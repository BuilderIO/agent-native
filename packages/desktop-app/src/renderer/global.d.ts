/** Electron APIs exposed to the renderer via the preload contextBridge */
interface ElectronAPI {
  platform: string;

  windowControls: {
    minimize(): void;
    maximize(): void;
    close(): void;
    isMaximized(): Promise<boolean>;
    onMaximizedChange(cb: (isMaximized: boolean) => void): () => void;
  };

  shortcuts: {
    onCloseTab(cb: () => void): () => void;
    onKeydown(
      cb: (info: { key: string; shiftKey: boolean }) => void,
    ): () => void;
  };

  setActiveApp(appId: string): void;
  setActiveWebview(target: { appId: string; webContentsId?: number }): void;

  interApp: {
    send(targetAppId: string, event: string, data: unknown): void;
    on(cb: (from: string, event: string, data: unknown) => void): () => void;
  };

  appConfig: {
    load(): Promise<import("@agent-native/shared-app-config").AppConfig[]>;
    add(
      app: import("@agent-native/shared-app-config").AppConfig,
    ): Promise<import("@agent-native/shared-app-config").AppConfig[]>;
    remove(
      id: string,
    ): Promise<import("@agent-native/shared-app-config").AppConfig[]>;
    update(
      id: string,
      updates: Partial<import("@agent-native/shared-app-config").AppConfig>,
    ): Promise<import("@agent-native/shared-app-config").AppConfig[]>;
    reset(): Promise<import("@agent-native/shared-app-config").AppConfig[]>;
  };
}

declare interface Window {
  electronAPI: ElectronAPI;
}

/** Extend JSX to support Electron's <webview> custom element */
declare namespace JSX {
  interface IntrinsicElements {
    webview: React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement>,
      HTMLElement
    > & {
      src?: string;
      partition?: string;
      allowpopups?: string;
      webpreferences?: string;
      useragent?: string;
      disablewebsecurity?: string;
    };
  }
}

/** Minimal Electron WebviewTag interface for ref usage */
interface ElectronWebviewElement extends HTMLElement {
  src: string;
  reload(): void;
  reloadIgnoringCache(): void;
  getWebContentsId(): number;
  getURL(): string;
  getTitle(): string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  openDevTools(): void;
  findInPage(
    text: string,
    options?: { findNext?: boolean; forward?: boolean },
  ): void;
  stopFindInPage(
    action?: "clearSelection" | "keepSelection" | "activateSelection",
  ): void;
}
