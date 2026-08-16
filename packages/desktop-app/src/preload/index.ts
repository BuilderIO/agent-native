import type {
  CreateMcpServerArgs,
  McpServersList,
  McpServer,
  McpServerScope,
  TestMcpUrlResult,
} from "@agent-native/core/client/resources";
import type { AppConfig } from "@shared/app-registry";
import {
  CHAT_FIRST_MCP_IPC,
  type ChatFirstMcpPluginImportResult,
} from "@shared/chat-first-mcp";
import type { CodeAgentPermissionMode } from "@shared/code-agents";
import {
  IPC,
  type ActiveWebviewTarget,
  type CodeAgentCodePackResult,
  type CodeAgentComputerSetupAction,
  type CodeAgentComputerSetupResult,
  type CodeAgentCreateRunRequest,
  type CodeAgentCreateRunResult,
  type CodeAgentRemoteWaitlistRequest,
  type CodeAgentRemoteWaitlistResult,
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
  type DesktopAppContextAction,
  type DesktopAppCreationSettings,
  type DesktopAppRuntimeStatus,
  type DesktopIdentityStatus,
  type DesktopCreateAppRequest,
  type DesktopCreateAppResult,
  type DesktopPrepareLocalCodeChangeRequest,
  type DesktopPrepareLocalCodeChangeResult,
  type DesktopShortcutActivationRequest,
  type DesktopShortcutSettings,
  type DesktopShortcutUpdateResult,
  type DesktopShortcutUpsertRequest,
  type QuickPromptPreferences,
  type QuickPromptSettings,
  type QuickPromptSubmitRequest,
  type QuickPromptSubmitResult,
  type InterAppMessage,
  type LocalAppFolderSelectResult,
  type UpdateStatus,
} from "@shared/ipc-channels";
import {
  MULTI_FRONTIER_CHANNELS,
  type MultiFrontierActionResult,
  type MultiFrontierCreateIntent,
  type MultiFrontierProviderStatusEnvelope,
  type MultiFrontierProviderStatusEvent,
  type MultiFrontierReReviewIntent,
  type MultiFrontierRendererApi,
  type MultiFrontierSettings,
  type MultiFrontierSubscriptionEnvelope,
  type MultiFrontierSubscriptionResult,
} from "@shared/multi-frontier-channels";
import type {
  MultiFrontierIpcEvent,
  MultiFrontierProviderId,
  MultiFrontierRendererState,
} from "@shared/multi-frontier-ipc";
import { isDesktopSentryConfigured } from "@shared/sentry-config";
import { contextBridge, ipcRenderer } from "electron";

const CODE_AGENTS_SUBSCRIBE_TRANSCRIPT_CHANNEL =
  "code-agents:subscribe-transcript";
const CODE_AGENTS_UNSUBSCRIBE_TRANSCRIPT_CHANNEL =
  "code-agents:unsubscribe-transcript";
const CODE_AGENTS_TRANSCRIPT_EVENTS_CHANNEL = "code-agents:transcript-events";
const WEBVIEW_PRELOAD_PATH =
  process.argv
    .find((arg) => arg.startsWith("--an-webview-preload="))
    ?.slice("--an-webview-preload=".length) ?? "";
const WEBVIEW_CHAT_PRELOAD_PATH =
  process.argv
    .find((arg) => arg.startsWith("--an-webview-chat-preload="))
    ?.slice("--an-webview-chat-preload=".length) ?? "";

type CodeAgentTranscriptSubscriptionBatch = CodeAgentTranscriptResult & {
  subscriptionId?: string;
  reason?: string;
};

/** The API surface exposed to the renderer via window.electronAPI */
const electronAPI = {
  /** Current OS platform — used by renderer to adapt UI (e.g. traffic lights vs custom controls) */
  platform: process.platform as string,

  /** Desktop shell Sentry is configured in the main process. */
  sentry: {
    enabled: isDesktopSentryConfigured(process.env),
  },

  /** Dedicated preload for hosted app webviews. Exposes only app-safe bridges. */
  webviewPreloadPath: WEBVIEW_PRELOAD_PATH,
  /** Chat-only preload for every hosted app webview. */
  webviewChatPreloadPath: WEBVIEW_CHAT_PRELOAD_PATH,

  /** Window chrome controls */
  windowControls: {
    minimize: () => ipcRenderer.send(IPC.WINDOW_MINIMIZE),
    maximize: () => ipcRenderer.send(IPC.WINDOW_MAXIMIZE),
    close: () => ipcRenderer.send(IPC.WINDOW_CLOSE),
    setNativeTrafficLightsVisible: (visible: boolean): void =>
      ipcRenderer.send(IPC.WINDOW_NATIVE_BUTTONS_VISIBILITY, visible),
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
      cb: (info: {
        key: string;
        shiftKey: boolean;
        altKey?: boolean;
        ctrlKey?: boolean;
      }) => void,
    ): (() => void) => {
      const handler = (
        _: Electron.IpcRendererEvent,
        info: {
          key: string;
          shiftKey: boolean;
          altKey?: boolean;
          ctrlKey?: boolean;
        },
      ) => cb(info);
      ipcRenderer.on("shortcut:keydown", handler);
      return () => ipcRenderer.removeListener("shortcut:keydown", handler);
    },
    loadBindings: (): Promise<DesktopShortcutSettings> =>
      ipcRenderer.invoke(IPC.SHORTCUTS_LOAD),
    upsertBinding: (
      request: DesktopShortcutUpsertRequest,
    ): Promise<DesktopShortcutUpdateResult> =>
      ipcRenderer.invoke(IPC.SHORTCUTS_UPSERT, request),
    removeBinding: (id: string): Promise<DesktopShortcutUpdateResult> =>
      ipcRenderer.invoke(IPC.SHORTCUTS_REMOVE, id),
    onActivate: (
      cb: (request: DesktopShortcutActivationRequest) => void,
    ): (() => void) => {
      const handler = (
        _: Electron.IpcRendererEvent,
        request: DesktopShortcutActivationRequest,
      ) => cb(request);
      ipcRenderer.on(IPC.SHORTCUTS_ACTIVATE, handler);
      return () => ipcRenderer.removeListener(IPC.SHORTCUTS_ACTIVATE, handler);
    },
    ackActivation: (requestId: string, appId?: string): void => {
      ipcRenderer.send(IPC.SHORTCUTS_ACTIVATE_ACK, { requestId, appId });
    },
  },

  /** App config management */
  appConfig: {
    load: (): Promise<AppConfig[]> => ipcRenderer.invoke(IPC.APPS_LOAD),
    add: (app: AppConfig): Promise<AppConfig[]> =>
      ipcRenderer.invoke(IPC.APPS_ADD, app),
    remove: (id: string): Promise<AppConfig[]> =>
      ipcRenderer.invoke(IPC.APPS_REMOVE, id),
    update: (id: string, updates: Partial<AppConfig>): Promise<AppConfig[]> =>
      ipcRenderer.invoke(IPC.APPS_UPDATE, id, updates),
    reorder: (id: string, direction: "up" | "down"): Promise<AppConfig[]> =>
      ipcRenderer.invoke(IPC.APPS_REORDER, id, direction),
    reset: (): Promise<AppConfig[]> => ipcRenderer.invoke(IPC.APPS_RESET),
    chooseLocalFolder: (): Promise<LocalAppFolderSelectResult> =>
      ipcRenderer.invoke(IPC.APPS_CHOOSE_LOCAL_FOLDER),
    getCreationSettings: (): Promise<DesktopAppCreationSettings> =>
      ipcRenderer.invoke(IPC.APPS_GET_CREATION_SETTINGS),
    updateCreationSettings: (
      settings: Partial<DesktopAppCreationSettings>,
    ): Promise<DesktopAppCreationSettings> =>
      ipcRenderer.invoke(IPC.APPS_UPDATE_CREATION_SETTINGS, settings),
    createFromPrompt: (
      request: DesktopCreateAppRequest,
    ): Promise<DesktopCreateAppResult> =>
      ipcRenderer.invoke(IPC.APPS_CREATE_FROM_PROMPT, request),
    prepareLocalCodeChange: (
      request: DesktopPrepareLocalCodeChangeRequest,
    ): Promise<DesktopPrepareLocalCodeChangeResult> =>
      ipcRenderer.invoke(IPC.APPS_PREPARE_LOCAL_CODE_CHANGE, request),
    showContextMenu: (appId: string): Promise<DesktopAppContextAction | null> =>
      ipcRenderer.invoke(IPC.APPS_SHOW_CONTEXT_MENU, appId),
    onRuntimeStatus: (
      cb: (status: DesktopAppRuntimeStatus) => void,
    ): (() => void) => {
      const handler = (
        _: Electron.IpcRendererEvent,
        status: DesktopAppRuntimeStatus,
      ) => cb(status);
      ipcRenderer.on(IPC.APP_STATUS, handler);
      return () => ipcRenderer.removeListener(IPC.APP_STATUS, handler);
    },
  },

  /** Loopback URL for shell-owned chat requests in a selected app session. */
  desktopChat: {
    getApiUrl: (appId: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.DESKTOP_CHAT_GET_API_URL, appId),
    getTerminalInfoUrl: (appId: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.DESKTOP_CHAT_GET_TERMINAL_INFO_URL, appId),
  },

  /** Workspace identity commands expose intent and status, never credentials. */
  identity: {
    getStatus: (): Promise<DesktopIdentityStatus> =>
      ipcRenderer.invoke(IPC.IDENTITY_STATUS_GET),
    getAvailability: (): Promise<boolean> =>
      ipcRenderer.invoke(IPC.IDENTITY_AVAILABILITY_GET),
    signIn: (): Promise<boolean> => ipcRenderer.invoke(IPC.IDENTITY_SIGN_IN),
    signOut: (): Promise<boolean> => ipcRenderer.invoke(IPC.IDENTITY_SIGN_OUT),
    onStatusChange: (
      cb: (status: DesktopIdentityStatus) => void,
    ): (() => void) => {
      const handler = (
        _: Electron.IpcRendererEvent,
        status: DesktopIdentityStatus,
      ) => cb(status);
      ipcRenderer.on(IPC.IDENTITY_STATUS_CHANGED, handler);
      return () =>
        ipcRenderer.removeListener(IPC.IDENTITY_STATUS_CHANGED, handler);
    },
  },

  /** Shared MCP connection management used by the desktop settings surface. */
  mcpServers: {
    list: (): Promise<McpServersList> =>
      ipcRenderer.invoke(CHAT_FIRST_MCP_IPC.LIST),
    create: (args: CreateMcpServerArgs): Promise<McpServer> =>
      ipcRenderer.invoke(CHAT_FIRST_MCP_IPC.CREATE, args),
    delete: (args: { id: string; scope: McpServerScope }): Promise<void> =>
      ipcRenderer.invoke(CHAT_FIRST_MCP_IPC.DELETE, args),
    reconnect: (args: { id: string; scope: McpServerScope }): Promise<void> =>
      ipcRenderer.invoke(CHAT_FIRST_MCP_IPC.RECONNECT, args),
    test: (
      url: string,
      headers?: Record<string, string>,
    ): Promise<TestMcpUrlResult> =>
      ipcRenderer.invoke(CHAT_FIRST_MCP_IPC.TEST, { url, headers }),
    testExisting: (args: {
      id: string;
      scope: McpServerScope;
    }): Promise<TestMcpUrlResult> =>
      ipcRenderer.invoke(CHAT_FIRST_MCP_IPC.TEST_EXISTING, args),
    importPlugin: (): Promise<ChatFirstMcpPluginImportResult> =>
      ipcRenderer.invoke(CHAT_FIRST_MCP_IPC.IMPORT_PLUGIN),
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

  /** Open a validated URL in the user's system browser. */
  shell: {
    openExternal: (url: string): Promise<void> =>
      ipcRenderer.invoke(IPC.SHELL_OPEN_EXTERNAL, url),
  },

  /** Global Quick Prompt overlay controls */
  quickPrompt: {
    load: (): Promise<QuickPromptSettings> =>
      ipcRenderer.invoke(IPC.QUICK_PROMPT_LOAD),
    update: (
      settings: Partial<QuickPromptPreferences>,
    ): Promise<QuickPromptSettings> =>
      ipcRenderer.invoke(IPC.QUICK_PROMPT_UPDATE, settings),
    dismiss: (): void => {
      ipcRenderer.send(IPC.QUICK_PROMPT_DISMISS);
    },
    setPickerOpen: (open: boolean): void => {
      ipcRenderer.send(IPC.QUICK_PROMPT_SET_PICKER_OPEN, open);
    },
    onHidden: (cb: () => void): (() => void) => {
      const handler = () => cb();
      ipcRenderer.on(IPC.QUICK_PROMPT_HIDDEN, handler);
      return () => ipcRenderer.removeListener(IPC.QUICK_PROMPT_HIDDEN, handler);
    },
    submit: (
      request: QuickPromptSubmitRequest,
    ): Promise<QuickPromptSubmitResult> =>
      ipcRenderer.invoke(IPC.QUICK_PROMPT_SUBMIT, request),
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
    submitRemoteWaitlist: (
      request: CodeAgentRemoteWaitlistRequest,
    ): Promise<CodeAgentRemoteWaitlistResult> =>
      ipcRenderer.invoke(IPC.CODE_AGENTS_REMOTE_WAITLIST, request),
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
    runComputerSetupAction: (
      action: CodeAgentComputerSetupAction,
    ): Promise<CodeAgentComputerSetupResult> =>
      ipcRenderer.invoke(IPC.CODE_AGENTS_COMPUTER_SETUP, action),
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
    openCodexLogin: (): Promise<CodeAgentTerminalResult> =>
      ipcRenderer.invoke(IPC.CODE_AGENTS_OPEN_CODEX_LOGIN),
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

  multiFrontier: {
    getSettings: (): Promise<MultiFrontierSettings> =>
      ipcRenderer.invoke(MULTI_FRONTIER_CHANNELS.settingsGet),
    updateSettings: (
      settings: Partial<MultiFrontierSettings>,
    ): Promise<MultiFrontierSettings> =>
      ipcRenderer.invoke(MULTI_FRONTIER_CHANNELS.settingsUpdate, settings),
    getProviderStatus: (
      providerId: MultiFrontierProviderId,
    ): Promise<MultiFrontierSubscriptionResult> =>
      ipcRenderer.invoke(MULTI_FRONTIER_CHANNELS.providerStatus, providerId),
    beginProviderLogin: (
      providerId: MultiFrontierProviderId,
    ): Promise<MultiFrontierSubscriptionResult> =>
      ipcRenderer.invoke(MULTI_FRONTIER_CHANNELS.providerLogin, providerId),
    refreshProviderStatus: (
      providerId: MultiFrontierProviderId,
    ): Promise<MultiFrontierSubscriptionResult> =>
      ipcRenderer.invoke(MULTI_FRONTIER_CHANNELS.providerRefresh, providerId),
    list: (): Promise<MultiFrontierRendererState[]> =>
      ipcRenderer.invoke(MULTI_FRONTIER_CHANNELS.list),
    create: (
      intent: MultiFrontierCreateIntent,
    ): Promise<MultiFrontierActionResult> =>
      ipcRenderer.invoke(MULTI_FRONTIER_CHANNELS.create, intent),
    start: (collaborationId: string): Promise<MultiFrontierActionResult> =>
      ipcRenderer.invoke(MULTI_FRONTIER_CHANNELS.start, collaborationId),
    go: (collaborationId: string): Promise<MultiFrontierActionResult> =>
      ipcRenderer.invoke(MULTI_FRONTIER_CHANNELS.go, collaborationId),
    pause: (collaborationId: string): Promise<MultiFrontierActionResult> =>
      ipcRenderer.invoke(MULTI_FRONTIER_CHANNELS.pause, collaborationId),
    resume: (
      collaborationId: string,
      prompt?: string,
    ): Promise<MultiFrontierActionResult> =>
      ipcRenderer.invoke(
        MULTI_FRONTIER_CHANNELS.resume,
        prompt ? { collaborationId, prompt } : collaborationId,
      ),
    cancel: (collaborationId: string): Promise<MultiFrontierActionResult> =>
      ipcRenderer.invoke(MULTI_FRONTIER_CHANNELS.cancel, collaborationId),
    reReview: (
      collaborationId: string,
      input: MultiFrontierReReviewIntent,
    ): Promise<MultiFrontierActionResult> =>
      ipcRenderer.invoke(MULTI_FRONTIER_CHANNELS.reReview, {
        collaborationId,
        reviewArtifactId: input.reviewArtifactId,
        ...(input.instruction ? { instruction: input.instruction } : {}),
      }),
    roleSwap: (
      collaborationId: string,
      nextDriverParticipantId: string,
    ): Promise<MultiFrontierActionResult> =>
      ipcRenderer.invoke(MULTI_FRONTIER_CHANNELS.roleSwap, {
        collaborationId,
        nextDriverParticipantId,
      }),
    subscribe: (
      collaborationId: string,
      callback: (event: MultiFrontierIpcEvent) => void,
    ): (() => void) => {
      const subscriptionId = `mf-subscription-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`;
      const handler = (
        _: Electron.IpcRendererEvent,
        envelope: MultiFrontierSubscriptionEnvelope,
      ) => {
        if (envelope?.subscriptionId !== subscriptionId) return;
        callback(envelope.event);
      };
      ipcRenderer.on(MULTI_FRONTIER_CHANNELS.events, handler);
      ipcRenderer.send(MULTI_FRONTIER_CHANNELS.subscribe, {
        subscriptionId,
        collaborationId,
      });
      return () => {
        ipcRenderer.removeListener(MULTI_FRONTIER_CHANNELS.events, handler);
        ipcRenderer.send(MULTI_FRONTIER_CHANNELS.unsubscribe, {
          subscriptionId,
        });
      };
    },
    subscribeProviderStatus: (
      callback: (event: MultiFrontierProviderStatusEvent) => void,
    ): (() => void) => {
      const subscriptionId = `mf-provider-status-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`;
      const handler = (
        _: Electron.IpcRendererEvent,
        envelope: MultiFrontierProviderStatusEnvelope,
      ) => {
        if (envelope?.subscriptionId !== subscriptionId) return;
        callback(envelope.event);
      };
      ipcRenderer.on(MULTI_FRONTIER_CHANNELS.providerStatusEvents, handler);
      ipcRenderer.send(MULTI_FRONTIER_CHANNELS.providerStatusSubscribe, {
        subscriptionId,
      });
      return () => {
        ipcRenderer.removeListener(
          MULTI_FRONTIER_CHANNELS.providerStatusEvents,
          handler,
        );
        ipcRenderer.send(MULTI_FRONTIER_CHANNELS.providerStatusUnsubscribe, {
          subscriptionId,
        });
      };
    },
  } satisfies MultiFrontierRendererApi,

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
