declare module "*.css" {}

/** Auto-update status surfaced from electron-updater (mirrors shared/ipc-channels.ts). */
type UpdateStatus =
  | { state: "idle" }
  | { state: "unsupported"; reason: string }
  | { state: "checking" }
  | { state: "available"; version: string; releaseNotes?: string }
  | { state: "not-available"; currentVersion: string }
  | {
      state: "downloading";
      percent: number;
      bytesPerSecond?: number;
      transferred?: number;
      total?: number;
    }
  | { state: "downloaded"; version: string; releaseNotes?: string }
  | { state: "error"; message: string };

type CodeAgentRunStatus =
  | "queued"
  | "running"
  | "paused"
  | "needs-approval"
  | "completed"
  | "errored"
  | "unknown";

type CodeAgentRunProgress = {
  label?: string;
  completed: number;
  total: number;
  failed?: number;
  percent: number;
};

type CodeAgentRunDetail = {
  label: string;
  value: string;
};

type CodeAgentRun = {
  id: string;
  goalId: string;
  title: string;
  subtitle?: string;
  status: CodeAgentRunStatus;
  phase?: string;
  needsApproval?: boolean;
  progress?: CodeAgentRunProgress;
  details?: CodeAgentRunDetail[];
  surfaceUrl?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
};

type CodeAgentMigrationRun = CodeAgentRun & {
  name: string;
  sourceRoot: string;
  outputRoot: string;
  target: string;
  phase: string;
  approved: boolean;
  taskCount: number;
  passedTaskCount: number;
  failedTaskCount: number;
  createdAt: string;
  updatedAt: string;
};

type CodeAgentRunListResult<TRun extends CodeAgentRun = CodeAgentMigrationRun> =
  {
    status: "ok" | "unauthorized" | "unavailable";
    goalId?: string;
    runs: TRun[];
    workbenchUrl?: string;
    error?: string;
  };

type CodeAgentTerminalResult = {
  ok: boolean;
  cwd: string;
  error?: string;
};

type CodeAgentControlCommand = "resume" | "status" | "stop";

type CodeAgentControlResult = {
  ok: boolean;
  command: CodeAgentControlCommand;
  action?: "open-ui" | "refresh" | "none";
  message: string;
  error?: string;
};

type DesktopOpenRequest = {
  app?: string;
  goalId?: string;
  runId?: string;
};

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
      cb: (info: { key: string; shiftKey: boolean; altKey?: boolean }) => void,
    ): () => void;
  };

  setActiveApp(appId: string): void;
  setActiveWebview(target: { appId: string; webContentsId?: number }): void;

  clipboard: {
    writeText(text: string): Promise<boolean>;
  };

  interApp: {
    send(targetAppId: string, event: string, data: unknown): void;
    on(cb: (from: string, event: string, data: unknown) => void): () => void;
  };

  frame: {
    load(): Promise<{
      enabled: boolean;
      mode: "dev" | "prod";
      prodUrl?: string;
    }>;
    update(settings: {
      enabled?: boolean;
      mode?: "dev" | "prod";
      prodUrl?: string;
    }): Promise<{
      enabled: boolean;
      mode: "dev" | "prod";
      prodUrl?: string;
    }>;
  };

  updater: {
    check(): Promise<UpdateStatus>;
    download(): Promise<UpdateStatus>;
    install(): void;
    getStatus(): Promise<UpdateStatus>;
    onStatusChange(cb: (status: UpdateStatus) => void): () => void;
  };

  codeAgents: {
    listRuns(goalId?: string): Promise<CodeAgentRunListResult>;
    controlRun(
      goalId: string,
      runId: string,
      command: CodeAgentControlCommand,
    ): Promise<CodeAgentControlResult>;
    listMigrationRuns(): Promise<CodeAgentRunListResult>;
    openTerminal(): Promise<CodeAgentTerminalResult>;
    onOpenRequest(cb: (request: DesktopOpenRequest) => void): () => void;
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
      allowpopups?: boolean;
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
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
  findInPage(
    text: string,
    options?: { findNext?: boolean; forward?: boolean },
  ): void;
  stopFindInPage(
    action?: "clearSelection" | "keepSelection" | "activateSelection",
  ): void;
}
