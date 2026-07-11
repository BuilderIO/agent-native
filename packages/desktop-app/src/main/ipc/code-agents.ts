import fs from "fs";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { CODE_AGENT_GOALS, getCodeAgentGoal } from "@shared/code-agents";
import {
  IPC,
  type CodeAgentCodePackResult,
  type CodeAgentControlResult,
  type CodeAgentCreateRunResult,
  type CodeAgentFollowUpResult,
  type CodeAgentHostMetadata,
  type CodeAgentModelListResult,
  type CodeAgentProjectFolder,
  type CodeAgentProjectListResult,
  type CodeAgentProjectSelectResult,
  type CodeAgentProviderSettings,
  type CodeAgentProviderSettingsUpdateResult,
  type CodeAgentRemoteConnectorControlResult,
  type CodeAgentRemoteConnectorPairResult,
  type CodeAgentRemoteConnectorStatus,
  type CodeAgentRerunResult,
  type CodeAgentRetryRunResult,
  type CodeAgentRun,
  type CodeAgentRunListResult,
  type CodeAgentTerminalResult,
  type CodeAgentTranscriptResult,
  type CodeAgentUpdateRunResult,
} from "@shared/ipc-channels";
import {
  app,
  clipboard,
  desktopCapturer,
  ipcMain,
  shell,
  systemPreferences,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";

import {
  getComputerPermissionStatus,
  requestAccessibilityPermission,
  runComputerSetupAction,
} from "../computer-control";
import {
  CODE_AGENTS_SUBSCRIBE_TRANSCRIPT_CHANNEL,
  CODE_AGENTS_TRANSCRIPT_EVENTS_CHANNEL,
  CODE_AGENTS_UNSUBSCRIBE_TRANSCRIPT_CHANNEL,
  type CodeAgentTranscriptSubscription,
  type CodeAgentTranscriptSubscriptionBatch,
} from "../index";

export interface CodeAgentsIpcDeps {
  isObject: (value: unknown) => value is Record<string, unknown>;
  firstStringValue: (...values: unknown[]) => string | undefined;
  timestampSlug: (value: string) => string;
  normalizeCodeAgentRunId: (value: unknown) => string | null;
  listDesktopCodeAgentRuns: (goalId?: string) => CodeAgentRun[];
  createCodeAgentRun: (input: unknown) => Promise<CodeAgentCreateRunResult>;
  getCodeAgentModelList: () => CodeAgentModelListResult;
  readCodeAgentTranscript: (input: unknown) => CodeAgentTranscriptResult;
  removeCodeAgentTranscriptSubscription: (subscriptionId: string) => void;
  initializeCodeAgentTranscriptSubscriptionKeys: (
    subscription: CodeAgentTranscriptSubscription,
  ) => CodeAgentTranscriptResult;
  watchCodeAgentTranscriptSubscription: (
    subscription: CodeAgentTranscriptSubscription,
  ) => void;
  setCodeAgentTranscriptSubscription: (
    subscriptionId: string,
    subscription: CodeAgentTranscriptSubscription,
  ) => void;
  sendCodeAgentTranscriptSubscriptionBatch: (
    subscription: CodeAgentTranscriptSubscription,
    batch: Omit<CodeAgentTranscriptSubscriptionBatch, "subscriptionId">,
  ) => void;
  appendCodeAgentFollowUp: (input: unknown) => Promise<CodeAgentFollowUpResult>;
  updateCodeAgentRun: (input: unknown) => CodeAgentUpdateRunResult;
  retryCodeAgentRun: (input: unknown) => CodeAgentRetryRunResult;
  rerunCodeAgentRun: (input: unknown) => Promise<CodeAgentRerunResult>;
  controlCodeAgentRun: (input: unknown) => Promise<CodeAgentControlResult>;
  getCodeAgentHostMetadata: () => CodeAgentHostMetadata;
  getBundledChromeExtensionPath: () => string;
  getCodeAgentProviderSettings: () => CodeAgentProviderSettings;
  updateCodeAgentProviderSettings: (
    input: unknown,
  ) => CodeAgentProviderSettingsUpdateResult;
  connectDesktopBuilderProvider: () => Promise<CodeAgentProviderSettingsUpdateResult>;
  listCodeAgentProjectPacks: (input?: unknown) => CodeAgentCodePackResult;
  listCodeAgentProjects: () => CodeAgentProjectListResult;
  upsertCodeAgentProject: (folderPath: string) => CodeAgentProjectSelectResult;
  readCodeAgentProjectsState: () => {
    selectedPath?: string;
    projects: CodeAgentProjectFolder[];
  };
  chooseCodeAgentProject: () => Promise<CodeAgentProjectSelectResult>;
  openTerminalForCodeAgents: (request?: unknown) => CodeAgentTerminalResult;
  getRemoteConnectorStatus: () => CodeAgentRemoteConnectorStatus;
  setRemoteConnectorEnabled: (
    enabled: boolean,
  ) => CodeAgentRemoteConnectorControlResult;
  pairRemoteCodeAgentConnector: (
    input: unknown,
  ) => Promise<CodeAgentRemoteConnectorPairResult>;
}

/**
 * Registers the clipboard + Agent-Native Code (background code-agent) IPC
 * surface: run listing/creation/transcripts, follow-ups, control commands,
 * computer-use setup, provider settings, projects, terminal launch, and the
 * remote connector pairing flow.
 */
export function registerCodeAgentsIpc(deps: CodeAgentsIpcDeps): void {
  const {
    isObject,
    firstStringValue,
    timestampSlug,
    normalizeCodeAgentRunId,
    listDesktopCodeAgentRuns,
    createCodeAgentRun,
    getCodeAgentModelList,
    readCodeAgentTranscript,
    removeCodeAgentTranscriptSubscription,
    initializeCodeAgentTranscriptSubscriptionKeys,
    watchCodeAgentTranscriptSubscription,
    setCodeAgentTranscriptSubscription,
    sendCodeAgentTranscriptSubscriptionBatch,
    appendCodeAgentFollowUp,
    updateCodeAgentRun,
    retryCodeAgentRun,
    rerunCodeAgentRun,
    controlCodeAgentRun,
    getCodeAgentHostMetadata,
    getBundledChromeExtensionPath,
    getCodeAgentProviderSettings,
    updateCodeAgentProviderSettings,
    connectDesktopBuilderProvider,
    listCodeAgentProjectPacks,
    listCodeAgentProjects,
    upsertCodeAgentProject,
    readCodeAgentProjectsState,
    chooseCodeAgentProject,
    openTerminalForCodeAgents,
    getRemoteConnectorStatus,
    setRemoteConnectorEnabled,
    pairRemoteCodeAgentConnector,
  } = deps;

  ipcMain.handle(
    IPC.CLIPBOARD_WRITE_TEXT,
    (_event: IpcMainInvokeEvent, text: unknown): boolean => {
      if (typeof text !== "string" || text.length === 0) return false;
      clipboard.writeText(text);
      return true;
    },
  );

  ipcMain.handle(
    IPC.CODE_AGENTS_LIST_RUNS,
    (
      _event: IpcMainInvokeEvent,
      goalId?: string,
    ): Promise<CodeAgentRunListResult> => {
      const goal = getCodeAgentGoal(
        goalId ?? CODE_AGENT_GOALS[0]?.id ?? "task",
      );
      if (!goal) {
        return Promise.resolve({
          status: "unavailable",
          goalId,
          runs: [],
          error: `Unknown Agent-Native Code goal: ${goalId}`,
        });
      }
      const runs = listDesktopCodeAgentRuns(goal.id);
      return Promise.resolve({
        status: "ok",
        goalId: goal.id,
        runs,
      });
    },
  );

  ipcMain.handle(
    IPC.CODE_AGENTS_CREATE_RUN,
    (
      _event: IpcMainInvokeEvent,
      input: unknown,
    ): Promise<CodeAgentCreateRunResult> => createCodeAgentRun(input),
  );

  ipcMain.handle(
    IPC.CODE_AGENTS_LIST_MODELS,
    (): CodeAgentModelListResult => getCodeAgentModelList(),
  );

  ipcMain.handle(
    IPC.CODE_AGENTS_READ_TRANSCRIPT,
    (_event: IpcMainInvokeEvent, input: unknown): CodeAgentTranscriptResult =>
      readCodeAgentTranscript(input),
  );

  ipcMain.on(
    CODE_AGENTS_SUBSCRIBE_TRANSCRIPT_CHANNEL,
    (event: IpcMainEvent, input: unknown) => {
      const payload = isObject(input) ? input : {};
      const subscriptionId =
        firstStringValue(payload.subscriptionId) ??
        `subscription-${timestampSlug(new Date().toISOString())}-${randomUUID().slice(0, 8)}`;
      const request = isObject(payload.request) ? payload.request : payload;
      const runId = normalizeCodeAgentRunId(request.runId);
      if (!runId) {
        event.sender.send(CODE_AGENTS_TRANSCRIPT_EVENTS_CHANNEL, {
          subscriptionId,
          status: "unavailable",
          runId: "",
          events: [],
          error: "Missing or invalid run id.",
        } satisfies CodeAgentTranscriptSubscriptionBatch);
        return;
      }

      removeCodeAgentTranscriptSubscription(subscriptionId);
      const subscription: CodeAgentTranscriptSubscription = {
        id: subscriptionId,
        runId,
        senderId: event.sender.id,
        knownEventKeys: new Set(),
      };
      const result =
        initializeCodeAgentTranscriptSubscriptionKeys(subscription);
      setCodeAgentTranscriptSubscription(subscriptionId, subscription);
      watchCodeAgentTranscriptSubscription(subscription);
      event.sender.once("destroyed", () => {
        removeCodeAgentTranscriptSubscription(subscriptionId);
      });
      if (result.status !== "ok" || result.error) {
        sendCodeAgentTranscriptSubscriptionBatch(subscription, {
          status: result.status,
          runId: result.runId ?? runId,
          events: [],
          eventFile: result.eventFile,
          reason: "subscribe",
          error: result.error,
        });
      }
    },
  );

  ipcMain.on(
    CODE_AGENTS_UNSUBSCRIBE_TRANSCRIPT_CHANNEL,
    (_event: IpcMainEvent, input: unknown) => {
      const subscriptionId = isObject(input)
        ? firstStringValue(input.subscriptionId)
        : firstStringValue(input);
      if (subscriptionId) removeCodeAgentTranscriptSubscription(subscriptionId);
    },
  );

  ipcMain.handle(
    IPC.CODE_AGENTS_APPEND_FOLLOW_UP,
    (
      _event: IpcMainInvokeEvent,
      input: unknown,
    ): Promise<CodeAgentFollowUpResult> => appendCodeAgentFollowUp(input),
  );

  ipcMain.handle(
    IPC.CODE_AGENTS_UPDATE_RUN,
    (_event: IpcMainInvokeEvent, input: unknown): CodeAgentUpdateRunResult =>
      updateCodeAgentRun(input),
  );

  ipcMain.handle(
    IPC.CODE_AGENTS_RETRY_RUN,
    (_event: IpcMainInvokeEvent, input: unknown): CodeAgentRetryRunResult =>
      retryCodeAgentRun(input),
  );

  ipcMain.handle(
    IPC.CODE_AGENTS_RERUN_RUN,
    (
      _event: IpcMainInvokeEvent,
      input: unknown,
    ): Promise<CodeAgentRerunResult> => rerunCodeAgentRun(input),
  );

  ipcMain.handle(
    IPC.CODE_AGENTS_CONTROL_RUN,
    (
      _event: IpcMainInvokeEvent,
      input: unknown,
    ): Promise<CodeAgentControlResult> => controlCodeAgentRun(input),
  );

  ipcMain.handle(
    IPC.CODE_AGENTS_GET_HOST_METADATA,
    (): CodeAgentHostMetadata => getCodeAgentHostMetadata(),
  );

  ipcMain.handle(
    IPC.CODE_AGENTS_COMPUTER_SETUP,
    (_event: IpcMainInvokeEvent, action: unknown) =>
      runComputerSetupAction(action, {
        platform: process.platform,
        requestAccessibility: () =>
          requestAccessibilityPermission(systemPreferences),
        requestScreenRecording: async () => {
          await desktopCapturer.getSources({
            types: ["screen"],
            thumbnailSize: { width: 1, height: 1 },
          });
          return (
            getComputerPermissionStatus(systemPreferences).screenRecording ===
            "granted"
          );
        },
        openExternal: (url) => shell.openExternal(url),
        extensionPath: getBundledChromeExtensionPath,
        pathExists: fs.existsSync,
        revealExtensionFolder: async (extensionPath) => {
          const openError = await shell.openPath(extensionPath);
          if (openError) throw new Error(openError);
        },
        openChromeExtensions: () => {
          const chrome = spawnSync(
            "open",
            ["-a", "Google Chrome", "chrome://extensions/"],
            { encoding: "utf8", stdio: "ignore" },
          );
          if (chrome.error || chrome.status !== 0) {
            throw (
              chrome.error ?? new Error("Google Chrome could not be opened.")
            );
          }
        },
        restart: () => {
          setTimeout(() => {
            app.relaunch();
            app.exit(0);
          }, 250);
        },
      }),
  );

  ipcMain.handle(
    IPC.CODE_AGENTS_PROVIDER_SETTINGS_GET,
    (): CodeAgentProviderSettings => getCodeAgentProviderSettings(),
  );

  ipcMain.handle(
    IPC.CODE_AGENTS_PROVIDER_SETTINGS_UPDATE,
    (
      _event: IpcMainInvokeEvent,
      input: unknown,
    ): CodeAgentProviderSettingsUpdateResult =>
      updateCodeAgentProviderSettings(input),
  );

  ipcMain.handle(
    IPC.CODE_AGENTS_PROVIDER_BUILDER_CONNECT,
    (): Promise<CodeAgentProviderSettingsUpdateResult> =>
      connectDesktopBuilderProvider(),
  );

  ipcMain.handle(
    IPC.CODE_AGENTS_LIST_CODE_PACKS,
    (_event: IpcMainInvokeEvent, input?: unknown): CodeAgentCodePackResult =>
      listCodeAgentProjectPacks(input),
  );

  ipcMain.handle(
    IPC.CODE_AGENTS_LIST_PROJECTS,
    (): CodeAgentProjectListResult => listCodeAgentProjects(),
  );

  ipcMain.handle(
    IPC.CODE_AGENTS_SELECT_PROJECT,
    (
      _event: IpcMainInvokeEvent,
      folderPath: unknown,
    ): CodeAgentProjectSelectResult => {
      if (typeof folderPath === "string")
        return upsertCodeAgentProject(folderPath);
      const state = readCodeAgentProjectsState();
      return {
        ok: false,
        projects: state.projects,
        selectedPath: state.selectedPath,
        error: "Missing project folder.",
      };
    },
  );

  ipcMain.handle(
    IPC.CODE_AGENTS_CHOOSE_PROJECT,
    (): Promise<CodeAgentProjectSelectResult> => chooseCodeAgentProject(),
  );

  ipcMain.handle(
    IPC.CODE_AGENTS_LIST_MIGRATION_RUNS,
    (): Promise<CodeAgentRunListResult> =>
      Promise.resolve({
        status: "ok",
        goalId: "migrate",
        runs: listDesktopCodeAgentRuns("migrate"),
      }),
  );

  ipcMain.handle(
    IPC.CODE_AGENTS_OPEN_TERMINAL,
    (
      _event: IpcMainInvokeEvent,
      request?: unknown,
    ): CodeAgentTerminalResult => {
      return openTerminalForCodeAgents(request);
    },
  );

  ipcMain.handle(
    IPC.CODE_AGENTS_REMOTE_CONNECTOR_GET_STATUS,
    (): CodeAgentRemoteConnectorStatus => getRemoteConnectorStatus(),
  );

  ipcMain.handle(
    IPC.CODE_AGENTS_REMOTE_CONNECTOR_SET_ENABLED,
    (
      _event: IpcMainInvokeEvent,
      enabled: unknown,
    ): CodeAgentRemoteConnectorControlResult =>
      setRemoteConnectorEnabled(Boolean(enabled)),
  );

  ipcMain.handle(
    IPC.CODE_AGENTS_REMOTE_CONNECTOR_PAIR,
    (
      _event: IpcMainInvokeEvent,
      input: unknown,
    ): Promise<CodeAgentRemoteConnectorPairResult> =>
      pairRemoteCodeAgentConnector(input),
  );
}
