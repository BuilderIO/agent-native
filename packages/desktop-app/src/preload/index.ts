import { contextBridge, ipcRenderer } from "electron";
import {
  IPC,
  type ActiveWebviewTarget,
  type CodeAgentCodePackResult,
  type CodeAgentCreateRunRequest,
  type CodeAgentCreateRunResult,
  type CodeAgentFollowUpRequest,
  type CodeAgentFollowUpResult,
  type CodeAgentHostMetadata,
  type CodeAgentModelListResult,
  type CodeAgentProjectListResult,
  type CodeAgentProjectSelectResult,
  type CodeAgentRetryRunRequest,
  type CodeAgentRetryRunResult,
  type CodeAgentRerunRequest,
  type CodeAgentRerunResult,
  type CodeAgentUpdateRunRequest,
  type CodeAgentUpdateRunResult,
  type CodeAgentControlCommand,
  type CodeAgentControlResult,
  type CodeAgentMigrationRun,
  type CodeAgentRunListResult,
  type CodeAgentTranscriptRequest,
  type CodeAgentTranscriptResult,
  type CodeAgentTerminalRequest,
  type CodeAgentTerminalResult,
  type CodeAgentRemoteConnectorControlResult,
  type CodeAgentRemoteConnectorPairRequest,
  type CodeAgentRemoteConnectorPairResult,
  type CodeAgentRemoteConnectorStatus,
  type CodeAgentProviderSettings,
  type CodeAgentProviderSettingsUpdate,
  type CodeAgentProviderSettingsUpdateResult,
  type DesktopOpenRequest,
  type InterAppMessage,
  type UpdateStatus,
} from "@shared/ipc-channels";
import type { CodeAgentPermissionMode } from "@shared/code-agents";

const CODE_AGENTS_SUBSCRIBE_TRANSCRIPT_CHANNEL =
  "code-agents:subscribe-transcript";
const CODE_AGENTS_UNSUBSCRIBE_TRANSCRIPT_CHANNEL =
  "code-agents:unsubscribe-transcript";
const CODE_AGENTS_TRANSCRIPT_EVENTS_CHANNEL = "code-agents:transcript-events";

type CodeAgentTranscriptSubscriptionBatch = CodeAgentTranscriptResult & {
  subscriptionId?: string;
  reason?: string;
};

/** The API surface exposed to the renderer via window.electronAPI */
const electronAPI = {
  /** Current OS platform — used by renderer to adapt UI (e.g. traffic lights vs custom controls) */
  platform: process.platform as string,

  /** Window chrome controls */
  windowControls: {
    minimize: () => ipcRenderer.send(IPC.WINDOW_MINIMIZE),
    maximize: () => ipcRenderer.send(IPC.WINDOW_MAXIMIZE),
    close: () => ipcRenderer.send(IPC.WINDOW_CLOSE),
    isMaximized: (): Promise<boolean> =>
      ipcRenderer.invoke(IPC.WINDOW_IS_MAXIMIZED),

    /** Subscribe to maximize/restore state changes. Returns an unsubscribe fn. */
    onMaximizedChange: (cb: (isMaximized: boolean) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, value: boolean) =>
        cb(value);
      ipcRenderer.on(IPC.WINDOW_MAXIMIZED_CHANGED, handler);
      return () =>
        ipcRenderer.removeListener(IPC.WINDOW_MAXIMIZED_CHANGED, handler);
    },
  },

  /** Shortcuts forwarded from the main process */
  shortcuts: {
    onCloseTab: (cb: () => void): (() => void) => {
      const handler = () => cb();
      ipcRenderer.on("shortcut:close-tab", handler);
      return () => ipcRenderer.removeListener("shortcut:close-tab", handler);
    },

    /** Generic shortcut forwarding from webview guests */
    onKeydown: (
      cb: (info: { key: string; shiftKey: boolean; altKey?: boolean }) => void,
    ): (() => void) => {
      const handler = (
        _: Electron.IpcRendererEvent,
        info: { key: string; shiftKey: boolean; altKey?: boolean },
      ) => cb(info);
      ipcRenderer.on("shortcut:keydown", handler);
      return () => ipcRenderer.removeListener("shortcut:keydown", handler);
    },
  },

  /** App config management */
  appConfig: {
    load: (): Promise<any[]> => ipcRenderer.invoke(IPC.APPS_LOAD),
    add: (app: any): Promise<any[]> => ipcRenderer.invoke(IPC.APPS_ADD, app),
    remove: (id: string): Promise<any[]> =>
      ipcRenderer.invoke(IPC.APPS_REMOVE, id),
    update: (id: string, updates: any): Promise<any[]> =>
      ipcRenderer.invoke(IPC.APPS_UPDATE, id, updates),
    reset: (): Promise<any[]> => ipcRenderer.invoke(IPC.APPS_RESET),
  },

  /** Tell main process which app webview is currently active (for DevTools targeting) */
  setActiveApp: (appId: string) => ipcRenderer.send(IPC.SET_ACTIVE_APP, appId),
  setActiveWebview: (target: ActiveWebviewTarget) =>
    ipcRenderer.send(IPC.SET_ACTIVE_WEBVIEW, target),

  /** Clipboard helpers */
  clipboard: {
    writeText: (text: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.CLIPBOARD_WRITE_TEXT, text),
  },

  /** Local dev frame settings */
  frame: {
    load: (): Promise<any> => ipcRenderer.invoke(IPC.FRAME_LOAD),
    update: (settings: any): Promise<any> =>
      ipcRenderer.invoke(IPC.FRAME_UPDATE, settings),
  },

  /** Auto-update controls + status */
  updater: {
    check: (): Promise<UpdateStatus> => ipcRenderer.invoke(IPC.UPDATE_CHECK),
    download: (): Promise<UpdateStatus> =>
      ipcRenderer.invoke(IPC.UPDATE_DOWNLOAD),
    install: (): void => {
      ipcRenderer.invoke(IPC.UPDATE_INSTALL);
    },
    getStatus: (): Promise<UpdateStatus> =>
      ipcRenderer.invoke(IPC.UPDATE_GET_STATUS),

    /** Subscribe to update status changes. Returns an unsubscribe fn. */
    onStatusChange: (cb: (status: UpdateStatus) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, status: UpdateStatus) =>
        cb(status);
      ipcRenderer.on(IPC.UPDATE_STATUS_CHANGED, handler);
      return () =>
        ipcRenderer.removeListener(IPC.UPDATE_STATUS_CHANGED, handler);
    },
  },

  /** Native Agent-Native Code hub helpers */
  codeAgents: {
    listRuns: (goalId?: string): Promise<CodeAgentRunListResult> =>
      ipcRenderer.invoke(IPC.CODE_AGENTS_LIST_RUNS, goalId),
    listModels: (): Promise<CodeAgentModelListResult> =>
      ipcRenderer.invoke(IPC.CODE_AGENTS_LIST_MODELS),
    createRun: (
      request: CodeAgentCreateRunRequest,
    ): Promise<CodeAgentCreateRunResult> =>
      ipcRenderer.invoke(IPC.CODE_AGENTS_CREATE_RUN, request),
    readTranscript: (
      request: CodeAgentTranscriptRequest,
    ): Promise<CodeAgentTranscriptResult> =>
      ipcRenderer.invoke(IPC.CODE_AGENTS_READ_TRANSCRIPT, request),
    subscribeTranscript: (
      request: CodeAgentTranscriptRequest,
      cb: (batch: CodeAgentTranscriptSubscriptionBatch) => void,
    ): (() => void) => {
      const subscriptionId = `subscription-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`;
      const handler = (
        _: Electron.IpcRendererEvent,
        batch: CodeAgentTranscriptSubscriptionBatch,
      ) => {
        if (batch?.subscriptionId !== subscriptionId) return;
        cb(batch);
      };
      ipcRenderer.on(CODE_AGENTS_TRANSCRIPT_EVENTS_CHANNEL, handler);
      ipcRenderer.send(CODE_AGENTS_SUBSCRIBE_TRANSCRIPT_CHANNEL, {
        subscriptionId,
        request,
      });
      return () => {
        ipcRenderer.removeListener(
          CODE_AGENTS_TRANSCRIPT_EVENTS_CHANNEL,
          handler,
        );
        ipcRenderer.send(CODE_AGENTS_UNSUBSCRIBE_TRANSCRIPT_CHANNEL, {
          subscriptionId,
        });
      };
    },
    appendFollowUp: (
      request: CodeAgentFollowUpRequest,
    ): Promise<CodeAgentFollowUpResult> =>
      ipcRenderer.invoke(IPC.CODE_AGENTS_APPEND_FOLLOW_UP, request),
    updateRun: (
      request: CodeAgentUpdateRunRequest,
    ): Promise<CodeAgentUpdateRunResult> =>
      ipcRenderer.invoke(IPC.CODE_AGENTS_UPDATE_RUN, request),
    retryRun: (
      request: CodeAgentRetryRunRequest,
    ): Promise<CodeAgentRetryRunResult> =>
      ipcRenderer.invoke(IPC.CODE_AGENTS_RETRY_RUN, request),
    rerunRun: (request: CodeAgentRerunRequest): Promise<CodeAgentRerunResult> =>
      ipcRenderer.invoke(IPC.CODE_AGENTS_RERUN_RUN, request),
    controlRun: (
      goalId: string,
      runId: string,
      command: CodeAgentControlCommand,
      permissionMode?: CodeAgentPermissionMode,
    ): Promise<CodeAgentControlResult> =>
      ipcRenderer.invoke(IPC.CODE_AGENTS_CONTROL_RUN, {
        goalId,
        runId,
        command,
        permissionMode,
      }),
    getHostMetadata: (): Promise<CodeAgentHostMetadata> =>
      ipcRenderer.invoke(IPC.CODE_AGENTS_GET_HOST_METADATA),
    listCodePacks: (cwd?: string): Promise<CodeAgentCodePackResult> =>
      ipcRenderer.invoke(IPC.CODE_AGENTS_LIST_CODE_PACKS, { cwd }),
    listProjects: (): Promise<CodeAgentProjectListResult> =>
      ipcRenderer.invoke(IPC.CODE_AGENTS_LIST_PROJECTS),
    selectProject: (cwd: string): Promise<CodeAgentProjectSelectResult> =>
      ipcRenderer.invoke(IPC.CODE_AGENTS_SELECT_PROJECT, cwd),
    chooseProject: (): Promise<CodeAgentProjectSelectResult> =>
      ipcRenderer.invoke(IPC.CODE_AGENTS_CHOOSE_PROJECT),
    listMigrationRuns: (): Promise<
      CodeAgentRunListResult<CodeAgentMigrationRun>
    > => ipcRenderer.invoke(IPC.CODE_AGENTS_LIST_MIGRATION_RUNS),
    openTerminal: (
      request?: CodeAgentTerminalRequest,
    ): Promise<CodeAgentTerminalResult> =>
      ipcRenderer.invoke(IPC.CODE_AGENTS_OPEN_TERMINAL, request),
    getRemoteConnectorStatus: (): Promise<CodeAgentRemoteConnectorStatus> =>
      ipcRenderer.invoke(IPC.CODE_AGENTS_REMOTE_CONNECTOR_GET_STATUS),
    setRemoteConnectorEnabled: (
      enabled: boolean,
    ): Promise<CodeAgentRemoteConnectorControlResult> =>
      ipcRenderer.invoke(IPC.CODE_AGENTS_REMOTE_CONNECTOR_SET_ENABLED, enabled),
    pairRemoteConnector: (
      request?: CodeAgentRemoteConnectorPairRequest,
    ): Promise<CodeAgentRemoteConnectorPairResult> =>
      ipcRenderer.invoke(IPC.CODE_AGENTS_REMOTE_CONNECTOR_PAIR, request),
    getProviderSettings: (): Promise<CodeAgentProviderSettings> =>
      ipcRenderer.invoke(IPC.CODE_AGENTS_PROVIDER_SETTINGS_GET),
    updateProviderSettings: (
      request: CodeAgentProviderSettingsUpdate,
    ): Promise<CodeAgentProviderSettingsUpdateResult> =>
      ipcRenderer.invoke(IPC.CODE_AGENTS_PROVIDER_SETTINGS_UPDATE, request),
    connectBuilderProvider:
      (): Promise<CodeAgentProviderSettingsUpdateResult> =>
        ipcRenderer.invoke(IPC.CODE_AGENTS_PROVIDER_BUILDER_CONNECT),
    onOpenRequest: (
      cb: (request: DesktopOpenRequest) => void,
    ): (() => void) => {
      const handler = (
        _: Electron.IpcRendererEvent,
        request: DesktopOpenRequest,
      ) => cb(request);
      ipcRenderer.on(IPC.DEEP_LINK_OPEN, handler);
      return () => ipcRenderer.removeListener(IPC.DEEP_LINK_OPEN, handler);
    },
  },

  /** Inter-app communication — relay messages between loaded apps */
  interApp: {
    /** Send a message to a specific app (or broadcast with targetAppId = "*") */
    send: (targetAppId: string, event: string, data: unknown) => {
      const msg: InterAppMessage = {
        from: "shell",
        targetAppId,
        event,
        data,
      };
      ipcRenderer.send(IPC.INTER_APP_SEND, msg);
    },

    /** Subscribe to inter-app messages. Returns an unsubscribe fn. */
    on: (
      cb: (from: string, event: string, data: unknown) => void,
    ): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, msg: InterAppMessage) => {
        cb(msg.from, msg.event, msg.data);
      };
      ipcRenderer.on(IPC.INTER_APP_MESSAGE, handler);
      return () => ipcRenderer.removeListener(IPC.INTER_APP_MESSAGE, handler);
    },
  },
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
