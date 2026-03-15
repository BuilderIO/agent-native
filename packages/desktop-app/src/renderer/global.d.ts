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

  interApp: {
    send(targetAppId: string, event: string, data: unknown): void;
    on(cb: (from: string, event: string, data: unknown) => void): () => void;
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
  getURL(): string;
  getTitle(): string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  openDevTools(): void;
}
