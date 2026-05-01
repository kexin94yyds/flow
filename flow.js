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
    contents: { video: [], book: [], paper: [], audio: [], web: [] },
    notes: { video: {}, book: {}, paper: {}, audio: {}, web: {} }
  };

  // DOM 元素
  const modeBtns = document.querySelectorAll('.mode-btn[data-mode]');
  const modeTitle = document.getElementById('modeTitle');
  const mediaSection = document.getElementById('mediaSection');
  const mediaTitle = document.getElementById('mediaTitle');
  const mediaGrid = document.getElementById('mediaGrid');

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

  // 模式配置
  const modeConfig = {
    video: { title: '视频学习', icon: 'video' },
    book: { title: '书籍阅读', icon: 'book' },
    paper: { title: '论文研读', icon: 'paper' },
    audio: { title: '音频播客', icon: 'audio' },
    web: { title: '网页收藏', icon: 'web' },
    settings: { title: '设置', icon: 'settings' }
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
    
    // 加载笔记（笔记单独存储）
    const savedNotes = localStorage.getItem('flowNotes');
    if (savedNotes) {
      try {
        flowData.notes = JSON.parse(savedNotes);
      } catch (e) {}
    }
  }
  
  // 从 localStorage 加载
  async function loadFromLocalStorage() {
    // 先尝试加载新格式 items
    const savedItems = localStorage.getItem('flowItems');
    if (savedItems) {
      try {
        items = JSON.parse(savedItems);
        await itemsToFlowData();
        return;
      } catch (e) {}
    }
    
    // 回退到旧格式 flowData
    const saved = localStorage.getItem('flowData');
    if (saved) {
      try {
        const oldData = JSON.parse(saved);
        flowData.contents = oldData.contents || { video: [], book: [], paper: [], audio: [] };
        flowData.notes = oldData.notes || { video: {}, book: {}, paper: {}, audio: {} };
        // 将旧数据转换为 items 格式
        flowDataToItems();
      } catch (e) {
        console.error('加载数据失败', e);
      }
    }
  }
  
  // 将 items 数组转换为 flowData.contents 结构
  async function itemsToFlowData() {
    flowData.contents = { video: [], book: [], paper: [], audio: [], web: [] };
    
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
          pinned: false,
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

    // 添加内容
    addContentBtn.addEventListener('click', openContentModal);

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
    const modes = ['video', 'book', 'paper', 'audio', 'web'];
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

    // 更新模式按钮
    modeBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    // 更新标题
    modeTitle.textContent = modeConfig[mode]?.title || '学习空间';

    // 渲染媒体区
    renderMedia();
  }

  // 渲染媒体卡片网格
  function renderMedia() {
    const mode = flowData.currentMode;
    let contents = flowData.contents[mode] || [];

    // 搜索过滤
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      contents = contents.filter(content => {
        const title = (content.title || '').toLowerCase();
        const note = (content.note || '').toLowerCase();
        const platform = (content.platform || '').toLowerCase();
        return title.includes(query) || note.includes(query) || platform.includes(query);
      });
    }
    
    // 排序：置顶的在前，然后按创建时间降序
    contents.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    // 更新标题
    const titleMap = {
      video: '视频列表',
      book: '书籍列表',
      paper: '论文列表'
    };
    mediaTitle.textContent = titleMap[mode] || '内容列表';

    if (contents.length === 0) {
      renderMediaPlaceholder(searchQuery ? '未找到匹配内容' : null);
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
        <div class="media-card-content">
          <div class="media-card-meta">
            <span class="media-card-platform ${platformClass}">${platformText}</span>
            <span style="font-size: 11px; color: #9ca3af;">稍后阅读</span>
          </div>
          <div class="media-card-title">${escapeHtml(content.title)}</div>
          ${content.author ? `<div style="font-size: 12px; color: #6b7280; margin-top: 2px;">${escapeHtml(content.author)}</div>` : ''}
          <div class="media-card-note" data-content-id="${content.id}" title="点击编辑备注">${content.note ? escapeHtml(content.note) : '<span style="color: #9ca3af; font-style: italic;">点击添加备注...</span>'}</div>
        </div>
        <div class="media-card-notes" data-content-id="${content.id}">
          <div class="card-notes-header">
            <span>笔记 (${notes.length})</span>
            <button class="card-notes-add" data-content-id="${content.id}">+ 添加</button>
          </div>
          <div class="card-notes-list">
            ${notes.length > 0 ? notes.map(note => `
              <div class="card-note-item" data-note-id="${note.id}" data-content-id="${content.id}">
                <div class="card-note-title">${escapeHtml(note.title)}</div>
                <div class="card-note-preview">${escapeHtml(note.preview || '')}</div>
              </div>
            `).join('') : '<div class="card-notes-empty">拖拽 .md 文件到此卡片添加笔记</div>'}
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
  function renderMediaPlaceholder(customMsg) {
    const mode = flowData.currentMode;
    let icon, text;

    if (customMsg) {
      // 搜索无结果
      icon = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>`;
      text = customMsg;
    } else if (mode === 'video') {
      icon = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/>
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>`;
      text = '点击右上角"添加内容"添加视频';
    } else if (mode === 'book') {
      icon = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>`;
      text = '点击右上角"添加内容"添加书籍';
    } else {
      icon = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>`;
      text = '点击右上角"添加内容"添加论文';
    }

    mediaGrid.innerHTML = `
      <div class="media-placeholder">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">${icon}</svg>
        <div>${text}</div>
      </div>
    `;
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
