declare namespace chrome {
  namespace storage {
    interface StorageArea {
      get(keys?: string | string[] | object | null): Promise<{ [key: string]: any }>;
      set(items: object): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
      clear(): Promise<void>;
    }
    const local: StorageArea;
  }
  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
      title?: string;
      favIconUrl?: string;
    }
    function query(queryInfo: object): Promise<Tab[]>;
    function create(createProperties: { url?: string }): Promise<Tab>;
  }
  namespace runtime {
    function openOptionsPage(): Promise<void>;
    const onInstalled: {
      addListener(callback: (details: { reason: string }) => void): void;
    };
  }
  namespace contextMenus {
    interface OnClickData {
      menuItemId: string | number;
      linkUrl?: string;
    }
    function create(createProperties: object): Promise<string | number>;
    const onClicked: {
      addListener(callback: (info: OnClickData, tab?: chrome.tabs.Tab) => void): void;
    };
  }
  namespace scripting {
    function executeScript(injection: { target: { tabId: number }; func: () => any }): Promise<any[]>;
  }
}
