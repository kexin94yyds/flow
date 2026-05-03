// Flow - 学习空间
(function () {
  'use strict';

  // 检测是否在 Electron 环境
  const isElectron = typeof require !== 'undefined';
  let ipcRenderer = null;
  if (isElectron) {
    try {
      ipcRenderer = require('electron').ipcRenderer;
    } catch (e) {
      // 非 Electron 环境
    }
  }

  // 数据存储 - 使用 items 数组格式（与 Dashboard 兼容）
  let items = [];
  
  // 兼容层：保持 flowData 接口，但数据来源于 items
  let flowData = {
    currentMode: 'video',
    currentContentId: null,
    contents: { video: [], book: [], paper: [], audio: [], web: [], history: [] },
    notes: { video: {}, book: {}, paper: {}, audio: {}, web: {}, history: {} }
  };

  // DOM 元素
  const modeBtns = document.querySelectorAll('.mode-btn[data-mode]');
  const modeTitle = document.getElementById('modeTitle');
  const modeSubtitle = document.getElementById('modeSubtitle');
  const mediaSection = document.getElementById('mediaSection');
  const mediaTitle = document.getElementById('mediaTitle');
  const mediaGrid = document.getElementById('mediaGrid');
  const mediaCount = document.getElementById('mediaCount');
  const mediaStatus = document.getElementById('mediaStatus');
  const sortSelect = document.getElementById('sortSelect');
  const contentTail = document.getElementById('contentTail');
  const recentList = document.getElementById('recentList');
  const tagCloud = document.getElementById('tagCloud');
  const tagSummary = document.getElementById('tagSummary');
  const progressGrid = document.getElementById('progressGrid');
  const progressSummary = document.getElementById('progressSummary');
  const progressBarFill = document.getElementById('progressBarFill');
  const quickActions = document.getElementById('quickActions');
  const viewToggleBtns = document.querySelectorAll('.view-toggle-btn');

  // 弹窗元素
  const noteModal = document.getElementById('noteModal');
  const noteModalTitle = document.getElementById('noteModalTitle');
  const noteModalContent = document.getElementById('noteModalContent');
  const noteModalClose = document.getElementById('noteModalClose');
  const noteCloseBtn = document.getElementById('noteCloseBtn');
  const noteDeleteBtn = document.getElementById('noteDeleteBtn');

  const contentModal = document.getElementById('contentModal');
  const contentModalClose = document.getElementById('contentModalClose');
  const contentUrlInput = document.getElementById('contentUrlInput');
  const contentAddBtn = document.getElementById('contentAddBtn');

  const addContentBtn = document.getElementById('addContentBtn');
  const pinBtn = document.getElementById('pinBtn');

  let currentNoteId = null;
  let currentEditId = null;
  let searchQuery = '';  // 搜索关键词
  let currentSort = 'newest';
  let currentView = 'grid';
  let historyArchiveOpen = false;
  let historyArchiveQuery = '';

  // 模式配置
  const modeConfig = {
    video: { title: '视频学习', icon: 'video', subtitle: '沉淀有价值的视频内容，构建你的知识体系' },
    book: { title: '书籍阅读', icon: 'book', subtitle: '收纳正在读的书，把重点和笔记留在同一处' },
    paper: { title: '论文研读', icon: 'paper', subtitle: '把论文、摘要和思考整理成连续的研究流' },
    audio: { title: '音频播客', icon: 'audio', subtitle: '收藏值得反复听的声音内容，提取可复用的观点' },
    web: { title: '网页收藏', icon: 'web', subtitle: '收好网页、文章和链接，把碎片变成线索' },
    history: { title: '历史项目', icon: 'history', subtitle: '把 Tab Out 的打开标签和稍后保存项目集中回看' },
    settings: { title: '设置', icon: 'settings', subtitle: '管理你的 Flow 配置与数据' }
  };

  // 初始化
  async function init() {
    await initEpubDB();
    await loadData();
    bindEvents();
    updateURLMode();
    render();
    
    // 自动聚焦搜索框
    setTimeout(() => {
      const searchInput = document.getElementById('searchInput');
      if (searchInput) searchInput.focus();
    }, 100);
  }

  // 加载数据
  async function loadData() {
    if (ipcRenderer) {
      // Electron 环境：从 electron-store 加载
      try {
        items = await ipcRenderer.invoke('get-items') || [];
        await itemsToFlowData();
      } catch (e) {
        console.error('从 Electron 加载数据失败', e);
        // 降级到 localStorage
        await loadFromLocalStorage();
      }
    } else {
      await loadFromLocalStorage();
    }
  }
  
  // 从 localStorage 加载
  async function loadFromLocalStorage() {
    const browserStorage = window.FlowStorage?.loadFlowBundle
      ? await window.FlowStorage.loadFlowBundle()
      : {};

    if (Array.isArray(browserStorage.flowItems) && browserStorage.flowItems.length > 0) {
      items = browserStorage.flowItems;
      await itemsToFlowData();
      if (browserStorage.flowNotes && typeof browserStorage.flowNotes === 'object') {
        flowData.notes = browserStorage.flowNotes;
      }
      return;
    }

    if (browserStorage.flowData) {
      try {
        const oldData = browserStorage.flowData;
        flowData.contents = oldData.contents || { video: [], book: [], paper: [], audio: [], web: [], history: [] };
        flowData.notes = browserStorage.flowNotes || oldData.notes || { video: {}, book: {}, paper: {}, audio: {}, web: {}, history: {} };
        flowDataToItems();
        return;
      } catch (e) {
        console.error('加载 chrome.storage.local 数据失败', e);
      }
    }

    // 先尝试加载新格式 items
    const savedItems = localStorage.getItem('flowItems');
    if (savedItems) {
      try {
        items = JSON.parse(savedItems);
        await itemsToFlowData();
        const savedNotes = localStorage.getItem('flowNotes');
        if (savedNotes) {
          flowData.notes = JSON.parse(savedNotes);
        }
        return;
      } catch (e) {}
    }
    
    // 回退到旧格式 flowData
    const saved = localStorage.getItem('flowData');
    if (saved) {
      try {
        const oldData = JSON.parse(saved);
        flowData.contents = oldData.contents || { video: [], book: [], paper: [], audio: [], web: [], history: [] };
        flowData.notes = oldData.notes || { video: {}, book: {}, paper: {}, audio: {}, web: {}, history: {} };
        // 将旧数据转换为 items 格式
        flowDataToItems();
      } catch (e) {
        console.error('加载数据失败', e);
      }
    }
  }
  
  // 将 items 数组转换为 flowData.contents 结构
  async function itemsToFlowData() {
    flowData.contents = { video: [], book: [], paper: [], audio: [], web: [], history: [] };
    
    for (const item of items) {
      const platform = (item.platform || '').toLowerCase();
      let mode = 'web';  // 默认为网页
      
      if (platform === 'book') mode = 'book';
      else if (platform === 'paper') mode = 'paper';
      else if (platform === 'audio') mode = 'audio';
      else if (platform === 'youtube' || platform === 'bilibili' || platform === 'video') mode = 'video';
      else if (platform === 'web' || platform === 'twitter') mode = 'web';
      
      // 如果 item 包含 fileData，保存到 IndexedDB
      if (item.fileData) {
        try {
          const arrayBuffer = base64ToArrayBuffer(item.fileData);
          await saveEpubToDB(item.id, arrayBuffer);
          // 清除 fileData，避免重复保存
          delete item.fileData;
        } catch (e) {
          console.error('保存文件到 IndexedDB 失败:', e);
        }
      }
      
      flowData.contents[mode].push({
        id: item.id,
        url: item.url,
        title: item.title,
        image: item.image,
        note: item.note,
        createdAt: item.createdAt,
        pinned: Boolean(item.pinned),
        platform: item.platform,
        author: item.author,
        hasEpubFile: item.hasEpubFile,
        hasAudioFile: item.hasAudioFile,
        fileName: item.fileName,
        fileSize: item.fileSize
      });
    }
  }

  // Base64 转 ArrayBuffer
  function base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  
  // 将 flowData.contents 转换为 items 数组
  function flowDataToItems() {
    items = [];
    const modes = ['video', 'book', 'paper', 'audio', 'web'];
    
    for (const mode of modes) {
      const contents = flowData.contents[mode] || [];
      for (const content of contents) {
        items.push({
          id: content.id,
          url: content.url || '',
          title: content.title || '未命名',
          category: 'read_later',
          note: content.note || '',
          image: content.image || '',
          platform: getPlatformFromMode(mode, content.url),
          createdAt: content.createdAt || new Date().toISOString(),
          pinned: Boolean(content.pinned),
          author: content.author,
          hasEpubFile: content.hasEpubFile,
          hasAudioFile: content.hasAudioFile,
          fileName: content.fileName,
          fileSize: content.fileSize
        });
      }
    }
  }

  // 根据模式和 URL 获取 platform
  function getPlatformFromMode(mode, url) {
    if (mode === 'book') return 'Book';
    if (mode === 'paper') return 'Paper';
    if (mode === 'audio') return 'Audio';
    if (mode === 'web') return 'Web';
    if (url?.includes('youtube.com') || url?.includes('youtu.be')) return 'YouTube';
    if (url?.includes('bilibili.com')) return 'Bilibili';
    return 'Video';
  }

  // 保存数据
  async function saveData() {
    // 先将 flowData 转换为 items
    flowDataToItems();
    
    if (ipcRenderer) {
      // Electron 环境：保存到 electron-store
      try {
        await ipcRenderer.invoke('set-items', items);
      } catch (e) {
        console.error('保存到 Electron 失败', e);
        // 降级到 localStorage
        localStorage.setItem('flowItems', JSON.stringify(items));
      }
    } else {
      // 网页环境：保存到 localStorage
      localStorage.setItem('flowItems', JSON.stringify(items));
    }
    
    // 笔记单独保存
    localStorage.setItem('flowNotes', JSON.stringify(flowData.notes));
    if (window.FlowStorage?.saveFlowBundle) {
      await window.FlowStorage.saveFlowBundle({
        flowItems: items,
        flowNotes: flowData.notes,
        flowData: {
          contents: flowData.contents,
          notes: flowData.notes
        }
      });
    }
  }

  // 更新 URL 模式
  function updateURLMode() {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('mode');
    if (mode && modeConfig[mode]) {
      flowData.currentMode = mode;
    }
  }

  // 设置 URL 模式
  function setURLMode(mode) {
    const url = new URL(window.location);
    url.searchParams.set('mode', mode);
    window.history.pushState({}, '', url);
  }

  // 绑定事件
  function bindEvents() {
    // 模式切换
    modeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        if (mode === 'settings') {
          alert('设置功能开发中...');
          return;
        }
        switchMode(mode);
      });
    });

    // 添加内容入口可能在精简布局中被隐藏。
    addContentBtn?.addEventListener('click', openContentModal);

    // 笔记弹窗
    noteModalClose.addEventListener('click', closeNoteModal);
    noteCloseBtn.addEventListener('click', closeNoteModal);
    noteDeleteBtn.addEventListener('click', deleteCurrentNote);
    noteModal.addEventListener('click', (e) => {
      if (e.target === noteModal) closeNoteModal();
    });

    // 内容弹窗
    contentModalClose.addEventListener('click', closeContentModal);
    contentModal.addEventListener('click', (e) => {
      if (e.target === contentModal) closeContentModal();
    });
    contentAddBtn.addEventListener('click', addContentFromUrl);

    // EPUB 上传
    const epubDropZone = document.getElementById('epubDropZone');
    const epubFileInput = document.getElementById('epubFileInput');
    const epubAddBtn = document.getElementById('epubAddBtn');
    
    epubDropZone.addEventListener('click', () => epubFileInput.click());
    epubDropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      epubDropZone.classList.add('drag-over');
    });
    epubDropZone.addEventListener('dragleave', () => {
      epubDropZone.classList.remove('drag-over');
    });
    epubDropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      epubDropZone.classList.remove('drag-over');
      if (e.dataTransfer.files[0]) {
        handleEpubFile(e.dataTransfer.files[0]);
      }
    });
    epubFileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) {
        handleEpubFile(e.target.files[0]);
      }
    });
    epubAddBtn.addEventListener('click', addEpubBook);

    // 论文添加
    document.getElementById('paperAddBtn').addEventListener('click', addPaper);

    // 网页添加
    document.getElementById('webAddBtn').addEventListener('click', addWebPage);

    // 音频上传
    const audioDropZone = document.getElementById('audioDropZone');
    const audioFileInput = document.getElementById('audioFileInput');
    const audioAddBtn = document.getElementById('audioAddBtn');
    
    audioDropZone.addEventListener('click', () => audioFileInput.click());
    audioDropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      audioDropZone.classList.add('drag-over');
    });
    audioDropZone.addEventListener('dragleave', () => {
      audioDropZone.classList.remove('drag-over');
    });
    audioDropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      audioDropZone.classList.remove('drag-over');
      if (e.dataTransfer.files[0]) {
        handleAudioFile(e.dataTransfer.files[0]);
      }
    });
    audioFileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) {
        handleAudioFile(e.target.files[0]);
      }
    });
    audioAddBtn.addEventListener('click', addAudioFile);

    // 备注点击编辑
    mediaGrid.addEventListener('click', (e) => {
      const noteEl = e.target.closest('.media-card-note');
      if (noteEl && !noteEl.querySelector('.note-edit-textarea')) {
        const contentId = noteEl.dataset.contentId;
        startNoteEdit(noteEl, contentId);
      }
    });
    mediaGrid.addEventListener('click', handleHistoryGridClick);
    mediaGrid.addEventListener('input', handleHistoryGridInput);

    // URL 变化监听
    window.addEventListener('popstate', () => {
      updateURLMode();
      render();
    });

    // 导出/导入
    document.getElementById('exportBtn').addEventListener('click', exportData);
    document.getElementById('importBtn').addEventListener('click', () => {
      document.getElementById('importFileInput').click();
    });
    document.getElementById('importFileInput').addEventListener('change', (e) => {
      if (e.target.files[0]) {
        importData(e.target.files[0]);
        e.target.value = '';
      }
    });

    // 置顶按钮
    if (pinBtn && ipcRenderer) {
      // 初始化置顶状态
      ipcRenderer.invoke('get-always-on-top').then(isPinned => {
        if (isPinned) pinBtn.classList.add('active');
      }).catch(() => {});
      
      pinBtn.addEventListener('click', async () => {
        try {
          const isPinned = await ipcRenderer.invoke('toggle-always-on-top');
          pinBtn.classList.toggle('active', isPinned);
          pinBtn.title = isPinned ? '取消置顶' : '置顶窗口';
        } catch (e) {
          console.error('切换置顶失败:', e);
        }
      });
    }

    // 键盘导航：Tab 切换模式（全局生效，包括搜索框）
    document.addEventListener('keydown', (e) => {
      // Tab 键切换模式
      if (e.key === 'Tab') {
        e.preventDefault();
        switchToNextMode(e.shiftKey);
      }
    });

    // 搜索功能
    const searchInput = document.getElementById('searchInput');
    const clearSearchBtn = document.getElementById('clearSearchBtn');
    
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.trim();
        clearSearchBtn.style.display = searchQuery ? 'block' : 'none';
        render();
      });
      
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          clearSearch();
        }
      });
    }
    
    if (clearSearchBtn) {
      clearSearchBtn.addEventListener('click', clearSearch);
    }

    if (sortSelect) {
      sortSelect.addEventListener('change', (e) => {
        currentSort = e.target.value || 'newest';
        render();
      });
    }

    viewToggleBtns.forEach(button => {
      button.addEventListener('click', () => {
        currentView = button.dataset.view || 'grid';
        render();
      });
    });
  }

  // 清除搜索
  function clearSearch() {
    const searchInput = document.getElementById('searchInput');
    const clearSearchBtn = document.getElementById('clearSearchBtn');
    if (searchInput) {
      searchInput.value = '';
      searchQuery = '';
      clearSearchBtn.style.display = 'none';
      render();
    }
  }

  // Tab 切换到下一个模式
  function switchToNextMode(reverse = false) {
    const modes = ['history', 'video', 'book', 'paper', 'audio', 'web'];
    const currentIndex = modes.indexOf(flowData.currentMode);
    
    let nextIndex;
    if (reverse) {
      // Shift+Tab 向上
      nextIndex = currentIndex - 1;
      if (nextIndex < 0) nextIndex = modes.length - 1;
    } else {
      // Tab 向下
      nextIndex = currentIndex + 1;
      if (nextIndex >= modes.length) nextIndex = 0;
    }
    
    switchMode(modes[nextIndex]);
  }

  // 切换模式
  function switchMode(mode) {
    flowData.currentMode = mode;
    setURLMode(mode);
    render();
  }

  // 渲染界面
  function render() {
    const mode = flowData.currentMode;
    const visibleContents = getVisibleContents(mode);
    const searchInput = document.getElementById('searchInput');

    // 更新模式按钮
    modeBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    // 更新标题
    modeTitle.textContent = modeConfig[mode]?.title || '学习空间';
    if (modeSubtitle) {
      modeSubtitle.textContent = modeConfig[mode]?.subtitle || '把内容和笔记整理到同一个 Flow 里';
    }
    if (searchInput) {
      searchInput.placeholder = getSearchPlaceholder(mode);
    }
    if (sortSelect) {
      sortSelect.value = currentSort;
      const sortWrap = sortSelect.closest('.media-sort');
      if (sortWrap) {
        sortWrap.style.display = mode === 'history' ? 'none' : '';
      }
    }
    viewToggleBtns.forEach(button => {
      button.classList.toggle('active', button.dataset.view === currentView);
    });
    const viewToggle = viewToggleBtns[0]?.closest('.view-toggle');
    if (viewToggle) {
      viewToggle.style.display = mode === 'history' ? 'none' : '';
    }

    // 渲染媒体区和右侧辅助列
    renderMedia(visibleContents);
    renderInsights(visibleContents);
  }

  function getVisibleContents(mode = flowData.currentMode) {
    let contents = [...(flowData.contents[mode] || [])];
    // 搜索过滤
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      contents = contents.filter(content => {
        const title = (content.title || '').toLowerCase();
        const note = (content.note || '').toLowerCase();
        const platform = (content.platform || getPlatformText(content.url, mode) || '').toLowerCase();
        return title.includes(query) || note.includes(query) || platform.includes(query);
      });
    }

    contents.sort((a, b) => {
      if (currentSort === 'oldest') {
        return getTimestamp(a.createdAt) - getTimestamp(b.createdAt);
      }
      if (currentSort === 'pinned') {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
      }
      return getTimestamp(b.createdAt) - getTimestamp(a.createdAt);
    });

    return contents;
  }

  // 渲染媒体卡片网格
  function renderMedia(contents) {
    const mode = flowData.currentMode;

    // 更新标题
    const titleMap = {
      video: '视频列表',
      book: '书籍列表',
      paper: '论文列表',
      audio: '音频列表',
      web: '网页收藏',
      history: '历史项目'
    };
    mediaTitle.textContent = titleMap[mode] || '内容列表';
    if (mediaCount) {
      mediaCount.textContent = String(contents.length);
    }
    if (mediaStatus) {
      mediaStatus.textContent = getStatusLabel(mode, contents);
    }
    if (mediaGrid) {
      mediaGrid.classList.toggle('list-view', currentView === 'list');
    }

    if (mode === 'history') {
      renderHistoryMode();
      return;
    }

    if (contents.length === 0) {
      renderMediaPlaceholder();
      if (contentTail) {
        contentTail.textContent = '';
      }
      return;
    }

    // 渲染卡片
    mediaGrid.innerHTML = contents.map(content => renderMediaCard(content, mode)).join('');

    // 绑定事件
    mediaGrid.querySelectorAll('.media-card').forEach(card => {
      const id = card.dataset.id;
      card.querySelector('.media-card-thumb').addEventListener('click', () => openContent(id));
      card.querySelector('.media-card-btn.pin')?.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePin(id);
      });
      card.querySelector('.media-card-btn.delete')?.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteContent(id);
      });

      // 笔记添加按钮
      card.querySelector('.card-notes-add')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openNoteFileDialog(id);
      });

      // 笔记点击
      card.querySelectorAll('.card-note-item').forEach(noteItem => {
        noteItem.addEventListener('click', (e) => {
          e.stopPropagation();
          openNoteModal(noteItem.dataset.noteId, noteItem.dataset.contentId);
        });
      });

      // 卡片拖拽上传
      const notesArea = card.querySelector('.media-card-notes');
      notesArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        notesArea.classList.add('drag-over');
      });
      notesArea.addEventListener('dragleave', () => {
        notesArea.classList.remove('drag-over');
      });
      notesArea.addEventListener('drop', (e) => {
        e.preventDefault();
        notesArea.classList.remove('drag-over');
        handleCardFileDrop(e.dataTransfer.files, id);
      });
    });

    if (contentTail) {
      contentTail.textContent = '';
    }
  }

  // 打开笔记文件选择器
  function openNoteFileDialog(contentId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown';
    input.onchange = (e) => handleCardFileDrop(e.target.files, contentId);
    input.click();
  }

  // 处理卡片文件拖拽
  function handleCardFileDrop(files, contentId) {
    Array.from(files).forEach(file => {
      if (file.name.endsWith('.md') || file.name.endsWith('.markdown')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          addNoteToContent(file.name.replace(/\.(md|markdown)$/, ''), e.target.result, contentId);
        };
        reader.readAsText(file);
      }
    });
  }

  // 添加笔记到指定内容
  function addNoteToContent(title, content, contentId) {
    const mode = flowData.currentMode;

    if (!flowData.notes[mode]) {
      flowData.notes[mode] = {};
    }
    if (!flowData.notes[mode][contentId]) {
      flowData.notes[mode][contentId] = [];
    }

    const note = {
      id: generateId(),
      title,
      content,
      preview: content.substring(0, 80).replace(/[#*`\n]/g, ' ').trim(),
      createdAt: Date.now()
    };

    flowData.notes[mode][contentId].push(note);
    saveData();
    render();
  }

  // 渲染单个媒体卡片
  function renderMediaCard(content, mode) {
    const platformClass = getPlatformClass(content.url, mode);
    const platformText = getPlatformText(content.url, mode);
    const thumbHtml = getThumbHtml(content, mode);
    const notes = flowData.notes[mode]?.[content.id] || [];
    const noteItems = notes.slice(0, 2);
    const hasThumb = thumbHtml.includes('<img');

    // 根据模式显示不同图标
    const iconSvg = mode === 'book' 
      ? `<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>`
      : mode === 'paper'
      ? `<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>`
      : mode === 'audio'
      ? `<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/></svg>`
      : mode === 'web'
      ? `<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/></svg>`
      : `<svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;

    return `
      <div class="media-card" data-id="${content.id}">
        <div class="media-card-thumb ${hasThumb ? 'has-thumb' : ''}">
          ${thumbHtml}
          <div class="media-card-play ${hasThumb ? 'overlay' : ''}">
            ${iconSvg}
          </div>
        </div>
        <div class="media-card-body">
          <div class="media-card-content">
            <div class="media-card-meta">
              <span class="media-card-platform ${platformClass}">${platformText}</span>
              <span style="font-size: 11px; color: #9ca3af;">稍后阅读</span>
            </div>
            <div class="media-card-title">${escapeHtml(content.title)}</div>
            ${content.author ? `<div style="font-size: 12px; color: #6b7280; margin-top: 2px;">${escapeHtml(content.author)}</div>` : ''}
            <div class="media-card-note" data-content-id="${content.id}" title="点击编辑备注">${content.note ? escapeHtml(content.note) : '<span class="media-note-placeholder">点击添加备注...</span>'}</div>
          </div>
          <div class="media-card-notes" data-content-id="${content.id}">
            <div class="card-notes-header">
              <span>笔记 ${notes.length > 0 ? `(${notes.length})` : ''}</span>
              <button class="card-notes-add" data-content-id="${content.id}">+ 添加</button>
            </div>
            <div class="card-notes-list">
              ${notes.length > 0 ? noteItems.map(note => `
                <div class="card-note-item" data-note-id="${note.id}" data-content-id="${content.id}">
                  <div class="card-note-title">${escapeHtml(note.title)}</div>
                  <div class="card-note-preview">${escapeHtml(note.preview || '')}</div>
                </div>
              `).join('') : '<div class="card-notes-empty">拖入 .md 或点击添加笔记</div>'}
            </div>
          </div>
          <div class="media-card-footer">
            <span>${formatDate(content.createdAt)}</span>
            <div class="media-card-actions">
              <button class="media-card-btn pin ${content.pinned ? 'active' : ''}">${content.pinned ? '已置顶' : '置顶'}</button>
              <button class="media-card-btn delete">删除</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // 获取平台样式类
  function getPlatformClass(url, mode) {
    if (mode === 'book') return 'book';
    if (mode === 'paper') return 'paper';
    if (mode === 'audio') return 'audio';
    if (mode === 'web') return 'web';
    if (url?.includes('youtube.com') || url?.includes('youtu.be')) return 'youtube';
    if (url?.includes('bilibili.com')) return 'bilibili';
    return 'youtube';
  }

  // 获取平台文本
  function getPlatformText(url, mode) {
    if (mode === 'book') return '书籍';
    if (mode === 'paper') return '论文';
    if (mode === 'audio') return '音频';
    if (mode === 'web') return '网页';
    if (url?.includes('youtube.com') || url?.includes('youtu.be')) return 'YouTube';
    if (url?.includes('bilibili.com')) return 'Bilibili';
    return '视频';
  }

  // 获取缩略图 HTML
  function getThumbHtml(content, mode) {
    // 优先使用存储的图片
    if (content.image) {
      return `<img src="${content.image}" alt="">`;
    }
    // YouTube 缩略图
    if (content.url?.includes('youtube.com') || content.url?.includes('youtu.be')) {
      const videoId = extractYouTubeId(content.url);
      if (videoId) {
        return `<img src="https://img.youtube.com/vi/${videoId}/mqdefault.jpg" alt="">`;
      }
    }
    // 其他情况显示默认背景
    return '';
  }

  // 渲染空状态
  function renderMediaPlaceholder() {
    mediaGrid.innerHTML = `
      <div class="media-placeholder" aria-hidden="true"></div>
    `;
  }

  async function renderTabOutBoard() {
    if (!mediaGrid) return;

    renderMediaPlaceholder();

    const boardData = await loadTabOutBoardData();
    const openTabs = filterHistoryCards(boardData.openTabs);
    const activeSavedTabs = filterHistoryCards(boardData.activeSavedTabs);
    const archivedSavedTabs = filterHistoryCards(boardData.archivedSavedTabs);
    const totalCount = openTabs.length + activeSavedTabs.length + archivedSavedTabs.length;

    if (mediaCount) {
      mediaCount.textContent = String(totalCount);
    }
    if (mediaStatus) {
      mediaStatus.textContent = getHistoryStatusLabel(openTabs, activeSavedTabs, archivedSavedTabs);
    }

    if (totalCount === 0) {
      mediaGrid.innerHTML = `
        <section class="tabout-board-empty">
          <div>
            <strong>${searchQuery ? '没有匹配的历史项目' : '还没有历史项目'}</strong>
            <p>${searchQuery ? '试试换个关键词，或者先清空搜索。' : '等你在 Tab Out 里积累打开标签和稍后保存项目后，这里会集中展示。'}</p>
          </div>
        </section>
      `;
      return;
    }

    mediaGrid.innerHTML = `
      <div class="tabout-board">
        ${renderOpenTabsSection(openTabs)}
        ${renderSavedTabsSection(activeSavedTabs, archivedSavedTabs)}
      </div>
    `;
  }

  async function renderHistoryMode() {
    await renderTabOutBoard();
  }

  function renderOpenTabsSection(openTabs) {
    if (!openTabs.length) return '';

    const duplicateCount = openTabs.reduce((sum, tab) => sum + Math.max(0, (tab.duplicateCount || 1) - 1), 0);

    return `
      <section class="tabout-board-section">
        <div class="tabout-board-heading tabout-board-heading-actions">
          <div class="tabout-board-heading-copy">
            <strong>Open tabs</strong>
            <span>${escapeHtml(`${openTabs.length} tabs${duplicateCount ? ` · ${duplicateCount} duplicates` : ''}`)}</span>
          </div>
          <div class="tabout-board-heading-tools">
            <button class="tabout-inline-action" data-history-action="close-all-open-tabs">全部关闭</button>
          </div>
        </div>
        <div class="tabout-project-grid">
          ${openTabs.map(card => renderOpenTabCard(card)).join('')}
        </div>
      </section>
    `;
  }

  function renderSavedTabsSection(activeSavedTabs, archivedSavedTabs) {
    const archiveItems = filterHistoryArchiveItems(archivedSavedTabs);
    const archiveSummary = archivedSavedTabs.length
      ? `Archive ${archivedSavedTabs.length}${historyArchiveQuery ? ` · ${archiveItems.length} 命中` : ''}`
      : 'Archive 0';

    return `
      <section class="tabout-board-section">
        <div class="tabout-board-heading">
          <strong>Saved for later</strong>
          <span>${escapeHtml(`${activeSavedTabs.length} items`)}</span>
        </div>
        <div class="history-saved-list">
          ${activeSavedTabs.length
            ? activeSavedTabs.map(item => renderSavedTabRow(item)).join('')
            : `<div class="history-empty-copy">${searchQuery ? '没有匹配的稍后保存项目' : '还没有 active 的稍后保存项目'}</div>`}
        </div>
        <section class="history-archive-panel">
          <button class="history-archive-toggle ${historyArchiveOpen ? 'open' : ''}" data-history-action="toggle-archive">
            <span>${escapeHtml(archiveSummary)}</span>
            <span>${historyArchiveOpen ? '收起' : '展开'}</span>
          </button>
          ${historyArchiveOpen ? `
            <div class="history-archive-body">
              <input
                type="text"
                class="history-archive-search"
                value="${escapeHtml(historyArchiveQuery)}"
                placeholder="搜索归档标题或链接..."
              >
              <div class="history-archive-list">
                ${archiveItems.length
                  ? archiveItems.map(item => renderArchiveTabRow(item)).join('')
                  : `<div class="history-empty-copy">${historyArchiveQuery ? '没有匹配的归档项目' : '还没有归档项目'}</div>`}
              </div>
            </div>
          ` : ''}
        </section>
      </section>
    `;
  }

  function renderOpenTabCard(card) {
    const url = card.url || '#';
    const title = card.title || card.url || 'Untitled';
    const domain = getBoardDomain(url) || 'Tab Out';
    const favicon = card.faviconUrl || getBoardFavicon(url);
    const duplicatePill = card.duplicateCount > 1
      ? `<div class="tabout-project-pill warn">${card.duplicateCount} 个重复</div>`
      : `<div class="tabout-project-pill">打开标签</div>`;

    return `
      <article class="tabout-project-card" data-tab-url="${escapeHtml(url)}">
        <button class="tabout-project-thumb tabout-card-pressable" data-history-action="focus-open-tab" data-tab-url="${escapeHtml(url)}" title="切换到此标签">
          ${favicon ? `<img src="${escapeHtml(favicon)}" alt="" data-hide-on-error="true">` : ''}
        </button>
        <div class="tabout-project-body">
          <div class="tabout-project-domain">${escapeHtml(domain)}</div>
          <button class="tabout-project-title tabout-card-pressable text" data-history-action="focus-open-tab" data-tab-url="${escapeHtml(url)}" title="${escapeHtml(title)}">${escapeHtml(title)}</button>
          ${duplicatePill}
          <div class="tabout-project-url">${escapeHtml(url)}</div>
          <div class="tabout-project-actions">
            <button class="tabout-action-btn primary" data-history-action="focus-open-tab" data-tab-url="${escapeHtml(url)}">打开</button>
            <button class="tabout-action-btn" data-history-action="defer-open-tab" data-tab-url="${escapeHtml(url)}" data-tab-title="${escapeHtml(title)}">稍后</button>
            <button class="tabout-action-btn" data-history-action="save-open-tab-flow" data-tab-url="${escapeHtml(url)}" data-tab-title="${escapeHtml(title)}">Flow</button>
            <button class="tabout-action-btn danger" data-history-action="close-open-tab" data-tab-id="${card.id}" data-tab-url="${escapeHtml(url)}">关闭</button>
            ${card.duplicateCount > 1 ? `<button class="tabout-action-btn" data-history-action="dedup-open-tabs" data-tab-url="${escapeHtml(url)}">去重</button>` : ''}
          </div>
        </div>
      </article>
    `;
  }

  function renderSavedTabRow(item) {
    const domain = getBoardDomain(item.url) || 'Tab Out';
    const title = item.title || item.url || 'Untitled';

    return `
      <div class="history-saved-row">
        <button class="history-check-btn" data-history-action="complete-saved-tab" data-saved-id="${item.id}" title="标记完成">✓</button>
        <div class="history-saved-main">
          <a class="history-saved-title" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(title)}</a>
          <div class="history-saved-meta">${escapeHtml(domain)} · 保存于 ${escapeHtml(formatRelativeDate(item.savedAt))}</div>
        </div>
        <button class="history-dismiss-btn" data-history-action="dismiss-saved-tab" data-saved-id="${item.id}" title="移除">×</button>
      </div>
    `;
  }

  function renderArchiveTabRow(item) {
    const title = item.title || item.url || 'Untitled';
    const stamp = item.completedAt || item.savedAt;
    return `
      <a class="history-archive-item" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">
        <span class="history-archive-item-title">${escapeHtml(title)}</span>
        <span class="history-archive-item-date">${escapeHtml(formatRelativeDate(stamp))}</span>
      </a>
    `;
  }

  async function loadTabOutBoardData() {
    const [openTabs, savedTabs] = await Promise.all([
      loadTabOutOpenTabs(),
      loadTabOutDeferredTabs()
    ]);

    return {
      openTabs,
      activeSavedTabs: savedTabs.active,
      archivedSavedTabs: savedTabs.archived
    };
  }

  function filterHistoryCards(cards) {
    if (!searchQuery) return cards;
    const query = searchQuery.toLowerCase();
    return cards.filter(card => {
      const title = (card.title || '').toLowerCase();
      const url = (card.url || '').toLowerCase();
      const domain = (getBoardDomain(card.url) || '').toLowerCase();
      return title.includes(query) || url.includes(query) || domain.includes(query);
    });
  }

  function filterHistoryArchiveItems(cards) {
    if (!historyArchiveQuery) return cards;
    const query = historyArchiveQuery.toLowerCase();
    return cards.filter(card => {
      const title = (card.title || '').toLowerCase();
      const url = (card.url || '').toLowerCase();
      return title.includes(query) || url.includes(query);
    });
  }

  async function loadTabOutOpenTabs() {
    if (typeof chrome === 'undefined' || !chrome.tabs?.query) return [];

    try {
      const extensionUrl = chrome.runtime?.id ? `chrome-extension://${chrome.runtime.id}/` : '';
      const tabs = (await chrome.tabs.query({})).filter(tab => isBoardUrl(tab.url, extensionUrl));
      const urlCounts = new Map();

      tabs.forEach(tab => {
        if (!tab.url) return;
        urlCounts.set(tab.url, (urlCounts.get(tab.url) || 0) + 1);
      });

      return tabs
        .map(tab => ({
          id: tab.id,
          url: tab.url,
          title: tab.title || tab.url || 'Untitled',
          faviconUrl: tab.favIconUrl || getBoardFavicon(tab.url),
          duplicateCount: urlCounts.get(tab.url) || 1
        }));
    } catch (err) {
      console.warn('[flow] Could not load Tab Out open tabs:', err);
      return [];
    }
  }

  async function loadTabOutDeferredTabs() {
    try {
      const stored = window.FlowStorage?.getMany
        ? await window.FlowStorage.getMany(['deferred'])
        : {};
      const deferred = Array.isArray(stored.deferred) ? stored.deferred : [];
      const visible = deferred.filter(item => !item.dismissed);
      const normalize = item => ({
        id: item.id,
        url: item.url,
        title: item.title || item.url || 'Untitled',
        faviconUrl: getBoardFavicon(item.url),
        savedAt: item.savedAt,
        completedAt: item.completedAt,
        completed: Boolean(item.completed)
      });

      return {
        active: visible
          .filter(item => !item.completed)
          .sort((a, b) => getTimestamp(b.savedAt) - getTimestamp(a.savedAt))
          .map(normalize),
        archived: visible
          .filter(item => item.completed)
          .sort((a, b) => getTimestamp(b.completedAt || b.savedAt) - getTimestamp(a.completedAt || a.savedAt))
          .map(normalize)
      };
    } catch (err) {
      console.warn('[flow] Could not load Tab Out saved tabs:', err);
      return { active: [], archived: [] };
    }
  }

  function isBoardUrl(url, extensionUrl) {
    if (!url) return false;
    if (extensionUrl && url.startsWith(extensionUrl)) return false;
    return !/^(chrome|chrome-extension|edge|about):/i.test(url);
  }

  function getBoardDomain(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }

  function getBoardFavicon(url) {
    const domain = getBoardDomain(url);
    return domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32` : '';
  }

  async function handleHistoryGridClick(event) {
    if (flowData.currentMode !== 'history') return;

    const actionEl = event.target.closest('[data-history-action]');
    if (!actionEl) return;

    event.preventDefault();
    const action = actionEl.dataset.historyAction;
    const tabUrl = actionEl.dataset.tabUrl;
    const tabTitle = actionEl.dataset.tabTitle || tabUrl || '';
    const savedId = actionEl.dataset.savedId;
    const tabId = Number(actionEl.dataset.tabId);

    if (action === 'focus-open-tab') {
      await focusHistoryTab(tabUrl);
      return;
    }

    if (action === 'defer-open-tab') {
      await saveHistoryTabForLater({ url: tabUrl, title: tabTitle });
      await closeHistoryTab(tabUrl, tabId);
      render();
      return;
    }

    if (action === 'save-open-tab-flow') {
      await saveHistoryTabToFlow({ url: tabUrl, title: tabTitle });
      render();
      return;
    }

    if (action === 'close-open-tab') {
      await closeHistoryTab(tabUrl, tabId);
      render();
      return;
    }

    if (action === 'close-all-open-tabs') {
      await closeAllHistoryOpenTabs();
      render();
      return;
    }

    if (action === 'dedup-open-tabs') {
      await closeDuplicateHistoryTabs(tabUrl);
      render();
      return;
    }

    if (action === 'complete-saved-tab' && savedId) {
      await completeHistorySavedTab(savedId);
      render();
      return;
    }

    if (action === 'dismiss-saved-tab' && savedId) {
      await dismissHistorySavedTab(savedId);
      render();
      return;
    }

    if (action === 'toggle-archive') {
      historyArchiveOpen = !historyArchiveOpen;
      await renderTabOutBoard();
    }
  }

  async function handleHistoryGridInput(event) {
    if (flowData.currentMode !== 'history') return;
    if (!event.target.classList.contains('history-archive-search')) return;

    historyArchiveQuery = event.target.value.trim();
    const cursor = event.target.selectionStart ?? historyArchiveQuery.length;
    await renderTabOutBoard();
    const nextInput = mediaGrid.querySelector('.history-archive-search');
    if (nextInput) {
      nextInput.focus();
      nextInput.setSelectionRange(cursor, cursor);
    }
  }

  async function focusHistoryTab(url) {
    if (!url || typeof chrome === 'undefined' || !chrome.tabs?.query) return;

    const allTabs = await chrome.tabs.query({});
    const currentWindow = chrome.windows?.getCurrent ? await chrome.windows.getCurrent() : null;
    let matches = allTabs.filter(tab => tab.url === url);

    if (matches.length === 0) {
      try {
        const targetHost = new URL(url).hostname;
        matches = allTabs.filter(tab => {
          try {
            return new URL(tab.url).hostname === targetHost;
          } catch {
            return false;
          }
        });
      } catch {}
    }

    if (matches.length === 0) return;

    const match = matches.find(tab => currentWindow && tab.windowId !== currentWindow.id) || matches[0];
    await chrome.tabs.update(match.id, { active: true });
    if (chrome.windows?.update) {
      await chrome.windows.update(match.windowId, { focused: true });
    }
  }

  async function closeHistoryTab(url, tabId) {
    if (typeof chrome === 'undefined' || !chrome.tabs?.remove) return;

    if (Number.isFinite(tabId)) {
      await chrome.tabs.remove(tabId);
      return;
    }

    const allTabs = await chrome.tabs.query({});
    const match = allTabs.find(tab => tab.url === url);
    if (match) {
      await chrome.tabs.remove(match.id);
    }
  }

  async function closeAllHistoryOpenTabs() {
    if (typeof chrome === 'undefined' || !chrome.tabs?.query) return;

    const openTabs = await loadTabOutOpenTabs();
    const ids = openTabs.map(tab => tab.id).filter(Number.isFinite);
    if (ids.length) {
      await chrome.tabs.remove(ids);
    }
  }

  async function closeDuplicateHistoryTabs(url) {
    if (!url || typeof chrome === 'undefined' || !chrome.tabs?.query) return;

    const allTabs = await chrome.tabs.query({});
    const matching = allTabs.filter(tab => tab.url === url);
    if (matching.length <= 1) return;

    const keep = matching.find(tab => tab.active) || matching[0];
    const toClose = matching.filter(tab => tab.id !== keep.id).map(tab => tab.id);
    if (toClose.length) {
      await chrome.tabs.remove(toClose);
    }
  }

  async function saveHistoryTabForLater(tab) {
    if (!tab?.url) return;

    const stored = window.FlowStorage?.getMany
      ? await window.FlowStorage.getMany(['deferred'])
      : {};
    const deferred = Array.isArray(stored.deferred) ? stored.deferred : [];

    deferred.push({
      id: Date.now().toString(),
      url: tab.url,
      title: tab.title || tab.url,
      savedAt: new Date().toISOString(),
      completed: false,
      dismissed: false
    });

    if (window.FlowStorage?.setMany) {
      await window.FlowStorage.setMany({ deferred });
    } else if (window.FlowStorage?.set) {
      await window.FlowStorage.set('deferred', deferred);
    } else if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ deferred });
    }
  }

  async function completeHistorySavedTab(id) {
    if (!id) return;

    const stored = window.FlowStorage?.getMany
      ? await window.FlowStorage.getMany(['deferred'])
      : {};
    const deferred = Array.isArray(stored.deferred) ? stored.deferred : [];
    const item = deferred.find(entry => entry.id === id);
    if (!item) return;

    item.completed = true;
    item.completedAt = new Date().toISOString();

    if (window.FlowStorage?.setMany) {
      await window.FlowStorage.setMany({ deferred });
    } else if (window.FlowStorage?.set) {
      await window.FlowStorage.set('deferred', deferred);
    } else if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ deferred });
    }
  }

  async function dismissHistorySavedTab(id) {
    if (!id) return;

    const stored = window.FlowStorage?.getMany
      ? await window.FlowStorage.getMany(['deferred'])
      : {};
    const deferred = Array.isArray(stored.deferred) ? stored.deferred : [];
    const item = deferred.find(entry => entry.id === id);
    if (!item) return;

    item.dismissed = true;

    if (window.FlowStorage?.setMany) {
      await window.FlowStorage.setMany({ deferred });
    } else if (window.FlowStorage?.set) {
      await window.FlowStorage.set('deferred', deferred);
    } else if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ deferred });
    }
  }

  async function saveHistoryTabToFlow(tab) {
    if (!tab?.url) return;

    const existingItem = findFlowItemByUrl(tab.url);
    const targetMode = inferHistoryFlowMode(tab.url);
    const payload = {
      id: existingItem?.id || generateId(),
      url: tab.url,
      title: tab.title || tab.url,
      image: existingItem?.image || '',
      note: existingItem?.note || getBoardDomain(tab.url),
      createdAt: existingItem?.createdAt || new Date().toISOString(),
      pinned: existingItem?.pinned || false,
      platform: getPlatformFromMode(targetMode, tab.url)
    };

    if (existingItem) {
      Object.assign(existingItem, payload);
    } else {
      flowData.contents[targetMode] = flowData.contents[targetMode] || [];
      flowData.contents[targetMode].unshift(payload);
    }

    await saveData();
  }

  function findFlowItemByUrl(url) {
    return Object.values(flowData.contents)
      .flat()
      .find(item => item.url === url) || null;
  }

  function inferHistoryFlowMode(url) {
    if (url?.includes('youtube.com') || url?.includes('youtu.be') || url?.includes('bilibili.com')) {
      return 'video';
    }
    return 'web';
  }

  function renderInsights(contents) {
    if (flowData.currentMode === 'history') {
      renderHistoryInsights();
      return;
    }

    renderRecentList(contents);
    renderTagCloud(contents);
    renderProgress(contents);
    renderQuickActions();
  }

  async function renderHistoryInsights() {
    const boardData = await loadTabOutBoardData();
    const openTabs = filterHistoryCards(boardData.openTabs);
    const activeSavedTabs = filterHistoryCards(boardData.activeSavedTabs);
    const archivedSavedTabs = filterHistoryCards(boardData.archivedSavedTabs);
    const historyItems = [
      ...openTabs.map(item => ({ ...item, bucket: '打开标签' })),
      ...activeSavedTabs.map(item => ({ ...item, bucket: '稍后保存' })),
      ...archivedSavedTabs.map(item => ({ ...item, bucket: '已归档' }))
    ];

    renderHistoryRecentList(historyItems);
    renderHistoryTagCloud(openTabs, activeSavedTabs, archivedSavedTabs, historyItems);
    renderHistoryProgress(openTabs, activeSavedTabs, archivedSavedTabs, historyItems);
    renderQuickActions();
  }

  function renderHistoryRecentList(historyItems) {
    if (!recentList) return;

    if (historyItems.length === 0) {
      recentList.innerHTML = `<div class="progress-subtext">${searchQuery ? '没有匹配的历史项目' : '还没有可展示的历史项目'}</div>`;
      return;
    }

    recentList.innerHTML = historyItems.slice(0, 3).map(item => `
      <div class="recent-item">
        <div class="recent-thumb">${item.faviconUrl ? `<img src="${escapeHtml(item.faviconUrl)}" alt="">` : '<span>历</span>'}</div>
        <div>
          <div class="recent-item-title">${escapeHtml(item.title || '未命名项目')}</div>
          <div class="recent-item-meta">${escapeHtml(item.bucket)} · ${escapeHtml(getBoardDomain(item.url) || 'Tab Out')}</div>
        </div>
        <span class="bookmark-mark">⌁</span>
      </div>
    `).join('');
  }

  function renderHistoryTagCloud(openTabs, activeSavedTabs, archivedSavedTabs, historyItems) {
    if (!tagCloud || !tagSummary) return;

    const domainBuckets = new Map();
    historyItems.forEach(item => {
      const domain = getBoardDomain(item.url) || '其他';
      domainBuckets.set(domain, (domainBuckets.get(domain) || 0) + 1);
    });

    const chips = [
      { label: '历史模式', count: historyItems.length },
      { label: 'Open tabs', count: openTabs.length },
      { label: 'Saved for later', count: activeSavedTabs.length },
      { label: 'Archive', count: archivedSavedTabs.length }
    ];

    Array.from(domainBuckets.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .forEach(([label, count]) => chips.push({ label, count }));

    tagSummary.textContent = `${historyItems.length} 个历史项目`;
    tagCloud.innerHTML = chips.map(chip => `
      <span class="tag-chip">
        <span>${escapeHtml(chip.label)}</span>
        <span class="tag-chip-count">${chip.count}</span>
      </span>
    `).join('');
  }

  function renderHistoryProgress(openTabs, activeSavedTabs, archivedSavedTabs, historyItems) {
    if (!progressGrid || !progressSummary || !progressBarFill) return;

    const totalCount = historyItems.length;
    const revisitScore = totalCount ? Math.min(100, Math.round(((activeSavedTabs.length + archivedSavedTabs.length) / Math.max(totalCount, 1)) * 100)) : 0;

    progressGrid.innerHTML = [
      { label: '打开标签', value: openTabs.length, subtext: '当前浏览中' },
      { label: '稍后保存', value: activeSavedTabs.length, subtext: '待回看' },
      { label: '已归档', value: archivedSavedTabs.length, subtext: '已完成' }
    ].map(metric => `
      <div class="progress-metric">
        <div class="progress-label">${metric.label}</div>
        <div class="progress-value">${metric.value}</div>
        <div class="progress-subtext">${metric.subtext}</div>
      </div>
    `).join('');

    progressSummary.textContent = totalCount > 0
      ? `共 ${totalCount} 个历史项目，待回看 ${activeSavedTabs.length} 个，已归档 ${archivedSavedTabs.length} 个`
      : searchQuery
        ? '当前搜索词下没有命中历史项目'
        : '还没有积累到可回看的历史项目';
    progressBarFill.style.width = `${revisitScore}%`;
  }

  function renderRecentList(contents) {
    if (!recentList) return;

    if (contents.length === 0) {
      recentList.innerHTML = '<div class="progress-subtext">还没有收藏内容</div>';
      return;
    }

    recentList.innerHTML = contents.slice(0, 3).map(content => `
      <div class="recent-item">
        <div class="recent-thumb">${getMiniThumbHtml(content, flowData.currentMode)}</div>
        <div>
          <div class="recent-item-title">${escapeHtml(content.title || '未命名内容')}</div>
          <div class="recent-item-meta">${escapeHtml(getPlatformText(content.url, flowData.currentMode))} · ${escapeHtml(formatRelativeDate(content.createdAt))}</div>
        </div>
        <span class="bookmark-mark">${content.pinned ? '★' : '⌁'}</span>
      </div>
    `).join('');
  }

  function renderTagCloud(contents) {
    if (!tagCloud || !tagSummary) return;

    const chips = [];
    const mode = flowData.currentMode;
    const notesCount = contents.filter(content => (content.note || '').trim()).length;
    const pinnedCount = contents.filter(content => content.pinned).length;
    const sourceBuckets = new Map();

    contents.forEach(content => {
      const label = getPlatformText(content.url, mode);
      sourceBuckets.set(label, (sourceBuckets.get(label) || 0) + 1);
    });

    chips.push({ label: modeConfig[mode]?.title || '当前模式', count: contents.length });
    if (pinnedCount > 0) chips.push({ label: '置顶', count: pinnedCount });
    if (notesCount > 0) chips.push({ label: '有备注', count: notesCount });

    Array.from(sourceBuckets.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .forEach(([label, count]) => chips.push({ label, count }));

    tagSummary.textContent = `${contents.length} 条内容`;
    tagCloud.innerHTML = chips.map(chip => `
      <span class="tag-chip">
        <span>${escapeHtml(chip.label)}</span>
        <span class="tag-chip-count">${chip.count}</span>
      </span>
    `).join('');
  }

  function renderProgress(contents) {
    if (!progressGrid || !progressSummary || !progressBarFill) return;

    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const totalNotes = contents.reduce((sum, content) => {
      const notes = flowData.notes[flowData.currentMode]?.[content.id] || [];
      return sum + notes.length;
    }, 0);
    const thisWeekCount = contents.filter(content => getTimestamp(content.createdAt) >= sevenDaysAgo).length;
    const pinnedCount = contents.filter(content => content.pinned).length;
    const focusScore = contents.length
      ? Math.min(100, Math.round(((pinnedCount * 2) + totalNotes + thisWeekCount) / Math.max(contents.length, 1) * 20))
      : 0;

    progressGrid.innerHTML = [
      { label: '内容总量', value: contents.length, subtext: '当前模式' },
      { label: '新增条目', value: thisWeekCount, subtext: '最近 7 天' }
    ].map(metric => `
      <div class="progress-metric">
        <div class="progress-label">${metric.label}</div>
        <div class="progress-value">${metric.value}</div>
        <div class="progress-subtext">${metric.subtext}</div>
      </div>
    `).join('');

    progressSummary.textContent = totalNotes > 0
      ? `累计写下 ${totalNotes} 条笔记，当前置顶 ${pinnedCount} 条`
      : pinnedCount > 0
        ? `当前置顶 ${pinnedCount} 条，建议继续补充笔记`
        : '先收藏几条高质量内容，再慢慢整理';
    progressBarFill.style.width = `${focusScore}%`;
  }

  function renderQuickActions() {
    if (!quickActions) return;

    quickActions.innerHTML = [
      { action: 'focus-search', title: '搜索内容', desc: '立即定位卡片' },
      { action: 'add-content', title: '添加内容', desc: '继续往 Flow 里收' },
      { action: 'clear-search', title: '清空筛选', desc: '回到完整列表' },
      { action: 'open-dashboard', title: '返回 Tab Out', desc: '切回主面板' }
    ].map(item => `
      <button class="quick-action-btn" data-action="${item.action}">
        <strong>${item.title}</strong>
        <span>${item.desc}</span>
      </button>
    `).join('');

    quickActions.querySelectorAll('.quick-action-btn').forEach(button => {
      button.addEventListener('click', () => {
        const action = button.dataset.action;
        if (action === 'focus-search') {
          document.getElementById('searchInput')?.focus();
        } else if (action === 'add-content') {
          openContentModal();
        } else if (action === 'clear-search') {
          clearSearch();
        } else if (action === 'open-dashboard') {
          window.location.href = 'index.html';
        }
      });
    });
  }

  function getMiniThumbHtml(content, mode) {
    if (content.image) {
      return `<img src="${content.image}" alt="">`;
    }

    const labelMap = {
      video: '视频',
      book: '书籍',
      paper: '论文',
      audio: '音频',
      web: '网页'
    };

    return `<span>${labelMap[mode] || '内容'}</span>`;
  }

  function getStatusLabel(mode, contents) {
    if (mode === 'history') {
      return searchQuery ? `检索历史项目中` : '回看 Tab Out 历史中';
    }
    if (searchQuery) return `检索到 ${contents.length} 条结果`;
    if (currentSort === 'oldest') return '按最早添加排序';
    if (currentSort === 'pinned') return '置顶内容优先';
    const pinnedCount = contents.filter(content => content.pinned).length;
    if (pinnedCount > 0) {
      return `已置顶 ${pinnedCount} 条`;
    }
    const labelMap = {
      video: '沉浸式整理中',
      book: '阅读轨道已就绪',
      paper: '研究线索整理中',
      audio: '声音清单持续生长',
      web: '碎片线索正在收束'
    };
    return labelMap[mode] || 'Flow 已就绪';
  }

  function getTimestamp(value) {
    if (!value) return 0;
    const timestamp = typeof value === 'number' ? value : Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function formatRelativeDate(value) {
    const timestamp = getTimestamp(value);
    if (!timestamp) return '刚刚';
    const diff = Date.now() - timestamp;
    const day = 24 * 60 * 60 * 1000;
    if (diff < day) return '今天';
    if (diff < day * 2) return '昨天';
    const days = Math.max(2, Math.round(diff / day));
    return `${days} 天前`;
  }

  function getSearchPlaceholder(mode) {
    const placeholderMap = {
      video: '搜索视频标题、作者、主题或笔记内容...',
      book: '搜索书名、作者、主题或笔记内容...',
      paper: '搜索论文标题、作者、关键词或笔记内容...',
      audio: '搜索播客、作者、主题或笔记内容...',
      web: '搜索网页标题、站点、主题或笔记内容...',
      history: '搜索历史项目标题、域名或链接...'
    };
    return placeholderMap[mode] || '搜索内容...';
  }

  function getHistoryStatusLabel(openTabs, deferredTabs) {
    const totalCount = openTabs.length + deferredTabs.length;
    if (searchQuery) return `检索到 ${totalCount} 个历史项目`;
    if (totalCount === 0) return '等待历史项目出现';
    if (openTabs.length === 0) return `稍后保存 ${deferredTabs.length} 项`;
    if (deferredTabs.length === 0) return `打开标签 ${openTabs.length} 项`;
    return `打开标签 ${openTabs.length} 项 · 稍后保存 ${deferredTabs.length} 项`;
  }

  // 打开内容（新窗口）或下载
  async function openContent(id) {
    const mode = flowData.currentMode;
    const content = flowData.contents[mode]?.find(c => c.id === id);
    if (!content) return;
    
    // 如果是书籍且有 EPUB 文件，下载它
    if (mode === 'book' && content.hasEpubFile) {
      try {
        const fileData = await getEpubFromDB(id);
        if (fileData) {
          const blob = new Blob([fileData], { type: 'application/epub+zip' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = content.fileName || `${content.title}.epub`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } else {
          alert('EPUB 文件不存在');
        }
      } catch (e) {
        console.error('下载失败:', e);
        alert('下载失败');
      }
      return;
    }
    
    // 如果是音频且有文件，下载它
    if (mode === 'audio' && content.hasAudioFile) {
      try {
        const fileData = await getEpubFromDB(id);
        if (fileData) {
          const blob = new Blob([fileData], { type: content.fileType || 'audio/mpeg' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = content.fileName || `${content.title}.mp3`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } else {
          alert('音频文件不存在');
        }
      } catch (e) {
        console.error('下载失败:', e);
        alert('下载失败');
      }
      return;
    }
    
    // 否则打开 URL
    if (content.url) {
      window.open(content.url, '_blank');
    }
  }

  // 开始编辑备注
  function startNoteEdit(noteEl, contentId) {
    const mode = flowData.currentMode;
    const content = flowData.contents[mode]?.find(c => c.id === contentId);
    if (!content) return;
    
    const currentNote = content.note || '';
    
    noteEl.innerHTML = `<textarea class="note-edit-textarea" placeholder="Cmd+Enter 保存，Esc 取消">${escapeHtml(currentNote)}</textarea>`;
    
    const textarea = noteEl.querySelector('.note-edit-textarea');
    textarea.focus();
    textarea.selectionStart = textarea.value.length;
    
    let saved = false;
    
    // 保存函数
    function saveNote() {
      if (saved) return;
      saved = true;
      const newNote = textarea.value.trim();
      content.note = newNote;
      saveData();
      noteEl.innerHTML = newNote 
        ? escapeHtml(newNote) 
        : '<span style="color: #9ca3af; font-style: italic;">点击添加备注...</span>';
    }
    
    // 取消函数
    function cancelEdit() {
      if (saved) return;
      saved = true;
      noteEl.innerHTML = currentNote 
        ? escapeHtml(currentNote) 
        : '<span style="color: #9ca3af; font-style: italic;">点击添加备注...</span>';
    }
    
    // Cmd+Enter 保存，Esc 取消
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        saveNote();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
      }
    });
    
    // 点击外部时保存
    textarea.addEventListener('blur', () => {
      setTimeout(saveNote, 100);
    });
  }

  // 编辑内容
  function editContent(id) {
    const mode = flowData.currentMode;
    const content = flowData.contents[mode]?.find(c => c.id === id);
    if (!content) return;

    const newTitle = prompt('编辑标题', content.title);
    if (newTitle !== null && newTitle !== content.title) {
      content.title = newTitle;
      saveData();
      render();
    }
  }

  // 置顶/取消置顶内容
  async function togglePin(id) {
    const mode = flowData.currentMode;
    const content = flowData.contents[mode]?.find(c => c.id === id);
    if (!content) return;
    
    content.pinned = !content.pinned;
    content.pinnedAt = content.pinned ? Date.now() : null;
    
    await saveData();
    render();
  }

  // 删除内容
  async function deleteContent(id) {
    if (!confirm('确定删除这个内容吗？')) return;

    const mode = flowData.currentMode;
    const content = flowData.contents[mode]?.find(c => c.id === id);
    const index = flowData.contents[mode]?.findIndex(c => c.id === id);
    
    if (index > -1) {
      // 如果是书籍或音频且有文件，删除 IndexedDB 中的文件
      if ((mode === 'book' && content?.hasEpubFile) || (mode === 'audio' && content?.hasAudioFile)) {
        try {
          await deleteEpubFromDB(id);
        } catch (e) {
          console.error('删除文件失败:', e);
        }
      }
      
      flowData.contents[mode].splice(index, 1);
      // 同时删除关联的笔记
      delete flowData.notes[mode]?.[id];
      saveData();
      render();
    }
  }

  // 提取 YouTube ID
  function extractYouTubeId(url) {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
  }

  // 提取 Bilibili BV号
  function extractBilibiliId(url) {
    const regex = /bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/;
    const match = url.match(regex);
    return match ? match[1] : null;
  }


  // 打开笔记弹窗
  function openNoteModal(noteId, contentId) {
    const mode = flowData.currentMode;
    const cId = contentId || flowData.currentContentId || '_global';
    const notes = flowData.notes[mode]?.[cId] || [];
    const note = notes.find(n => n.id === noteId);

    if (!note) return;

    currentNoteId = noteId;
    currentEditId = cId;
    noteModalTitle.textContent = note.title;
    noteModalContent.innerHTML = renderMarkdown(note.content);
    noteModal.classList.add('show');
  }

  // 关闭笔记弹窗
  function closeNoteModal() {
    noteModal.classList.remove('show');
    currentNoteId = null;
    currentEditId = null;
  }

  // 删除当前笔记
  function deleteCurrentNote() {
    if (!currentNoteId) return;
    if (!confirm('确定删除这条笔记吗？')) return;

    const mode = flowData.currentMode;
    const contentId = currentEditId || '_global';
    const notes = flowData.notes[mode]?.[contentId] || [];
    const index = notes.findIndex(n => n.id === currentNoteId);

    if (index > -1) {
      notes.splice(index, 1);
      saveData();
      closeNoteModal();
      render();
    }
  }

  // 打开内容弹窗
  function openContentModal() {
    const mode = flowData.currentMode;
    
    // 根据模式显示不同的添加界面
    document.getElementById('videoAddSection').style.display = mode === 'video' ? 'block' : 'none';
    document.getElementById('bookAddSection').style.display = mode === 'book' ? 'block' : 'none';
    document.getElementById('paperAddSection').style.display = mode === 'paper' ? 'block' : 'none';
    document.getElementById('audioAddSection').style.display = mode === 'audio' ? 'block' : 'none';
    document.getElementById('webAddSection').style.display = mode === 'web' ? 'block' : 'none';
    
    // 重置输入
    contentUrlInput.value = '';
    document.getElementById('epubPreview').style.display = 'none';
    document.getElementById('paperUrlInput').value = '';
    document.getElementById('audioPreview').style.display = 'none';
    
    contentModal.classList.add('show');
  }

  // 关闭内容弹窗
  function closeContentModal() {
    contentModal.classList.remove('show');
  }

  // 从 URL 添加内容
  async function addContentFromUrl() {
    const url = contentUrlInput.value.trim();
    if (!url) {
      alert('请输入链接');
      return;
    }

    const mode = flowData.currentMode;

    if (!flowData.contents[mode]) {
      flowData.contents[mode] = [];
    }

    // 获取默认标题
    let title = '加载中...';
    let image = '';

    // 先创建内容占位
    const content = {
      id: generateId(),
      title,
      url,
      image: '',
      note: '',
      createdAt: Date.now()
    };

    flowData.contents[mode].push(content);
    saveData();
    closeContentModal();
    render();

    // 异步获取元数据
    try {
      const metadata = await fetchMetadata(url);
      if (metadata.title) {
        content.title = metadata.title;
      } else {
        // 如果获取失败，使用默认标题
        if (url.includes('youtube.com') || url.includes('youtu.be')) {
          content.title = 'YouTube 视频';
        } else if (url.includes('bilibili.com')) {
          content.title = 'Bilibili 视频';
        } else {
          try {
            const urlObj = new URL(url);
            content.title = urlObj.hostname;
          } catch (e) {
            content.title = '未命名';
          }
        }
      }
      if (metadata.image) {
        content.image = metadata.image;
      }
      saveData();
      render();
    } catch (e) {
      console.error('获取元数据失败:', e);
      // 使用默认值
      if (url.includes('youtube.com') || url.includes('youtu.be')) {
        content.title = 'YouTube 视频';
      } else if (url.includes('bilibili.com')) {
        content.title = 'Bilibili 视频';
      } else {
        content.title = '未命名';
      }
      saveData();
      render();
    }
  }

  // 获取 URL 元数据
  async function fetchMetadata(url) {
    // 如果是 YouTube，使用 oEmbed API（支持 CORS）
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      const videoId = extractYouTubeId(url);
      if (videoId) {
        try {
          const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
          const res = await fetch(oembedUrl);
          if (res.ok) {
            const data = await res.json();
            return {
              title: data.title || '',
              image: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
            };
          }
        } catch (e) {
          console.log('YouTube oEmbed 失败，使用缩略图');
        }
        // 回退：至少返回缩略图
        return {
          title: '',
          image: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
        };
      }
    }

    // 尝试本地服务器 API（用于其他网站）
    try {
      const apiUrl = `http://localhost:3000/api/metadata?url=${encodeURIComponent(url)}`;
      const res = await fetch(apiUrl);
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.log('本地 API 不可用');
    }

    return { title: '', image: '' };
  }

  // EPUB 临时数据
  let pendingEpubData = null;

  // IndexedDB 数据库
  let epubDB = null;

  // 初始化 IndexedDB
  function initEpubDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('FlowEpubStore', 1);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        epubDB = request.result;
        resolve(epubDB);
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('epubs')) {
          db.createObjectStore('epubs', { keyPath: 'id' });
        }
      };
    });
  }

  // 保存 EPUB 到 IndexedDB
  function saveEpubToDB(id, fileData) {
    return new Promise((resolve, reject) => {
      if (!epubDB) {
        reject(new Error('Database not initialized'));
        return;
      }
      
      const transaction = epubDB.transaction(['epubs'], 'readwrite');
      const store = transaction.objectStore('epubs');
      const request = store.put({ id, data: fileData });
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // 从 IndexedDB 获取 EPUB
  function getEpubFromDB(id) {
    return new Promise((resolve, reject) => {
      if (!epubDB) {
        reject(new Error('Database not initialized'));
        return;
      }
      
      const transaction = epubDB.transaction(['epubs'], 'readonly');
      const store = transaction.objectStore('epubs');
      const request = store.get(id);
      
      request.onsuccess = () => resolve(request.result?.data);
      request.onerror = () => reject(request.error);
    });
  }

  // 从 IndexedDB 删除 EPUB
  function deleteEpubFromDB(id) {
    return new Promise((resolve, reject) => {
      if (!epubDB) {
        reject(new Error('Database not initialized'));
        return;
      }
      
      const transaction = epubDB.transaction(['epubs'], 'readwrite');
      const store = transaction.objectStore('epubs');
      const request = store.delete(id);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // 处理 EPUB 文件
  async function handleEpubFile(file) {
    if (!file.name.endsWith('.epub')) {
      alert('请选择 EPUB 文件');
      return;
    }

    try {
      const zip = await JSZip.loadAsync(file);
      
      // 读取 container.xml 获取 rootfile 路径
      const containerXml = await zip.file('META-INF/container.xml').async('text');
      const parser = new DOMParser();
      const containerDoc = parser.parseFromString(containerXml, 'text/xml');
      const rootfilePath = containerDoc.querySelector('rootfile').getAttribute('full-path');
      const rootDir = rootfilePath.substring(0, rootfilePath.lastIndexOf('/') + 1);
      
      // 读取 content.opf 获取元数据
      const opfXml = await zip.file(rootfilePath).async('text');
      const opfDoc = parser.parseFromString(opfXml, 'text/xml');
      
      // 获取标题
      const titleEl = opfDoc.querySelector('metadata title, metadata dc\\:title');
      const title = titleEl ? titleEl.textContent : file.name.replace('.epub', '');
      
      // 获取作者
      const creatorEl = opfDoc.querySelector('metadata creator, metadata dc\\:creator');
      const author = creatorEl ? creatorEl.textContent : '未知作者';
      
      // 获取封面
      let coverImage = '';
      
      // 方法1: 从 meta cover 获取
      const coverMeta = opfDoc.querySelector('meta[name="cover"]');
      if (coverMeta) {
        const coverId = coverMeta.getAttribute('content');
        const coverItem = opfDoc.querySelector(`item[id="${coverId}"]`);
        if (coverItem) {
          const coverHref = coverItem.getAttribute('href');
          const coverPath = rootDir + coverHref;
          const coverFile = zip.file(coverPath) || zip.file(coverHref);
          if (coverFile) {
            const coverData = await coverFile.async('base64');
            const mediaType = coverItem.getAttribute('media-type') || 'image/jpeg';
            coverImage = `data:${mediaType};base64,${coverData}`;
          }
        }
      }
      
      // 方法2: 查找 cover-image 属性
      if (!coverImage) {
        const coverItem = opfDoc.querySelector('item[properties="cover-image"]');
        if (coverItem) {
          const coverHref = coverItem.getAttribute('href');
          const coverPath = rootDir + coverHref;
          const coverFile = zip.file(coverPath) || zip.file(coverHref);
          if (coverFile) {
            const coverData = await coverFile.async('base64');
            const mediaType = coverItem.getAttribute('media-type') || 'image/jpeg';
            coverImage = `data:${mediaType};base64,${coverData}`;
          }
        }
      }
      
      // 方法3: 查找名为 cover 的图片
      if (!coverImage) {
        const items = opfDoc.querySelectorAll('item[media-type^="image"]');
        for (const item of items) {
          const href = item.getAttribute('href').toLowerCase();
          if (href.includes('cover')) {
            const coverPath = rootDir + item.getAttribute('href');
            const coverFile = zip.file(coverPath) || zip.file(item.getAttribute('href'));
            if (coverFile) {
              const coverData = await coverFile.async('base64');
              const mediaType = item.getAttribute('media-type') || 'image/jpeg';
              coverImage = `data:${mediaType};base64,${coverData}`;
              break;
            }
          }
        }
      }
      
      // 读取原始文件数据
      const fileData = await file.arrayBuffer();
      
      // 保存临时数据
      pendingEpubData = {
        title,
        author,
        image: coverImage,
        fileName: file.name,
        fileData: fileData
      };
      
      // 显示预览
      document.getElementById('epubTitlePreview').textContent = title;
      document.getElementById('epubAuthorPreview').textContent = author;
      if (coverImage) {
        document.getElementById('epubCoverPreview').src = coverImage;
      } else {
        document.getElementById('epubCoverPreview').src = '';
        document.getElementById('epubCoverPreview').style.background = '#e5e7eb';
      }
      document.getElementById('epubPreview').style.display = 'block';
      
    } catch (e) {
      console.error('解析 EPUB 失败:', e);
      alert('解析 EPUB 失败，请确保文件格式正确');
    }
  }

  // 添加 EPUB 书籍
  async function addEpubBook() {
    if (!pendingEpubData) return;
    
    const mode = 'book';
    if (!flowData.contents[mode]) {
      flowData.contents[mode] = [];
    }
    
    const contentId = generateId();
    
    const content = {
      id: contentId,
      title: pendingEpubData.title,
      author: pendingEpubData.author,
      image: pendingEpubData.image,
      fileName: pendingEpubData.fileName,
      hasEpubFile: true,
      url: '',
      note: '',
      createdAt: Date.now()
    };
    
    // 保存文件到 IndexedDB
    try {
      await saveEpubToDB(contentId, pendingEpubData.fileData);
    } catch (e) {
      console.error('保存 EPUB 文件失败:', e);
      alert('保存文件失败');
      return;
    }
    
    flowData.contents[mode].push(content);
    pendingEpubData = null;
    saveData();
    closeContentModal();
    render();
  }

  // 添加论文
  function addPaper() {
    const url = document.getElementById('paperUrlInput').value.trim();
    if (!url) {
      alert('请输入论文链接');
      return;
    }
    
    const mode = 'paper';
    if (!flowData.contents[mode]) {
      flowData.contents[mode] = [];
    }
    
    let title = '论文';
    if (url.includes('arxiv.org')) {
      title = 'arXiv 论文';
    }
    
    const content = {
      id: generateId(),
      title,
      url,
      image: '',
      note: '',
      createdAt: Date.now()
    };
    
    flowData.contents[mode].push(content);
    saveData();
    closeContentModal();
    render();
    
    // 异步获取元数据
    fetchMetadata(url).then(metadata => {
      if (metadata.title) {
        content.title = metadata.title;
        saveData();
        render();
      }
    });
  }

  // 添加网页
  async function addWebPage() {
    const url = document.getElementById('webUrlInput').value.trim();
    if (!url) {
      alert('请输入网页链接');
      return;
    }
    
    const mode = 'web';
    if (!flowData.contents[mode]) {
      flowData.contents[mode] = [];
    }
    
    const content = {
      id: generateId(),
      title: '加载中...',
      url,
      image: '',
      note: '',
      createdAt: Date.now()
    };
    
    flowData.contents[mode].push(content);
    saveData();
    closeContentModal();
    render();
    
    // 异步获取元数据
    const metadata = await fetchMetadata(url);
    if (metadata.title) {
      content.title = metadata.title;
    } else {
      content.title = new URL(url).hostname;
    }
    if (metadata.image) {
      content.image = metadata.image;
    }
    saveData();
    render();
  }

  // 音频临时数据
  let pendingAudioData = null;

  // 处理音频文件
  async function handleAudioFile(file) {
    const audioTypes = ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/m4a', 'audio/ogg', 'audio/flac'];
    if (!file.type.startsWith('audio/')) {
      alert('请选择音频文件');
      return;
    }

    // 格式化文件大小
    const formatSize = (bytes) => {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    // 读取文件数据
    const fileData = await file.arrayBuffer();
    
    // 保存临时数据
    pendingAudioData = {
      title: file.name.replace(/\.[^/.]+$/, ''),
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      fileData: fileData
    };
    
    // 显示预览
    document.getElementById('audioTitlePreview').textContent = pendingAudioData.title;
    document.getElementById('audioSizePreview').textContent = formatSize(file.size);
    document.getElementById('audioPreview').style.display = 'block';
  }

  // 添加音频文件
  async function addAudioFile() {
    if (!pendingAudioData) return;
    
    const mode = 'audio';
    if (!flowData.contents[mode]) {
      flowData.contents[mode] = [];
    }
    
    const contentId = generateId();
    
    const content = {
      id: contentId,
      title: pendingAudioData.title,
      fileName: pendingAudioData.fileName,
      fileSize: pendingAudioData.fileSize,
      fileType: pendingAudioData.fileType,
      hasAudioFile: true,
      url: '',
      note: '',
      createdAt: Date.now()
    };
    
    // 保存文件到 IndexedDB（复用 epubs store）
    try {
      await saveEpubToDB(contentId, pendingAudioData.fileData);
    } catch (e) {
      console.error('保存音频文件失败:', e);
      alert('保存文件失败');
      return;
    }
    
    flowData.contents[mode].push(content);
    pendingAudioData = null;
    saveData();
    closeContentModal();
    render();
  }

  // 导出数据
  async function exportData() {
    try {
      // 收集所有文件数据
      const files = {};
      
      // 收集书籍文件
      for (const book of flowData.contents.book || []) {
        if (book.hasEpubFile) {
          const fileData = await getEpubFromDB(book.id);
          if (fileData) {
            files[book.id] = arrayBufferToBase64(fileData);
          }
        }
      }
      
      // 收集音频文件
      for (const audio of flowData.contents.audio || []) {
        if (audio.hasAudioFile) {
          const fileData = await getEpubFromDB(audio.id);
          if (fileData) {
            files[audio.id] = arrayBufferToBase64(fileData);
          }
        }
      }
      
      // 先转换为 items 格式
      flowDataToItems();
      
      const exportObj = {
        version: 2,
        exportedAt: new Date().toISOString(),
        items: items,  // 新格式
        flowData: flowData,  // 兼容旧格式
        notes: flowData.notes,
        files: files
      };
      
      const json = JSON.stringify(exportObj, null, 2);
      
      if (ipcRenderer) {
        // Electron 环境：使用保存对话框
        const result = await ipcRenderer.invoke('export-data', {
          defaultName: `flow-data-${new Date().toISOString().split('T')[0]}.json`,
          data: json
        });
        if (result.success) {
          alert('导出成功！文件已保存到: ' + result.path);
        } else if (result.canceled) {
          // 用户取消，不显示提示
        } else {
          alert('导出失败');
        }
      } else {
        // 浏览器环境：使用下载链接
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `flow-data-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        alert('导出成功！');
      }
    } catch (e) {
      console.error('导出失败:', e);
      alert('导出失败');
    }
  }

  // 导入数据
  async function importData(file) {
    try {
      const text = await file.text();
      const importObj = JSON.parse(text);
      
      // 支持多种格式
      if (!importObj.items && !importObj.flowData) {
        alert('无效的数据文件');
        return;
      }
      
      if (!confirm('导入将覆盖当前数据，确定继续吗？')) {
        return;
      }
      
      // 优先使用 items 格式
      if (importObj.items) {
        items = importObj.items;
        itemsToFlowData();
      } else if (importObj.flowData) {
        // 兼容旧格式
        flowData.contents = importObj.flowData.contents || { video: [], book: [], paper: [], audio: [] };
        flowDataToItems();
      }
      
      // 恢复笔记
      if (importObj.notes) {
        flowData.notes = importObj.notes;
      } else if (importObj.flowData?.notes) {
        flowData.notes = importObj.flowData.notes;
      }
      
      // 恢复文件到 IndexedDB
      if (importObj.files) {
        for (const [id, base64Data] of Object.entries(importObj.files)) {
          const arrayBuffer = base64ToArrayBuffer(base64Data);
          await saveEpubToDB(id, arrayBuffer);
        }
      }
      
      saveData();
      render();
      alert('导入成功！');
    } catch (e) {
      console.error('导入失败:', e);
      alert('导入失败，请检查文件格式');
    }
  }

  // ArrayBuffer 转 Base64
  function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  // Base64 转 ArrayBuffer
  function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // 简单的 Markdown 渲染
  function renderMarkdown(text) {
    return text
      // 代码块
      .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
      // 行内代码
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // 标题
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      // 粗体
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      // 斜体
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      // 链接
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
      // 列表
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      // 段落
      .replace(/\n\n/g, '</p><p>')
      .replace(/^(.+)$/gm, '<p>$1</p>')
      // 清理
      .replace(/<p><\/p>/g, '')
      .replace(/<p>(<h[123]>)/g, '$1')
      .replace(/(<\/h[123]>)<\/p>/g, '$1')
      .replace(/<p>(<pre>)/g, '$1')
      .replace(/(<\/pre>)<\/p>/g, '$1')
      .replace(/<p>(<li>)/g, '$1')
      .replace(/(<\/li>)<\/p>/g, '$1');
  }

  // 工具函数
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function formatDate(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  }

  // 启动
  init();
})();
