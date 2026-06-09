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

type CodeAgentPermissionMode =
  | "read-only"
  | "ask-before-edit"
  | "auto-edit"
  | "full-auto";

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

type CodeAgentReasoningEffort =
  | "auto"
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

type CodeAgentModelSelection = {
  engine?: string;
  model?: string;
  effort?: CodeAgentReasoningEffort | string;
};

type CodeAgentModelOption = {
  engine: string;
  engineLabel: string;
  model: string;
  label: string;
  description?: string;
  configured?: boolean;
};

type CodeAgentModelListResult = {
  status: "ok" | "unavailable";
  models: CodeAgentModelOption[];
  selected?: CodeAgentModelSelection;
  error?: string;
};

type CodeAgentRemoteConnectorState =
  | "disabled"
  | "unconfigured"
  | "starting"
  | "running"
  | "stopped"
  | "error";

type CodeAgentRemoteConnectorStatus = {
  state: CodeAgentRemoteConnectorState;
  enabled: boolean;
  configured: boolean;
  configPath: string;
  relayUrl?: string;
  pid?: number;
  startedAt?: string;
  lastExitAt?: string;
  lastExitCode?: number | null;
  lastExitSignal?: string | null;
  restartCount: number;
  nextRestartAt?: string;
  error?: string;
};

type CodeAgentRemoteConnectorControlResult = {
  ok: boolean;
  status: CodeAgentRemoteConnectorStatus;
  error?: string;
};

type CodeAgentRemoteConnectorPairRequest = {
  relayUrl?: string;
  label?: string;
};

type CodeAgentRemoteConnectorPairResult = {
  ok: boolean;
  status: CodeAgentRemoteConnectorStatus;
  deviceId?: string;
  message?: string;
  error?: string;
};

type CodeAgentProviderId = "builder" | "anthropic" | "openai" | "google";

type CodeAgentProviderCredentialKey =
  | "ANTHROPIC_API_KEY"
  | "OPENAI_API_KEY"
  | "GOOGLE_GENERATIVE_AI_API_KEY"
  | "BUILDER_PRIVATE_KEY"
  | "BUILDER_PUBLIC_KEY";

type CodeAgentProviderStatus = {
  id: CodeAgentProviderId;
  label: string;
  configured: boolean;
  configuredKeys: CodeAgentProviderCredentialKey[];
  missingKeys: CodeAgentProviderCredentialKey[];
  savedKeys: CodeAgentProviderCredentialKey[];
  source?: "desktop-settings" | "environment" | "mixed";
};

type CodeAgentProviderSettings = {
  configured: boolean;
  configuredProviders: string[];
  providers: CodeAgentProviderStatus[];
  storagePath: string;
};

type CodeAgentProviderSettingsUpdate = Partial<
  Record<CodeAgentProviderCredentialKey, string | null>
>;

type CodeAgentProviderSettingsUpdateResult = {
  ok: boolean;
  settings: CodeAgentProviderSettings;
  message: string;
  error?: string;
};

type CodeAgentPromptAttachment = {
  name: string;
  type?: string;
  size?: number;
  text?: string;
};

type CodeAgentProjectCommand = {
  kind: "command";
  name: string;
  path: string;
  relativePath: string;
  description?: string;
  argumentHint?: string;
  reserved: boolean;
  body?: string;
};

type CodeAgentProjectSkill = {
  kind: "skill";
  name: string;
  path: string;
  relativePath: string;
  description?: string;
  body?: string;
};

type CodeAgentCodePack = {
  schemaVersion: 1;
  root: string;
  commands: CodeAgentProjectCommand[];
  skills: CodeAgentProjectSkill[];
};

type CodeAgentCodePackResult = {
  status: "ok" | "unavailable";
  pack?: CodeAgentCodePack;
  error?: string;
};

type CodeAgentProjectFolder = {
  id: string;
  path: string;
  name: string;
  updatedAt?: string;
};

type CodeAgentProjectListResult = {
  status: "ok" | "unavailable";
  projects: CodeAgentProjectFolder[];
  selectedPath?: string;
  defaultPath?: string;
  error?: string;
};

type CodeAgentProjectSelectResult = {
  ok: boolean;
  project?: CodeAgentProjectFolder;
  projects: CodeAgentProjectFolder[];
  selectedPath?: string;
  error?: string;
};

type CodeAgentQueueMetadata = {
  queued: boolean;
  queuedAt?: string;
  queuedBy?: "desktop" | "cli" | "host" | string;
  queueId?: string;
  queuePosition?: number;
  attempt?: number;
  retryOf?: string;
  rerunOf?: string;
};

type CodeAgentSteeringMetadata = {
  cwd?: string;
  permissionMode?: CodeAgentPermissionMode;
  engine?: string;
  model?: string;
  effort?: CodeAgentReasoningEffort | string;
  attachments?: CodeAgentPromptAttachment[];
};

type CodeAgentRun = {
  id: string;
  goalId: string;
  title: string;
  subtitle?: string;
  kind?: string;
  source?: string;
  sourceLabel?: string;
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

type CodeAgentRunListResult<TRun extends CodeAgentRun = CodeAgentRun> = {
  status: "ok" | "unauthorized" | "unavailable";
  goalId?: string;
  runs: TRun[];
  workbenchUrl?: string;
  error?: string;
};

type CodeAgentTranscriptEventType = "user" | "system" | "artifact" | "status";

type CodeAgentTranscriptEvent = {
  id: string;
  runId: string;
  type: CodeAgentTranscriptEventType;
  title?: string;
  text: string;
  createdAt: string;
  artifactPath?: string;
  artifactUrl?: string;
  metadata?: Record<string, unknown>;
};

type CodeAgentTranscriptRequest = {
  goalId?: string;
  runId: string;
};

type CodeAgentTranscriptResult = {
  status: "ok" | "unavailable";
  runId?: string;
  events: CodeAgentTranscriptEvent[];
  eventFile?: string;
  error?: string;
};

type CodeAgentTranscriptSubscriptionBatch = CodeAgentTranscriptResult & {
  subscriptionId?: string;
  reason?: string;
};

type CodeAgentCreateRunRequest = {
  goalId?: string;
  prompt: string;
  cwd?: string;
  permissionMode?: CodeAgentPermissionMode;
  engine?: string;
  model?: string;
  effort?: CodeAgentReasoningEffort | string;
  attachments?: CodeAgentPromptAttachment[];
  metadata?: Record<string, unknown>;
};

type CodeAgentCreateRunResult = {
  ok: boolean;
  run?: CodeAgentRun;
  event?: CodeAgentTranscriptEvent;
  eventFile?: string;
  message: string;
  error?: string;
};

type CodeAgentFollowUpRequest = {
  goalId?: string;
  runId: string;
  prompt: string;
  followUpMode?: "immediate" | "queued";
  permissionMode?: CodeAgentPermissionMode;
  engine?: string;
  model?: string;
  effort?: CodeAgentReasoningEffort | string;
  attachments?: CodeAgentPromptAttachment[];
  metadata?: Record<string, unknown>;
};

type CodeAgentFollowUpResult = {
  ok: boolean;
  event?: CodeAgentTranscriptEvent;
  eventFile?: string;
  message: string;
  error?: string;
};

type CodeAgentUpdateRunRequest = {
  goalId?: string;
  runId: string;
  permissionMode?: CodeAgentPermissionMode;
  engine?: string;
  model?: string;
  effort?: CodeAgentReasoningEffort | string;
  metadata?: Record<string, unknown>;
};

type CodeAgentUpdateRunResult = {
  ok: boolean;
  run?: CodeAgentRun;
  message: string;
  error?: string;
};

type CodeAgentTerminalRequest = {
  cwd?: string;
  sourceRoot?: string;
  outputRoot?: string;
};

type CodeAgentTerminalResult = {
  ok: boolean;
  cwd: string;
  error?: string;
};

type CodeAgentControlCommand = "resume" | "status" | "stop" | "approve";

type CodeAgentHostControlCommand = CodeAgentControlCommand | "retry" | "rerun";

type CodeAgentControlResult = {
  ok: boolean;
  command: CodeAgentControlCommand;
  action?: "open-ui" | "refresh" | "none" | "select-run";
  run?: CodeAgentRun;
  message: string;
  error?: string;
};

type CodeAgentRerunRequest = {
  goalId?: string;
  runId: string;
  prompt?: string;
  cwd?: string;
  permissionMode?: CodeAgentPermissionMode;
  engine?: string;
  model?: string;
  effort?: CodeAgentReasoningEffort | string;
  attachments?: CodeAgentPromptAttachment[];
  metadata?: Record<string, unknown>;
};

type CodeAgentRerunResult = CodeAgentCreateRunResult & {
  sourceRunId?: string;
};

type CodeAgentRetryRunRequest = {
  goalId?: string;
  runId: string;
  permissionMode?: CodeAgentPermissionMode;
  engine?: string;
  model?: string;
  effort?: CodeAgentReasoningEffort | string;
  metadata?: Record<string, unknown>;
};

type CodeAgentRetryRunResult = {
  ok: boolean;
  run?: CodeAgentRun;
  message: string;
  error?: string;
};

type CodeAgentCodePackMetadata = {
  name: string;
  version?: string;
  root?: string;
  packagePath?: string;
  cliEntry?: string;
  available?: boolean;
};

type CodeAgentHostMetadata = {
  status: "ok" | "unavailable";
  platform: NodeJS.Platform | string;
  desktopVersion?: string;
  storeRoot: string;
  runsDir: string;
  transcriptsDir: string;
  codePack?: CodeAgentCodePackMetadata;
  llmProvider?: {
    configured: boolean;
    label?: string;
    configuredProviders?: string[];
    missingEnvVars?: string[];
  };
  capabilities: {
    fileBackedRuns: boolean;
    nativeTaskRunner: boolean;
    queueMetadata: boolean;
    steeringMetadata: boolean;
    retryRun: boolean;
    rerunRun: boolean;
    openTerminal: boolean;
    controlCommands: CodeAgentHostControlCommand[];
  };
  error?: string;
};

type DesktopOpenRequest = {
  app?: string;
  goalId?: string;
  path?: string;
  softOpen?: boolean;
  runId?: string;
};

type DesktopShortcutBehavior = "toggle" | "show";

type DesktopShortcutBinding = {
  id: string;
  accelerator: string;
  app: string;
  view?: string;
  behavior: DesktopShortcutBehavior;
  enabled: boolean;
};

type DesktopShortcutRegistration = {
  id: string;
  registered: boolean;
  error?: string;
};

type DesktopShortcutSettings = {
  bindings: DesktopShortcutBinding[];
  registrations: DesktopShortcutRegistration[];
};

type DesktopShortcutUpsertRequest = {
  id?: string;
  accelerator: string;
  app: string;
  view?: string;
  behavior?: DesktopShortcutBehavior;
  enabled?: boolean;
};

type DesktopShortcutUpdateResult = {
  ok: boolean;
  settings: DesktopShortcutSettings;
  error?: string;
};

type LocalAppFolderInfo = {
  path: string;
  name: string;
  devUrl: string;
  devPort: number;
  devCommand: string;
  packageManager?: string;
  warning?: string;
};

type LocalAppFolderSelectResult = {
  ok: boolean;
  folder?: LocalAppFolderInfo;
  error?: string;
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
    loadBindings(): Promise<DesktopShortcutSettings>;
    upsertBinding(
      request: DesktopShortcutUpsertRequest,
    ): Promise<DesktopShortcutUpdateResult>;
    removeBinding(id: string): Promise<DesktopShortcutUpdateResult>;
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
      showCodeTab: boolean;
      mode: "dev" | "prod";
      prodUrl?: string;
    }>;
    update(settings: {
      enabled?: boolean;
      showCodeTab?: boolean;
      mode?: "dev" | "prod";
      prodUrl?: string;
    }): Promise<{
      enabled: boolean;
      showCodeTab: boolean;
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
    listModels(): Promise<CodeAgentModelListResult>;
    createRun(
      request: CodeAgentCreateRunRequest,
    ): Promise<CodeAgentCreateRunResult>;
    readTranscript(
      request: CodeAgentTranscriptRequest,
    ): Promise<CodeAgentTranscriptResult>;
    subscribeTranscript(
      request: CodeAgentTranscriptRequest,
      cb: (batch: CodeAgentTranscriptSubscriptionBatch) => void,
    ): () => void;
    appendFollowUp(
      request: CodeAgentFollowUpRequest,
    ): Promise<CodeAgentFollowUpResult>;
    updateRun(
      request: CodeAgentUpdateRunRequest,
    ): Promise<CodeAgentUpdateRunResult>;
    retryRun(
      request: CodeAgentRetryRunRequest,
    ): Promise<CodeAgentRetryRunResult>;
    rerunRun(request: CodeAgentRerunRequest): Promise<CodeAgentRerunResult>;
    controlRun(
      goalId: string,
      runId: string,
      command: CodeAgentControlCommand,
      permissionMode?: CodeAgentPermissionMode,
    ): Promise<CodeAgentControlResult>;
    getHostMetadata(): Promise<CodeAgentHostMetadata>;
    listCodePacks(cwd?: string): Promise<CodeAgentCodePackResult>;
    listProjects(): Promise<CodeAgentProjectListResult>;
    selectProject(cwd: string): Promise<CodeAgentProjectSelectResult>;
    chooseProject(): Promise<CodeAgentProjectSelectResult>;
    listMigrationRuns(): Promise<CodeAgentRunListResult<CodeAgentMigrationRun>>;
    openTerminal(
      request?: CodeAgentTerminalRequest,
    ): Promise<CodeAgentTerminalResult>;
    getRemoteConnectorStatus(): Promise<CodeAgentRemoteConnectorStatus>;
    setRemoteConnectorEnabled(
      enabled: boolean,
    ): Promise<CodeAgentRemoteConnectorControlResult>;
    pairRemoteConnector(
      request?: CodeAgentRemoteConnectorPairRequest,
    ): Promise<CodeAgentRemoteConnectorPairResult>;
    getProviderSettings(): Promise<CodeAgentProviderSettings>;
    updateProviderSettings(
      request: CodeAgentProviderSettingsUpdate,
    ): Promise<CodeAgentProviderSettingsUpdateResult>;
    connectBuilderProvider(): Promise<CodeAgentProviderSettingsUpdateResult>;
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
    chooseLocalFolder(): Promise<LocalAppFolderSelectResult>;
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
