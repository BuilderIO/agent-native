import fs from "fs";
import {
  execFile,
  spawn,
  spawnSync,
  type ChildProcess,
} from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

import { buildChatFirstAppCreationPrompt } from "@agent-native/core/shared";
import {
  DESKTOP_DEFAULT_APPS,
  FRAME_PORT,
  getDesktopTemplateGatewayAppUrl,
  getTemplate,
  isDefaultDesktopTemplateDevTarget,
} from "@shared/app-registry";
import type { AppConfig } from "@shared/app-registry";
import { desktopRemoteMcpUnavailable } from "@shared/chat-first-mcp";
import {
  CODE_AGENTS_SURFACE_ID,
  CODE_AGENT_GOALS,
  DEFAULT_CODE_AGENT_PERMISSION_MODE,
  getCodeAgentAppConfig,
  getCodeAgentGoal,
  getCodeAgentPermissionMode,
  MIGRATION_APP_ID,
  type CodeAgentPermissionMode,
} from "@shared/code-agents";
import {
  formatDesktopShortcutAccelerator,
  normalizeDesktopShortcutAccelerator,
  shortcutOpenPathForBinding,
  type DesktopShortcutBinding,
  type DesktopShortcutRegistration,
} from "@shared/desktop-shortcuts";
import {
  canOpenDesktopExternalUrl,
  isAllowedMacPrivacySettingsUrl,
} from "@shared/external-navigation";
import {
  IPC,
  type ActiveWebviewTarget,
  type CodeAgentCodePackResult,
  type CodeAgentCreateRunResult,
  type CodeAgentForkRunResult,
  type CodeAgentFollowUpResult,
  type CodeAgentHostMetadata,
  type CodeAgentModelListResult,
  type CodeAgentModelOption,
  type CodeAgentProjectFolder,
  type CodeAgentProjectListResult,
  type CodeAgentProjectSelectResult,
  type CodeAgentUpdateRunResult,
  type CodeAgentControlCommand,
  type CodeAgentControlResult,
  type CodeAgentPortalTransferAllResult,
  type CodeAgentPortalTransferItem,
  type CodeAgentPortalTransferResult,
  type CodeAgentPromptAttachment,
  type CodeAgentRetryRunResult,
  type CodeAgentRestoreWorktreeResult,
  type CodeAgentRerunResult,
  type CodeAgentRun,
  type CodeAgentRunListResult,
  type CodeAgentScheduleListResult,
  type CodeAgentScheduleResult,
  type CodeAgentQueueMetadata,
  type CodeAgentSteeringMetadata,
  type CodeAgentTranscriptEvent,
  type CodeAgentTranscriptEventType,
  type CodeAgentTranscriptResult,
  type CodeAgentWorktreeListResult,
  type CodeAgentTerminalRequest,
  type CodeAgentTerminalResult,
  type CodeAgentRemoteConnectorControlResult,
  type CodeAgentRemoteConnectorPairRequest,
  type CodeAgentRemoteConnectorPairResult,
  type CodeAgentRemoteConnectorStatus,
  type CodeAgentRemoteWaitlistResult,
  type CodeAgentProviderCredentialKey,
  type CodeAgentProviderSettings,
  type CodeAgentProviderSettingsUpdate,
  type CodeAgentProviderSettingsUpdateResult,
  type DesktopOpenRequest,
  type DesktopAppContextAction,
  type DesktopAppCreationSettings,
  type DesktopAppRuntimeStatus,
  type DesktopCreateAppRequest,
  type DesktopCreateAppResult,
  type DesktopPrepareLocalCodeChangeRequest,
  type DesktopPrepareLocalCodeChangeResult,
  type DesktopShortcutActivationRequest,
  type DesktopShortcutSettings,
  type DesktopShortcutUpdateResult,
  type DesktopShortcutUpsertRequest,
  type DesktopWorkspaceAppListResult,
  type LocalAppFolderInfo,
  type LocalAppFolderSelectResult,
  type DesktopContentFileDeleteRequest,
  type DesktopContentFileRevealRequest,
  type DesktopContentFileWriteRequest,
  type DesktopContentFilesAssociateSourceRequest,
  type DesktopContentFilesFolderRequest,
  type DesktopContentFilesFolder,
  type DesktopContentFilesRepository,
  type DesktopContentFilesResult,
  type DesktopContentFilesWriteRequest,
  type DesktopPlanFilesChooseFolderRequest,
  type DesktopPlanFilesFolder,
  type DesktopPlanFilesReadRequest,
  type DesktopPlanFilesResult,
  type DesktopPlanFilesWriteRequest,
  type DesktopPlanMdxFolder,
  type DesktopIdentityStatus,
  type DesktopIdentitySettings,
  type DesktopIdentityMagicLinkRequest,
} from "@shared/ipc-channels";
import { DESKTOP_DEEP_LINK_PROTOCOL } from "@shared/release-channel";
import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  Notification,
  screen,
  session,
  shell,
  systemPreferences,
  webContents,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";

import {
  AI_SDK_MODEL_CONFIG,
  ANTHROPIC_MODEL_CONFIG,
  BUILDER_MODEL_CONFIG,
} from "../../../core/src/agent/model-config.js";
import {
  appendUniqueJsonLineAtomically,
  updateJsonFileAtomically,
  withFileLockSync,
  writeJsonFileAtomically,
} from "../../../core/src/cli/atomic-json-file.js";
import { listCodeAgentSchedules } from "../../../core/src/cli/code-agent-schedules.js";
import {
  createPortalTransferContext,
  portalTransferContinuationPrompt,
} from "../../../core/src/cli/portal-transfer.js";
import {
  createPortalHandoff,
  type PortalHandoff,
} from "../../../core/src/cli/portal-workspace.js";
import {
  getBackgroundAgentRun,
  listBackgroundAgentRuns,
  listBackgroundAgentTranscriptEvents,
  type BackgroundAgentRun,
  type BackgroundAgentTranscriptEvent,
} from "../../../core/src/code-agents/background-run.js";
import {
  loadMcpConfig,
  type McpServerConfig,
} from "../../../core/src/mcp-client/config.js";
import * as AppStore from "./app-store";
import { BrowserControlLoopbackBridge } from "./browser-control/bridge";
import {
  AGENT_NATIVE_BROWSER_EXTENSION_IDS_ENV,
  installBrowserNativeHost,
  parseAdditionalChromeExtensionIds,
} from "./browser-control/native-host";
import { isClaudeSubscriptionAuthMethod } from "./claude-subscription.js";
import {
  cachedCliStatus,
  createCliStatusCache,
  type CliStatusCache,
} from "./cli-status-cache.js";
import { guardCodeAgentPersistence } from "./code-agent-persistence-guard.js";
import {
  isCodeAgentRunnerInFlight,
  resolveCodeAgentRunnerInvocation,
} from "./code-agent-runner.js";
import { DesktopCodeAgentScheduler } from "./code-agent-scheduler.js";
import {
  CODE_AGENTS_SUBSCRIBE_TRANSCRIPT_CHANNEL,
  CODE_AGENTS_TRANSCRIPT_EVENTS_CHANNEL,
  CODE_AGENTS_UNSUBSCRIBE_TRANSCRIPT_CHANNEL,
} from "./code-agent-transcript-ipc.js";
import { boundedCodeAgentTranscriptEvents } from "./code-agent-transcript-window.js";
import {
  CODE_AGENT_EPHEMERAL_WORKTREE_RETENTION_MS,
  attachCodeAgentWorktree,
  claimCodeAgentWorktreeRun,
  cleanupDueCodeAgentWorktrees,
  createOrAttachCodeAgentWorktree,
  listNamedCodeAgentWorktrees,
  reconcileCodeAgentWorktreeLeases,
  releaseCodeAgentWorktree,
  restoreManagedCodeAgentWorktree,
  worktreeRegistryPath,
  type CodeAgentManagedWorktree,
  type CodeAgentWorktreeRunState,
} from "./code-agent-worktree-registry.js";
import {
  codeAgentWorktreeHasChanges,
  codeAgentWorktreeHasCommitsAfterBase,
  cleanupCodeAgentWorktree,
  createCodeAgentWorktree,
} from "./code-agent-worktrees.js";
import {
  getCodexLoginLaunchSpec,
  spawnDetached,
} from "./codex-login-launcher.js";
import {
  ComputerControlBroker,
  DesktopComputerMcpBridge,
  EphemeralScreenObserver,
  getComputerPermissionStatus,
  requestAccessibilityPermission,
  runComputerSetupAction,
  SwiftDesktopHelperClient,
} from "./computer-control";
import { contentFilesWebviewDenialReason } from "./content-files-webview-access.js";
import { deriveContentFilesRepositoryIdentity } from "./content-files/local-identity";
import { DesktopDesignPreviewManager } from "./design-preview-manager";
import {
  DESKTOP_IDENTITY_PARTITION,
  DesktopIdentityBroker,
  desktopWorkspaceLogoutPath,
  fetchDesktopIdentityAvailability,
  isDesktopIdentityAppConfigEligible,
  isDesktopIdentityOriginEligible,
  type DesktopIdentityApp,
} from "./desktop-identity";
import {
  captureWebviewLogs,
  initializeDesktopLogger,
  revealLogFolder,
  getLogFilePath,
} from "./desktop-logger";
import {
  desktopRequestedUserDataPath,
  initializeDesktopStartup,
  resolveDesktopSsoBrokerStatePath,
  runDesktopStartupStep,
} from "./desktop-startup.js";
import { HIDE_EMBEDDED_IDENTITY_SSO_SCRIPT } from "./embedded-auth-ui";
import { isAllowedEnvironmentNavigation } from "./environment-navigation";
import { registerAppsIpc } from "./ipc/apps";
import { registerChatFirstMcpIpc } from "./ipc/chat-first-mcp.js";
import { registerCodeAgentsIpc } from "./ipc/code-agents";
import { registerContentFilesIpc } from "./ipc/content-files";
import { registerDesktopChatIpc } from "./ipc/desktop-chat";
import { registerInterAppIpc } from "./ipc/inter-app";
import { registerPlanFilesIpc } from "./ipc/plan-files";
import { registerShortcutsIpc } from "./ipc/shortcuts";
import { isDesktopSsoCanaryVersion } from "./ipc/update-policy.js";
import {
  checkForAppUpdates,
  getCurrentUpdateStatus,
  isPreparingDownloadedUpdate,
  isInstallingDownloadedUpdate,
  installDownloadedUpdate,
  requestQuitAfterUpdatePreparation,
  registerUpdatesIpc,
} from "./ipc/updates";
import { registerWindowIpc } from "./ipc/window";
import {
  createMultiFrontierQuitGuard,
  initializeMultiFrontierAppIntegration,
  type MultiFrontierAppIntegration,
} from "./multi-frontier-app-integration.js";
import { createOAuthPopupCloser } from "./oauth-popup-close";
import { routeOAuthToBoundSession } from "./oauth-session";
import {
  isQuickPromptActive,
  registerQuickPromptIpc,
  registerQuickPromptShortcut,
} from "./quick-prompt";
import {
  initializeDesktopSentry,
  installSentryWebContentsInstrumentation,
  setSentryWebContentsMetadata,
} from "./sentry";
import { installWebviewNavigationListeners } from "./webview-navigation";
import { installWindowDragController } from "./window-drag";
import { loadDesktopWorkspaceApps } from "./workspace-apps.js";

initializeDesktopStartup({
  isPackaged: app.isPackaged,
  version: app.getVersion(),
  appDataPath: app.getPath("appData"),
  requestedUserDataPath: desktopRequestedUserDataPath(
    app.commandLine.getSwitchValue("user-data-dir"),
    process.argv,
  ),
  createDirectory: (directoryPath) =>
    fs.mkdirSync(directoryPath, { recursive: true }),
  setUserDataPath: (directoryPath) => app.setPath("userData", directoryPath),
  initializeSentry: initializeDesktopSentry,
  initializeLogger: initializeDesktopLogger,
  logError: console.error,
  logWarning: console.warn,
});

const DESKTOP_CODE_AGENT_PERSISTENCE_LOCK = {
  lockWaitMs: 50,
  reclaimFreshDeadOwner: false,
};

// ---------- stdout/stderr pipe resilience ----------
// The main process logs spawned dev-server / code-agent child output via
// console.log/console.error from `child.stdout.on("data", …)` handlers. When
// a child server dies or restarts (frequent during local dev / HMR), the
// stdout pipe's read end closes and the very next console write throws
// `write EPIPE`. With no `error` listener on the std streams Node turns that
// into an uncaught exception, which Electron surfaces as a fatal main-process
// crash dialog. Swallow EPIPE / destroyed-stream errors on the std streams
// (and, as a narrow safety net, the same code on uncaughtException) so a
// closed log pipe can never take the app down. Any other error is left to
// crash exactly as before.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (err: NodeJS.ErrnoException) => {
    if (err?.code === "EPIPE" || err?.code === "ERR_STREAM_DESTROYED") return;
    throw err;
  });
}
process.on("uncaughtException", (err: NodeJS.ErrnoException) => {
  if (err?.code === "EPIPE" || err?.code === "ERR_STREAM_DESTROYED") return;
  throw err;
});

const IS_DEV = !app.isPackaged;

function isDesktopSsoEnabled(): boolean {
  return AppStore.loadDesktopAppPreferences().desktopSsoEnabled === true;
}

// ---------- User-Agent marker ----------
// Tag every request from this Electron app so the server can distinguish
// Agent Native desktop from other Electron-based webviews (Builder.io's
// Fusion, Slack desktop, Discord, etc.). Without this, any Electron UA
// would trigger the desktop-only OAuth deep-link page (`agentnative://...`),
// stranding users in non-Agent-Native Electron contexts on a "Connected!
// Open Agent Native" screen whose deep link can't fire.
const desktopSsoCanaryMarker = isDesktopSsoCanaryVersion(app.getVersion())
  ? ` AgentNativeDesktopSsoCanary/${app.getVersion()}`
  : "";
app.userAgentFallback = `${app.userAgentFallback} AgentNativeDesktop/${app.getVersion()}${desktopSsoCanaryMarker}`;
// ---------- Deep link protocol (agentnative:// or agentnative-nightly://) ----------
// Register before app is ready so macOS associates the scheme with this app.

const DEEP_LINK_PROTOCOL = DESKTOP_DEEP_LINK_PROTOCOL;
if (IS_DEV) {
  app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL, process.execPath, [
    path.resolve(process.argv[1]),
  ]);
} else {
  app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL);
}

let pendingDeepLink: string | null = null;
let mainWindow: BrowserWindow | null = null;
let desktopDesignPreviewManager: DesktopDesignPreviewManager | null = null;
let desktopComputerMcpBridge: DesktopComputerMcpBridge | null = null;
let desktopBrowserControlBridge: BrowserControlLoopbackBridge | null = null;
let desktopIdentityBroker: DesktopIdentityBroker | null = null;
let desktopWorkspaceApps: AppConfig[] = [];
let desktopWorkspaceAppsGeneration = 0;
const desktopWebviewAppIds = new WeakMap<Electron.WebContents, string>();
let browserNativeHostManifestPath: string | null = null;
const pendingOpenRequests: DesktopOpenRequest[] = [];

type DesktopNavigationShortcutInput = {
  type: string;
  key: string;
  code?: string;
  meta?: boolean;
  control?: boolean;
  shift?: boolean;
  alt?: boolean;
};

function forwardDesktopNavigationShortcut(
  event: { preventDefault(): void },
  input: DesktopNavigationShortcutInput,
): boolean {
  if (!(input.meta || input.control) || input.type !== "keyDown") return false;

  const key = input.key.toLowerCase();
  const isNumericShortcut = !input.shift && !input.alt && /^[1-9]$/.test(key);
  const isBracketLeft =
    input.code === "BracketLeft" || key === "[" || key === "{";
  const isBracketRight =
    input.code === "BracketRight" || key === "]" || key === "}";
  const isBracketShortcut =
    Boolean(input.shift) && !input.alt && (isBracketLeft || isBracketRight);
  if (!isNumericShortcut && !isBracketShortcut) return false;

  event.preventDefault();
  const win = mainWindow;
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return true;
  win.webContents.send("shortcut:keydown", {
    key: isNumericShortcut ? key : isBracketLeft ? "[" : "]",
    code: input.code,
    shiftKey: Boolean(input.shift),
    altKey: Boolean(input.alt),
    ctrlKey: Boolean(input.control),
    metaKey: Boolean(input.meta),
  });
  return true;
}

const PENDING_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const CODE_AGENT_PROVIDER_SETTING_KEYS: CodeAgentProviderCredentialKey[] = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "BUILDER_PRIVATE_KEY",
  "BUILDER_PUBLIC_KEY",
];
const CODEX_CLI_ENGINE_NAME = "codex-cli";
const CODEX_CLI_DEFAULT_MODEL = "gpt-5.6-luna";
const CLAUDE_CLI_ENGINE_NAME = "claude-cli";
const PI_CLI_ENGINE_NAME = "pi-cli";
const OPENCODE_CLI_ENGINE_NAME = "opencode-cli";
const CODE_AGENT_WORKTREE_ENGINES = new Set([
  CODEX_CLI_ENGINE_NAME,
  CLAUDE_CLI_ENGINE_NAME,
  PI_CLI_ENGINE_NAME,
  OPENCODE_CLI_ENGINE_NAME,
]);
const CODE_AGENT_REMOTE_WAITLIST_URL =
  "https://agent-native.com/_agent-native/builder/branch-waitlist";
const DEFAULT_PORTAL_RELAY_URL = "https://dispatch.agent-native.com";
const DESKTOP_BUILDER_CONNECT_TIMEOUT_MS = 5 * 60 * 1000;
export {
  CODE_AGENTS_SUBSCRIBE_TRANSCRIPT_CHANNEL,
  CODE_AGENTS_TRANSCRIPT_EVENTS_CHANNEL,
  CODE_AGENTS_UNSUBSCRIBE_TRANSCRIPT_CHANNEL,
};

type DesktopBackgroundAgentControlCommand =
  | "approve"
  | "approve-always"
  | "deny"
  | "resume"
  | "retry"
  | "stop";

interface DesktopBackgroundAgentControlInput {
  runId: string;
  command: DesktopBackgroundAgentControlCommand;
}

interface DesktopBackgroundAgentFollowUpInput {
  runId: string;
  prompt: string;
  mode?: "immediate" | "queued";
  permissionMode?: CodeAgentPermissionMode;
  source?: string;
  metadata?: Record<string, unknown>;
}

interface DesktopBackgroundAgentControlResult {
  ok: boolean;
  runId: string;
  run: BackgroundAgentRun | null;
  queued?: boolean;
  message?: string;
  error?: string;
}

interface DesktopBackgroundAgentController {
  list(options?: { goalId?: string }): BackgroundAgentRun[];
  get(runId: string): BackgroundAgentRun | null;
  transcript(runId: string): BackgroundAgentTranscriptEvent[];
  sendFollowUp(
    input: DesktopBackgroundAgentFollowUpInput,
  ): Promise<DesktopBackgroundAgentControlResult>;
  control(
    input: DesktopBackgroundAgentControlInput,
  ): Promise<DesktopBackgroundAgentControlResult>;
}

export interface CodeAgentTranscriptSubscriptionBatch {
  subscriptionId: string;
  status: CodeAgentTranscriptResult["status"];
  runId: string;
  events: CodeAgentTranscriptEvent[];
  eventFile?: string;
  reason?: string;
  error?: string;
}

export interface CodeAgentTranscriptSubscription {
  id: string;
  runId: string;
  senderId: number;
  knownEventKeys: Set<string>;
  watcher?: fs.FSWatcher;
  flushTimer?: NodeJS.Timeout;
  reason?: string;
  /** Byte offset into the primary event JSONL file for incremental tailing. */
  fileOffset?: number;
  /** Absolute path of the primary event file being tailed. */
  tailedFilePath?: string;
}

function isDeepLinkArg(arg: string): boolean {
  return arg.startsWith(`${DEEP_LINK_PROTOCOL}:`);
}

function handleSecondInstance(_event: Electron.Event, argv: string[]): void {
  const deepLink = argv.find(isDeepLinkArg);
  if (deepLink) {
    void handleDeepLink(deepLink);
  } else {
    focusMainWindow();
  }
}

if (IS_DEV) {
  // electron-vite kills the main process and relaunches it on every rebuild
  // (e.g. when the concurrent `@agent-native/core` tsc --watch under
  // dev:lazy:desktop rewrites bundled output). A single-instance lock would
  // make the relaunched instance race the still-dying one for the lock, lose,
  // and app.quit() — leaving the killed instance's dead Dock tile behind.
  // Skip the lock in dev; keep the deep-link handler for parity.
  app.on("second-instance", handleSecondInstance);
  // Quit immediately when electron-vite SIGTERMs us so the old process and its
  // Dock tile vanish at once, before the relaunched instance paints its window.
  const exitNow = () => app.exit(0);
  process.on("SIGTERM", exitNow);
  process.on("SIGINT", exitNow);
} else {
  const singleInstanceLock = app.requestSingleInstanceLock();
  if (!singleInstanceLock) {
    app.quit();
  } else {
    app.on("second-instance", handleSecondInstance);
  }
}

interface OAuthInjectionTarget {
  appId?: string | null;
  origin?: string | null;
  session?: Electron.Session;
}

interface PendingOAuthState extends OAuthInjectionTarget {
  expiresAt: number;
}

const pendingOAuthStates = new Map<string, PendingOAuthState>();

function prunePendingOAuthStates(now = Date.now()) {
  for (const [state, pending] of pendingOAuthStates) {
    if (pending.expiresAt <= now) pendingOAuthStates.delete(state);
  }
}

function decodeOAuthStatePayload(
  state: string | null,
): Record<string, unknown> | undefined {
  if (!state) return undefined;
  try {
    const dotIdx = state.lastIndexOf(".");
    if (dotIdx === -1) return undefined;
    const data = state.slice(0, dotIdx);
    return JSON.parse(Buffer.from(data, "base64url").toString());
  } catch {
    return undefined;
  }
}

function extractAppFromOAuthState(state: string | null): string | undefined {
  const parsed = decodeOAuthStatePayload(state);
  return typeof parsed?.app === "string" ? parsed.app : undefined;
}

function getCookieNameForApp(id: string | null | undefined): string {
  const slug = (id ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug ? `an_session_${slug}` : "an_session";
}

function desktopTemplateGatewayOverridesDevUrls(): boolean {
  const value =
    process.env["AGENT_NATIVE_USE_TEMPLATE_GATEWAY"] ||
    process.env["VITE_AGENT_NATIVE_USE_TEMPLATE_GATEWAY"];
  return value === "1" || value === "true";
}

function resolveDesktopTemplateGatewayUrl(appConfig: AppConfig): string | null {
  if (
    !desktopTemplateGatewayOverridesDevUrls() &&
    !isDefaultDesktopTemplateDevTarget(appConfig)
  ) {
    return null;
  }
  return getDesktopTemplateGatewayAppUrl(appConfig.id);
}

function resolveAppBaseUrl(appConfig: AppConfig): string | null {
  const isProdMode = appConfig.mode !== "dev";
  if (isProdMode && appConfig.url) return appConfig.url;
  if (!isProdMode) {
    return (
      resolveDesktopTemplateGatewayUrl(appConfig) ||
      appConfig.devUrl ||
      (appConfig.devPort ? `http://localhost:${appConfig.devPort}` : null) ||
      appConfig.url ||
      null
    );
  }
  return (
    appConfig.url ||
    appConfig.devUrl ||
    (appConfig.devPort ? `http://localhost:${appConfig.devPort}` : null) ||
    null
  );
}

function getAppOrigin(appConfig: AppConfig): string | null {
  const rawUrl = resolveAppBaseUrl(appConfig);
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl).origin;
  } catch {
    return null;
  }
}

function getConfiguredAppOrigin(appConfig: AppConfig): string | null {
  const rawUrl =
    appConfig.mode === "dev"
      ? appConfig.devUrl ||
        (appConfig.devPort
          ? `http://localhost:${appConfig.devPort}`
          : appConfig.url)
      : appConfig.url;
  if (!rawUrl) return null;
  return new URL(rawUrl).origin;
}

function withCodeAgentApps(apps: AppConfig[]): AppConfig[] {
  let next = apps;
  try {
    for (const goal of CODE_AGENT_GOALS) {
      if (goal.surfaceKind !== "app") continue;
      if (next.some((appConfig) => appConfig.id === goal.appId)) continue;
      next = [...next, getCodeAgentAppConfig(goal, next)];
    }
    return next;
  } catch {
    return apps;
  }
}

function loadAppsForAuthContext(): AppConfig[] {
  try {
    const localApps = AppStore.loadApps();
    const localIds = new Set(localApps.map((appConfig) => appConfig.id));
    return withCodeAgentApps([
      ...localApps,
      ...desktopWorkspaceApps.filter(
        (appConfig) => !localIds.has(appConfig.id),
      ),
    ]);
  } catch (err) {
    console.error("[main] failed to load apps for auth context:", err);
    return withCodeAgentApps([]);
  }
}

function clearDesktopWorkspaceApps(): void {
  desktopWorkspaceAppsGeneration += 1;
  desktopWorkspaceApps = [];
}

function cacheDesktopWorkspaceApps(
  result: DesktopWorkspaceAppListResult,
  generation: number,
): void {
  if (generation !== desktopWorkspaceAppsGeneration) return;
  desktopWorkspaceApps = result.enabled ? result.apps : [];
}

function findAppForSourceUrl(sourceUrl: string | undefined): AppConfig | null {
  if (!sourceUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return null;
  }

  const frameAppId = parsed.searchParams.get("app");
  const apps = loadAppsForAuthContext();
  if (frameAppId) {
    const match = apps.find((appConfig) => appConfig.id === frameAppId);
    if (match) return match;
  }

  return (
    apps.find((appConfig) => getAppOrigin(appConfig) === parsed.origin) ?? null
  );
}

function getInjectionTargetForAppId(
  appId: string | null | undefined,
): OAuthInjectionTarget | null {
  if (!appId) return null;
  const appConfig = loadAppsForAuthContext().find(
    (app) => app.id === appId && app.enabled !== false,
  );
  if (!appConfig) return null;
  return {
    appId: appConfig.id,
    origin: getAppOrigin(appConfig),
    session: session.fromPartition(`persist:app-${appConfig.id}`),
  };
}

function resolveDesktopIdentityApp(
  appId: string,
  options?: { forCleanup?: boolean; appConfigs?: AppConfig[] },
): DesktopIdentityApp | null {
  if (!app.isPackaged) return null;

  const appConfigs = options?.appConfigs ?? loadAppsForAuthContext();
  const canonical = DESKTOP_DEFAULT_APPS.find(
    (candidate) => candidate.id === appId,
  );
  const configured = appConfigs.find((candidate) => candidate.id === appId);
  const canonicalOrigin = canonical
    ? getAppOrigin({ ...canonical, mode: "prod" })
    : null;
  const configuredOrigin = configured ? getAppOrigin(configured) : null;
  const isCanonical = Boolean(
    canonical &&
    configured?.isBuiltIn === true &&
    canonicalOrigin &&
    configuredOrigin === canonicalOrigin,
  );

  let origin: string | null = null;
  if (options?.forCleanup) {
    if (canonical) {
      origin = canonicalOrigin;
    } else if (
      isDesktopIdentityAppConfigEligible(configured, { forCleanup: true })
    ) {
      origin = configuredOrigin;
    }
  } else {
    // A known canonical id with a changed origin is never treated as a custom
    // app. This prevents an edited first-party entry from inheriting trust.
    if (canonical && !isCanonical) return null;
    if (
      !isDesktopIdentityAppConfigEligible(configured, {
        canonical: isCanonical,
      })
    ) {
      return null;
    }
    origin = isCanonical ? canonicalOrigin : configuredOrigin;
  }
  if (!isDesktopIdentityOriginEligible(origin)) return null;

  const primaryCookieName = getCookieNameForApp(appId);
  const appSlug = primaryCookieName.replace(/^an_session_/, "");
  const betterAuthPrefix = appSlug ? `an_${appSlug}` : "an";
  const betterAuthCookieNames = [
    `${betterAuthPrefix}.session_token`,
    `__Secure-${betterAuthPrefix}.session_token`,
    `${betterAuthPrefix}.session_data`,
    `__Secure-${betterAuthPrefix}.session_data`,
  ];
  const workspaceSso = isCanonical || configured?.workspaceSso === true;
  const cookieNames = [
    primaryCookieName,
    ...(primaryCookieName === "an_session" ? [] : ["an_session"]),
    ...(workspaceSso ? ["an_session_workspace", "an_embed_session"] : []),
    ...betterAuthCookieNames,
  ];
  return {
    id: appId,
    origin,
    session: session.fromPartition(`persist:app-${appId}`),
    cookieNames,
    cookieNamesToClear: [
      ...new Set([
        ...cookieNames,
        "an.session_token",
        "__Secure-an.session_token",
        "an.session_data",
        "__Secure-an.session_data",
      ]),
    ],
    identityAuthority: appId === "dispatch",
    workspaceSso,
  };
}

function listDesktopIdentityApps(
  options: { forCleanup?: boolean } = {},
): DesktopIdentityApp[] {
  const appConfigs = loadAppsForAuthContext();
  const appIds = new Set(
    options.forCleanup
      ? [
          ...DESKTOP_DEFAULT_APPS.map((candidate) => candidate.id),
          ...appConfigs.map((candidate) => candidate.id),
        ]
      : appConfigs.map((candidate) => candidate.id),
  );
  return [...appIds]
    .map((appId) =>
      resolveDesktopIdentityApp(appId, {
        ...options,
        appConfigs,
      }),
    )
    .filter((candidate): candidate is DesktopIdentityApp => candidate !== null);
}

function listDesktopIdentityCleanupApps(): DesktopIdentityApp[] {
  return listDesktopIdentityApps({ forCleanup: true });
}

async function isDesktopIdentityAvailable(
  authorityApp: DesktopIdentityApp,
): Promise<boolean> {
  return fetchDesktopIdentityAvailability(authorityApp, authorityApp.session);
}

function getOAuthInjectionTarget(
  sourceSession: Electron.Session | undefined,
  sourceUrl: string | undefined,
): OAuthInjectionTarget {
  const appConfig = findAppForSourceUrl(sourceUrl);
  let origin: string | null = null;
  if (sourceUrl) {
    try {
      origin = new URL(sourceUrl).origin;
    } catch {
      origin = null;
    }
  }
  return {
    appId: appConfig?.id ?? null,
    origin: appConfig ? getAppOrigin(appConfig) : origin,
    session: sourceSession,
  };
}

function rememberOAuthState(url: string, target?: OAuthInjectionTarget) {
  try {
    const state = new URL(url).searchParams.get("state");
    if (!state) return;
    prunePendingOAuthStates();
    const existing = pendingOAuthStates.get(state);
    pendingOAuthStates.set(state, {
      ...existing,
      ...target,
      appId:
        target?.appId ?? existing?.appId ?? extractAppFromOAuthState(state),
      expiresAt: Date.now() + PENDING_OAUTH_STATE_TTL_MS,
    });
  } catch {
    // Malformed URL — ignore
  }
}

function consumeOAuthState(state: string | null): OAuthInjectionTarget | null {
  if (!state) return null;
  const now = Date.now();
  prunePendingOAuthStates(now);
  const pending = pendingOAuthStates.get(state);
  if (!pending || pending.expiresAt <= now) return null;
  pendingOAuthStates.delete(state);
  return pending;
}

function flushPendingOpenRequests(win = mainWindow) {
  if (!win || win.isDestroyed() || win.webContents.isLoading()) return;
  while (pendingOpenRequests.length > 0) {
    const request = pendingOpenRequests.shift();
    if (request) win.webContents.send(IPC.DEEP_LINK_OPEN, request);
  }
}

function focusMainWindow(
  options: { stealFocus?: boolean } = {},
): BrowserWindow | null {
  const win =
    mainWindow && !mainWindow.isDestroyed()
      ? mainWindow
      : BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    if (process.platform === "darwin") app.show();
    win.show();
    win.focus();
    if (process.platform === "darwin" && options.stealFocus) {
      app.focus({ steal: true });
    }
    return win;
  }

  if (app.isReady()) {
    const created = createWindow();
    if (process.platform === "darwin" && options.stealFocus) {
      created.once("ready-to-show", () => app.focus({ steal: true }));
    }
    return created;
  }
  return null;
}

function sendOpenRequestToRenderer(
  request: DesktopOpenRequest,
  options: { stealFocus?: boolean } = {},
) {
  const win = focusMainWindow(options);
  if (!win || win.isDestroyed() || win.webContents.isLoading()) {
    pendingOpenRequests.push(request);
    return;
  }
  win.webContents.send(IPC.DEEP_LINK_OPEN, request);
}

function buildAppOpenRoutePath(parsed: URL): string {
  const query = parsed.searchParams.toString();
  return query ? `/_agent-native/open?${query}` : "/_agent-native/open";
}

function inferCodeAgentGoalIdFromRunId(
  runId: string | undefined,
): string | undefined {
  if (!runId) return undefined;
  const recordGoal = getCodeAgentGoal(
    getRecordString(readCodeAgentRunRecord(runId), "goalId"),
  );
  if (recordGoal) return recordGoal.id;

  const prefixGoal = getCodeAgentGoal(runId.split("-")[0]);
  return prefixGoal?.id;
}

async function handleDeepLink(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== `${DEEP_LINK_PROTOCOL}:`) return;
    if (parsed.host === "oauth-complete") {
      const token = parsed.searchParams.get("token");
      if (token) {
        const state = parsed.searchParams.get("state");
        const pendingTarget = consumeOAuthState(state);
        if (!pendingTarget) {
          console.warn(
            "[main] rejected oauth-complete deep link without matching OAuth state",
          );
          return;
        }
        const stateTarget = getInjectionTargetForAppId(
          extractAppFromOAuthState(state),
        );
        await injectSessionAndReload(token, {
          ...stateTarget,
          ...pendingTarget,
        });
      } else {
        const state = parsed.searchParams.get("state");
        const pendingTarget = consumeOAuthState(state);
        if (pendingTarget) {
          reloadWebviewsForTarget(pendingTarget);
        } else {
          console.warn(
            "[main] ignored oauth-complete deep link without token or matching OAuth state",
          );
        }
      }
      focusMainWindow();
      return;
    }

    if (parsed.host === "open") {
      const targetApp = parsed.searchParams.get("app") ?? undefined;
      const goalParam =
        parsed.searchParams.get("goal") ??
        parsed.searchParams.get("command") ??
        undefined;
      const goalId = goalParam?.replace(/^\//, "");
      const runId = parsed.searchParams.get("run") ?? undefined;
      const targetGoal =
        getCodeAgentGoal(goalId) ??
        getCodeAgentGoal(inferCodeAgentGoalIdFromRunId(runId)) ??
        (targetApp === MIGRATION_APP_ID ? getCodeAgentGoal("migrate") : null);
      if (targetApp === CODE_AGENTS_SURFACE_ID) {
        sendOpenRequestToRenderer({
          app: CODE_AGENTS_SURFACE_ID,
          goalId: targetGoal?.id,
          runId,
        });
      } else if (targetGoal) {
        sendOpenRequestToRenderer({
          app:
            targetGoal.surfaceKind === "native"
              ? CODE_AGENTS_SURFACE_ID
              : (targetApp ?? targetGoal.appId),
          goalId: targetGoal.id,
          runId,
        });
      } else if (targetApp && getInjectionTargetForAppId(targetApp)) {
        sendOpenRequestToRenderer({
          app: targetApp,
          path: buildAppOpenRoutePath(parsed),
        });
      }
    } else if (parsed.host === "shortcuts" && parsed.pathname === "/upsert") {
      await handleShortcutUpsertDeepLink(parsed);
    }
  } catch {
    // Malformed URL — ignore
  }
}

async function handleShortcutUpsertDeepLink(parsed: URL) {
  const accelerator = parsed.searchParams.get("accelerator") ?? "";
  const targetApp = parsed.searchParams.get("app") ?? "";
  const view = parsed.searchParams.get("view") ?? undefined;
  const behavior =
    parsed.searchParams.get("behavior") === "show" ? "show" : "toggle";
  const apps = loadAppsForAuthContext();
  const appConfig = apps.find(
    (candidate) => candidate.id === targetApp && candidate.enabled !== false,
  );
  const normalized = normalizeDesktopShortcutAccelerator(accelerator);
  if (!targetApp || !appConfig || !normalized.accelerator) {
    console.warn("[main] rejected invalid shortcut deep link", {
      targetApp,
      hasApp: Boolean(appConfig),
      error: normalized.error,
    });
    return;
  }
  const win = focusMainWindow();
  const appLabel = appConfig.name;
  const messageOptions: Electron.MessageBoxOptions = {
    type: "question",
    buttons: ["Add Shortcut", "Cancel"],
    defaultId: 0,
    cancelId: 1,
    message: "Add Agent Native app shortcut?",
    detail: [
      `Shortcut: ${formatDesktopShortcutAccelerator(normalized.accelerator, process.platform)}`,
      `Target: ${appLabel}${view ? ` / ${view}` : ""}`,
      `Behavior: ${behavior === "show" ? "show and switch" : "toggle visibility"}`,
    ].join("\n"),
  };
  const result = win
    ? await dialog.showMessageBox(win, messageOptions)
    : await dialog.showMessageBox(messageOptions);

  if (result.response !== 0) return;

  const update = AppStore.upsertDesktopShortcutBinding({
    accelerator: normalized.accelerator,
    app: targetApp,
    view,
    behavior,
    enabled: true,
  });
  if (!update.ok) {
    const errorOptions: Electron.MessageBoxOptions = {
      type: "error",
      message: "Shortcut was not added",
      detail: update.error,
    };
    if (win) {
      await dialog.showMessageBox(win, errorOptions);
    } else {
      await dialog.showMessageBox(errorOptions);
    }
    return;
  }
  registerDesktopShortcutBindings();
}

async function injectSessionAndReload(
  token: string,
  target: OAuthInjectionTarget,
) {
  // Production apps have separate auth databases. A token minted by Mail does
  // not resolve in Calendar, so the desktop handoff must only update the app
  // that initiated OAuth. The app-specific cookie name still matters on
  // localhost because cookies are scoped by host, not host+port.
  const targets: {
    session: Electron.Session;
    origin: string;
    cookieName: string;
  }[] = [];

  const targetFromAppId = getInjectionTargetForAppId(target.appId);
  const sess = target.session ?? targetFromAppId?.session;
  const origin = target.origin ?? targetFromAppId?.origin;
  if (sess && origin) {
    const primaryCookieName = getCookieNameForApp(target.appId);
    targets.push({ session: sess, origin, cookieName: primaryCookieName });
    // Older deployed apps may still look for the unsuffixed legacy cookie.
    if (primaryCookieName !== "an_session") {
      targets.push({ session: sess, origin, cookieName: "an_session" });
    }
  } else {
    console.warn("[main] OAuth handoff had no resolvable target; reloading");
    reloadAllWebviews();
    return;
  }

  for (const { session: sess, origin, cookieName } of targets) {
    try {
      await sess.cookies.set({
        url: origin,
        name: cookieName,
        value: token,
        httpOnly: true,
        path: "/",
        expirationDate: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      });
    } catch (err) {
      console.error(
        `[main] cookie.set (${cookieName}) failed for ${origin}:`,
        err,
      );
    }
  }
  reloadWebviewsForTarget({ ...targetFromAppId, ...target });
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
}

function reloadWebviewsForTarget(target: OAuthInjectionTarget) {
  const targetSession = target.session;
  const targetAppId = target.appId;
  const targetOrigin = target.origin;
  let reloaded = false;

  for (const wc of webContents.getAllWebContents()) {
    if (wc.getType() !== "webview") continue;
    if (targetSession && wc.session === targetSession) {
      wc.reload();
      reloaded = true;
      continue;
    }
    try {
      const url = new URL(wc.getURL());
      const appId = url.searchParams.get("app");
      if (
        (targetAppId && appId === targetAppId) ||
        (targetOrigin && url.origin === targetOrigin)
      ) {
        wc.reload();
        reloaded = true;
      }
    } catch {}
  }

  if (!reloaded) {
    console.warn("[main] OAuth handoff target had no live webview to reload");
  }
}

function reloadAllWebviews() {
  for (const wc of webContents.getAllWebContents()) {
    if (wc.getType() === "webview") wc.reload();
  }
}

// macOS: deep links arrive via open-url (both when app is running and on cold launch)
app.on("open-url", (event, url) => {
  event.preventDefault();
  if (app.isReady()) {
    handleDeepLink(url);
  } else {
    pendingDeepLink = url;
  }
});

// --------------- Run completion / attention notifications ---------------

/** True when the main window is hidden or unfocused. */
function isWindowUnfocused(): boolean {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  if (!win) return true;
  return !win.isFocused() || win.isMinimized() || !win.isVisible();
}

/** Attention-needed run count (approval-needed + recently-finished while away). */
const runAttentionRunIds = new Set<string>();

function updateDockBadge(): void {
  if (process.platform !== "darwin") return;
  if (runAttentionRunIds.size > 0) {
    app.setBadgeCount(runAttentionRunIds.size);
  } else {
    app.setBadgeCount(0);
  }
}

function showCodeAgentRunNotification(
  runId: string,
  kind: "completed" | "failed" | "approval-needed",
  runTitle: string,
): void {
  if (!Notification.isSupported()) return;
  if (!isWindowUnfocused()) return;

  const titles: Record<typeof kind, string> = {
    completed: "Run finished",
    failed: "Run failed",
    "approval-needed": "Approval needed",
  };
  const bodies: Record<typeof kind, string> = {
    completed: `"${runTitle}" completed successfully.`,
    failed: `"${runTitle}" encountered an error.`,
    "approval-needed": `"${runTitle}" is waiting for your approval.`,
  };

  runAttentionRunIds.add(runId);
  updateDockBadge();

  const notification = new Notification({
    title: titles[kind],
    body: bodies[kind],
  });
  notification.on("click", () => {
    focusMainWindow();
    // Clear this run from attention set when user clicks
    runAttentionRunIds.delete(runId);
    updateDockBadge();
  });
  notification.show();
}

// Clear badge whenever the main window gains focus.
app.on("browser-window-focus", () => {
  runAttentionRunIds.clear();
  updateDockBadge();
});

// ---------- IPC: Auto-updates ----------
// See main/ipc/updates.ts for the autoUpdater wiring, status broadcast, and
// update-ready notification. `checkForAppUpdates`/`getCurrentUpdateStatus`
// (imported above) are also used by the application menu below.
async function closeDesktopComputerMcpBridge(): Promise<void> {
  const computerBridge = desktopComputerMcpBridge;
  const browserBridge = desktopBrowserControlBridge;
  desktopComputerMcpBridge = null;
  desktopBrowserControlBridge = null;

  const closePromises: Promise<void>[] = [];
  if (computerBridge) closePromises.push(computerBridge.close());
  if (browserBridge) closePromises.push(browserBridge.close());
  for (const result of await Promise.allSettled(closePromises)) {
    if (result.status === "rejected") throw result.reason;
  }
}

registerUpdatesIpc({
  refreshApplicationMenu,
  focusMainWindow,
  prepareForUpdate: async () => {
    await closeDesktopComputerMcpBridge();
    await disposeMultiFrontierAppIntegration();
  },
  restoreAfterUpdateFailure: async () => {
    await initializeDesktopComputerMcpBridge();
    if (multiFrontierDisposePromise) {
      initializeMultiFrontierAppIntegrationForRuntime();
    }
  },
});

function isShellIdentityIpc(event: IpcMainInvokeEvent): boolean {
  return Boolean(
    mainWindow &&
    !mainWindow.isDestroyed() &&
    event.sender.id === mainWindow.webContents.id,
  );
}

ipcMain.handle(IPC.IDENTITY_STATUS_GET, async (event) => {
  if (!isShellIdentityIpc(event)) {
    return "idle" satisfies DesktopIdentityStatus;
  }
  if (!isDesktopSsoEnabled()) return "idle" satisfies DesktopIdentityStatus;
  const broker = ensureDesktopIdentityBroker();
  await broker?.refreshStatus(resolveDesktopIdentityApp("dispatch"));
  return broker?.getStatus() ?? "idle";
});

ipcMain.handle(IPC.IDENTITY_AVAILABILITY_GET, async (event) => {
  if (!isShellIdentityIpc(event) || !isDesktopSsoEnabled()) return false;
  const broker = ensureDesktopIdentityBroker();
  if (!broker) return false;
  await broker.refreshStatus(resolveDesktopIdentityApp("dispatch"));
  return broker.isAvailable();
});

ipcMain.handle(IPC.IDENTITY_SETTINGS_GET, (event) => {
  if (!isShellIdentityIpc(event)) {
    return { ssoEnabled: false } satisfies DesktopIdentitySettings;
  }
  return {
    ssoEnabled: isDesktopSsoEnabled(),
  } satisfies DesktopIdentitySettings;
});

ipcMain.handle(IPC.IDENTITY_SSO_ENABLED_SET, async (event, enabled) => {
  if (!isShellIdentityIpc(event) || typeof enabled !== "boolean") return false;
  AppStore.saveDesktopAppPreferences({ desktopSsoEnabled: enabled });

  if (!enabled) {
    const broker = desktopIdentityBroker;
    desktopIdentityBroker = null;
    broker?.setStatusForSetting("idle");
    mainWindow?.webContents.send(IPC.IDENTITY_STATUS_CHANGED, "idle");
    refreshApplicationMenu();
    return true;
  }

  const broker = ensureDesktopIdentityBroker();
  if (broker) {
    await broker.refreshStatus(resolveDesktopIdentityApp("dispatch"));
    mainWindow?.webContents.send(
      IPC.IDENTITY_STATUS_CHANGED,
      broker.getStatus(),
    );
  }
  return true;
});

ipcMain.handle(IPC.IDENTITY_APP_SESSION_ENSURE, async (event, appId) => {
  if (
    !isShellIdentityIpc(event) ||
    !isDesktopSsoEnabled() ||
    typeof appId !== "string" ||
    !appId.trim()
  ) {
    return false;
  }
  const broker = ensureDesktopIdentityBroker();
  return broker?.ensureAppSession(appId.trim()) ?? false;
});

ipcMain.handle(IPC.IDENTITY_SIGN_IN, async (event) => {
  if (!isShellIdentityIpc(event) || !isDesktopSsoEnabled()) return false;
  const broker = ensureDesktopIdentityBroker();
  if (!broker) return false;
  const status = broker.getStatus();
  if (status !== "sign-in-required" && status !== "failed") return false;
  const identityApp =
    resolveDesktopIdentityApp(activeAppId) ??
    resolveDesktopIdentityApp("dispatch");
  if (!identityApp) return false;
  return broker.signIn(identityApp.id);
});

ipcMain.handle(IPC.IDENTITY_AUTHENTICATE, async (event, request) => {
  if (!isShellIdentityIpc(event)) {
    return { ok: false, error: "The desktop identity surface is unavailable." };
  }
  if (!isDesktopSsoEnabled()) {
    return { ok: false, error: "Desktop workspace sign-in is turned off." };
  }
  const broker = ensureDesktopIdentityBroker();
  if (!broker) {
    return { ok: false, error: "Desktop workspace sign-in is unavailable." };
  }
  if (!request || typeof request !== "object") {
    return { ok: false, error: "Enter your email and password to continue." };
  }
  const input = request as {
    mode?: unknown;
    email?: unknown;
    password?: unknown;
  };
  if (
    (input.mode !== "sign-in" && input.mode !== "sign-up") ||
    typeof input.email !== "string" ||
    typeof input.password !== "string"
  ) {
    return { ok: false, error: "Enter your email and password to continue." };
  }
  return broker.authenticateWithPassword({
    mode: input.mode,
    email: input.email,
    password: input.password,
  });
});

ipcMain.handle(IPC.IDENTITY_MAGIC_LINK_REQUEST, async (event, request) => {
  if (!isShellIdentityIpc(event)) {
    return {
      ok: false,
      error: "The desktop identity surface is unavailable.",
    };
  }
  if (!isDesktopSsoEnabled()) {
    return { ok: false, error: "Desktop workspace sign-in is turned off." };
  }
  const broker = ensureDesktopIdentityBroker();
  if (!broker) {
    return { ok: false, error: "Desktop workspace sign-in is unavailable." };
  }
  if (
    !request ||
    typeof request !== "object" ||
    typeof (request as DesktopIdentityMagicLinkRequest).email !== "string"
  ) {
    return { ok: false, error: "Enter your email to continue." };
  }
  return broker.requestMagicLink({
    email: (request as DesktopIdentityMagicLinkRequest).email,
  });
});

ipcMain.handle(IPC.IDENTITY_SIGN_OUT, async (event) => {
  if (!isShellIdentityIpc(event)) return false;
  const broker = ensureDesktopIdentityBroker();
  if (!broker || broker.getStatus() === "idle") return false;
  return broker.signOut(listDesktopIdentityCleanupApps());
});

function ensureDesktopIdentityBroker(): DesktopIdentityBroker | null {
  if (!isDesktopSsoEnabled()) return null;
  if (desktopIdentityBroker) return desktopIdentityBroker;

  desktopIdentityBroker = new DesktopIdentityBroker({
    identitySession: session.fromPartition(DESKTOP_IDENTITY_PARTITION),
    isAvailable: isDesktopIdentityAvailable,
    // Parent Google verification runs in the isolated identity window so its
    // browser-bound OAuth state remains in the same cookie partition. Magic
    // links may still complete through the system browser exchange path.
    resolveApp: resolveDesktopIdentityApp,
    listApps: () => listDesktopIdentityApps(),
    openExternal: (url) => openExternalUrl(url),
    createWindow: (options) => new BrowserWindow(options),
    parentWindow: () => mainWindow,
    handleWindowOpen: (contents, url) =>
      handleWindowOpenForContents(contents, url),
    handleOAuthNavigation: (url, contents) =>
      openOAuthFromWebviewNavigation(url, contents),
    reloadApp: (identityApp) =>
      reloadWebviewsForTarget({
        appId: identityApp.id,
        origin: identityApp.origin,
        session: identityApp.session,
      }),
    clearLocalBroker: async () => {
      await fs.promises
        .rm(resolveDesktopSsoBrokerStatePath(app.getPath("userData")), {
          force: true,
        })
        .catch(() => {});
    },
    onStatus: (status: DesktopIdentityStatus) => {
      if (appIsQuitting) return;
      if (status === "idle" || status === "sign-in-required") {
        clearDesktopWorkspaceApps();
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          mainWindow.webContents.send(IPC.IDENTITY_STATUS_CHANGED, status);
        } catch (error) {
          console.warn(
            "[desktop-identity] status update skipped during window shutdown:",
            error instanceof Error ? error.message : "unknown error",
          );
        }
      }
      refreshApplicationMenu();
    },
  });
  return desktopIdentityBroker;
}

function createWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }

  const isMac = process.platform === "darwin";

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,

    // macOS: hidden title bar with traffic lights positioned above the chat rail
    // Windows/Linux: fully frameless, custom controls in renderer
    titleBarStyle: "hidden",
    // Traffic lights in the far top-left of the chat-first workbench
    ...(isMac && { trafficLightPosition: { x: 14, y: 12 } }),

    backgroundColor: "#111111",
    show: false,

    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      webSecurity: true,
      additionalArguments: [
        `--an-webview-preload=${pathToFileURL(path.join(__dirname, "../preload/webview.js")).href}`,
        `--an-webview-chat-preload=${pathToFileURL(path.join(__dirname, "../preload/webview-chat.js")).href}`,
      ],
    },
  });
  installSentryWebContentsInstrumentation(win.webContents, {
    role: "shell-renderer",
  });
  const disposeWindowDragController = installWindowDragController(win, {
    getCursorScreenPoint: () => screen.getCursorScreenPoint(),
  });
  desktopDesignPreviewManager?.destroy();
  desktopDesignPreviewManager = new DesktopDesignPreviewManager(win);

  // Avoid white flash — show window once content is ready
  win.once("ready-to-show", () => win.show());
  win.webContents.on("did-finish-load", () => {
    // A reloaded renderer has no status yet, so the dedup cache must not
    // suppress the next send as an unchanged repeat.
    lastDesktopAppRuntimeStatus.clear();
    flushPendingOpenRequests(win);
    flushPendingDesktopShortcutActivations(win);
  });

  // In dev, load from the Vite dev server; in prod, load built files
  if (IS_DEV && process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    // DevTools will be opened for the active webview via Cmd+Shift+I
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow = win;
  win.on("closed", () => {
    disposeWindowDragController();
    desktopDesignPreviewManager?.destroy();
    desktopDesignPreviewManager = null;
    if (mainWindow === win) mainWindow = null;
  });

  return win;
}

// ---------- DevTools: target the active app webview ----------

let activeAppId = "";
let chatFirstPreviewAppId: string | null = null;
let activeWebviewContentsId: number | undefined;
let desktopShortcutRegistrations = new Map<
  string,
  DesktopShortcutRegistration
>();
const registeredDesktopShortcutAccelerators = new Set<string>();
let desktopShortcutsActivated = false;
const pendingDesktopShortcutActivations = new Map<
  string,
  {
    request: DesktopShortcutActivationRequest;
    attempts: number;
    timer?: ReturnType<typeof setTimeout>;
  }
>();
const DESKTOP_SHORTCUT_ACTIVATION_RETRY_MS = [120, 300, 700, 1200];

function debugDesktopShortcut(message: string, details?: unknown) {
  if (process.env.AGENT_NATIVE_DESKTOP_SHORTCUT_DEBUG !== "1") return;
  if (details === undefined) console.info(`[desktop-shortcut] ${message}`);
  else console.info(`[desktop-shortcut] ${message}`, details);
}

function clearDesktopShortcutActivation(requestId: string) {
  const pending = pendingDesktopShortcutActivations.get(requestId);
  if (pending?.timer) clearTimeout(pending.timer);
  pendingDesktopShortcutActivations.delete(requestId);
}

function flushPendingDesktopShortcutActivations(win = mainWindow) {
  if (!win || win.isDestroyed() || win.webContents.isLoading()) return;
  for (const [requestId, pending] of pendingDesktopShortcutActivations) {
    if (emitDesktopShortcutActivation(win, pending.request)) {
      debugDesktopShortcut("activation sent after renderer load", {
        requestId,
        app: pending.request.app,
      });
    }
  }
}

function emitDesktopShortcutActivation(
  win: BrowserWindow,
  request: DesktopShortcutActivationRequest,
) {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return false;
  if (win.webContents.isLoading()) return false;
  win.webContents.send(IPC.SHORTCUTS_ACTIVATE, request);
  return true;
}

async function getRendererActiveAppId(
  win: BrowserWindow | null,
): Promise<string | null> {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return null;
  try {
    const result = await win.webContents.executeJavaScript(
      `window.__agentNativeDesktopShortcutBridge?.getActiveAppId?.() ?? ""`,
      true,
    );
    return typeof result === "string" && result.trim() ? result.trim() : null;
  } catch (err) {
    debugDesktopShortcut("active app query failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function invokeRendererDesktopShortcutActivation(
  win: BrowserWindow,
  request: DesktopShortcutActivationRequest,
): Promise<boolean> {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return false;
  if (win.webContents.isLoading()) return false;
  try {
    const result = await win.webContents.executeJavaScript(
      `window.__agentNativeDesktopShortcutBridge?.activate?.(${JSON.stringify(request)}) ?? { handled: false }`,
      true,
    );
    if (!result || typeof result !== "object") return false;
    const handled = (result as { handled?: unknown }).handled === true;
    const appId =
      typeof (result as { appId?: unknown }).appId === "string"
        ? (result as { appId: string }).appId
        : "";
    if (handled && appId) setDesktopActiveAppId(appId);
    debugDesktopShortcut("activation bridge result", {
      requestId: request.requestId,
      app: request.app,
      handled,
      appId: appId || undefined,
      activeAppId,
    });
    return handled;
  } catch (err) {
    debugDesktopShortcut("activation bridge failed", {
      requestId: request.requestId,
      app: request.app,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

function scheduleDesktopShortcutActivationRetry(requestId: string) {
  const pending = pendingDesktopShortcutActivations.get(requestId);
  if (!pending) return;
  const delay = DESKTOP_SHORTCUT_ACTIVATION_RETRY_MS[pending.attempts];
  if (delay === undefined) {
    debugDesktopShortcut("activation not acknowledged", {
      requestId,
      app: pending.request.app,
      attempts: pending.attempts,
    });
    pendingDesktopShortcutActivations.delete(requestId);
    return;
  }

  pending.timer = setTimeout(() => {
    const current = pendingDesktopShortcutActivations.get(requestId);
    if (!current) return;
    const win = focusMainWindow({ stealFocus: true });
    if (!win || win.isDestroyed() || win.webContents.isLoading()) {
      scheduleDesktopShortcutActivationRetry(requestId);
      return;
    }
    current.attempts += 1;
    void invokeRendererDesktopShortcutActivation(win, current.request).then(
      (handled) => {
        if (handled) {
          clearDesktopShortcutActivation(requestId);
          return;
        }
        if (emitDesktopShortcutActivation(win, current.request)) {
          debugDesktopShortcut("activation retry sent", {
            requestId,
            app: current.request.app,
            attempt: current.attempts,
          });
        }
        scheduleDesktopShortcutActivationRetry(requestId);
      },
    );
  }, delay);
}

ipcMain.on(IPC.SET_ACTIVE_APP, (_event: IpcMainEvent, appId: string) => {
  setDesktopActiveAppId(appId);
  if (appId !== "design") desktopDesignPreviewManager?.clearOwner();
  void ensureManagedDesktopAppRunning(appId);
});

ipcMain.on(
  IPC.SHORTCUTS_ACTIVATE_ACK,
  (
    _event: IpcMainEvent,
    payload: { requestId?: unknown; appId?: unknown } | undefined,
  ) => {
    const requestId =
      typeof payload?.requestId === "string" ? payload.requestId : "";
    const appId = typeof payload?.appId === "string" ? payload.appId : "";
    if (!requestId) return;
    if (appId) setDesktopActiveAppId(appId);
    debugDesktopShortcut("activation acknowledged", {
      requestId,
      app: appId || undefined,
    });
    clearDesktopShortcutActivation(requestId);
  },
);

ipcMain.on(
  IPC.SET_ACTIVE_WEBVIEW,
  (event: IpcMainEvent, target: ActiveWebviewTarget) => {
    if (!mainWindow || event.sender.id !== mainWindow.webContents.id) return;
    if (target.active === false) {
      desktopDesignPreviewManager?.clearOwner(target.webContentsId);
      if (activeWebviewContentsId === target.webContentsId) {
        activeWebviewContentsId = undefined;
      }
      return;
    }
    setDesktopActiveAppId(target.appId);
    activeWebviewContentsId = target.webContentsId;
    setSentryWebContentsMetadata(target.webContentsId, {
      role: "app-webview",
      appId: target.appId,
    });
    desktopDesignPreviewManager?.registerOwner(
      target.webContentsId,
      target.appId,
      target.hostBounds,
    );
  },
);

ipcMain.on(
  IPC.DESIGN_PREVIEW_REQUEST,
  (event: IpcMainEvent, request: unknown) => {
    desktopDesignPreviewManager?.handleRequest(event.sender, request);
  },
);

function getActiveWebviewContents() {
  const allContents = webContents.getAllWebContents();
  const liveWebviewContents = (contents?: Electron.WebContents | null) => {
    if (!contents) return undefined;
    try {
      if (contents.isDestroyed()) return undefined;
      return contents.getType() === "webview" ? contents : undefined;
    } catch {
      return undefined;
    }
  };
  const webviewContents = allContents.filter((wc) => liveWebviewContents(wc));

  const activeTarget =
    activeWebviewContentsId &&
    liveWebviewContents(webContents.fromId(activeWebviewContentsId));

  if (activeWebviewContentsId && !activeTarget) {
    activeWebviewContentsId = undefined;
  }

  // Fall back to the currently focused guest, then to the active app by URL.
  return (
    activeTarget ||
    webviewContents.find((wc) => wc.isFocused()) ||
    (activeAppId &&
      webviewContents.find((wc) => {
        try {
          const url = new URL(wc.getURL());
          return url.searchParams.get("app") === activeAppId;
        } catch {
          return false;
        }
      })) ||
    webviewContents[0]
  );
}

function getDesktopShortcutSettings(): DesktopShortcutSettings {
  const bindings = AppStore.loadDesktopShortcutBindings();
  return {
    bindings,
    registrations: bindings.map(
      (binding) =>
        desktopShortcutRegistrations.get(binding.id) ?? {
          id: binding.id,
          registered: false,
          error: binding.enabled ? "Shortcut is not registered." : undefined,
        },
    ),
  };
}

function unregisterDesktopShortcutBindings() {
  for (const accelerator of registeredDesktopShortcutAccelerators) {
    try {
      globalShortcut.unregister(accelerator);
    } catch {
      // Best effort; Electron also clears global shortcuts on quit.
    }
  }
  registeredDesktopShortcutAccelerators.clear();
}

function refreshDesktopShortcutBindings() {
  if (desktopShortcutsActivated) {
    registerDesktopShortcutBindings();
    return;
  }

  unregisterDesktopShortcutBindings();
  desktopShortcutRegistrations = new Map(
    AppStore.loadDesktopShortcutBindings().map((binding) => [
      binding.id,
      { id: binding.id, registered: false },
    ]),
  );
}

function hideMainWindowForShortcut() {
  const win =
    mainWindow && !mainWindow.isDestroyed()
      ? mainWindow
      : BrowserWindow.getAllWindows()[0];
  if (process.platform === "darwin") {
    app.hide();
  } else if (win && !win.isDestroyed()) {
    win.hide();
  }
}

async function sendDesktopShortcutActivation(request: DesktopOpenRequest) {
  const activationRequest: DesktopShortcutActivationRequest = {
    ...request,
    requestId: randomUUID(),
  };
  pendingDesktopShortcutActivations.set(activationRequest.requestId, {
    request: activationRequest,
    attempts: 0,
  });

  const win = focusMainWindow({ stealFocus: true });
  if (
    win &&
    (await invokeRendererDesktopShortcutActivation(win, activationRequest))
  ) {
    clearDesktopShortcutActivation(activationRequest.requestId);
    return;
  }
  if (win && emitDesktopShortcutActivation(win, activationRequest)) {
    debugDesktopShortcut("activation sent", {
      requestId: activationRequest.requestId,
      app: activationRequest.app,
    });
  }
  scheduleDesktopShortcutActivationRetry(activationRequest.requestId);
}

async function handleDesktopShortcutBinding(binding: DesktopShortcutBinding) {
  const win =
    mainWindow && !mainWindow.isDestroyed()
      ? mainWindow
      : BrowserWindow.getAllWindows()[0];
  const isWindowFrontmost = Boolean(
    win && !win.isDestroyed() && win.isVisible() && win.isFocused(),
  );
  const rendererActiveAppId = isWindowFrontmost
    ? await getRendererActiveAppId(win)
    : null;
  const effectiveActiveAppId = rendererActiveAppId ?? activeAppId;
  const isTargetActive = effectiveActiveAppId === binding.app;
  debugDesktopShortcut("triggered", {
    id: binding.id,
    accelerator: binding.accelerator,
    app: binding.app,
    behavior: binding.behavior,
    activeAppId,
    rendererActiveAppId: rendererActiveAppId || undefined,
    effectiveActiveAppId,
    isWindowFrontmost,
  });

  if (binding.behavior === "toggle" && isTargetActive && isWindowFrontmost) {
    hideMainWindowForShortcut();
    return;
  }

  const targetView = binding.view?.trim();
  await sendDesktopShortcutActivation({
    app: binding.app,
    ...(targetView
      ? { path: shortcutOpenPathForBinding(binding), softOpen: true }
      : {}),
  });
}

function registerDesktopShortcutBindings() {
  desktopShortcutsActivated = true;
  unregisterDesktopShortcutBindings();
  const registrations = new Map<string, DesktopShortcutRegistration>();
  const bindings = AppStore.loadDesktopShortcutBindings();
  const apps = loadAppsForAuthContext();
  const appsById = new Map(apps.map((appConfig) => [appConfig.id, appConfig]));
  const claimedAccelerators = new Set<string>();

  for (const binding of bindings) {
    if (!binding.enabled) {
      registrations.set(binding.id, { id: binding.id, registered: false });
      continue;
    }

    // Stored settings can predate the reserved-key validation applied when a
    // shortcut is created. Never let an old binding take over a native app
    // command such as macOS's Command+H hide action.
    const normalized = normalizeDesktopShortcutAccelerator(binding.accelerator);
    if (!normalized.accelerator) {
      registrations.set(binding.id, {
        id: binding.id,
        registered: false,
        error: normalized.error ?? "Shortcut is invalid.",
      });
      continue;
    }
    const accelerator = normalized.accelerator;

    const targetApp = appsById.get(binding.app);
    if (!targetApp) {
      registrations.set(binding.id, {
        id: binding.id,
        registered: false,
        error: "Target app is not installed.",
      });
      continue;
    }
    if (targetApp.enabled === false) {
      registrations.set(binding.id, {
        id: binding.id,
        registered: false,
        error: "Target app is disabled.",
      });
      continue;
    }
    if (claimedAccelerators.has(accelerator)) {
      registrations.set(binding.id, {
        id: binding.id,
        registered: false,
        error: "Another binding already uses this shortcut.",
      });
      continue;
    }

    try {
      const registered = globalShortcut.register(accelerator, () => {
        void handleDesktopShortcutBinding(binding);
      });
      if (registered) {
        claimedAccelerators.add(accelerator);
        registeredDesktopShortcutAccelerators.add(accelerator);
        registrations.set(binding.id, { id: binding.id, registered: true });
        debugDesktopShortcut("registered", {
          id: binding.id,
          accelerator,
          app: binding.app,
        });
      } else {
        registrations.set(binding.id, {
          id: binding.id,
          registered: false,
          error: "macOS or another app is already using this shortcut.",
        });
        debugDesktopShortcut("registration rejected", {
          id: binding.id,
          accelerator,
          app: binding.app,
        });
      }
    } catch (err) {
      registrations.set(binding.id, {
        id: binding.id,
        registered: false,
        error: err instanceof Error ? err.message : String(err),
      });
      debugDesktopShortcut("registration failed", {
        id: binding.id,
        accelerator,
        app: binding.app,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  desktopShortcutRegistrations = registrations;
}

function toggleWebviewDevTools() {
  if (activeAppId === CODE_AGENTS_SURFACE_ID) {
    const target = mainWindow?.webContents;
    if (!target || target.isDestroyed()) return;
    if (target.isDevToolsOpened()) {
      target.closeDevTools();
    } else {
      target.openDevTools({ mode: "detach" });
    }
    return;
  }
  const target = getActiveWebviewContents();
  if (!target) {
    const shellTarget = mainWindow?.webContents;
    if (!shellTarget || shellTarget.isDestroyed()) return;
    if (shellTarget.isDevToolsOpened()) {
      shellTarget.closeDevTools();
    } else {
      shellTarget.openDevTools({ mode: "detach" });
    }
    return;
  }
  if (target.isDevToolsOpened()) {
    target.closeDevTools();
  } else {
    target.openDevTools({ mode: "detach" });
  }
}

// Electron's built-in zoomIn/zoomOut/resetZoom menu roles act on the focused
// webContents, which is the shell renderer (the chrome around the apps), not
// the webview guest where the actual app content lives. So the user sees no
// effect. Apply zoom directly to the active webview's webContents instead.
const ZOOM_STEP = 0.5;
const ZOOM_MIN = -3;
const ZOOM_MAX = 3;

function zoomActiveWebview(delta: number) {
  const target = getActiveWebviewContents();
  if (!target) return;
  const next = Math.max(
    ZOOM_MIN,
    Math.min(ZOOM_MAX, target.getZoomLevel() + delta),
  );
  target.setZoomLevel(next);
}

function resetActiveWebviewZoom() {
  const target = getActiveWebviewContents();
  if (!target) return;
  target.setZoomLevel(0);
}

function codeAgentStoreRoot(): string {
  return path.resolve(
    process.env.AGENT_NATIVE_CODE_AGENTS_HOME ??
      path.join(getHomeDirectory(), ".agent-native", "code-agents"),
  );
}

function codeAgentRunsDir(): string {
  return path.join(codeAgentStoreRoot(), "runs");
}

function codeAgentEventsDir(): string {
  return path.join(codeAgentStoreRoot(), "transcripts");
}

function codeAgentProjectsFile(): string {
  return path.join(codeAgentStoreRoot(), "projects.json");
}

const REMOTE_DEVICE_PATH_ENV = "AGENT_NATIVE_REMOTE_DEVICE_PATH";
const REMOTE_CONNECTOR_INITIAL_BACKOFF_MS = 2_000;
const REMOTE_CONNECTOR_MAX_BACKOFF_MS = 60_000;

let remoteConnectorEnabled = false;
let remoteConnectorProcess: ChildProcess | null = null;
let remoteConnectorRestartTimer: NodeJS.Timeout | null = null;
let remoteConnectorRestartCount = 0;
let remoteConnectorStartedAt: string | undefined;
let remoteConnectorLastExitAt: string | undefined;
let remoteConnectorLastExitCode: number | null | undefined;
let remoteConnectorLastExitSignal: string | null | undefined;
let remoteConnectorNextRestartAt: string | undefined;
let remoteConnectorError: string | undefined;
let appIsQuitting = false;
let multiFrontierAppIntegration: MultiFrontierAppIntegration | undefined;
let multiFrontierDisposePromise: Promise<void> | undefined;
const multiFrontierQuitGuard = createMultiFrontierQuitGuard({
  dispose: () => disposeMultiFrontierAppIntegration(),
  reissueQuit: () => app.quit(),
  shouldAllowQuit: () => isInstallingDownloadedUpdate(),
  shouldDeferQuit: () => isPreparingDownloadedUpdate(),
  onDeferredQuit: requestQuitAfterUpdatePreparation,
});
const permissionConfiguredSessions = new WeakSet<Electron.Session>();
const ALLOWED_WEBVIEW_PERMISSIONS = new Set([
  "clipboard-read",
  "clipboard-sanitized-write",
  "display-capture",
  "fullscreen",
  "media",
  "notifications",
]);

function isAllowedWebviewPermission(permission: string): boolean {
  return ALLOWED_WEBVIEW_PERMISSIONS.has(permission);
}

function originFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function isTrustedPermissionRequest(
  contents: Electron.WebContents | null | undefined,
  targetAppId: string | null,
  requestingOrigin?: string,
  details?: unknown,
): boolean {
  if (!targetAppId) return false;
  const appConfig = loadAppsForAuthContext().find(
    (candidate) => candidate.id === targetAppId && candidate.enabled !== false,
  );
  if (!appConfig) return false;

  // In dev mode, first-party templates load through the frame
  // (http://localhost:FRAME_PORT), so the actual document origin differs from
  // the resolved app base origin (dev port or template gateway). Trust the
  // frame origin only in dev; production loads the real app URL directly.
  const appOrigin = getAppOrigin(appConfig);
  const frameOrigin =
    appConfig.mode === "dev" ? `http://localhost:${FRAME_PORT}` : null;
  const trustedOrigins = new Set(
    [appOrigin, frameOrigin].filter((value): value is string => Boolean(value)),
  );
  if (trustedOrigins.size === 0) return false;

  const detailUrl = isObject(details)
    ? firstStringValue(details.requestingUrl, details.embeddingOrigin)
    : undefined;
  const requestOrigin =
    originFromUrl(requestingOrigin) ??
    originFromUrl(detailUrl) ??
    originFromUrl(contents?.getURL());
  if (!requestOrigin || !trustedOrigins.has(requestOrigin)) return false;

  const contentsOrigin = originFromUrl(contents?.getURL());
  return !contentsOrigin || trustedOrigins.has(contentsOrigin);
}

function remoteDeviceConfigPath(): string {
  return path.resolve(
    process.env[REMOTE_DEVICE_PATH_ENV] ??
      path.join(getHomeDirectory(), ".agent-native", "remote-device.json"),
  );
}

function readRemoteDeviceConfig(): {
  token: string;
  relayUrl?: string;
  deviceId?: string;
  deviceName?: string;
  workspacePath?: string;
} | null {
  try {
    const raw = JSON.parse(
      fs.readFileSync(remoteDeviceConfigPath(), "utf-8"),
    ) as unknown;
    if (!isObject(raw)) return null;
    const token = firstStringValue(
      raw.token,
      raw.deviceToken,
      raw.relayToken,
      raw.accessToken,
      raw.bearerToken,
    );
    if (!token) return null;
    return {
      token,
      relayUrl: firstStringValue(raw.relayUrl, raw.url, raw.baseUrl),
      deviceId: firstStringValue(raw.deviceId, raw.id),
      deviceName: firstStringValue(raw.deviceName, raw.name),
      workspacePath: firstStringValue(
        raw.workspacePath,
        raw.workspace,
        raw.cwd,
        raw.projectPath,
      ),
    };
  } catch {
    return null;
  }
}

function writeRemoteDeviceConfig(config: {
  token: string;
  relayUrl: string;
  deviceId?: string;
  deviceName?: string;
  workspacePath?: string;
}): void {
  writeJsonFileAtomically(
    remoteDeviceConfigPath(),
    {
      token: config.token,
      relayUrl: config.relayUrl,
      deviceId: config.deviceId,
      deviceName: config.deviceName,
      workspacePath: config.workspacePath,
    },
    { mode: 0o600 },
  );
}

function normalizeRemoteRelayUrl(
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    return `${url.origin}${url.pathname.replace(/\/+$/, "") || "/"}`;
  } catch {
    return undefined;
  }
}

interface PortalRemoteHost {
  id: string;
  label: string;
  status: string;
  hostName?: string;
  executionCapabilities?: Record<string, unknown>;
}

interface PortalRelayResult extends Record<string, unknown> {
  ok?: boolean;
  error?: string;
  message?: string;
}

function resolvePortalRelayUrl(input: unknown): string {
  const payload = isObject(input) ? input : {};
  const configuredAppUrl = (() => {
    try {
      const appConfig = loadAppsForAuthContext().find(
        (candidate) => candidate.id === "dispatch",
      );
      return appConfig ? getAppOrigin(appConfig) : undefined;
      // coercion-ok: An unavailable app registry is an absent relay URL candidate.
    } catch {
      return undefined;
    }
  })();
  let activeWebviewUrl: string | undefined;
  try {
    activeWebviewUrl = getActiveWebviewContents()?.getURL();
  } catch {
    activeWebviewUrl = undefined;
  }
  const candidates = [
    firstStringValue(payload.relayUrl),
    readRemoteDeviceConfig()?.relayUrl,
    configuredAppUrl,
    activeWebviewUrl,
    process.env.AGENT_NATIVE_PORTAL_RELAY_URL,
    DEFAULT_PORTAL_RELAY_URL,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeRemoteRelayUrl(candidate ?? undefined);
    if (normalized) return normalized;
  }
  return DEFAULT_PORTAL_RELAY_URL;
}

function normalizePortalHost(value: unknown): PortalRemoteHost | null {
  if (!isObject(value)) return null;
  const id = firstStringValue(value.id);
  const label = firstStringValue(value.label, value.name) ?? id;
  const status = firstStringValue(value.status) ?? "offline";
  if (!id || !label || status === "revoked") return null;
  return {
    id,
    label,
    status,
    hostName: firstStringValue(value.hostName),
    executionCapabilities: isObject(value.executionCapabilities)
      ? value.executionCapabilities
      : undefined,
  };
}

async function portalRelayRequest(
  relayUrl: string,
  method: "GET" | "POST",
  pathname: string,
  body?: unknown,
): Promise<PortalRelayResult> {
  const relaySession = findRemoteRelaySession(relayUrl);
  try {
    const response = await relaySession.fetch(
      new URL(pathname, relayUrl).toString(),
      {
        method,
        headers: {
          ...(method === "POST" ? { "content-type": "application/json" } : {}),
        },
        ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
        credentials: "include",
        redirect: "manual",
      },
    );
    const text = await response.text();
    let payload: PortalRelayResult = {};
    if (text) {
      try {
        const parsed = JSON.parse(text);
        if (isObject(parsed)) payload = parsed;
        // coercion-ok: Non-JSON relay errors still have an explicit HTTP failure below.
      } catch {
        // The status and safe fallback below are enough for a user-facing error.
      }
    }
    if (!response.ok) {
      return {
        ok: false,
        error:
          firstStringValue(payload.error, payload.message) ??
          `Portal relay returned ${response.status}.`,
      };
    }
    return payload.error ? { ...payload, ok: false } : payload;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function selectPortalHost(input: unknown): Promise<
  | {
      relayUrl: string;
      host: PortalRemoteHost;
    }
  | { error: string }
> {
  const relayUrl = resolvePortalRelayUrl(input);
  const result = await portalRelayRequest(
    relayUrl,
    "GET",
    "/_agent-native/integrations/remote/hosts",
  );
  const hosts = Array.isArray(result.hosts)
    ? result.hosts
        .map(normalizePortalHost)
        .filter((host): host is PortalRemoteHost => Boolean(host))
    : [];
  if (result.ok === false || result.error)
    return { error: result.error ?? "Portal hosts are unavailable." };
  const requestedHostId = isObject(input)
    ? firstStringValue(input.portalHostId, input.hostId)
    : undefined;
  const host = requestedHostId
    ? hosts.find((candidate) => candidate.id === requestedHostId)
    : (hosts.find((candidate) => candidate.status === "online") ?? hosts[0]);
  if (!host) {
    return {
      error:
        "No paired computer is available. Pair the always-on computer with the Portal relay first.",
    };
  }
  if (requestedHostId && host.id !== requestedHostId) {
    return { error: "The selected Portal computer is no longer paired." };
  }
  if (host.executionCapabilities?.acceptsPortalHandoffs === false) {
    return {
      error: "The selected Portal computer needs the latest connector.",
    };
  }
  return { relayUrl, host };
}

function portalPrompt(
  prompt: string,
  handoff: PortalHandoff,
  host: PortalRemoteHost,
): string {
  return [
    `[Portal execution residence]`,
    `Run on paired computer: ${host.label} (${host.id})`,
    `Portal handoff: ${handoff.handoffId}`,
    `Source snapshot: ${handoff.branch} at ${handoff.commit}`,
    "Before doing work, use the Portal workspace prepared on that computer and load its latest local environment files. Never copy environment values, tokens, or secrets into the relay or chat.",
    "",
    prompt,
  ].join("\n");
}

async function createPortalCodeAgentRun(input: {
  payload: Record<string, unknown>;
  prompt: string;
  userMetadata: Record<string, unknown>;
  goal: NonNullable<ReturnType<typeof getCodeAgentGoal>>;
  runId: string;
  sourceCwd: string;
  permissionMode: CodeAgentPermissionMode;
  engine?: string;
  model?: string;
  effort?: string;
  attachments?: CodeAgentPromptAttachment[];
}): Promise<CodeAgentCreateRunResult> {
  const selected = await selectPortalHost(input.payload);
  if ("error" in selected) {
    return {
      ok: false,
      message: "Could not start the Portal run.",
      error: selected.error,
    };
  }

  let handoff: PortalHandoff;
  try {
    handoff = await createPortalHandoff({ sourcePath: input.sourceCwd });
  } catch (error) {
    return {
      ok: false,
      message: "Could not portal the local code.",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const remote = await portalRelayRequest(
    selected.relayUrl,
    "POST",
    "/_agent-native/integrations/remote/enqueue",
    {
      operation: "code-agent.run.create",
      payload: {
        hostId: selected.host.id,
        runId: input.runId,
        prompt: portalPrompt(input.prompt, handoff, selected.host),
        title: input.prompt.replace(/\s+/g, " ").trim().slice(0, 72),
        goalId: input.goal.id,
        permissionMode: input.permissionMode,
        engine: input.engine,
        model: input.model,
        effort: input.effort,
        metadata: {
          ...input.userMetadata,
          portal: handoff,
          executionResidence: {
            schemaVersion: 1,
            kind: "portal",
            state: "queued",
            hostId: selected.host.id,
            hostLabel: selected.host.label,
            handoffId: handoff.handoffId,
            sourceBranch: handoff.sourceBranch,
            sourceCommit: handoff.commit,
            portalBranch: handoff.branch,
            envPolicy: handoff.envPolicy,
          },
        },
      },
    },
  );
  if (remote.ok === false) {
    return {
      ok: false,
      message: "Portal code was pushed but the remote run was not queued.",
      error: remote.error ?? "The Portal relay rejected the run.",
    };
  }
  const commandId = firstStringValue(remote.commandId, remote.requestId);
  if (!commandId) {
    return {
      ok: false,
      message: "Portal code was pushed but the relay returned no run id.",
      error: "Invalid Portal relay response.",
    };
  }

  const now = new Date().toISOString();
  const queue = buildCodeAgentQueueMetadata({
    goalId: input.goal.id,
    queuedAt: now,
    attempt: 1,
  });
  const steering = buildCodeAgentSteeringMetadata({
    cwd: input.sourceCwd,
    permissionMode: input.permissionMode,
    engine: input.engine,
    model: input.model,
    effort: input.effort,
    attachments: input.attachments,
  });
  const portalMetadata = {
    ...input.userMetadata,
    cwd: input.sourceCwd,
    executionTarget: "portal",
    portal: handoff,
    executionResidence: {
      schemaVersion: 1,
      kind: "portal",
      state: "queued",
      hostId: selected.host.id,
      hostLabel: selected.host.label,
      handoffId: handoff.handoffId,
      sourceBranch: handoff.sourceBranch,
      sourceCommit: handoff.commit,
      portalBranch: handoff.branch,
      envPolicy: handoff.envPolicy,
    },
    remote: {
      commandId,
      remoteRunId: input.runId,
      deviceId: selected.host.id,
      relayUrl: selected.relayUrl,
    },
    queue,
    steering,
    source: "desktop-portal",
    queued: true,
    queuedAt: now,
    initialPrompt: input.prompt,
    permissionMode: input.permissionMode,
    engine: input.engine,
    model: input.model,
    effort: input.effort,
    attachments: input.attachments,
  };
  const run: CodeAgentRun = {
    id: input.runId,
    goalId: input.goal.id,
    title: input.prompt.replace(/\s+/g, " ").trim().slice(0, 72),
    subtitle: `Portal queued on ${selected.host.label}`,
    status: "queued",
    phase: "portal-queued",
    progress: { label: "Portal queued", completed: 0, total: 1, percent: 0 },
    details: [
      { label: "Goal", value: input.goal.slashCommand },
      { label: "Workspace", value: `Portal · ${selected.host.label}` },
      {
        label: "Snapshot",
        value: `${handoff.branch} @ ${handoff.commit.slice(0, 12)}`,
      },
      { label: "Environment", value: "Loaded locally on paired computer" },
      { label: "Mode", value: input.permissionMode },
    ],
    createdAt: now,
    updatedAt: now,
    metadata: portalMetadata,
  };
  const record = {
    schemaVersion: 1,
    ...run,
    cwd: input.sourceCwd,
    permissionMode: input.permissionMode,
    queue,
    steering,
    metadata: portalMetadata,
  };
  const runFile = codeAgentRunFilePath(input.runId);
  if (!runFile) {
    return {
      ok: false,
      message: "Could not create a Portal session id.",
      error: "Invalid generated run id.",
    };
  }
  try {
    withFileLockSync(runFile, () => {
      if (fs.existsSync(runFile)) {
        throw new Error(`A Code Agent run already exists: ${input.runId}`);
      }
      writeJsonFileAtomically(runFile, record);
    });
    const event = createDesktopUserTranscriptEvent(
      input.runId,
      input.prompt,
      input.goal.id,
      {
        queue,
        steering,
        attachments: input.attachments,
        executionTarget: "portal",
        portal: handoff,
      },
    );
    const eventFile = appendCodeAgentTranscriptEvent(event);
    return {
      ok: true,
      run,
      event,
      eventFile,
      message:
        firstStringValue(remote.message) ??
        `Portal queued on ${selected.host.label}.`,
    };
  } catch (error) {
    return {
      ok: false,
      message:
        "The Portal run was queued remotely but could not be recorded locally.",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function appendPortalCodeAgentFollowUp(input: {
  runId: string;
  prompt: string;
  followUpMode: "immediate" | "queued";
  permissionMode?: CodeAgentPermissionMode;
  metadata: Record<string, unknown>;
  runRecord: Record<string, unknown>;
}): Promise<CodeAgentFollowUpResult> {
  const metadata = isObject(input.runRecord.metadata)
    ? input.runRecord.metadata
    : {};
  const portal = isObject(metadata.portal) ? metadata.portal : {};
  const remote = isObject(metadata.remote) ? metadata.remote : {};
  const relayUrl = firstStringValue(remote.relayUrl);
  const hostId = firstStringValue(remote.deviceId);
  const remoteRunId = firstStringValue(remote.remoteRunId) ?? input.runId;
  if (!relayUrl || !hostId) {
    return {
      ok: false,
      message: "Portal host details are missing from this session.",
      error: "Invalid Portal execution residence.",
    };
  }
  const result = await portalRelayRequest(
    relayUrl,
    "POST",
    "/_agent-native/integrations/remote/enqueue",
    {
      operation: "code-agent.run.follow-up",
      payload: {
        hostId,
        runId: remoteRunId,
        prompt: input.prompt,
        permissionMode: input.permissionMode,
      },
    },
  );
  if (result.ok === false) {
    return {
      ok: false,
      message: "Could not send the follow-up to Portal.",
      error: result.error,
    };
  }
  const event = createDesktopUserTranscriptEvent(
    input.runId,
    input.prompt,
    getRecordString(input.runRecord, "goalId"),
    {
      ...input.metadata,
      source: "desktop-portal-follow-up",
      followUpMode: input.followUpMode,
      executionResidence: portal,
    },
  );
  const eventFile = appendCodeAgentTranscriptEvent(event);
  touchCodeAgentRunRecord(input.runId, {
    updatedAt: new Date().toISOString(),
    metadata: {
      lastPortalFollowUpAt: event.createdAt,
      ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
    },
  });
  return {
    ok: true,
    event,
    eventFile,
    message: firstStringValue(result.message) ?? "Follow-up sent to Portal.",
  };
}

const PORTAL_TRANSFER_RUNNER_STOP_TIMEOUT_MS = 5_000;

async function transferCodeAgentRun(
  input: unknown,
): Promise<CodeAgentPortalTransferResult> {
  const payload = isObject(input) ? input : {};
  const runId = normalizeCodeAgentRunId(payload.runId);
  if (!runId) {
    return {
      ok: false,
      runId: "",
      message: "Select a chat first.",
      error: "Missing or invalid run id.",
    };
  }

  const selected = await selectPortalHost(payload);
  if ("error" in selected) {
    return {
      ok: false,
      runId,
      message: "Could not move the chat to Portal.",
      error: selected.error,
    };
  }
  return transferCodeAgentRunToPortal(runId, selected);
}

async function transferAllCodeAgentRuns(
  input?: unknown,
): Promise<CodeAgentPortalTransferAllResult> {
  const transferred: CodeAgentPortalTransferItem[] = [];
  const skipped: CodeAgentPortalTransferItem[] = [];
  const failed: CodeAgentPortalTransferItem[] = [];
  const selected = await selectPortalHost(input);
  if ("error" in selected) {
    return {
      ok: false,
      transferred,
      skipped,
      failed,
      message: "Could not move local chats to Portal.",
      error: selected.error,
    };
  }

  for (const { runId, record } of listRawCodeAgentRunRecords()) {
    const title = getRecordString(record, "title");
    const item = {
      runId,
      ...(title ? { title } : {}),
    };
    if (isPortalCodeAgentRunRecord(record)) {
      skipped.push({
        ...item,
        ok: false,
        message: "Already running on Portal.",
      });
      continue;
    }
    const goal = getCodeAgentGoal(getRecordString(record, "goalId"));
    if (!goal || goal.surfaceKind !== "native") {
      skipped.push({
        ...item,
        ok: false,
        message: "This session does not run as a native coding chat.",
      });
      continue;
    }
    if (
      getRecordString(record, "status") === "needs-approval" ||
      record.needsApproval === true
    ) {
      skipped.push({
        ...item,
        ok: false,
        message: "Waiting for a local approval. Resolve it before moving it.",
      });
      continue;
    }

    const result = await transferCodeAgentRunToPortal(runId, selected);
    const transferItem: CodeAgentPortalTransferItem = {
      ...item,
      ok: result.ok,
      ...(result.eventCount !== undefined
        ? { eventCount: result.eventCount }
        : {}),
      message: result.message,
      ...(result.error ? { error: result.error } : {}),
    };
    if (result.ok) transferred.push(transferItem);
    else failed.push(transferItem);
  }

  const counts = [
    `${transferred.length} moved`,
    `${skipped.length} skipped`,
    `${failed.length} failed`,
  ].join(", ");
  return {
    ok: failed.length === 0,
    host: { id: selected.host.id, label: selected.host.label },
    transferred,
    skipped,
    failed,
    message:
      transferred.length > 0
        ? `Portal transfer: ${counts}.`
        : `No local chats moved. ${counts}.`,
    ...(failed.length > 0
      ? { error: failed.map((item) => item.error ?? item.message).join(" ") }
      : {}),
  };
}

async function transferCodeAgentRunToPortal(
  runId: string,
  selected: { relayUrl: string; host: PortalRemoteHost },
): Promise<CodeAgentPortalTransferResult> {
  const record = readCodeAgentRunRecord(runId);
  if (!record) {
    return {
      ok: false,
      runId,
      message: "The selected chat no longer exists.",
      error: `No run record exists for ${runId}.`,
    };
  }
  if (isPortalCodeAgentRunRecord(record)) {
    return {
      ok: false,
      runId,
      message: "This chat is already running on Portal.",
      error: "The chat already has a Portal execution residence.",
    };
  }
  if (
    getRecordString(record, "status") === "needs-approval" ||
    record.needsApproval === true
  ) {
    return {
      ok: false,
      runId,
      message: "Resolve the local approval before moving this chat.",
      error: "Pending approvals cannot be moved safely between computers.",
    };
  }

  const goal = getCodeAgentGoal(getRecordString(record, "goalId"));
  if (!goal || goal.surfaceKind !== "native") {
    return {
      ok: false,
      runId,
      message: "This session cannot be moved as a native coding chat.",
      error: "Portal transfer requires a native code-agent goal.",
    };
  }
  const sourceCwd = getRecordString(record, "cwd");
  if (!sourceCwd || !fs.existsSync(sourceCwd)) {
    return {
      ok: false,
      runId,
      message: "The local coding folder is no longer available.",
      error: sourceCwd
        ? `Portal source folder does not exist: ${sourceCwd}`
        : "The run has no source folder.",
    };
  }

  const metadata = isObject(record.metadata) ? record.metadata : {};
  const worktree = isObject(metadata.worktree) ? metadata.worktree : undefined;
  const recordedWorktreePath = firstStringValue(worktree?.path);
  if (recordedWorktreePath && !fs.existsSync(recordedWorktreePath)) {
    return {
      ok: false,
      runId,
      message: "This chat's worktree is no longer available.",
      error: `Portal cannot move a missing worktree: ${recordedWorktreePath}`,
    };
  }

  if (
    activeCodeAgentProcesses.has(runId) ||
    startingCodeAgentRuns.has(runId) ||
    isActiveDesktopCodeAgentRun(record)
  ) {
    const activePid = activeCodeAgentProcesses.get(runId)?.pid;
    const stopped = await controlCodeAgentRun({
      goalId: goal.id,
      runId,
      command: "stop",
    });
    if (!stopped.ok) {
      return {
        ok: false,
        runId,
        message: "The local runner could not be stopped for Portal.",
        error: stopped.error ?? stopped.message,
      };
    }
    try {
      await waitForPortalRunnerStop(runId, activePid);
    } catch (error) {
      return {
        ok: false,
        runId,
        message:
          "The local runner is still stopping. Portal did not start a duplicate.",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const transcript = readAllCodeAgentTranscript({ runId });
  if (transcript.status !== "ok") {
    return {
      ok: false,
      runId,
      message: "The chat transcript could not be read for Portal.",
      error: transcript.error ?? "Transcript is unavailable.",
    };
  }

  let transferContext;
  try {
    transferContext = createPortalTransferContext({
      sourceRunId: runId,
      sourceStatus: getRecordString(record, "status"),
      sourcePhase: getRecordString(record, "phase"),
      events: transcript.events,
    });
  } catch (error) {
    return {
      ok: false,
      runId,
      message: "Portal could not package the full chat context.",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  let handoff: PortalHandoff;
  try {
    handoff = await createPortalHandoff({ sourcePath: sourceCwd });
  } catch (error) {
    return {
      ok: false,
      runId,
      message: "Portal could not snapshot the local code.",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const prompt = portalTransferContinuationPrompt({
    hostLabel: selected.host.label,
    handoffId: handoff.handoffId,
    eventCount: transferContext.events.length,
  });
  const sourceKind = firstStringValue(metadata.kind);
  const remote = await portalRelayRequest(
    selected.relayUrl,
    "POST",
    "/_agent-native/integrations/remote/enqueue",
    {
      operation: "code-agent.run.create",
      payload: {
        hostId: selected.host.id,
        runId,
        prompt,
        title: getRecordString(record, "title") ?? "Transferred coding chat",
        goalId: goal.id,
        permissionMode: readCodeAgentPermissionMode(record),
        engine: firstStringValue(metadata.engine, record.engine),
        model: firstStringValue(metadata.model, record.model),
        effort: firstStringValue(metadata.effort, record.effort),
        metadata: {
          source: "desktop-portal-transfer",
          executionTarget: "portal",
          portal: handoff,
          ...(sourceKind ? { kind: sourceKind } : {}),
          portalTransfer: transferContext,
        },
      },
    },
  );
  if (remote.ok === false) {
    return {
      ok: false,
      runId,
      message: "Portal code was pushed but the chat was not queued remotely.",
      error: remote.error ?? "The Portal relay rejected the transfer.",
    };
  }
  const commandId = firstStringValue(remote.commandId, remote.requestId);
  if (!commandId) {
    return {
      ok: false,
      runId,
      message: "Portal code was pushed but the relay returned no command id.",
      error: "Invalid Portal relay response.",
    };
  }

  const now = new Date().toISOString();
  const permissionMode = readCodeAgentPermissionMode(record);
  const executionResidence = {
    schemaVersion: 1,
    kind: "portal",
    state: "queued",
    hostId: selected.host.id,
    hostLabel: selected.host.label,
    handoffId: handoff.handoffId,
    sourceBranch: handoff.sourceBranch,
    sourceCommit: handoff.commit,
    portalBranch: handoff.branch,
    envPolicy: handoff.envPolicy,
  };
  const portalMetadata: Record<string, unknown> = {
    ...metadata,
    cwd: sourceCwd,
    executionTarget: "portal",
    portal: handoff,
    executionResidence,
    remote: {
      commandId,
      remoteRunId: runId,
      deviceId: selected.host.id,
      relayUrl: selected.relayUrl,
    },
    source: "desktop-portal-transfer",
    queued: true,
    queuedAt: now,
    ...(metadata.initialPrompt !== undefined
      ? { initialPrompt: metadata.initialPrompt }
      : {}),
    permissionMode,
    portalTransfer: {
      schemaVersion: 1,
      sourceRunId: runId,
      sourceStatus: getRecordString(record, "status"),
      sourcePhase: getRecordString(record, "phase"),
      eventCount: transferContext.events.length,
      transferredAt: now,
    },
  };
  touchCodeAgentRunRecord(runId, {
    status: "queued",
    phase: "portal-queued",
    needsApproval: false,
    subtitle: `Portal queued on ${selected.host.label}`,
    progress: { label: "Portal queued", completed: 0, total: 1, percent: 0 },
    details: [
      { label: "Goal", value: goal.slashCommand },
      { label: "Workspace", value: `Portal · ${selected.host.label}` },
      {
        label: "Snapshot",
        value: `${handoff.branch} @ ${handoff.commit.slice(0, 12)}`,
      },
      {
        label: "Context",
        value: `Imported ${transferContext.events.length} transcript events`,
      },
      { label: "Environment", value: "Loaded locally on paired computer" },
      ...(permissionMode ? [{ label: "Mode", value: permissionMode }] : []),
    ],
    metadata: portalMetadata,
  });
  appendCodeAgentStatusEvent(
    runId,
    `Portal handoff queued on ${selected.host.label}.`,
    {
      source: "desktop-portal-transfer",
      commandId,
      handoffId: handoff.handoffId,
      eventCount: transferContext.events.length,
      executionResidence,
    },
  );

  return {
    ok: true,
    runId,
    run: readDesktopCodeAgentRun(runId) ?? undefined,
    host: { id: selected.host.id, label: selected.host.label },
    eventCount: transferContext.events.length,
    message: `Moved ${getRecordString(record, "title") ?? "chat"} to Portal on ${selected.host.label}.`,
  };
}

async function waitForPortalRunnerStop(
  runId: string,
  pid?: number,
): Promise<void> {
  const deadline = Date.now() + PORTAL_TRANSFER_RUNNER_STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const inFlight = isCodeAgentRunnerInFlight(
      runId,
      activeCodeAgentProcesses,
      startingCodeAgentRuns,
    );
    const processAlive = pid ? isProcessAlive(pid) : false;
    if (!inFlight && !processAlive) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Local runner for ${runId} did not stop within 5 seconds.`);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    throw error;
  }
}

function isPortalCodeAgentRunRecord(record: Record<string, unknown>): boolean {
  const metadata = isObject(record.metadata) ? record.metadata : {};
  return metadata.executionTarget === "portal" || isObject(metadata.portal);
}

async function submitCodeAgentRemoteWaitlist(
  input: unknown,
): Promise<CodeAgentRemoteWaitlistResult> {
  const payload = isObject(input) ? input : {};
  const email = firstStringValue(payload.email)?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  try {
    const response = await fetch(CODE_AGENT_REMOTE_WAITLIST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        pageUrl: firstStringValue(payload.pageUrl),
        source: firstStringValue(payload.source) ?? "desktop_code_agents",
        useCase:
          firstStringValue(payload.useCase) ??
          "desktop_remote_code_agent_waitlist",
      }),
    });
    const text = await response.text();
    let result: Record<string, unknown> = {};
    if (text) {
      try {
        const parsed = JSON.parse(text);
        if (isObject(parsed)) result = parsed;
      } catch (error) {
        console.warn(
          "[desktop] Remote waitlist returned invalid JSON:",
          error instanceof Error ? error.message : error,
        );
      }
    }
    if (!response.ok) {
      return {
        ok: false,
        error:
          firstStringValue(result.error, result.message) ??
          "Couldn't join the waitlist. Please try again.",
      };
    }
    return {
      ok: true,
      message: firstStringValue(result.message),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function getRemoteConnectorStatus(): CodeAgentRemoteConnectorStatus {
  const config = readRemoteDeviceConfig();
  const relayUrl = normalizeRemoteRelayUrl(config?.relayUrl);
  const configured = Boolean(config?.token && relayUrl);
  let state: CodeAgentRemoteConnectorStatus["state"] = "stopped";
  if (!remoteConnectorEnabled) state = "disabled";
  else if (!configured) state = "unconfigured";
  else if (remoteConnectorProcess?.pid) state = "running";
  else if (remoteConnectorNextRestartAt) state = "starting";
  else if (remoteConnectorError) state = "error";
  return {
    state,
    enabled: remoteConnectorEnabled,
    configured,
    configPath: remoteDeviceConfigPath(),
    relayUrl,
    workspacePath: config?.workspacePath,
    pid: remoteConnectorProcess?.pid,
    startedAt: remoteConnectorStartedAt,
    lastExitAt: remoteConnectorLastExitAt,
    lastExitCode: remoteConnectorLastExitCode,
    lastExitSignal: remoteConnectorLastExitSignal,
    restartCount: remoteConnectorRestartCount,
    nextRestartAt: remoteConnectorNextRestartAt,
    error: remoteConnectorError,
  };
}

function resolveRemoteConnectorCliInvocation(): {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
} {
  const electronNodeEnv = { ELECTRON_RUN_AS_NODE: "1" };
  const localCoreCli = path.resolve(
    __dirname,
    "../../../core/dist/cli/index.js",
  );
  if (fs.existsSync(localCoreCli)) {
    return {
      command: process.execPath,
      args: [localCoreCli],
      cwd: path.dirname(localCoreCli),
      env: electronNodeEnv,
    };
  }
  const repoCoreCli = path.resolve("packages/core/dist/cli/index.js");
  if (fs.existsSync(repoCoreCli)) {
    return {
      command: process.execPath,
      args: [repoCoreCli],
      cwd: process.cwd(),
      env: electronNodeEnv,
    };
  }
  return {
    command: "pnpm",
    args: [
      "--filter",
      "@agent-native/core",
      "exec",
      "node",
      "dist/cli/index.js",
    ],
    cwd: process.cwd(),
  };
}

function startRemoteCodeAgentConnector(): CodeAgentRemoteConnectorStatus {
  if (!remoteConnectorEnabled || appIsQuitting)
    return getRemoteConnectorStatus();
  if (remoteConnectorProcess && !remoteConnectorProcess.killed) {
    return getRemoteConnectorStatus();
  }
  const config = readRemoteDeviceConfig();
  const relayUrl = normalizeRemoteRelayUrl(config?.relayUrl);
  if (!config || !relayUrl) {
    remoteConnectorError = config
      ? "Remote device config is missing relayUrl."
      : undefined;
    return getRemoteConnectorStatus();
  }
  if (remoteConnectorRestartTimer) {
    clearTimeout(remoteConnectorRestartTimer);
    remoteConnectorRestartTimer = null;
  }
  remoteConnectorNextRestartAt = undefined;
  remoteConnectorError = undefined;

  const invocation = resolveRemoteConnectorCliInvocation();
  const args = [...invocation.args, "code", "serve", "--relay-url", relayUrl];
  try {
    const computerEnv = remoteConnectorComputerEnv();
    const child = spawn(invocation.command, args, {
      cwd: invocation.cwd,
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...AppStore.getCodeAgentProviderProcessEnv(process.env),
        ...invocation.env,
        AGENT_NATIVE_CODE_AGENTS_HOME: codeAgentStoreRoot(),
        ...computerEnv,
      },
    });
    remoteConnectorProcess = child;
    remoteConnectorStartedAt = new Date().toISOString();
    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (text) console.log(`[remote-code-agent] ${text}`);
    });
    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (text) console.error(`[remote-code-agent] ${text}`);
    });
    child.on("exit", (code, signal) => {
      revokeRemoteConnectorComputerControl();
      if (remoteConnectorProcess === child) remoteConnectorProcess = null;
      remoteConnectorLastExitAt = new Date().toISOString();
      remoteConnectorLastExitCode = code;
      remoteConnectorLastExitSignal = signal;
      if (!appIsQuitting && remoteConnectorEnabled) {
        scheduleRemoteConnectorRestart();
      }
    });
    child.on("error", (err) => {
      revokeRemoteConnectorComputerControl();
      remoteConnectorError = err instanceof Error ? err.message : String(err);
      if (remoteConnectorProcess === child) remoteConnectorProcess = null;
      if (!appIsQuitting && remoteConnectorEnabled) {
        scheduleRemoteConnectorRestart();
      }
    });
  } catch (err) {
    revokeRemoteConnectorComputerControl();
    remoteConnectorError = err instanceof Error ? err.message : String(err);
    scheduleRemoteConnectorRestart();
  }
  return getRemoteConnectorStatus();
}

function scheduleRemoteConnectorRestart(): void {
  if (remoteConnectorRestartTimer || !remoteConnectorEnabled || appIsQuitting) {
    return;
  }
  const delay = Math.min(
    REMOTE_CONNECTOR_INITIAL_BACKOFF_MS *
      Math.max(1, 2 ** remoteConnectorRestartCount),
    REMOTE_CONNECTOR_MAX_BACKOFF_MS,
  );
  remoteConnectorRestartCount += 1;
  remoteConnectorNextRestartAt = new Date(Date.now() + delay).toISOString();
  remoteConnectorRestartTimer = setTimeout(() => {
    remoteConnectorRestartTimer = null;
    remoteConnectorNextRestartAt = undefined;
    startRemoteCodeAgentConnector();
  }, delay);
}

function setRemoteConnectorEnabled(
  enabled: boolean,
): CodeAgentRemoteConnectorControlResult {
  remoteConnectorEnabled = enabled;
  try {
    AppStore.saveRemoteConnectorSettings({ enabled });
  } catch (err) {
    remoteConnectorError = err instanceof Error ? err.message : String(err);
  }
  if (!enabled) {
    if (remoteConnectorRestartTimer) {
      clearTimeout(remoteConnectorRestartTimer);
      remoteConnectorRestartTimer = null;
    }
    remoteConnectorNextRestartAt = undefined;
    remoteConnectorRestartCount = 0;
    if (remoteConnectorProcess?.pid) {
      try {
        remoteConnectorProcess.kill("SIGTERM");
      } catch (err) {
        remoteConnectorError = err instanceof Error ? err.message : String(err);
      }
    }
    remoteConnectorProcess = null;
    return { ok: true, status: getRemoteConnectorStatus() };
  }
  remoteConnectorRestartCount = 0;
  return { ok: true, status: startRemoteCodeAgentConnector() };
}

function parseRemoteConnectorPairRequest(
  input: unknown,
): CodeAgentRemoteConnectorPairRequest {
  if (!isObject(input)) return {};
  return {
    relayUrl: firstStringValue(input.relayUrl, input.url),
    label: firstStringValue(input.label, input.name),
    workspacePath: firstStringValue(
      input.workspacePath,
      input.portalWorkspacePath,
    ),
  };
}

function findRemoteRelaySession(relayUrl: string): Electron.Session {
  let origin: string | null = null;
  try {
    origin = new URL(relayUrl).origin;
  } catch {
    return session.defaultSession;
  }

  try {
    const matchingApp = loadAppsForAuthContext().find(
      (appConfig) => getAppOrigin(appConfig) === origin,
    );
    if (matchingApp)
      return session.fromPartition(`persist:app-${matchingApp.id}`);
  } catch (err) {
    console.warn("[remote-code-agent] failed to match relay app:", err);
  }

  const active = getActiveWebviewContents();
  try {
    if (active && new URL(active.getURL()).origin === origin) {
      return active.session;
    }
  } catch {
    // Fall back to the default Electron session.
  }
  return session.defaultSession;
}

async function cookieHeaderForRelay(
  relaySession: Electron.Session,
  relayUrl: string,
): Promise<string> {
  const origin = new URL(relayUrl).origin;
  const cookies = await relaySession.cookies.get({ url: origin });
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

async function pairRemoteCodeAgentConnector(
  input: unknown,
): Promise<CodeAgentRemoteConnectorPairResult> {
  const request = parseRemoteConnectorPairRequest(input);
  const relayUrl = normalizeRemoteRelayUrl(request.relayUrl);
  if (!relayUrl) {
    return {
      ok: false,
      status: getRemoteConnectorStatus(),
      error: "Enter a valid Agent-Native app URL to pair remote control.",
    };
  }

  try {
    const relaySession = findRemoteRelaySession(relayUrl);
    const response = await relaySession.fetch(
      new URL(
        "/_agent-native/integrations/remote/register",
        relayUrl,
      ).toString(),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          label: request.label ?? `${os.hostname()} Desktop`,
        }),
        credentials: "include",
        redirect: "manual",
      },
    );
    const text = await response.text();
    const payload = text ? (JSON.parse(text) as unknown) : null;
    if (!response.ok || !isObject(payload)) {
      const error = isObject(payload)
        ? firstStringValue(payload.error, payload.message)
        : undefined;
      return {
        ok: false,
        status: getRemoteConnectorStatus(),
        error:
          error ??
          `Remote pairing returned ${response.status} from ${new URL(relayUrl).host}.`,
      };
    }

    const device = isObject(payload.device) ? payload.device : {};
    const token = firstStringValue(
      payload.token,
      payload.deviceToken,
      payload.relayToken,
      payload.accessToken,
    );
    if (!token) {
      const error = firstStringValue(payload.error, payload.message);
      return {
        ok: false,
        status: getRemoteConnectorStatus(),
        error: error ?? "The app did not return a remote device token.",
      };
    }

    const deviceId = firstStringValue(payload.deviceId, device.id);
    const deviceName = firstStringValue(
      payload.deviceName,
      payload.label,
      device.label,
      device.name,
    );
    const existingWorkspacePath = readRemoteDeviceConfig()?.workspacePath;
    const workspacePath =
      request.workspacePath ??
      existingWorkspacePath ??
      firstStringValue(process.env.AGENT_NATIVE_PORTAL_WORKSPACE_PATH);
    writeRemoteDeviceConfig({
      token,
      relayUrl,
      deviceId,
      deviceName,
      workspacePath,
    });

    remoteConnectorEnabled = true;
    AppStore.saveRemoteConnectorSettings({ enabled: true });
    remoteConnectorError = undefined;
    remoteConnectorRestartCount = 0;
    remoteConnectorNextRestartAt = undefined;
    if (remoteConnectorRestartTimer) {
      clearTimeout(remoteConnectorRestartTimer);
      remoteConnectorRestartTimer = null;
    }
    if (remoteConnectorProcess?.pid) {
      try {
        remoteConnectorProcess.kill("SIGTERM");
      } catch {
        // A fresh connector start below will report any remaining failure.
      }
      remoteConnectorProcess = null;
    }

    return {
      ok: true,
      status: startRemoteCodeAgentConnector(),
      deviceId,
      message: "Remote control paired.",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    remoteConnectorError = message;
    return {
      ok: false,
      status: getRemoteConnectorStatus(),
      error: message,
    };
  }
}

function timestampSlug(value: string): string {
  return value.replace(/\D/g, "").slice(0, 14);
}

function normalizeCodeAgentRunId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 160) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(trimmed)) return null;
  return trimmed;
}

function codeAgentRunFilePath(runId: string): string | null {
  const safeRunId = normalizeCodeAgentRunId(runId);
  if (!safeRunId) return null;
  return path.join(codeAgentRunsDir(), `${safeRunId}.json`);
}

function codeAgentEventFilePath(runId: string): string | null {
  const safeRunId = normalizeCodeAgentRunId(runId);
  if (!safeRunId) return null;
  return path.join(codeAgentEventsDir(), `${safeRunId}.jsonl`);
}

function listDesktopCodeAgentRuns(goalId?: string): CodeAgentRun[] {
  reconcileInterruptedCodeAgentRuns("list", goalId);
  reclaimTerminalCodeAgentWorktrees(goalId);
  const runs = desktopCodeBackgroundAgentController.list({
    goalId,
  }) as BackgroundAgentRun[];
  const scheduledRunIds = new Set(
    listCodeAgentSchedules()
      .map((schedule) => schedule.targetRunId)
      .filter((runId): runId is string => Boolean(runId)),
  );
  return runs.map((run) => {
    const desktopRun = backgroundRunToDesktopRun(run);
    return scheduledRunIds.has(desktopRun.id)
      ? {
          ...desktopRun,
          metadata: {
            ...(desktopRun.metadata ?? {}),
            hasSchedule: true,
          },
        }
      : desktopRun;
  });
}

function readDesktopCodeAgentRun(runId: string): CodeAgentRun | null {
  reconcileInterruptedCodeAgentRun(runId, "read");
  reclaimTerminalCodeAgentWorktree(readCodeAgentRunRecord(runId));
  const run = desktopCodeBackgroundAgentController.get(
    runId,
  ) as BackgroundAgentRun | null;
  return run ? backgroundRunToDesktopRun(run) : null;
}

function listRawCodeAgentRunRecords(
  goalId?: string,
): Array<{ runId: string; record: Record<string, unknown> }> {
  const dir = codeAgentRunsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const record = readJsonObjectFile(path.join(dir, file));
      const runId = normalizeCodeAgentRunId(record?.id);
      if (!record || !runId) return null;
      if (goalId && getRecordString(record, "goalId") !== goalId) return null;
      return { runId, record };
    })
    .filter(
      (
        item,
      ): item is {
        runId: string;
        record: Record<string, unknown>;
      } => Boolean(item),
    );
}

function isTerminalCodeAgentRun(record: Record<string, unknown>): boolean {
  const status = getRecordString(record, "status");
  return status === "completed" || status === "errored" || status === "paused";
}

function codeAgentWorktreeRegistryFile(): string {
  return worktreeRegistryPath(codeAgentStoreRoot());
}

function codeAgentWorktreeMetadata(
  worktree: CodeAgentManagedWorktree,
): Record<string, unknown> {
  return {
    id: worktree.id,
    ...(worktree.name ? { name: worktree.name } : {}),
    policy: worktree.policy,
    sourcePath: worktree.sourcePath,
    path: worktree.path,
    pathAvailable: fs.existsSync(worktree.path),
    branch: worktree.branch,
    baseCommit: worktree.baseCommit,
    state: worktree.state,
    ...(worktree.cleanupAfter ? { cleanupAfter: worktree.cleanupAfter } : {}),
    ...(worktree.lastCleanupError
      ? { lastCleanupError: worktree.lastCleanupError }
      : {}),
  };
}

function activeCodeAgentRunUsesWorktree(
  worktree: CodeAgentManagedWorktree,
): boolean {
  return listRawCodeAgentRunRecords().some(({ record }) => {
    if (!isActiveDesktopCodeAgentRun(record)) return false;
    const metadata = isObject(record.metadata) ? record.metadata : undefined;
    const candidate = isObject(metadata?.worktree) ? metadata.worktree : null;
    if (!candidate) return false;
    return (
      firstStringValue(candidate.id) === worktree.id ||
      (firstStringValue(candidate.path) !== undefined &&
        path.resolve(firstStringValue(candidate.path)!) ===
          path.resolve(worktree.path))
    );
  });
}

const startingCodeAgentWorktreeRuns = new Set<string>();
const codeAgentWorktreeLeaseOwnerId = randomUUID();

function codeAgentWorktreeIdFromRunRecord(
  record: Record<string, unknown> | null,
): string | undefined {
  const metadata = isObject(record?.metadata) ? record.metadata : undefined;
  const worktree = isObject(metadata?.worktree) ? metadata.worktree : undefined;
  return firstStringValue(worktree?.id);
}

function codeAgentRunHoldsWorktreeLease(
  runId: string,
  record: Record<string, unknown>,
): boolean {
  if (
    activeCodeAgentProcesses.has(runId) ||
    startingCodeAgentRuns.has(runId) ||
    startingCodeAgentWorktreeRuns.has(
      codeAgentWorktreeIdFromRunRecord(record) ?? "",
    )
  ) {
    return true;
  }
  const status = getRecordString(record, "status");
  const phase = getRecordString(record, "phase");
  return Boolean(
    status === "running" ||
    status === "needs-approval" ||
    phase === "executing" ||
    phase === "approval-running",
  );
}

function hasActiveCodeAgentWorktreeRun(
  worktreeId: string,
  exceptRunId?: string,
): boolean {
  return listRawCodeAgentRunRecords().some(({ runId, record }) => {
    if (
      runId === exceptRunId ||
      codeAgentWorktreeIdFromRunRecord(record) !== worktreeId
    ) {
      return false;
    }
    return codeAgentRunHoldsWorktreeLease(runId, record);
  });
}

function isQueuedCodeAgentWorktreeRun(
  record: Record<string, unknown>,
): boolean {
  const metadata = isObject(record.metadata) ? record.metadata : undefined;
  const worktree = isObject(metadata?.worktree) ? metadata.worktree : undefined;
  const queueState = firstStringValue(worktree?.queueState);
  return Boolean(
    firstStringValue(worktree?.id) &&
    (queueState === "waiting" || queueState === "starting") &&
    (getRecordString(record, "status") === "queued" ||
      getRecordString(record, "phase") === "queued"),
  );
}

function reconcileManagedCodeAgentWorktreeLeases(): void {
  const runStates = new Map<string, CodeAgentWorktreeRunState>();
  for (const { runId, record } of listRawCodeAgentRunRecords()) {
    if (codeAgentRunHoldsWorktreeLease(runId, record)) {
      runStates.set(runId, "active");
    } else if (isQueuedCodeAgentWorktreeRun(record)) {
      const metadata = isObject(record.metadata) ? record.metadata : undefined;
      const worktree = isObject(metadata?.worktree)
        ? metadata.worktree
        : undefined;
      runStates.set(
        runId,
        firstStringValue(worktree?.queueState) === "starting"
          ? "starting"
          : "queued",
      );
    } else {
      runStates.set(runId, "terminal");
    }
  }
  try {
    reconcileCodeAgentWorktreeLeases({
      registryPath: codeAgentWorktreeRegistryFile(),
      runStates,
    });
  } catch (error) {
    console.warn(
      "[code-agents] Could not reconcile worktree leases:",
      error instanceof Error ? error.message : error,
    );
  }
}

function syncManagedWorktreeStateToRuns(
  worktree: CodeAgentManagedWorktree,
): void {
  for (const { runId, record } of listRawCodeAgentRunRecords()) {
    const metadata = isObject(record.metadata) ? record.metadata : undefined;
    const runWorktree = isObject(metadata?.worktree)
      ? metadata.worktree
      : undefined;
    const runWorktreeId = firstStringValue(runWorktree?.id);
    const runWorktreePath = firstStringValue(runWorktree?.path);
    if (
      (!runWorktreeId && !runWorktreePath) ||
      (runWorktreeId !== worktree.id &&
        path.resolve(runWorktreePath ?? "") !== path.resolve(worktree.path))
    ) {
      continue;
    }
    try {
      touchCodeAgentRunRecord(runId, {
        metadata: {
          worktree: codeAgentWorktreeMetadata(worktree),
        },
      });
    } catch (error) {
      console.warn(
        `[code-agents] Could not update cleanup state for run ${runId}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
}

async function startNextQueuedCodeAgentWorktreeRun(
  worktreeId: string,
): Promise<void> {
  if (
    startingCodeAgentWorktreeRuns.has(worktreeId) ||
    hasActiveCodeAgentWorktreeRun(worktreeId)
  ) {
    return;
  }
  const candidate = listRawCodeAgentRunRecords()
    .filter(({ record }) => {
      if (codeAgentWorktreeIdFromRunRecord(record) !== worktreeId) {
        return false;
      }
      const metadata = isObject(record.metadata) ? record.metadata : undefined;
      const worktree = isObject(metadata?.worktree)
        ? metadata.worktree
        : undefined;
      return (
        (firstStringValue(worktree?.queueState) === "waiting" ||
          firstStringValue(worktree?.queueState) === "starting") &&
        (getRecordString(record, "status") === "queued" ||
          getRecordString(record, "phase") === "queued")
      );
    })
    .sort((left, right) =>
      (getRecordString(left.record, "createdAt") ?? "").localeCompare(
        getRecordString(right.record, "createdAt") ?? "",
      ),
    )[0];
  if (!candidate) return;

  const recordMetadata = isObject(candidate.record.metadata)
    ? candidate.record.metadata
    : {};
  const worktree = isObject(recordMetadata.worktree)
    ? recordMetadata.worktree
    : undefined;
  const cwd =
    getRecordString(candidate.record, "cwd") ??
    firstStringValue(worktree?.path);
  if (!cwd || !fs.existsSync(cwd)) {
    touchCodeAgentRunRecord(candidate.runId, {
      status: "paused",
      phase: "worktree-unavailable",
      metadata: {
        worktree: {
          ...(worktree ?? {}),
          state: "recoverable",
          queueState: undefined,
        },
      },
    });
    return;
  }

  try {
    if (
      !claimCodeAgentWorktreeRun({
        registryPath: codeAgentWorktreeRegistryFile(),
        worktreeId,
        runId: candidate.runId,
        ownerId: codeAgentWorktreeLeaseOwnerId,
      })
    ) {
      return;
    }
  } catch (error) {
    touchCodeAgentRunRecord(candidate.runId, {
      status: "paused",
      phase: "worktree-unavailable",
      metadata: {
        worktree: {
          ...(worktree ?? {}),
          state: "recoverable",
          queueState: undefined,
          lastCleanupError:
            error instanceof Error ? error.message : String(error),
        },
      },
    });
    return;
  }

  startingCodeAgentWorktreeRuns.add(worktreeId);
  touchCodeAgentRunRecord(candidate.runId, {
    metadata: {
      worktree: {
        ...(worktree ?? {}),
        queueState: "starting",
      },
    },
  });
  try {
    await spawnCodeAgentRunner(
      candidate.runId,
      cwd,
      readCodeAgentPermissionMode(candidate.record),
    );
  } finally {
    startingCodeAgentWorktreeRuns.delete(worktreeId);
    const current = readCodeAgentRunRecord(candidate.runId);
    if (current && isTerminalCodeAgentRun(current)) {
      reclaimTerminalCodeAgentWorktree(current);
    }
    void startNextQueuedCodeAgentWorktreeRun(worktreeId);
  }
}

function cleanupDueManagedCodeAgentWorktrees(): void {
  try {
    reconcileManagedCodeAgentWorktreeLeases();
    cleanupDueCodeAgentWorktrees({
      registryPath: codeAgentWorktreeRegistryFile(),
      canRemove: (worktree) => !activeCodeAgentRunUsesWorktree(worktree),
      onWorktreeStateChanged: syncManagedWorktreeStateToRuns,
    });
  } catch (error) {
    console.warn(
      "[code-agents] Could not sweep expired worktrees:",
      error instanceof Error ? error.message : error,
    );
  }
}

function reclaimTerminalCodeAgentWorktree(
  record: Record<string, unknown> | null,
): void {
  if (!record || !isTerminalCodeAgentRun(record)) return;
  const metadata = isObject(record.metadata) ? record.metadata : undefined;
  if (metadata?.retainWorktree === true || metadata?.keepWorktree === true) {
    return;
  }
  const worktree = isObject(metadata?.worktree) ? metadata.worktree : undefined;
  if (!worktree || worktree.retain === true || worktree.keep === true) {
    return;
  }
  const sourcePath = firstStringValue(worktree.sourcePath);
  const worktreePath = firstStringValue(worktree.path);
  const branch = firstStringValue(worktree.branch);
  const baseCommit = firstStringValue(worktree.baseCommit);
  if (!sourcePath || !worktreePath || !branch) return;

  const runId = getRecordString(record, "id");
  const managedId = firstStringValue(worktree.id);
  if (managedId && runId) {
    try {
      const released = releaseCodeAgentWorktree({
        registryPath: codeAgentWorktreeRegistryFile(),
        worktreeId: managedId,
        runId,
        cleanupAfter:
          firstStringValue(worktree.policy) === "named"
            ? undefined
            : new Date(Date.now() + CODE_AGENT_EPHEMERAL_WORKTREE_RETENTION_MS),
      });
      if (released) {
        touchCodeAgentRunRecord(runId, {
          metadata: {
            worktree: codeAgentWorktreeMetadata(released),
          },
        });
        void startNextQueuedCodeAgentWorktreeRun(released.id);
      }
    } catch (error) {
      console.warn(
        `[code-agents] Could not release worktree for run ${runId}:`,
        error instanceof Error ? error.message : error,
      );
    }
    return;
  }

  // Older runs predate the registry. Keep their worktrees recoverable for the
  // same retention window and only remove them after checking for dirty files.
  if (!runId) return;
  const cleanupAfter = firstStringValue(worktree.cleanupAfter);
  if (!cleanupAfter) {
    touchCodeAgentRunRecord(runId, {
      metadata: {
        worktree: {
          ...worktree,
          policy: "ephemeral",
          state: "cleanup-pending",
          cleanupAfter: new Date(
            Date.now() + CODE_AGENT_EPHEMERAL_WORKTREE_RETENTION_MS,
          ).toISOString(),
        },
      },
    });
    return;
  }
  if (new Date(cleanupAfter).getTime() > Date.now()) return;
  if (
    listRawCodeAgentRunRecords().some(({ record: candidate }) => {
      if (candidate === record || !isActiveDesktopCodeAgentRun(candidate))
        return false;
      const metadata = isObject(candidate.metadata)
        ? candidate.metadata
        : undefined;
      const candidateWorktree = isObject(metadata?.worktree)
        ? metadata.worktree
        : undefined;
      return (
        path.resolve(firstStringValue(candidateWorktree?.path) ?? "") ===
        path.resolve(worktreePath)
      );
    })
  ) {
    return;
  }

  try {
    const hasUncommittedChanges =
      fs.existsSync(worktreePath) &&
      codeAgentWorktreeHasChanges({ path: worktreePath });
    const hasCommittedChanges = baseCommit
      ? codeAgentWorktreeHasCommitsAfterBase({
          sourcePath,
          branch,
          baseCommit,
        })
      : true;
    if (hasUncommittedChanges || hasCommittedChanges) {
      touchCodeAgentRunRecord(runId, {
        metadata: {
          worktree: {
            ...worktree,
            state: "recoverable",
            lastCleanupError: !baseCommit
              ? "The worktree base could not be verified; it was kept for recovery."
              : hasCommittedChanges
                ? "Worktree contains commits after its base; it was kept for recovery."
                : "Worktree has uncommitted changes; it was kept for recovery.",
          },
        },
      });
      return;
    }
    const result = cleanupCodeAgentWorktree({
      sourcePath,
      path: worktreePath,
      branch,
    });
    if (!result.worktreeRemoved || !result.branchRemoved) {
      console.warn(
        `[code-agents] Could not fully reclaim worktree for run ${getRecordString(record, "id") ?? "unknown"}.`,
      );
    } else {
      touchCodeAgentRunRecord(runId, {
        metadata: {
          worktree: {
            ...worktree,
            state: "removed",
          },
        },
      });
    }
  } catch (error) {
    console.warn(
      `[code-agents] Could not reclaim worktree for run ${getRecordString(record, "id") ?? "unknown"}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

function reclaimTerminalCodeAgentWorktrees(goalId?: string): void {
  for (const { record } of listRawCodeAgentRunRecords(goalId)) {
    reclaimTerminalCodeAgentWorktree(record);
  }
  cleanupDueManagedCodeAgentWorktrees();
}

function resumeQueuedCodeAgentWorktreeRuns(): void {
  const worktreeIds = new Set<string>();
  for (const { record } of listRawCodeAgentRunRecords()) {
    if (!isQueuedCodeAgentWorktreeRun(record)) continue;
    const worktreeId = codeAgentWorktreeIdFromRunRecord(record);
    if (worktreeId) worktreeIds.add(worktreeId);
  }
  for (const worktreeId of worktreeIds) {
    void startNextQueuedCodeAgentWorktreeRun(worktreeId);
  }
}

function reconcileInterruptedCodeAgentRuns(
  reason: "startup" | "list" | "read" | "follow-up" | "shutdown",
  goalId?: string,
): void {
  for (const { runId, record } of listRawCodeAgentRunRecords(goalId)) {
    reconcileInterruptedCodeAgentRun(runId, reason, record);
  }
}

function reconcileInterruptedCodeAgentRun(
  runId: string,
  reason: "startup" | "list" | "read" | "follow-up" | "shutdown",
  record = readCodeAgentRunRecord(runId),
): void {
  let currentRecord = record;
  if (
    !currentRecord ||
    (reason !== "shutdown" &&
      isCodeAgentRunnerInFlight(
        runId,
        activeCodeAgentProcesses,
        startingCodeAgentRuns,
      ))
  )
    return;
  if (isPortalCodeAgentRunRecord(currentRecord)) return;
  if (!isDesktopCodeAgentRunInterruptible(currentRecord)) return;
  if (reason !== "shutdown" && hasLivePersistedCodeAgentRunner(currentRecord))
    return;

  if (isQueuedCodeAgentWorktreeRun(currentRecord)) return;

  currentRecord = readCodeAgentRunRecord(runId) ?? currentRecord;
  if (
    reason !== "shutdown" &&
    (isCodeAgentRunnerInFlight(
      runId,
      activeCodeAgentProcesses,
      startingCodeAgentRuns,
    ) ||
      hasLivePersistedCodeAgentRunner(currentRecord))
  )
    return;
  if (!isDesktopCodeAgentRunInterruptible(currentRecord)) return;

  const now = new Date().toISOString();
  const approvalInterrupted = isDesktopCodeAgentApprovalRunner(currentRecord);
  appendCodeAgentStatusEvent(
    runId,
    approvalInterrupted
      ? "Agent-Native Code approval was interrupted before it finished."
      : reason === "shutdown"
        ? "Agent-Native Code paused because Desktop closed."
        : "Agent-Native Code was interrupted because Desktop restarted before this run finished.",
    {
      source: "desktop-runner",
      status: approvalInterrupted ? "needs-approval" : "paused",
      phase: approvalInterrupted ? "approval-required" : "stopped",
      reason,
    },
  );
  touchCodeAgentRunRecord(runId, {
    updatedAt: now,
    status: approvalInterrupted ? "needs-approval" : "paused",
    phase: approvalInterrupted ? "approval-required" : "stopped",
    needsApproval: approvalInterrupted,
    progress: approvalInterrupted
      ? {
          label: "Approval required",
          completed: 0,
          total: 1,
          percent: 50,
        }
      : {
          label: "Paused",
          completed: 0,
          total: 1,
          percent: 0,
        },
    metadata: {
      runnerState: "interrupted",
      runnerInterruptedAt: now,
      runnerInterruptReason: reason,
      staleRunnerPid: readPersistedCodeAgentRunnerPid(currentRecord),
      pendingFollowUps: undefined,
    },
  });
}

function isDesktopCodeAgentRunInterruptible(
  record: Record<string, unknown>,
): boolean {
  const status = getRecordString(record, "status");
  const phase = getRecordString(record, "phase");
  return Boolean(
    status === "queued" ||
    status === "running" ||
    phase === "queued" ||
    phase === "retry-queued" ||
    phase === "executing" ||
    phase === "follow-up" ||
    phase === "approval-running",
  );
}

function isDesktopCodeAgentApprovalRunner(
  record: Record<string, unknown>,
): boolean {
  const metadata = isObject(record.metadata) ? record.metadata : undefined;
  return Boolean(
    getRecordString(record, "phase") === "approval-running" ||
    isObject(metadata?.pendingApproval) ||
    record.needsApproval === true,
  );
}

function hasLivePersistedCodeAgentRunner(
  record: Record<string, unknown>,
): boolean {
  const pid = readPersistedCodeAgentRunnerPid(record);
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPersistedCodeAgentRunnerPid(
  record: Record<string, unknown>,
): number | undefined {
  const metadata = isObject(record.metadata) ? record.metadata : undefined;
  return (
    readRecordNumber(metadata, "runnerPid") ??
    readRecordNumber(record, "runnerPid")
  );
}

function readRecordNumber(
  record: Record<string, unknown> | null | undefined,
  key: string,
): number | undefined {
  if (!record) return undefined;
  const value = Number(record[key]);
  return Number.isFinite(value) ? value : undefined;
}

function backgroundRunToDesktopRun(record: BackgroundAgentRun): CodeAgentRun {
  const metadata: Record<string, unknown> = {
    ...(record.metadata ?? {}),
    artifactRoot: record.artifactRoot,
    cwd: record.cwd,
  };
  const worktree = isObject(metadata.worktree) ? metadata.worktree : undefined;
  const worktreePath = firstStringValue(worktree?.path);
  if (worktree && worktreePath && !fs.existsSync(worktreePath)) {
    metadata.worktree = {
      ...worktree,
      state: "recoverable",
    };
  }
  if (record.permissionMode) metadata.permissionMode = record.permissionMode;
  const activeProcess = activeCodeAgentProcesses.get(record.id);
  if (activeProcess) {
    metadata.runnerState = "running";
    metadata.runnerPid = activeProcess.pid;
    metadata.runnerStartedAt = activeProcess.startedAt;
  }
  return {
    id: record.id,
    goalId: record.goalId,
    title: record.title,
    subtitle: record.subtitle,
    kind: record.kind,
    source: record.source,
    sourceLabel: record.sourceLabel,
    status: record.status,
    phase: record.phase,
    needsApproval: record.needsApproval,
    progress: record.progress,
    details: record.details,
    surfaceUrl: record.surfaceUrl,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}

function readJsonObjectFile(filePath: string): Record<string, unknown> | null {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    return isObject(raw) ? raw : null;
  } catch {
    return null;
  }
}

function readCodeAgentRunRecord(runId: string): Record<string, unknown> | null {
  const filePath = codeAgentRunFilePath(runId);
  if (!filePath || !fs.existsSync(filePath)) return null;
  return readJsonObjectFile(filePath);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function firstStringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return undefined;
}

function transcriptTextFromUnknown(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() ? value : undefined;
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => {
        if (typeof item === "string") return item;
        if (!isObject(item)) return "";
        return (
          firstTranscriptTextValue(item.text, item.content, item.message) ?? ""
        );
      })
      .filter((part) => part.trim());
    return parts.length > 0 ? parts.join("\n") : undefined;
  }
  if (isObject(value)) {
    return firstTranscriptTextValue(value.text, value.content, value.message);
  }
  return undefined;
}

function firstTranscriptTextValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = transcriptTextFromUnknown(value);
    if (text) return text;
  }
  return undefined;
}

function getRecordString(
  record: Record<string, unknown> | null | undefined,
  key: string,
): string | undefined {
  if (!record) return undefined;
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readCodeAgentPermissionMode(
  record: Record<string, unknown> | null | undefined,
): CodeAgentPermissionMode | undefined {
  const metadata = isObject(record?.metadata) ? record.metadata : undefined;
  return getCodeAgentPermissionMode(
    firstStringValue(metadata?.permissionMode, record?.permissionMode),
  );
}

function normalizeCodeAgentPromptAttachments(
  value: unknown,
): CodeAgentPromptAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const attachments = value
    .map((item) => {
      if (!isObject(item)) return null;
      const name = firstStringValue(item.name);
      if (!name) return null;
      const size = Number(item.size);
      const attachment: CodeAgentPromptAttachment = { name };
      const type = firstStringValue(item.type);
      const text = firstStringValue(item.text);
      const dataUrl = firstStringValue(item.dataUrl);
      if (type) attachment.type = type;
      if (Number.isFinite(size) && size >= 0) attachment.size = size;
      if (text) attachment.text = text;
      if (dataUrl) attachment.dataUrl = dataUrl;
      return attachment;
    })
    .filter((item): item is CodeAgentPromptAttachment => item !== null);
  return attachments.length > 0 ? attachments : undefined;
}

function readCodeAgentAttempt(
  record: Record<string, unknown> | null | undefined,
): number {
  const metadata = isObject(record?.metadata) ? record.metadata : undefined;
  const queue = isObject(record?.queue)
    ? record.queue
    : isObject(metadata?.queue)
      ? metadata.queue
      : undefined;
  const value = Number(queue?.attempt ?? metadata?.attempt);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function isActiveDesktopCodeAgentRun(
  record: Record<string, unknown> | null | undefined,
): boolean {
  const metadata = isObject(record?.metadata) ? record.metadata : undefined;
  const runnerState = getRecordString(metadata, "runnerState");
  if (
    runnerState === "exited" ||
    runnerState === "failed" ||
    runnerState === "interrupted" ||
    runnerState === "stopped"
  ) {
    return false;
  }
  const status = getRecordString(record, "status");
  const phase = getRecordString(record, "phase");
  return Boolean(
    status === "queued" ||
    status === "running" ||
    status === "needs-approval" ||
    phase === "queued" ||
    phase === "executing" ||
    phase === "approval-required",
  );
}

function countQueuedCodeAgentRuns(goalId: string): number {
  return listDesktopCodeAgentRuns(goalId).filter(
    (run) => run.status === "queued",
  ).length;
}

function buildCodeAgentQueueMetadata(input: {
  goalId: string;
  queuedAt: string;
  attempt?: number;
  retryOf?: string;
  rerunOf?: string;
}): CodeAgentQueueMetadata {
  return {
    queued: true,
    queuedAt: input.queuedAt,
    queuedBy: "desktop",
    queueId: `desktop-${timestampSlug(input.queuedAt)}-${randomUUID().slice(0, 8)}`,
    queuePosition: countQueuedCodeAgentRuns(input.goalId) + 1,
    attempt: input.attempt ?? 1,
    retryOf: input.retryOf,
    rerunOf: input.rerunOf,
  };
}

function buildCodeAgentSteeringMetadata(input: {
  cwd?: string;
  permissionMode?: CodeAgentPermissionMode;
  engine?: string;
  model?: string;
  effort?: string;
  attachments?: CodeAgentPromptAttachment[];
}): CodeAgentSteeringMetadata {
  return {
    cwd: input.cwd,
    permissionMode: input.permissionMode,
    engine: input.engine,
    model: input.model,
    effort: input.effort,
    attachments: input.attachments,
  };
}

function normalizeTranscriptEventType(
  value: unknown,
  row: Record<string, unknown>,
): CodeAgentTranscriptEventType {
  const raw = typeof value === "string" ? value.toLowerCase() : "";
  const artifact = isObject(row.artifact) ? row.artifact : undefined;
  if (raw === "user" || raw === "human" || raw === "prompt") return "user";
  if (
    raw.includes("artifact") ||
    raw === "file" ||
    raw === "output" ||
    firstStringValue(
      row.artifactPath,
      row.artifactUrl,
      row.filePath,
      row.path,
      artifact?.path,
      artifact?.url,
    )
  ) {
    return "artifact";
  }
  if (
    raw.includes("status") ||
    raw.includes("progress") ||
    raw.includes("state") ||
    raw === "queued" ||
    raw === "running" ||
    raw === "completed" ||
    raw === "errored" ||
    typeof row.status === "string" ||
    typeof row.phase === "string"
  ) {
    return "status";
  }
  return "system";
}

function normalizeEventTimestamp(value: unknown, fallback: string): string {
  const candidate = firstStringValue(value);
  if (!candidate) return fallback;
  const time = new Date(candidate).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : fallback;
}

function normalizeCodeAgentTranscriptEvent(
  value: unknown,
  runId: string,
  fallback: { createdAt: string; idSuffix: string; source?: string },
): CodeAgentTranscriptEvent | null {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;
    return {
      id: `${runId}-${fallback.idSuffix}`,
      runId,
      type: "system",
      text,
      createdAt: fallback.createdAt,
      metadata: fallback.source ? { source: fallback.source } : undefined,
    };
  }

  if (!isObject(value)) return null;
  const row = value;
  const artifact = isObject(row.artifact) ? row.artifact : undefined;
  const type = normalizeTranscriptEventType(
    row.type ?? row.kind ?? row.role ?? row.category ?? row.event,
    row,
  );
  const artifactPath = firstStringValue(
    row.artifactPath,
    row.filePath,
    row.path,
    row.file,
    artifact?.path,
    artifact?.filePath,
  );
  const artifactUrl = firstStringValue(row.artifactUrl, row.url, artifact?.url);
  const statusText = firstStringValue(row.status, row.state, row.phase);
  const title = firstStringValue(
    row.title,
    row.label,
    row.name,
    type === "status" ? statusText : undefined,
    type === "artifact" ? "Artifact" : undefined,
  );
  const text =
    firstTranscriptTextValue(
      row.text,
      row.content,
      row.message,
      row.body,
      row.summary,
      row.description,
    ) ??
    statusText ??
    artifactPath ??
    artifactUrl ??
    title;
  if (!text) return null;

  const metadata = isObject(row.metadata)
    ? { ...(row.metadata as Record<string, unknown>) }
    : {};
  if (fallback.source && metadata.source === undefined) {
    metadata.source = fallback.source;
  }
  // Prefer the structured signal the executor stamps on credential-gap
  // events; carry it through so the renderer can detect the condition
  // without regex-matching `text` (see isCredentialGapCodeAgentEvent).
  const signal = row.signal === "credential-gap" ? "credential-gap" : undefined;

  return {
    id:
      firstStringValue(row.id, row.eventId) ?? `${runId}-${fallback.idSuffix}`,
    runId: firstStringValue(row.runId) ?? runId,
    type,
    title,
    text,
    createdAt: normalizeEventTimestamp(
      row.createdAt ?? row.timestamp ?? row.time ?? row.date,
      fallback.createdAt,
    ),
    artifactPath,
    artifactUrl,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    ...(signal ? { signal } : {}),
  };
}

function readInlineCodeAgentTranscriptEvents(
  runId: string,
  runRecord: Record<string, unknown> | null,
): CodeAgentTranscriptEvent[] {
  if (!runRecord) return [];
  const createdAt =
    getRecordString(runRecord, "createdAt") ?? new Date().toISOString();
  const eventSources = [
    runRecord.events,
    runRecord.transcript,
    runRecord.timeline,
  ];
  const events: CodeAgentTranscriptEvent[] = [];
  for (const source of eventSources) {
    if (!Array.isArray(source)) continue;
    source.forEach((entry, index) => {
      const event = normalizeCodeAgentTranscriptEvent(entry, runId, {
        createdAt,
        idSuffix: `inline-${events.length}-${index}`,
        source: "run-record",
      });
      if (event) events.push(event);
    });
  }
  return events;
}

function readJsonlCodeAgentTranscriptEvents(
  filePath: string,
  runId: string,
): CodeAgentTranscriptEvent[] {
  if (!fs.existsSync(filePath)) return [];
  const createdAt = new Date().toISOString();
  return fs
    .readFileSync(filePath, "utf-8")
    .split(/\r?\n/)
    .map((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return null;
      let parsed: unknown = trimmed;
      try {
        parsed = JSON.parse(trimmed) as unknown;
      } catch {
        parsed = trimmed;
      }
      return normalizeCodeAgentTranscriptEvent(parsed, runId, {
        createdAt,
        idSuffix: `jsonl-${index}`,
        source: filePath,
      });
    })
    .filter((event): event is CodeAgentTranscriptEvent => Boolean(event));
}

interface TailedJsonlResult {
  events: CodeAgentTranscriptEvent[];
  nextOffset: number;
}

/**
 * Reads only the bytes appended to a JSONL file since the last read.
 * Returns the new events and the updated file offset for the next call.
 * Falls back to a full read when offset is 0 (first call) or the file
 * was truncated (file size < offset).
 */
function tailJsonlCodeAgentTranscriptEvents(
  filePath: string,
  runId: string,
  offset: number,
): TailedJsonlResult {
  if (!fs.existsSync(filePath)) return { events: [], nextOffset: offset };
  try {
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    // File was truncated or rotated — fall back to full read.
    if (fileSize < offset) {
      const events = readJsonlCodeAgentTranscriptEvents(filePath, runId);
      return { events, nextOffset: fileSize };
    }
    // Nothing new.
    if (fileSize === offset) return { events: [], nextOffset: offset };
    const byteCount = fileSize - offset;
    const buf = Buffer.allocUnsafe(byteCount);
    const fd = fs.openSync(filePath, "r");
    try {
      fs.readSync(fd, buf, 0, byteCount, offset);
    } finally {
      fs.closeSync(fd);
    }
    const chunk = buf.toString("utf-8");
    const createdAt = new Date().toISOString();
    const events: CodeAgentTranscriptEvent[] = [];
    // We may have a partial line at the end (write in progress). Only process
    // complete lines; save the remainder for the next tail call by adjusting
    // the returned offset backward.
    const lines = chunk.split(/\r?\n/);
    // If the chunk doesn't end with a newline, the last element is an
    // incomplete line — don't parse it, and walk the offset back.
    const hasTrailingNewline = chunk.endsWith("\n") || chunk.endsWith("\r\n");
    const completeLines = hasTrailingNewline ? lines : lines.slice(0, -1);
    const incompleteByteCount = hasTrailingNewline
      ? 0
      : Buffer.byteLength(lines.at(-1) ?? "", "utf-8");
    for (const line of completeLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: unknown = trimmed;
      try {
        parsed = JSON.parse(trimmed) as unknown;
      } catch {
        parsed = trimmed;
      }
      const event = normalizeCodeAgentTranscriptEvent(parsed, runId, {
        createdAt,
        idSuffix: `tail-${events.length}`,
        source: filePath,
      });
      if (event) events.push(event);
    }
    return {
      events,
      nextOffset: fileSize - incompleteByteCount,
    };
  } catch {
    // On any error fall back to nothing — next full flush will reconcile.
    return { events: [], nextOffset: offset };
  }
}

function codeAgentTranscriptFileCandidates(
  runId: string,
  runRecord: Record<string, unknown> | null,
): string[] {
  const metadata = isObject(runRecord?.metadata) ? runRecord.metadata : null;
  const artifactRoot =
    getRecordString(runRecord, "artifactRoot") ??
    getRecordString(metadata, "artifactRoot");
  const candidates = [
    codeAgentEventFilePath(runId),
    path.join(codeAgentStoreRoot(), "events", `${runId}.jsonl`),
    path.join(codeAgentRunsDir(), `${runId}.events.jsonl`),
    path.join(codeAgentRunsDir(), `${runId}.transcript.jsonl`),
    path.join(codeAgentStoreRoot(), "artifacts", runId, "events.jsonl"),
    path.join(codeAgentStoreRoot(), "artifacts", runId, "transcript.jsonl"),
    artifactRoot ? path.join(artifactRoot, "events.jsonl") : null,
    artifactRoot ? path.join(artifactRoot, "transcript.jsonl") : null,
  ].filter((filePath): filePath is string => Boolean(filePath));
  return [...new Set(candidates)];
}

function sortTranscriptEvents(
  events: CodeAgentTranscriptEvent[],
): CodeAgentTranscriptEvent[] {
  const seen = new Set<string>();
  return events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => {
      const key = `${event.id}:${event.createdAt}:${event.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const aTime = new Date(a.event.createdAt).getTime();
      const bTime = new Date(b.event.createdAt).getTime();
      if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
        return aTime - bTime;
      }
      return a.index - b.index;
    })
    .map(({ event }) => event);
}

function readAllCodeAgentTranscript(input: unknown): CodeAgentTranscriptResult {
  const record: Record<string, unknown> =
    typeof input === "string" ? { runId: input } : isObject(input) ? input : {};
  const runId = normalizeCodeAgentRunId(record.runId);
  if (!runId) {
    return {
      status: "unavailable",
      events: [],
      error: "Missing or invalid run id.",
    };
  }

  const runRecord = readCodeAgentRunRecord(runId);
  const events = [
    ...readInlineCodeAgentTranscriptEvents(runId, runRecord),
    ...codeAgentTranscriptFileCandidates(runId, runRecord).flatMap((filePath) =>
      readJsonlCodeAgentTranscriptEvents(filePath, runId),
    ),
  ];
  return {
    status: "ok",
    runId,
    events: sortTranscriptEvents(events),
    eventFile: codeAgentEventFilePath(runId) ?? undefined,
  };
}

function readCodeAgentTranscript(input: unknown): CodeAgentTranscriptResult {
  const result = readAllCodeAgentTranscript(input);
  return {
    ...result,
    events: boundedCodeAgentTranscriptEvents(result.events, result.runId),
  };
}

const codeAgentTranscriptSubscriptions = new Map<
  string,
  CodeAgentTranscriptSubscription
>();
const codeAgentAssistantDeltaSeq = new Map<string, number>();

function codeAgentTranscriptEventKey(event: CodeAgentTranscriptEvent): string {
  return `${event.id}\u0000${event.createdAt}\u0000${event.text}`;
}

function readCodeAgentTranscriptSeq(event: CodeAgentTranscriptEvent): number {
  const seq = event.metadata?.seq;
  return typeof seq === "number" && Number.isFinite(seq) ? seq : 0;
}

function nextCodeAgentAssistantDeltaSeq(runId: string): number {
  const current = codeAgentAssistantDeltaSeq.get(runId);
  if (current !== undefined) {
    const next = current + 1;
    codeAgentAssistantDeltaSeq.set(runId, next);
    return next;
  }
  const transcript = readCodeAgentTranscript({ runId });
  const maxSeq = transcript.events.reduce(
    (max, event) => Math.max(max, readCodeAgentTranscriptSeq(event)),
    0,
  );
  const next = maxSeq + 1;
  codeAgentAssistantDeltaSeq.set(runId, next);
  return next;
}

function appendCodeAgentAssistantDeltaEvent(runId: string, text: string): void {
  if (!text.trim()) return;
  const now = new Date().toISOString();
  const seq = nextCodeAgentAssistantDeltaSeq(runId);
  appendCodeAgentTranscriptEvent({
    id: `event-${timestampSlug(now)}-${randomUUID().slice(0, 8)}`,
    runId,
    type: "system",
    title: "Assistant",
    text,
    createdAt: now,
    metadata: {
      source: "runner-stdout",
      type: "assistant_delta",
      seq,
      stream: "stdout",
    },
  });
}

function initializeCodeAgentTranscriptSubscriptionKeys(
  subscription: CodeAgentTranscriptSubscription,
): CodeAgentTranscriptResult {
  const tailFile = codeAgentEventFilePath(subscription.runId);
  if (tailFile) {
    subscription.tailedFilePath = tailFile;
    try {
      subscription.fileOffset = fs.existsSync(tailFile)
        ? fs.statSync(tailFile).size
        : 0;
    } catch {
      subscription.fileOffset = 0;
    }
  }

  const fullResult = readAllCodeAgentTranscript({ runId: subscription.runId });
  subscription.knownEventKeys = new Set(
    fullResult.events.map(codeAgentTranscriptEventKey),
  );
  return {
    ...fullResult,
    events: boundedCodeAgentTranscriptEvents(
      fullResult.events,
      fullResult.runId,
    ),
  };
}

function removeCodeAgentTranscriptSubscription(subscriptionId: string): void {
  const subscription = codeAgentTranscriptSubscriptions.get(subscriptionId);
  if (!subscription) return;
  if (subscription.flushTimer) clearTimeout(subscription.flushTimer);
  subscription.watcher?.close();
  codeAgentTranscriptSubscriptions.delete(subscriptionId);
}

function sendCodeAgentTranscriptSubscriptionBatch(
  subscription: CodeAgentTranscriptSubscription,
  batch: Omit<CodeAgentTranscriptSubscriptionBatch, "subscriptionId">,
): void {
  const target = webContents.fromId(subscription.senderId);
  if (!target || target.isDestroyed()) {
    removeCodeAgentTranscriptSubscription(subscription.id);
    return;
  }
  target.send(CODE_AGENTS_TRANSCRIPT_EVENTS_CHANNEL, {
    subscriptionId: subscription.id,
    ...batch,
  } satisfies CodeAgentTranscriptSubscriptionBatch);
}

function flushCodeAgentTranscriptSubscription(
  subscription: CodeAgentTranscriptSubscription,
  reason: string,
): void {
  subscription.flushTimer = undefined;

  // Fast path: use byte-offset tailing on the primary event file.
  // This avoids re-reading the entire JSONL file on every watch event.
  if (subscription.tailedFilePath && subscription.fileOffset !== undefined) {
    const { events: tailedEvents, nextOffset } =
      tailJsonlCodeAgentTranscriptEvents(
        subscription.tailedFilePath,
        subscription.runId,
        subscription.fileOffset,
      );
    subscription.fileOffset = nextOffset;
    // Deduplicate against known keys (handles rare duplicates or inline events).
    const newEvents = tailedEvents.filter((event) => {
      const key = codeAgentTranscriptEventKey(event);
      if (subscription.knownEventKeys.has(key)) return false;
      subscription.knownEventKeys.add(key);
      return true;
    });
    if (newEvents.length > 0) {
      sendCodeAgentTranscriptSubscriptionBatch(subscription, {
        status: "ok",
        runId: subscription.runId,
        events: boundedCodeAgentTranscriptEvents(newEvents, subscription.runId),
        eventFile: subscription.tailedFilePath,
        reason,
      });
    }
    return;
  }

  // Fallback path: full re-read (used when no primary file is established,
  // e.g. run records with inline events only).
  const result = readAllCodeAgentTranscript({ runId: subscription.runId });
  const nextKnownEventKeys = new Set<string>();
  const events: CodeAgentTranscriptEvent[] = [];

  for (const event of result.events) {
    const key = codeAgentTranscriptEventKey(event);
    nextKnownEventKeys.add(key);
    if (!subscription.knownEventKeys.has(key)) events.push(event);
  }

  subscription.knownEventKeys = nextKnownEventKeys;
  if (events.length === 0 && result.status === "ok" && !result.error) return;

  sendCodeAgentTranscriptSubscriptionBatch(subscription, {
    status: result.status,
    runId: result.runId ?? subscription.runId,
    events: boundedCodeAgentTranscriptEvents(
      events,
      result.runId ?? subscription.runId,
    ),
    eventFile: result.eventFile,
    reason,
    error: result.error,
  });
}

function scheduleCodeAgentTranscriptSubscriptionFlush(
  subscription: CodeAgentTranscriptSubscription,
  reason: string,
): void {
  subscription.reason = reason;
  if (subscription.flushTimer) return;
  subscription.flushTimer = setTimeout(() => {
    flushCodeAgentTranscriptSubscription(
      subscription,
      subscription.reason ?? reason,
    );
  }, 40);
}

function notifyCodeAgentTranscriptChanged(runId: string, reason: string): void {
  for (const subscription of codeAgentTranscriptSubscriptions.values()) {
    if (subscription.runId !== runId) continue;
    scheduleCodeAgentTranscriptSubscriptionFlush(subscription, reason);
  }
}

function watchCodeAgentTranscriptSubscription(
  subscription: CodeAgentTranscriptSubscription,
): void {
  const eventFile = codeAgentEventFilePath(subscription.runId);
  if (!eventFile) return;
  const dir = path.dirname(eventFile);
  const fileName = path.basename(eventFile);
  try {
    fs.mkdirSync(dir, { recursive: true });
    subscription.watcher = fs.watch(dir, (_eventType, changedFile) => {
      const changedName = changedFile ? String(changedFile) : "";
      if (changedName && changedName !== fileName) return;
      scheduleCodeAgentTranscriptSubscriptionFlush(subscription, "file-watch");
    });
  } catch {
    // readTranscript remains the compatibility fallback when file watching
    // is unavailable for this filesystem.
  }
}

function readLatestCodeAgentUserPrompt(runId: string): string | undefined {
  const transcript = readCodeAgentTranscript({ runId });
  for (let index = transcript.events.length - 1; index >= 0; index -= 1) {
    const event = transcript.events[index];
    if (event.type === "user" && event.text.trim()) {
      return event.text.trim();
    }
  }
  return undefined;
}

function createDesktopUserTranscriptEvent(
  runId: string,
  prompt: string,
  goalId?: string,
  metadata: Record<string, unknown> = {},
): CodeAgentTranscriptEvent {
  const now = new Date().toISOString();
  return {
    id: `event-${timestampSlug(now)}-${randomUUID().slice(0, 8)}`,
    runId,
    type: "user",
    title: "User prompt",
    text: prompt,
    createdAt: now,
    metadata: {
      source: "desktop",
      queued: true,
      queuedAt: now,
      ...(goalId ? { goalId } : {}),
      ...metadata,
    },
  };
}

function appendCodeAgentTranscriptEvent(
  event: CodeAgentTranscriptEvent,
): string {
  const eventFile = codeAgentEventFilePath(event.runId);
  if (!eventFile) throw new Error("Invalid run id.");
  const persistedEvent = {
    schemaVersion: 1,
    role: event.type,
    ...event,
    kind: event.type,
    message: event.text,
  };
  appendUniqueJsonLineAtomically(
    eventFile,
    persistedEvent,
    (value) =>
      isObject(value) && typeof value.id === "string"
        ? (value as typeof persistedEvent)
        : null,
    { lock: DESKTOP_CODE_AGENT_PERSISTENCE_LOCK },
  );
  notifyCodeAgentTranscriptChanged(event.runId, "append");
  return eventFile;
}

const activeCodeAgentProcesses = new Map<
  string,
  {
    pid?: number;
    command: string;
    cwd: string;
    startedAt: string;
    permissionMode: CodeAgentPermissionMode;
  }
>();
const startingCodeAgentRuns = new Set<string>();

const desktopCodeAgentScheduler = new DesktopCodeAgentScheduler({
  defaultCwd: () => resolveCodeAgentsTerminalCwd({}),
  isRunActive: (runId) =>
    activeCodeAgentProcesses.has(runId) || startingCodeAgentRuns.has(runId),
  startRun: (runId, cwd, permissionMode) => {
    void spawnCodeAgentRunner(runId, cwd, permissionMode);
  },
});

function desktopComputerHelperPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "native", "agent-native-computer-helper")
    : path.resolve(__dirname, "../../native/bin/agent-native-computer-helper");
}

async function initializeDesktopComputerMcpBridge(): Promise<void> {
  if (process.platform !== "darwin" || desktopComputerMcpBridge) return;
  const helperPath = desktopComputerHelperPath();
  if (!fs.existsSync(helperPath)) {
    console.warn("[computer-control] bundled macOS helper is unavailable.");
    return;
  }
  const helper = new SwiftDesktopHelperClient(helperPath);
  const broker = new ComputerControlBroker({
    helper,
    permissionStatus: () => getComputerPermissionStatus(systemPreferences),
  });
  const screenObserver = new EphemeralScreenObserver({
    desktopCapturer,
    permissionStatus: () => getComputerPermissionStatus(systemPreferences),
  });
  let browserBridge: BrowserControlLoopbackBridge | undefined;
  const hostEntryPath = app.isPackaged
    ? path.join(
        process.resourcesPath,
        "app.asar",
        "out/main/browser-control-host.js",
      )
    : path.resolve(__dirname, "browser-control-host.js");
  const extensionPath = getBundledChromeExtensionPath();
  try {
    browserBridge = new BrowserControlLoopbackBridge();
    const browserHost = await browserBridge.start();
    desktopBrowserControlBridge = browserBridge;
    browserNativeHostManifestPath = installBrowserNativeHost({
      ...browserHost,
      executablePath: process.execPath,
      hostEntryPath,
      stateDirectory: path.join(app.getPath("userData"), "browser-control"),
      additionalExtensionIds: parseAdditionalChromeExtensionIds(
        process.env[AGENT_NATIVE_BROWSER_EXTENSION_IDS_ENV],
      ),
    }).manifestPath;
  } catch (error) {
    try {
      await browserBridge?.close();
    } catch (closeError) {
      console.warn(
        "[browser-control] failed to close the unavailable Chrome bridge:",
        closeError instanceof Error ? closeError.message : "unknown error",
      );
    }
    browserBridge = undefined;
    desktopBrowserControlBridge = null;
    browserNativeHostManifestPath = null;
    console.warn(
      "[browser-control] Chrome native host installation failed:",
      error instanceof Error ? error.message : "unknown error",
    );
  }
  const bridge = new DesktopComputerMcpBridge({
    broker,
    permissionStatus: () => getComputerPermissionStatus(systemPreferences),
    screenObserver,
    browserBridge,
    browserNativeHostInstalled: () =>
      Boolean(
        browserNativeHostManifestPath &&
        fs.existsSync(browserNativeHostManifestPath),
      ),
    browserExtensionPath: () =>
      fs.existsSync(extensionPath) ? extensionPath : undefined,
    openContentWorkingCopy: ({ folder, name }) => {
      const resolvedFolder = path.resolve(folder);
      const approvedByActiveRun = [...activeCodeAgentProcesses.values()].some(
        (process) => path.resolve(process.cwd) === resolvedFolder,
      );
      if (!approvedByActiveRun) {
        throw new Error(
          "Content can only open the exact working folder of an active local code-agent run.",
        );
      }
      const grant = attachTemporaryContentFilesWorkingCopy(folder, name);
      void sendDesktopShortcutActivation({
        app: "content",
        path: `/local-files?workingCopyId=${encodeURIComponent(grant.id)}`,
      });
      const { path: _path, ...safeFolder } = contentFilesFolderInfo(grant);
      return {
        id: grant.id,
        name: safeFolder.name,
        kind: "temporary",
        repository: safeFolder.repository,
      };
    },
  });
  try {
    await bridge.start();
    desktopComputerMcpBridge = bridge;
  } catch (error) {
    try {
      await browserBridge?.close();
    } catch (closeError) {
      console.warn(
        "[browser-control] failed to close the unavailable Chrome bridge:",
        closeError instanceof Error ? closeError.message : "unknown error",
      );
    }
    desktopBrowserControlBridge = null;
    broker.close();
    console.warn(
      "[computer-control] authenticated loopback bridge could not start:",
      error instanceof Error ? error.message : "unknown error",
    );
  }
}

function desktopComputerChildEnv(
  runId: string,
  permissionMode: CodeAgentPermissionMode,
): NodeJS.ProcessEnv {
  if (!desktopComputerMcpBridge) return {};
  try {
    const registration = desktopComputerMcpBridge.registerRun(
      runId,
      permissionMode,
    );
    return {
      AGENT_NATIVE_DESKTOP_CHILD: "1",
      AGENT_NATIVE_DESKTOP_COMPUTER_MCP_URL: registration.url,
      AGENT_NATIVE_DESKTOP_COMPUTER_MCP_TOKEN: registration.bearerToken,
    };
  } catch (error) {
    console.warn(
      "[computer-control] task registration failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return {};
  }
}

function revokeDesktopComputerRun(runId: string): void {
  void desktopComputerMcpBridge?.revokeRun(runId).catch(() => undefined);
}

function remoteConnectorComputerEnv(): NodeJS.ProcessEnv {
  if (!desktopComputerMcpBridge) return {};
  try {
    const registration = desktopComputerMcpBridge.registerConnector();
    return {
      AGENT_NATIVE_COMPUTER_BRIDGE_URL: registration.url,
      AGENT_NATIVE_COMPUTER_BRIDGE_TOKEN: registration.bearerToken,
      AGENT_NATIVE_COMPUTER_CAPABILITIES: JSON.stringify({
        browser: {
          observe: true,
          control: true,
          provider: "chrome-extension",
          version: "1",
        },
      }),
    };
  } catch {
    return {};
  }
}

function desktopCodeAgentMcpServerId(appId: string): string {
  return `desktop_app_${appId.replace(/[^A-Za-z0-9_]/g, "_")}`;
}

function desktopAppMcpUrl(baseUrl: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL("mcp", base).toString();
}

async function resolveDesktopMcpHost(): Promise<{
  baseUrl: string;
  session: Electron.Session;
} | null> {
  const appConfig = loadAppsForAuthContext().find(
    (candidate) => candidate.id === "dispatch" && candidate.enabled !== false,
  );
  if (!appConfig) return null;
  const baseUrl = resolveAppBaseUrl(appConfig);
  if (!baseUrl) return null;
  return { baseUrl, session: findRemoteRelaySession(baseUrl) };
}

interface DesktopCodeAgentMcpEnvironment {
  env: NodeJS.ProcessEnv;
  remoteConfig:
    | { state: "loaded"; serverCount: number }
    | { state: "unavailable"; error: string };
}

/**
 * Give each local coding run the same workspace app MCP servers shown in its
 * rail, while retaining local/plugin config. Remote settings credentials stay
 * server-side until a capability broker can deliver them to this process.
 */
async function desktopCodeAgentMcpEnvironment(
  cwd: string,
  options: { includeWorkspaceApps?: boolean } = {},
): Promise<DesktopCodeAgentMcpEnvironment> {
  const workspaceRoot = resolveCodeAgentsTerminalCwd({});
  const workspaceConfig = loadMcpConfig(workspaceRoot);
  const localConfig = loadMcpConfig(cwd);
  const servers: Record<string, McpServerConfig> = {
    ...(workspaceConfig?.servers ?? {}),
    ...(localConfig?.servers ?? {}),
  };
  const allowlist = new Set(Object.keys(servers));
  const appIds: string[] = [];
  const remoteConfig: DesktopCodeAgentMcpEnvironment["remoteConfig"] =
    desktopRemoteMcpUnavailable();

  if (options.includeWorkspaceApps === false) {
    return {
      env: {
        MCP_SERVERS: JSON.stringify({
          servers: {
            ...(workspaceConfig?.servers ?? {}),
            ...(localConfig?.servers ?? {}),
          },
        }),
        AGENT_NATIVE_CODE_AGENT_MCP_SERVER_ALLOWLIST:
          [
            ...new Set([
              ...Object.keys(workspaceConfig?.servers ?? {}),
              ...Object.keys(localConfig?.servers ?? {}),
            ]),
          ].join(",") || "__none__",
        AGENT_NATIVE_CODE_AGENT_MCP_APP_IDS: "[]",
        AGENT_NATIVE_CODE_AGENT_SKILLS_ROOT: path.join(
          workspaceRoot,
          ".agents",
          "skills",
        ),
      },
      remoteConfig,
    };
  }

  for (const appConfig of loadAppsForAuthContext()) {
    if (appConfig.enabled === false) continue;
    const baseUrl = resolveAppBaseUrl(appConfig);
    if (!baseUrl) continue;
    const serverId = desktopCodeAgentMcpServerId(appConfig.id);
    const appMcpUrl = desktopAppMcpUrl(baseUrl);
    const appSession = session.fromPartition(`persist:app-${appConfig.id}`);
    const cookieHeader = await cookieHeaderForRelay(appSession, appMcpUrl);
    servers[serverId] = {
      type: "http",
      url: appMcpUrl,
      ...(cookieHeader ? { headers: { Cookie: cookieHeader } } : {}),
      description: `${appConfig.name} workspace app tools`,
    };
    allowlist.add(serverId);
    appIds.push(appConfig.id);
  }

  return {
    env: {
      MCP_SERVERS: JSON.stringify({ servers }),
      AGENT_NATIVE_CODE_AGENT_MCP_SERVER_ALLOWLIST:
        [...allowlist].join(",") || "__none__",
      AGENT_NATIVE_CODE_AGENT_MCP_APP_IDS: JSON.stringify(appIds),
      AGENT_NATIVE_CODE_AGENT_SKILLS_ROOT: path.join(
        workspaceRoot,
        ".agents",
        "skills",
      ),
    },
    remoteConfig,
  };
}

function revokeRemoteConnectorComputerControl(): void {
  revokeDesktopComputerRun("__remote_connector__");
}

function signalCodeAgentProcess(pid: number, signal: NodeJS.Signals): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  if (process.platform !== "win32") {
    try {
      process.kill(-pid, signal);
      return true;
    } catch {
      // Fall back to the child process itself when process groups are unavailable.
    }
  }
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

function pauseActiveCodeAgentProcessesForShutdown(): void {
  for (const [runId, active] of activeCodeAgentProcesses) {
    if (active.pid) signalCodeAgentProcess(active.pid, "SIGTERM");
    reconcileInterruptedCodeAgentRun(runId, "shutdown");
    revokeDesktopComputerRun(runId);
    activeCodeAgentProcesses.delete(runId);
  }
}

const desktopCodeBackgroundAgentController: DesktopBackgroundAgentController = {
  list: listBackgroundAgentRuns,
  get: getBackgroundAgentRun,
  transcript: listBackgroundAgentTranscriptEvents,
  sendFollowUp: sendDesktopCodeBackgroundAgentFollowUp,
  control: controlDesktopCodeBackgroundAgentRun,
};

function appendCodeAgentStatusEvent(
  runId: string,
  message: string,
  metadata: Record<string, unknown> = {},
): void {
  appendCodeAgentTranscriptEvent({
    id: `event-${timestampSlug(new Date().toISOString())}-${randomUUID().slice(0, 8)}`,
    runId,
    type: "status",
    title: "Status",
    text: message,
    createdAt: new Date().toISOString(),
    metadata,
  });
}

function persistCodeAgentChildEvent(
  runId: string,
  source: string,
  persist: () => void,
): void {
  guardCodeAgentPersistence({ runId, source }, persist);
}

async function spawnCodeAgentRunner(
  runId: string,
  cwd: string,
  permissionMode?: CodeAgentPermissionMode,
): Promise<void> {
  if (activeCodeAgentProcesses.has(runId) || startingCodeAgentRuns.has(runId)) {
    return;
  }
  const runRecord = readCodeAgentRunRecord(runId);
  const worktreeId = codeAgentWorktreeIdFromRunRecord(runRecord);
  if (worktreeId) {
    try {
      const claimed = claimCodeAgentWorktreeRun({
        registryPath: codeAgentWorktreeRegistryFile(),
        worktreeId,
        runId,
        ownerId: codeAgentWorktreeLeaseOwnerId,
      });
      if (!claimed) {
        touchCodeAgentRunRecord(runId, {
          status: "queued",
          phase: "queued",
          metadata: {
            worktree: {
              ...(isObject(runRecord?.metadata) &&
              isObject(runRecord.metadata.worktree)
                ? runRecord.metadata.worktree
                : {}),
              queueState: "waiting",
            },
          },
        });
        void startNextQueuedCodeAgentWorktreeRun(worktreeId);
        return;
      }
    } catch (error) {
      touchCodeAgentRunRecord(runId, {
        status: "paused",
        phase: "worktree-unavailable",
        metadata: {
          runnerState: "failed",
          runnerError: error instanceof Error ? error.message : String(error),
        },
      });
      reclaimTerminalCodeAgentWorktree(readCodeAgentRunRecord(runId));
      return;
    }
  }
  startingCodeAgentRuns.add(runId);
  const provider = ensureCodeAgentLlmProvider();
  if (!provider.ok) {
    appendCodeAgentStatusEvent(
      runId,
      "Could not start Agent-Native Code process.",
      {
        source: "desktop-runner",
        error: provider.error,
      },
    );
    touchCodeAgentRunRecord(runId, {
      status: "errored",
      phase: "missing-credentials",
      metadata: {
        runnerState: "failed",
        runnerError: provider.error,
      },
    });
    startingCodeAgentRuns.delete(runId);
    reclaimTerminalCodeAgentWorktree(readCodeAgentRunRecord(runId));
    return;
  }
  const repoRoot = resolveRepositoryRoot(cwd);
  const normalizedPermissionMode =
    permissionMode ??
    readCodeAgentPermissionMode(runRecord) ??
    DEFAULT_CODE_AGENT_PERMISSION_MODE;
  const invocation = resolveCodeAgentRunnerInvocation(
    {
      appIsPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      electronPath: process.execPath,
      repoRoot,
      cwd,
      environment: process.env,
    },
    "run",
    runId,
  );
  const { command, args } = invocation;
  try {
    const runMetadata = isObject(runRecord?.metadata) ? runRecord.metadata : {};
    const isDesktopAppCreation =
      runMetadata.kind === "desktop-create-app" ||
      runMetadata.kind === "desktop-local-code-change";
    const mcpEnvironment = await desktopCodeAgentMcpEnvironment(cwd, {
      includeWorkspaceApps: !isDesktopAppCreation,
    });
    if (mcpEnvironment.remoteConfig.state === "unavailable") {
      appendCodeAgentStatusEvent(
        runId,
        "Connected MCP settings could not be loaded for this chat.",
        {
          source: "desktop-mcp-config",
          error: mcpEnvironment.remoteConfig.error,
        },
      );
    }
    const computerEnv = desktopComputerChildEnv(
      runId,
      normalizedPermissionMode,
    );
    const child = spawn(command, args, {
      cwd: invocation.cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...AppStore.getCodeAgentProviderProcessEnv(process.env),
        AGENT_NATIVE_CODE_AGENTS_HOME: codeAgentStoreRoot(),
        AGENT_NATIVE_CODE_AGENT_PERMISSION_MODE: normalizedPermissionMode,
        ...invocation.env,
        ...mcpEnvironment.env,
        ...computerEnv,
      },
    });
    const runnerStartedAt = new Date().toISOString();
    const runnerCommand = `${command} ${args.join(" ")}`;
    activeCodeAgentProcesses.set(runId, {
      pid: child.pid,
      command: runnerCommand,
      cwd: invocation.cwd,
      startedAt: runnerStartedAt,
      permissionMode: normalizedPermissionMode,
    });
    startingCodeAgentRuns.delete(runId);
    touchCodeAgentRunRecord(runId, {
      status: "running",
      phase: "executing",
      metadata: {
        permissionMode: normalizedPermissionMode,
        runnerState: "running",
        runnerPid: child.pid,
        runnerCommand,
        runnerCwd: invocation.cwd,
        runnerStartedAt,
        ...(isObject(runRecord?.metadata) &&
        isObject(runRecord.metadata.worktree)
          ? {
              worktree: {
                ...runRecord.metadata.worktree,
                queueState: "running",
              },
            }
          : {}),
      },
    });
    child.stdout?.on("data", (chunk) => {
      persistCodeAgentChildEvent(runId, "runner-stdout", () => {
        appendCodeAgentAssistantDeltaEvent(runId, chunk.toString());
      });
    });
    child.stderr?.on("data", (chunk) => {
      persistCodeAgentChildEvent(runId, "runner-stderr", () => {
        appendCodeAgentStatusEvent(runId, chunk.toString().trim(), {
          source: "runner-stderr",
        });
      });
    });
    child.on("exit", (code, signal) => {
      revokeDesktopComputerRun(runId);
      activeCodeAgentProcesses.delete(runId);
      codeAgentAssistantDeltaSeq.delete(runId);
      persistCodeAgentChildEvent(runId, "runner-exit-status", () => {
        appendCodeAgentStatusEvent(
          runId,
          code === 0
            ? "Agent-Native Code process exited."
            : `Agent-Native Code process exited with ${signal ?? code}.`,
          { source: "desktop-runner", code, signal },
        );
      });
      persistCodeAgentChildEvent(runId, "runner-exit-run", () => {
        touchCodeAgentRunRecord(runId, {
          updatedAt: new Date().toISOString(),
          metadata: {
            runnerState: "exited",
            runnerExitedAt: new Date().toISOString(),
            runnerExitCode: code,
            runnerExitSignal: signal,
          },
        });
      });
      // Notify user if window is not focused.
      const finalRecord = readCodeAgentRunRecord(runId);
      reclaimTerminalCodeAgentWorktree(finalRecord);
      const finalStatus = getRecordString(finalRecord, "status");
      const runTitle =
        getRecordString(finalRecord, "title") ??
        getRecordString(finalRecord, "goal") ??
        runId;
      if (finalStatus === "completed") {
        showCodeAgentRunNotification(runId, "completed", runTitle);
      } else if (finalStatus === "errored") {
        showCodeAgentRunNotification(runId, "failed", runTitle);
      } else if (finalStatus === "needs-approval") {
        showCodeAgentRunNotification(runId, "approval-needed", runTitle);
      }
    });
    child.on("error", () => {
      revokeDesktopComputerRun(runId);
      activeCodeAgentProcesses.delete(runId);
      codeAgentAssistantDeltaSeq.delete(runId);
      persistCodeAgentChildEvent(runId, "runner-error-status", () => {
        appendCodeAgentStatusEvent(
          runId,
          "Agent-Native Code process could not continue.",
          { source: "desktop-runner" },
        );
      });
      persistCodeAgentChildEvent(runId, "runner-error-run", () => {
        touchCodeAgentRunRecord(runId, {
          status: "errored",
          phase: "runner-error",
          metadata: { runnerState: "failed" },
        });
      });
      reclaimTerminalCodeAgentWorktree(readCodeAgentRunRecord(runId));
    });
    child.unref();
  } catch (err) {
    startingCodeAgentRuns.delete(runId);
    revokeDesktopComputerRun(runId);
    persistCodeAgentChildEvent(runId, "runner-start-error-status", () => {
      appendCodeAgentStatusEvent(
        runId,
        "Could not start Agent-Native Code process.",
        {
          source: "desktop-runner",
          error: err instanceof Error ? err.message : String(err),
        },
      );
    });
    persistCodeAgentChildEvent(runId, "runner-start-error-run", () => {
      touchCodeAgentRunRecord(runId, {
        status: "errored",
        phase: "runner-error",
        metadata: {
          runnerState: "failed",
          runnerError: err instanceof Error ? err.message : String(err),
        },
      });
    });
    reclaimTerminalCodeAgentWorktree(readCodeAgentRunRecord(runId));
  }
}

function spawnCodeAgentApprovalRunner(
  runId: string,
  cwd: string,
  subcommand: "approve" | "approve-always" | "deny" = "approve",
): CodeAgentControlResult {
  if (activeCodeAgentProcesses.has(runId)) {
    return {
      ok: true,
      command: "approve",
      action: "refresh",
      message: "This Agent-Native Code run already has an active process.",
    };
  }
  const provider = ensureCodeAgentLlmProvider();
  if (!provider.ok) {
    appendCodeAgentStatusEvent(runId, "Could not start the approval command.", {
      source: "desktop-approval-runner",
      error: provider.error,
    });
    touchCodeAgentRunRecord(runId, {
      status: "needs-approval",
      phase: "missing-credentials",
      needsApproval: true,
      metadata: {
        approvalRunnerError: provider.error,
      },
    });
    return {
      ok: false,
      command: "approve",
      action: "refresh",
      message: "Connect a model provider before approving this run.",
      error: provider.error,
    };
  }
  const repoRoot = resolveRepositoryRoot(cwd);
  const runRecord = readCodeAgentRunRecord(runId);
  const normalizedPermissionMode =
    readCodeAgentPermissionMode(runRecord) ??
    DEFAULT_CODE_AGENT_PERMISSION_MODE;
  const invocation = resolveCodeAgentRunnerInvocation(
    {
      appIsPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      electronPath: process.execPath,
      repoRoot,
      cwd,
      environment: process.env,
    },
    subcommand,
    runId,
  );
  const { command, args } = invocation;

  try {
    const computerEnv = desktopComputerChildEnv(
      runId,
      normalizedPermissionMode,
    );
    const child = spawn(command, args, {
      cwd: invocation.cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...AppStore.getCodeAgentProviderProcessEnv(process.env),
        AGENT_NATIVE_CODE_AGENTS_HOME: codeAgentStoreRoot(),
        AGENT_NATIVE_CODE_AGENT_PERMISSION_MODE: normalizedPermissionMode,
        ...invocation.env,
        ...computerEnv,
      },
    });
    const runnerStartedAt = new Date().toISOString();
    const runnerCommand = `${command} ${args.join(" ")}`;
    activeCodeAgentProcesses.set(runId, {
      pid: child.pid,
      command: runnerCommand,
      cwd: invocation.cwd,
      startedAt: runnerStartedAt,
      permissionMode: normalizedPermissionMode,
    });
    appendCodeAgentStatusEvent(runId, "Approval requested from Desktop.", {
      source: "desktop",
      command: "approve",
    });
    touchCodeAgentRunRecord(runId, {
      status: "running",
      phase: "approval-running",
      metadata: {
        approvalRunnerPid: child.pid,
        approvalRunnerCommand: runnerCommand,
        approvalRunnerCwd: invocation.cwd,
        approvalRunnerStartedAt: runnerStartedAt,
      },
    });
    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (!text) return;
      persistCodeAgentChildEvent(runId, "approval-stdout", () => {
        appendCodeAgentStatusEvent(runId, text, {
          source: "approval-stdout",
        });
      });
    });
    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (!text) return;
      persistCodeAgentChildEvent(runId, "approval-stderr", () => {
        appendCodeAgentStatusEvent(runId, text, {
          source: "approval-stderr",
        });
      });
    });
    child.on("exit", (code, signal) => {
      revokeDesktopComputerRun(runId);
      activeCodeAgentProcesses.delete(runId);
      persistCodeAgentChildEvent(runId, "approval-exit-status", () => {
        appendCodeAgentStatusEvent(
          runId,
          code === 0
            ? "Approval process exited."
            : `Approval process exited with ${signal ?? code}.`,
          { source: "desktop-approval-runner", code, signal },
        );
      });
      persistCodeAgentChildEvent(runId, "approval-exit-run", () => {
        touchCodeAgentRunRecord(runId, {
          updatedAt: new Date().toISOString(),
          metadata: {
            approvalRunnerExitedAt: new Date().toISOString(),
            approvalRunnerExitCode: code,
            approvalRunnerExitSignal: signal,
          },
        });
      });
      // Notify user if window is not focused.
      const finalRecord = readCodeAgentRunRecord(runId);
      reclaimTerminalCodeAgentWorktree(finalRecord);
      const finalStatus = getRecordString(finalRecord, "status");
      const runTitle =
        getRecordString(finalRecord, "title") ??
        getRecordString(finalRecord, "goal") ??
        runId;
      if (finalStatus === "completed") {
        showCodeAgentRunNotification(runId, "completed", runTitle);
      } else if (finalStatus === "errored") {
        showCodeAgentRunNotification(runId, "failed", runTitle);
      } else if (finalStatus === "needs-approval") {
        showCodeAgentRunNotification(runId, "approval-needed", runTitle);
      }
    });
    child.on("error", () => {
      revokeDesktopComputerRun(runId);
      activeCodeAgentProcesses.delete(runId);
      persistCodeAgentChildEvent(runId, "approval-error-status", () => {
        appendCodeAgentStatusEvent(
          runId,
          "Approval process could not continue.",
          { source: "desktop-approval-runner" },
        );
      });
      persistCodeAgentChildEvent(runId, "approval-error-run", () => {
        touchCodeAgentRunRecord(runId, {
          status: "needs-approval",
          phase: "approval-error",
          needsApproval: true,
          metadata: { approvalRunnerState: "failed" },
        });
      });
      reclaimTerminalCodeAgentWorktree(readCodeAgentRunRecord(runId));
    });
    child.unref();
    return {
      ok: true,
      command: "approve",
      action: "refresh",
      message: "Approval command started.",
    };
  } catch (err) {
    revokeDesktopComputerRun(runId);
    const message = err instanceof Error ? err.message : String(err);
    persistCodeAgentChildEvent(runId, "approval-start-error-status", () => {
      appendCodeAgentStatusEvent(
        runId,
        "Could not start the approval command.",
        {
          source: "desktop-approval-runner",
          error: message,
        },
      );
    });
    persistCodeAgentChildEvent(runId, "approval-start-error-run", () => {
      touchCodeAgentRunRecord(runId, {
        status: "needs-approval",
        phase: "approval-error",
        needsApproval: true,
        metadata: {
          approvalRunnerError: message,
        },
      });
    });
    reclaimTerminalCodeAgentWorktree(readCodeAgentRunRecord(runId));
    return {
      ok: false,
      command: "approve",
      action: "refresh",
      message: "Could not start the approval command.",
      error: message,
    };
  }
}

async function sendDesktopCodeBackgroundAgentFollowUp(
  input: DesktopBackgroundAgentFollowUpInput,
): Promise<DesktopBackgroundAgentControlResult> {
  const runRecord = readCodeAgentRunRecord(input.runId);
  if (!runRecord) {
    return {
      ok: false,
      runId: input.runId,
      run: null,
      error: `Run not found: ${input.runId}`,
    };
  }

  const prompt = input.prompt.trim();
  if (!prompt) {
    return {
      ok: false,
      runId: input.runId,
      run: desktopCodeBackgroundAgentController.get(input.runId),
      error: "Follow-up prompt is required.",
    };
  }

  reconcileInterruptedCodeAgentRun(input.runId, "follow-up", runRecord);
  const currentRunRecord = readCodeAgentRunRecord(input.runId) ?? runRecord;
  const currentMetadata = isObject(currentRunRecord.metadata)
    ? currentRunRecord.metadata
    : {};
  const currentCwd =
    getRecordString(currentRunRecord, "cwd") ??
    firstStringValue(currentMetadata.cwd);
  const currentWorktree = isObject(currentMetadata.worktree)
    ? currentMetadata.worktree
    : undefined;
  if (currentCwd && currentWorktree && !fs.existsSync(currentCwd)) {
    return {
      ok: false,
      runId: input.runId,
      run: desktopCodeBackgroundAgentController.get(input.runId),
      message: "Restore the worktree to continue.",
      error: `The worktree is unavailable at ${currentCwd}.`,
    };
  }
  let attachedWorktree: CodeAgentManagedWorktree | undefined;
  if (firstStringValue(currentWorktree?.id)) {
    try {
      attachedWorktree = restoreManagedCodeAgentWorktree({
        registryPath: codeAgentWorktreeRegistryFile(),
        worktreeId: firstStringValue(currentWorktree?.id)!,
        runId: input.runId,
      });
      touchCodeAgentRunRecord(input.runId, {
        cwd: attachedWorktree.path,
        metadata: {
          cwd: attachedWorktree.path,
          worktree: codeAgentWorktreeMetadata(attachedWorktree),
        },
      });
    } catch (error) {
      return {
        ok: false,
        runId: input.runId,
        run: desktopCodeBackgroundAgentController.get(input.runId),
        message: "Restore the worktree to continue.",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  const runIsActive =
    activeCodeAgentProcesses.has(input.runId) ||
    isActiveDesktopCodeAgentRun(currentRunRecord);
  let worktreeLeaseAcquired = true;
  if (attachedWorktree && !runIsActive) {
    try {
      worktreeLeaseAcquired = claimCodeAgentWorktreeRun({
        registryPath: codeAgentWorktreeRegistryFile(),
        worktreeId: attachedWorktree.id,
        runId: input.runId,
        ownerId: codeAgentWorktreeLeaseOwnerId,
      });
    } catch (error) {
      return {
        ok: false,
        runId: input.runId,
        run: desktopCodeBackgroundAgentController.get(input.runId),
        message: "Restore the worktree to continue.",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  const worktreeBusy = Boolean(
    attachedWorktree &&
    (hasActiveCodeAgentWorktreeRun(attachedWorktree.id, input.runId) ||
      !worktreeLeaseAcquired),
  );
  const mode = input.mode ?? "immediate";
  const event = createDesktopUserTranscriptEvent(
    input.runId,
    prompt,
    undefined,
    {
      ...(input.metadata ?? {}),
      source: input.source ?? "desktop-background-agent-controller",
      permissionMode: input.permissionMode,
      followUpMode: mode,
      delivery: runIsActive ? mode : "run-now",
      promptKind: "follow-up",
    },
  );
  appendCodeAgentTranscriptEvent(event);

  if (runIsActive) {
    const metadata = isObject(currentRunRecord.metadata)
      ? currentRunRecord.metadata
      : {};
    touchCodeAgentRunRecord(input.runId, {
      ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
      metadata: {
        ...(input.permissionMode
          ? { permissionMode: input.permissionMode }
          : {}),
        pendingFollowUps: [
          ...readDesktopPendingFollowUps(metadata.pendingFollowUps),
          {
            id: `followup-${timestampSlug(event.createdAt)}-${randomUUID().slice(0, 8)}`,
            prompt,
            mode,
            createdAt: event.createdAt,
            eventId: event.id,
            permissionMode: input.permissionMode,
            source: input.source ?? "desktop-background-agent-controller",
            ...(Array.isArray(input.metadata?.attachments)
              ? { attachments: input.metadata.attachments }
              : {}),
          },
        ],
      },
    });
    return {
      ok: true,
      runId: input.runId,
      run: desktopCodeBackgroundAgentController.get(input.runId),
      queued: true,
      message: "Follow-up queued for the active Agent-Native Code run.",
    };
  }

  if (worktreeBusy) {
    touchCodeAgentRunRecord(input.runId, {
      status: "queued",
      phase: "queued",
      metadata: {
        worktree: {
          ...codeAgentWorktreeMetadata(attachedWorktree!),
          queueState: "waiting",
        },
      },
    });
    return {
      ok: true,
      runId: input.runId,
      run: desktopCodeBackgroundAgentController.get(input.runId),
      queued: true,
      message: "Follow-up queued behind another chat using this worktree.",
    };
  }

  const cwd =
    getRecordString(currentRunRecord, "cwd") ??
    resolveCodeAgentsTerminalCwd({});
  const goal =
    getCodeAgentGoal(getRecordString(currentRunRecord, "goalId")) ??
    CODE_AGENT_GOALS[0];
  if (goal.surfaceKind === "native") {
    spawnCodeAgentRunner(input.runId, cwd, input.permissionMode);
  }
  return {
    ok: true,
    runId: input.runId,
    run: desktopCodeBackgroundAgentController.get(input.runId),
    queued: false,
    message: "Follow-up recorded for the Agent-Native Code run.",
  };
}

function readDesktopPendingFollowUps(
  value: unknown,
): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> =>
    isObject(item),
  );
}

function stopDesktopCodeBackgroundAgentRunWithoutSignal(
  runId: string,
): DesktopBackgroundAgentControlResult {
  appendCodeAgentStatusEvent(
    runId,
    "Stop requested for Agent-Native Code run. No process signal was sent.",
    {
      source: "desktop-background-agent-controller",
      stoppedWithoutSignal: true,
    },
  );
  touchCodeAgentRunRecord(runId, {
    status: "paused",
    phase: "stopped",
    metadata: {
      runnerState: "stopped",
      runnerStoppedAt: new Date().toISOString(),
      stoppedBy: "desktop-background-agent-controller",
      stopSignalSent: false,
    },
  });
  return {
    ok: true,
    runId,
    run: desktopCodeBackgroundAgentController.get(runId),
    message:
      "Agent-Native Code run marked stopped without signaling a process.",
  };
}

async function controlDesktopCodeBackgroundAgentRun(
  input: DesktopBackgroundAgentControlInput,
): Promise<DesktopBackgroundAgentControlResult> {
  const runRecord = readCodeAgentRunRecord(input.runId);
  if (!runRecord) {
    return {
      ok: false,
      runId: input.runId,
      run: null,
      error: `Run not found: ${input.runId}`,
    };
  }

  if (input.command === "stop") {
    revokeDesktopComputerRun(input.runId);
    const active = activeCodeAgentProcesses.get(input.runId);
    const status = getRecordString(runRecord, "status");
    const phase = getRecordString(runRecord, "phase");
    if (
      status === "completed" ||
      status === "errored" ||
      phase === "complete" ||
      phase === "error"
    ) {
      return {
        ok: true,
        runId: input.runId,
        run: desktopCodeBackgroundAgentController.get(
          input.runId,
        ) as BackgroundAgentRun | null,
        message: "This Agent-Native Code run is already finished.",
      };
    }

    if (active?.pid) {
      if (signalCodeAgentProcess(active.pid, "SIGTERM")) {
        activeCodeAgentProcesses.delete(input.runId);
        appendCodeAgentStatusEvent(
          input.runId,
          "Stop requested for Agent-Native Code run.",
          {
            source: "desktop",
            pid: active.pid,
          },
        );
        touchCodeAgentRunRecord(input.runId, {
          status: "paused",
          phase: "stopped",
          metadata: {
            runnerStoppedAt: new Date().toISOString(),
          },
        });
        return {
          ok: true,
          runId: input.runId,
          run: desktopCodeBackgroundAgentController.get(
            input.runId,
          ) as BackgroundAgentRun | null,
          message: "Stop requested for this Agent-Native Code run.",
        };
      }
      return {
        ok: false,
        runId: input.runId,
        run: desktopCodeBackgroundAgentController.get(
          input.runId,
        ) as BackgroundAgentRun | null,
        message: "Could not stop this Agent-Native Code process.",
        error: `No process accepted SIGTERM for pid ${active.pid}.`,
      };
    }

    return stopDesktopCodeBackgroundAgentRunWithoutSignal(input.runId);
  }

  if (input.command === "approve" || input.command === "approve-always") {
    const metadata = isObject(runRecord.metadata) ? runRecord.metadata : null;
    const pendingApproval = isObject(metadata?.pendingApproval)
      ? metadata.pendingApproval
      : null;
    if (!pendingApproval) {
      return {
        ok: true,
        runId: input.runId,
        run: desktopCodeBackgroundAgentController.get(
          input.runId,
        ) as BackgroundAgentRun | null,
        message: "No pending approval was found for this run.",
      };
    }
    const cwd =
      getRecordString(runRecord, "cwd") ?? resolveCodeAgentsTerminalCwd({});
    const subcommand =
      input.command === "approve-always" ? "approve-always" : "approve";
    const result = spawnCodeAgentApprovalRunner(input.runId, cwd, subcommand);
    return desktopControlResultToBackgroundResult(input.runId, result);
  }

  if (input.command === "deny") {
    const metadata = isObject(runRecord.metadata) ? runRecord.metadata : null;
    const pendingApproval = isObject(metadata?.pendingApproval)
      ? metadata.pendingApproval
      : null;
    if (!pendingApproval) {
      return {
        ok: true,
        runId: input.runId,
        run: desktopCodeBackgroundAgentController.get(
          input.runId,
        ) as BackgroundAgentRun | null,
        message: "No pending approval was found for this run.",
      };
    }
    const cwd =
      getRecordString(runRecord, "cwd") ?? resolveCodeAgentsTerminalCwd({});
    const result = spawnCodeAgentApprovalRunner(input.runId, cwd, "deny");
    return desktopControlResultToBackgroundResult(input.runId, result);
  }

  if (input.command === "resume") {
    const cwd =
      getRecordString(runRecord, "cwd") ?? resolveCodeAgentsTerminalCwd({});
    appendCodeAgentStatusEvent(input.runId, "Resume requested from Desktop.", {
      source: "desktop",
      command: "resume",
    });
    spawnCodeAgentRunner(input.runId, cwd);
    return {
      ok: true,
      runId: input.runId,
      run: desktopCodeBackgroundAgentController.get(
        input.runId,
      ) as BackgroundAgentRun | null,
      message: "Agent-Native Code runner started.",
    };
  }

  return {
    ok: false,
    runId: input.runId,
    run: desktopCodeBackgroundAgentController.get(input.runId),
    error: `Unsupported command: ${input.command}`,
  };
}

function desktopControlResultToBackgroundResult(
  runId: string,
  result: CodeAgentControlResult,
): DesktopBackgroundAgentControlResult {
  return {
    ok: result.ok,
    runId,
    run: desktopCodeBackgroundAgentController.get(
      runId,
    ) as BackgroundAgentRun | null,
    message: result.message,
    error: result.error,
  };
}

function backgroundControlResultToDesktopControlResult(
  command: CodeAgentControlCommand,
  result: DesktopBackgroundAgentControlResult,
): CodeAgentControlResult {
  return {
    ok: result.ok,
    command,
    action: result.ok ? "refresh" : "none",
    run: result.run ? backgroundRunToDesktopRun(result.run) : undefined,
    message: result.message ?? (result.ok ? "Status refreshed." : "Failed."),
    error: result.error,
  };
}

function resolveRepositoryRoot(cwd: string): string {
  const candidates = [
    process.env.AGENT_NATIVE_FRAMEWORK_ROOT,
    process.env.INIT_CWD,
    process.env.PWD,
    IS_DEV ? path.resolve(".") : undefined,
    IS_DEV ? path.resolve(__dirname, "../../../..") : undefined,
    cwd,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const root = resolveUsableDirectory(candidate);
    if (root && fs.existsSync(path.join(root, "pnpm-workspace.yaml"))) {
      return root;
    }
  }
  return cwd;
}

function touchCodeAgentRunRecord(
  runId: string,
  updates: Record<string, unknown>,
): void {
  const filePath = codeAgentRunFilePath(runId);
  if (!filePath) return;
  updateJsonFileAtomically(
    filePath,
    (value) => (isObject(value) ? value : null),
    (record) => {
      if (!record) return null;
      const metadata = isObject(record.metadata)
        ? { ...(record.metadata as Record<string, unknown>) }
        : {};
      const updateMetadata = isObject(updates.metadata) ? updates.metadata : {};
      return {
        ...record,
        ...updates,
        metadata: { ...metadata, ...updateMetadata },
      };
    },
    { lock: DESKTOP_CODE_AGENT_PERSISTENCE_LOCK },
  );
}

function titleFromPrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (!normalized) return "Coding task";
  return normalized.length > 72 ? `${normalized.slice(0, 69)}...` : normalized;
}

async function generateAndPatchRunTitle(
  runId: string,
  prompt: string,
): Promise<string | null> {
  const apiKey =
    process.env.ANTHROPIC_API_KEY ||
    AppStore.loadCodeAgentProviderCredentials().ANTHROPIC_API_KEY;

  if (!apiKey) return null;

  const cleanPrompt = prompt.replace(/\s+/g, " ").trim().slice(0, 500);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6_000);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 20,
        messages: [
          {
            role: "user",
            content: `Generate a very short title (3-6 words, no quotes, no punctuation at end) for a coding session that starts with this request:\n\n${cleanPrompt}`,
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      content?: Array<{ type: string; text: string }>;
    };
    const text = data?.content?.find((c) => c.type === "text")?.text?.trim();
    if (!text) return null;
    const title = text
      .replace(/^["']|["']$/g, "")
      .trim()
      .slice(0, 72);
    if (!title) return null;
    touchCodeAgentRunRecord(runId, { title });
    return title;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function formatCodeAgentModel(model: string, effort?: string): string {
  const label = model
    .replace(/^ai-sdk:/, "")
    .replace(/-/g, " ")
    .replace(/\bgpt\b/i, "GPT")
    .replace(/\bclaude\b/i, "Claude")
    .replace(/\bgemini\b/i, "Gemini");
  if (!effort || effort === "auto") return label;
  return `${label} / ${effort}`;
}

async function createCodeAgentRun(
  input: unknown,
): Promise<CodeAgentCreateRunResult> {
  const payload = isObject(input) ? input : {};
  const prompt = firstStringValue(payload.prompt) ?? "";
  if (!prompt) {
    return {
      ok: false,
      message: "Enter a prompt to start a coding session.",
      error: "Missing prompt.",
    };
  }
  const userMetadata = isObject(payload.metadata) ? payload.metadata : {};
  const isDesktopAppCreation = userMetadata.kind === "desktop-create-app";
  const isDesktopLocalCodeChange =
    userMetadata.kind === "desktop-local-code-change";
  const requestedExecutionTarget = firstStringValue(payload.executionTarget);
  if (
    requestedExecutionTarget &&
    requestedExecutionTarget !== "local" &&
    requestedExecutionTarget !== "worktree" &&
    requestedExecutionTarget !== "portal"
  ) {
    return {
      ok: false,
      message: "Choose Local, Worktree, or Portal before starting the chat.",
      error: `Unsupported execution target: ${requestedExecutionTarget}`,
    };
  }
  const executionTarget = requestedExecutionTarget ?? "local";
  const requestedWorktree = isObject(payload.worktree)
    ? payload.worktree
    : undefined;
  const worktreeMode = firstStringValue(requestedWorktree?.mode) ?? "new";
  const worktreeName = firstStringValue(requestedWorktree?.name);
  if (
    executionTarget === "worktree" &&
    worktreeMode !== "new" &&
    worktreeMode !== "named"
  ) {
    return {
      ok: false,
      message: "Choose a new or named worktree before starting the chat.",
      error: `Unsupported worktree mode: ${worktreeMode}`,
    };
  }
  if (
    executionTarget === "worktree" &&
    worktreeMode === "named" &&
    !worktreeName
  ) {
    return {
      ok: false,
      message: "Choose a name for the reusable worktree.",
      error: "Named worktrees require a name.",
    };
  }
  const provider = ensureCodeAgentLlmProvider();
  if (!provider.ok && !isDesktopAppCreation) {
    if (!isDesktopLocalCodeChange && executionTarget !== "portal") {
      return {
        ok: false,
        message: "Connect a model provider before starting a coding chat.",
        error: provider.error,
      };
    }
  }

  // App creation must still produce a visible chat when setup is incomplete.
  // The runner records the credential gap on this queued run, which lets the
  // chat render the shared Builder/custom-key recovery actions and retry it.

  const goal =
    getCodeAgentGoal(firstStringValue(payload.goalId)) ?? CODE_AGENT_GOALS[0];
  const now = new Date().toISOString();
  const runId = `${goal.id}-${timestampSlug(now)}-${randomUUID().slice(0, 8)}`;
  const sourceCwd = resolveCodeAgentsTerminalCwd({ cwd: payload.cwd });
  const permissionMode =
    getCodeAgentPermissionMode(firstStringValue(payload.permissionMode)) ??
    DEFAULT_CODE_AGENT_PERMISSION_MODE;
  const engine = normalizeCodeAgentRequestedEngine(
    firstStringValue(payload.engine),
  );
  const model = firstStringValue(payload.model);
  const effort = firstStringValue(payload.effort);
  const attachments = normalizeCodeAgentPromptAttachments(payload.attachments);
  if (executionTarget === "portal") {
    return createPortalCodeAgentRun({
      payload,
      prompt,
      userMetadata,
      goal,
      runId,
      sourceCwd,
      permissionMode,
      engine,
      model,
      effort,
      attachments,
    });
  }
  let cwd = sourceCwd;
  let worktreeMetadata: CodeAgentManagedWorktree | undefined;
  let worktreeRunQueued = false;
  if (executionTarget === "worktree") {
    if (!engine || !CODE_AGENT_WORKTREE_ENGINES.has(engine)) {
      return {
        ok: false,
        message: "Worktrees are available for local coding agents.",
        error:
          "Choose Codex, Claude Code, Pi, or OpenCode before using a worktree.",
      };
    }
    try {
      cleanupDueManagedCodeAgentWorktrees();
      const worktree = createOrAttachCodeAgentWorktree({
        registryPath: codeAgentWorktreeRegistryFile(),
        sourcePath: sourceCwd,
        worktreeRoot: path.join(codeAgentStoreRoot(), "worktrees"),
        runId,
        policy: worktreeMode === "named" ? "named" : "ephemeral",
        name: worktreeName,
      });
      cwd = worktree.path;
      worktreeMetadata = worktree;
      worktreeRunQueued = !claimCodeAgentWorktreeRun({
        registryPath: codeAgentWorktreeRegistryFile(),
        worktreeId: worktree.id,
        runId,
        ownerId: codeAgentWorktreeLeaseOwnerId,
      });
    } catch (error) {
      return {
        ok: false,
        message: "Could not create the isolated worktree.",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  const retryOf = firstStringValue(userMetadata.retryOf, payload.retryOf);
  const rerunOf = firstStringValue(userMetadata.rerunOf, payload.rerunOf);
  const attempt = Number(userMetadata.attempt ?? payload.attempt);
  const queue = buildCodeAgentQueueMetadata({
    goalId: goal.id,
    queuedAt: now,
    attempt: Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 1,
    retryOf,
    rerunOf,
  });
  const steering = buildCodeAgentSteeringMetadata({
    cwd,
    permissionMode,
    engine,
    model,
    effort,
    attachments,
  });
  const title = titleFromPrompt(prompt);
  const run: CodeAgentRun = {
    id: runId,
    goalId: goal.id,
    title,
    subtitle: "Queued from Desktop",
    status: "queued",
    phase: "queued",
    progress: {
      label: "Queued",
      completed: 0,
      total: 1,
      percent: 0,
    },
    details: [
      { label: "Goal", value: goal.slashCommand },
      { label: "Working directory", value: cwd },
      {
        label: "Workspace",
        value:
          executionTarget === "worktree"
            ? worktreeMetadata?.name
              ? `Worktree - ${worktreeMetadata.name}`
              : "Worktree"
            : "Local",
      },
      ...(worktreeMetadata
        ? [{ label: "Branch", value: worktreeMetadata.branch }]
        : []),
      { label: "Mode", value: permissionMode },
      ...(model
        ? [{ label: "Model", value: formatCodeAgentModel(model, effort) }]
        : []),
    ],
    createdAt: now,
    updatedAt: now,
    metadata: {
      ...userMetadata,
      cwd,
      executionTarget,
      ...(worktreeMetadata
        ? {
            worktree: {
              ...codeAgentWorktreeMetadata(worktreeMetadata),
              queueState: worktreeRunQueued ? "waiting" : "starting",
            },
          }
        : {}),
      permissionMode,
      engine,
      model,
      effort,
      attachments,
      queue,
      steering,
      source: "desktop",
      queued: true,
      queuedAt: now,
      retryOf,
      rerunOf,
      initialPrompt: prompt,
    },
  };
  const record = {
    schemaVersion: 1,
    ...run,
    cwd,
    permissionMode,
    queue,
    steering,
    metadata: {
      ...(run.metadata ?? {}),
      engine,
      model,
      effort,
    },
  };
  const runFile = codeAgentRunFilePath(runId);
  if (!runFile) {
    if (worktreeMetadata) {
      try {
        releaseCodeAgentWorktree({
          registryPath: codeAgentWorktreeRegistryFile(),
          worktreeId: worktreeMetadata.id,
          runId,
          cleanupAfter: new Date(
            Date.now() + CODE_AGENT_EPHEMERAL_WORKTREE_RETENTION_MS,
          ),
        });
      } catch (cleanupError) {
        console.warn(
          "[code-agents] failed to release an invalid worktree during run cleanup:",
          cleanupError,
        );
      }
    }
    return {
      ok: false,
      message: "Could not create a session id.",
      error: "Invalid generated run id.",
    };
  }

  try {
    withFileLockSync(runFile, () => {
      if (fs.existsSync(runFile)) {
        throw new Error(`A Code Agent run already exists: ${runId}`);
      }
      writeJsonFileAtomically(runFile, record);
    });
    const event = createDesktopUserTranscriptEvent(runId, prompt, goal.id, {
      queue,
      steering,
      attachments,
      executionTarget,
      ...(worktreeMetadata
        ? {
            worktree: {
              ...codeAgentWorktreeMetadata(worktreeMetadata),
              queueState: worktreeRunQueued ? "waiting" : "starting",
            },
          }
        : {}),
      retryOf,
      rerunOf,
    });
    const eventFile = appendCodeAgentTranscriptEvent(event);
    if (goal.surfaceKind === "native" && !worktreeRunQueued) {
      spawnCodeAgentRunner(runId, cwd, permissionMode);
    }
    const generatedTitle = await generateAndPatchRunTitle(runId, prompt);
    return {
      ok: true,
      run: generatedTitle ? { ...run, title: generatedTitle } : run,
      event,
      eventFile,
      message: "Coding session recorded.",
    };
  } catch (err) {
    if (worktreeMetadata) {
      try {
        releaseCodeAgentWorktree({
          registryPath: codeAgentWorktreeRegistryFile(),
          worktreeId: worktreeMetadata.id,
          runId,
          cleanupAfter: new Date(
            Date.now() + CODE_AGENT_EPHEMERAL_WORKTREE_RETENTION_MS,
          ),
        });
      } catch (cleanupError) {
        console.warn(
          "[code-agents] failed to release a worktree after recording failed:",
          cleanupError,
        );
      }
    }
    return {
      ok: false,
      message: "Could not record the coding session.",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function listCodeAgentWorktrees(input?: unknown): CodeAgentWorktreeListResult {
  const cwd = typeof input === "string" ? input : undefined;
  const sourcePath = resolveCodeAgentsTerminalCwd({ cwd });
  cleanupDueManagedCodeAgentWorktrees();
  return listNamedCodeAgentWorktrees({
    registryPath: codeAgentWorktreeRegistryFile(),
    sourcePath,
  });
}

function restoreCodeAgentWorktree(
  input: unknown,
): Promise<CodeAgentRestoreWorktreeResult> {
  const payload = isObject(input) ? input : {};
  const worktreeId = firstStringValue(payload.worktreeId);
  const runId = normalizeCodeAgentRunId(payload.runId);
  if (!worktreeId) {
    return Promise.resolve({
      ok: false,
      worktreeId: "",
      message: "Select a worktree to restore.",
      error: "Missing worktree id.",
    });
  }
  try {
    const runRecord = runId ? readCodeAgentRunRecord(runId) : null;
    const attachRunId =
      runId && runRecord && isActiveDesktopCodeAgentRun(runRecord)
        ? runId
        : undefined;
    const managed = restoreManagedCodeAgentWorktree({
      registryPath: codeAgentWorktreeRegistryFile(),
      worktreeId,
      runId: attachRunId,
    });
    if (runId) {
      touchCodeAgentRunRecord(runId, {
        cwd: managed.path,
        metadata: {
          cwd: managed.path,
          worktree: codeAgentWorktreeMetadata(managed),
        },
      });
    }
    return Promise.resolve({
      ok: true,
      worktreeId,
      run: runId ? (readDesktopCodeAgentRun(runId) ?? undefined) : undefined,
      message: "Worktree restored.",
    });
  } catch (error) {
    return Promise.resolve({
      ok: false,
      worktreeId,
      message: "Could not restore the worktree.",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function forkCodeAgentRun(
  input: unknown,
): Promise<CodeAgentForkRunResult> {
  const payload = isObject(input) ? input : {};
  const sourceRunId = normalizeCodeAgentRunId(payload.sourceRunId);
  const executionTarget = firstStringValue(payload.executionTarget);
  if (!sourceRunId) {
    return {
      ok: false,
      sourceRunId: "",
      message: "Select a chat to fork.",
      error: "Missing or invalid source run id.",
    };
  }
  if (executionTarget !== "local" && executionTarget !== "worktree") {
    return {
      ok: false,
      sourceRunId,
      message: "Choose a workspace or a new worktree.",
      error: "Unsupported fork target.",
    };
  }

  const sourceRecord = readCodeAgentRunRecord(sourceRunId);
  if (!sourceRecord) {
    return {
      ok: false,
      sourceRunId,
      message: "This chat is no longer available.",
      error: `No run record exists for ${sourceRunId}.`,
    };
  }
  const goal =
    getCodeAgentGoal(firstStringValue(payload.goalId)) ??
    getCodeAgentGoal(getRecordString(sourceRecord, "goalId")) ??
    CODE_AGENT_GOALS[0];
  if (goal.surfaceKind !== "native") {
    return {
      ok: false,
      sourceRunId,
      message: `${goal.surfaceLabel} chats cannot be forked here.`,
      error: "Only native coding chats support local forks.",
    };
  }

  const sourceMetadata = isObject(sourceRecord.metadata)
    ? sourceRecord.metadata
    : {};
  const sourceWorktree = isObject(sourceMetadata.worktree)
    ? sourceMetadata.worktree
    : undefined;
  const sourceCwd =
    getRecordString(sourceRecord, "cwd") ??
    firstStringValue(sourceMetadata.cwd) ??
    resolveCodeAgentsTerminalCwd({});
  const sourceForNewWorktree =
    firstStringValue(sourceWorktree?.sourcePath) ?? sourceCwd;
  const localForkCwd =
    executionTarget === "local" && sourceWorktree
      ? sourceForNewWorktree
      : sourceCwd;
  if (executionTarget === "local" && !fs.existsSync(localForkCwd)) {
    return {
      ok: false,
      sourceRunId,
      message: "Restore the worktree to continue.",
      error: `The workspace is missing: ${localForkCwd}`,
    };
  }

  if (executionTarget === "worktree" && !fs.existsSync(sourceForNewWorktree)) {
    return {
      ok: false,
      sourceRunId,
      message: "Restore the worktree to continue.",
      error: "The source repository is no longer available.",
    };
  }

  const engine = firstStringValue(sourceMetadata.engine, sourceRecord.engine);
  if (
    executionTarget === "worktree" &&
    (!engine || !CODE_AGENT_WORKTREE_ENGINES.has(engine))
  ) {
    return {
      ok: false,
      sourceRunId,
      message: "New worktree forks are available for local coding agents.",
      error: "The source chat does not use a supported local coding agent.",
    };
  }

  const now = new Date().toISOString();
  const runId = `${goal.id}-${timestampSlug(now)}-${randomUUID().slice(0, 8)}`;
  const permissionMode =
    readCodeAgentPermissionMode(sourceRecord) ??
    DEFAULT_CODE_AGENT_PERMISSION_MODE;
  const model = firstStringValue(sourceMetadata.model, sourceRecord.model);
  const effort = firstStringValue(
    sourceMetadata.effort,
    sourceMetadata.reasoningEffort,
    sourceRecord.effort,
  );
  let cwd = localForkCwd;
  let worktreeMetadata: CodeAgentManagedWorktree | undefined;
  try {
    if (executionTarget === "worktree") {
      cleanupDueManagedCodeAgentWorktrees();
      worktreeMetadata = createOrAttachCodeAgentWorktree({
        registryPath: codeAgentWorktreeRegistryFile(),
        sourcePath: sourceForNewWorktree!,
        worktreeRoot: path.join(codeAgentStoreRoot(), "worktrees"),
        runId,
        policy: "ephemeral",
      });
      cwd = worktreeMetadata.path;
    }

    const transcript = readAllCodeAgentTranscript({ runId: sourceRunId });
    const initialPrompt =
      firstStringValue(sourceMetadata.initialPrompt) ??
      readLatestCodeAgentUserPrompt(sourceRunId) ??
      "Continue this coding chat.";
    const metadata: Record<string, unknown> = {
      ...sourceMetadata,
      cwd,
      executionTarget,
      ...(worktreeMetadata
        ? { worktree: codeAgentWorktreeMetadata(worktreeMetadata) }
        : {}),
      forkedFrom: sourceRunId,
      forkedAt: now,
      initialPrompt,
      source: "desktop",
      queued: false,
    };
    if (executionTarget === "local") delete metadata.worktree;
    const run: CodeAgentRun = {
      id: runId,
      goalId: goal.id,
      title: `Fork of ${getRecordString(sourceRecord, "title") ?? "coding chat"}`,
      subtitle: "Forked from Desktop",
      status: "paused",
      phase: "forked",
      progress: {
        label: "Ready to continue",
        completed: 0,
        total: 1,
        percent: 0,
      },
      details: [
        { label: "Goal", value: goal.slashCommand },
        { label: "Working directory", value: cwd },
        {
          label: "Workspace",
          value: executionTarget === "worktree" ? "New worktree" : "Workspace",
        },
        ...(worktreeMetadata
          ? [{ label: "Branch", value: worktreeMetadata.branch }]
          : []),
        { label: "Mode", value: permissionMode },
      ],
      createdAt: now,
      updatedAt: now,
      metadata,
    };
    const record = {
      schemaVersion: 1,
      ...run,
      cwd,
      permissionMode,
      engine,
      model,
      effort,
      metadata,
    };
    const runFile = codeAgentRunFilePath(runId);
    if (!runFile) throw new Error("Invalid generated run id.");
    withFileLockSync(runFile, () => {
      if (fs.existsSync(runFile)) {
        throw new Error(`A Code Agent run already exists: ${runId}`);
      }
      writeJsonFileAtomically(runFile, record);
    });
    for (const [index, event] of transcript.events.entries()) {
      appendCodeAgentTranscriptEvent({
        ...event,
        id: `fork-${runId}-${index}-${randomUUID().slice(0, 6)}`,
        runId,
        metadata: {
          ...(event.metadata ?? {}),
          forkedFrom: sourceRunId,
        },
      });
    }
    return {
      ok: true,
      sourceRunId,
      run,
      message:
        executionTarget === "worktree"
          ? "Forked into a new worktree."
          : "Forked in this workspace.",
    };
  } catch (error) {
    if (worktreeMetadata) {
      try {
        releaseCodeAgentWorktree({
          registryPath: codeAgentWorktreeRegistryFile(),
          worktreeId: worktreeMetadata.id,
          runId,
          cleanupAfter: new Date(
            Date.now() + CODE_AGENT_EPHEMERAL_WORKTREE_RETENTION_MS,
          ),
        });
      } catch (cleanupError) {
        console.warn(
          "[code-agents] failed to release a fork worktree after an error:",
          cleanupError,
        );
      }
    }
    return {
      ok: false,
      sourceRunId,
      message: "Could not fork the chat.",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function rerunCodeAgentRun(
  input: unknown,
): Promise<CodeAgentRerunResult> {
  const payload = isObject(input) ? input : {};
  const sourceRunId = normalizeCodeAgentRunId(payload.runId);
  if (!sourceRunId) {
    return {
      ok: false,
      message: "Select a session first.",
      error: "Missing or invalid run id.",
    };
  }

  const sourceRecord = readCodeAgentRunRecord(sourceRunId);
  if (!sourceRecord) {
    return {
      ok: false,
      sourceRunId,
      message: "Agent-Native Code session was not found.",
      error: `No run record exists for ${sourceRunId}.`,
    };
  }

  const goal =
    getCodeAgentGoal(firstStringValue(payload.goalId)) ??
    getCodeAgentGoal(getRecordString(sourceRecord, "goalId")) ??
    CODE_AGENT_GOALS[0];
  if (goal.surfaceKind !== "native") {
    return {
      ok: false,
      sourceRunId,
      message: `${goal.surfaceLabel} sessions open in their app surface.`,
      error: `Native rerun is not available for goal ${goal.id}.`,
    };
  }

  const sourceMetadata = isObject(sourceRecord.metadata)
    ? sourceRecord.metadata
    : {};
  const prompt =
    firstStringValue(payload.prompt) ??
    firstStringValue(sourceMetadata.initialPrompt, sourceMetadata.prompt) ??
    readLatestCodeAgentUserPrompt(sourceRunId);
  if (!prompt) {
    return {
      ok: false,
      sourceRunId,
      message: "Could not find a prompt to re-run.",
      error: "No user prompt was stored for this run.",
    };
  }

  const requestedPermissionMode = firstStringValue(payload.permissionMode);
  const permissionMode = requestedPermissionMode
    ? getCodeAgentPermissionMode(requestedPermissionMode)
    : readCodeAgentPermissionMode(sourceRecord);
  if (requestedPermissionMode && !permissionMode) {
    return {
      ok: false,
      sourceRunId,
      message: "Choose a valid run mode.",
      error: `Unsupported run mode: ${requestedPermissionMode}`,
    };
  }

  const sourceAttachments = normalizeCodeAgentPromptAttachments(
    sourceMetadata.attachments,
  );
  const userMetadata = isObject(payload.metadata) ? payload.metadata : {};
  const result = await createCodeAgentRun({
    goalId: goal.id,
    prompt,
    cwd:
      firstStringValue(payload.cwd) ??
      getRecordString(sourceRecord, "cwd") ??
      firstStringValue(sourceMetadata.cwd),
    executionTarget:
      firstStringValue(payload.executionTarget) ??
      firstStringValue(sourceMetadata.executionTarget),
    permissionMode,
    engine:
      firstStringValue(payload.engine) ??
      firstStringValue(sourceMetadata.engine),
    model:
      firstStringValue(payload.model) ?? firstStringValue(sourceMetadata.model),
    effort:
      firstStringValue(payload.effort) ??
      firstStringValue(sourceMetadata.effort, sourceMetadata.reasoningEffort),
    attachments:
      normalizeCodeAgentPromptAttachments(payload.attachments) ??
      sourceAttachments,
    metadata: {
      ...userMetadata,
      rerunOf: sourceRunId,
      attempt: readCodeAgentAttempt(sourceRecord) + 1,
      sourceRunStatus: getRecordString(sourceRecord, "status"),
      sourceRunPhase: getRecordString(sourceRecord, "phase"),
    },
  });
  return {
    ...result,
    sourceRunId,
    message: result.ok
      ? "Agent-Native Code session re-run started."
      : result.message,
  };
}

async function appendCodeAgentFollowUp(
  input: unknown,
): Promise<CodeAgentFollowUpResult> {
  const payload = isObject(input) ? input : {};
  const runId = normalizeCodeAgentRunId(payload.runId);
  const prompt = firstStringValue(payload.prompt) ?? "";
  const requestedFollowUpMode = firstStringValue(payload.followUpMode);
  const followUpMode =
    requestedFollowUpMode === "queued" ? "queued" : "immediate";
  const requestedPermissionMode = firstStringValue(payload.permissionMode);
  const permissionMode = requestedPermissionMode
    ? getCodeAgentPermissionMode(requestedPermissionMode)
    : undefined;
  const engine = normalizeCodeAgentRequestedEngine(
    firstStringValue(payload.engine),
  );
  const model = firstStringValue(payload.model);
  const effort = firstStringValue(payload.effort);
  const attachments = normalizeCodeAgentPromptAttachments(payload.attachments);
  const userMetadata = isObject(payload.metadata) ? payload.metadata : {};
  if (!runId) {
    return {
      ok: false,
      message: "Select a session first.",
      error: "Missing or invalid run id.",
    };
  }
  if (!prompt) {
    return {
      ok: false,
      message: "Enter a follow-up prompt.",
      error: "Missing prompt.",
    };
  }
  const portalRunRecord = readCodeAgentRunRecord(runId);
  if (portalRunRecord && isPortalCodeAgentRunRecord(portalRunRecord)) {
    return appendPortalCodeAgentFollowUp({
      runId,
      prompt,
      followUpMode,
      permissionMode,
      metadata: userMetadata,
      runRecord: portalRunRecord,
    });
  }
  const provider = ensureCodeAgentLlmProvider();
  if (!provider.ok) {
    return {
      ok: false,
      message: "Connect a model provider before chatting.",
      error: provider.error,
    };
  }
  if (requestedPermissionMode && !permissionMode) {
    return {
      ok: false,
      message: "Choose a valid run mode.",
      error: `Unsupported run mode: ${requestedPermissionMode}`,
    };
  }

  try {
    const runRecord = readCodeAgentRunRecord(runId);
    if (runRecord)
      reconcileInterruptedCodeAgentRun(runId, "follow-up", runRecord);
    const currentRunRecord = readCodeAgentRunRecord(runId) ?? runRecord;
    const runIsActive =
      activeCodeAgentProcesses.has(runId) ||
      isActiveDesktopCodeAgentRun(currentRunRecord);
    const cwd =
      getRecordString(currentRunRecord, "cwd") ??
      resolveCodeAgentsTerminalCwd({});
    const steering = buildCodeAgentSteeringMetadata({
      cwd,
      permissionMode:
        permissionMode ?? readCodeAgentPermissionMode(currentRunRecord),
      engine,
      model,
      effort,
      attachments,
    });
    const now = new Date().toISOString();
    touchCodeAgentRunRecord(runId, {
      updatedAt: now,
      ...(permissionMode ? { permissionMode } : {}),
      metadata: {
        ...userMetadata,
        lastDesktopFollowUpAt: now,
        ...(permissionMode ? { permissionMode } : {}),
        ...(engine ? { engine } : {}),
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
        ...(attachments ? { attachments } : {}),
        steering,
      },
    });
    const result = await desktopCodeBackgroundAgentController.sendFollowUp({
      runId,
      prompt,
      mode: followUpMode,
      permissionMode,
      source: "desktop-follow-up",
      metadata: {
        ...userMetadata,
        steering,
        attachments,
        engine,
        model,
        effort,
        followUpMode,
        promptKind: "follow-up",
      },
    });
    const transcript = readCodeAgentTranscript({ runId });
    const event = transcript.events.at(-1);
    return {
      ok: result.ok,
      event,
      eventFile: transcript.eventFile,
      message:
        result.message ??
        (runIsActive
          ? followUpMode === "queued"
            ? "Follow-up queued."
            : "Steering prompt recorded."
          : "Follow-up recorded."),
      error: result.error,
    };
  } catch (err) {
    return {
      ok: false,
      message: "Could not record the follow-up.",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function updateCodeAgentRun(input: unknown): CodeAgentUpdateRunResult {
  const payload = isObject(input) ? input : {};
  const runId = normalizeCodeAgentRunId(payload.runId);
  if (!runId) {
    return {
      ok: false,
      message: "Select a session first.",
      error: "Missing or invalid run id.",
    };
  }

  const runFile = codeAgentRunFilePath(runId);
  if (!runFile || !fs.existsSync(runFile)) {
    return {
      ok: false,
      message: "Agent-Native Code session was not found.",
      error: `No run record exists for ${runId}.`,
    };
  }

  const requestedPermissionMode = firstStringValue(payload.permissionMode);
  const permissionMode = requestedPermissionMode
    ? getCodeAgentPermissionMode(requestedPermissionMode)
    : undefined;
  // A mode/title/metadata update is allowed to omit model selection. Do not
  // turn that omission into the default local engine: a Claude run must stay
  // a Claude run when the transcript syncs its permission mode.
  const requestedEngine = firstStringValue(payload.engine);
  const engine = requestedEngine
    ? normalizeCodeAgentRequestedEngine(requestedEngine)
    : undefined;
  const model = firstStringValue(payload.model);
  const effort = firstStringValue(payload.effort);
  const userMetadata = isObject(payload.metadata) ? payload.metadata : {};
  const newTitle =
    typeof payload.title === "string" ? payload.title.trim() : undefined;
  if (requestedPermissionMode && !permissionMode) {
    return {
      ok: false,
      message: "Choose a valid run mode.",
      error: `Unsupported run mode: ${requestedPermissionMode}`,
    };
  }

  const record = readCodeAgentRunRecord(runId);
  const recordMetadata = isObject(record?.metadata) ? record.metadata : {};
  const preservedEngine = firstStringValue(
    recordMetadata.engine,
    record?.engine,
  );
  const preservedModel = firstStringValue(recordMetadata.model, record?.model);
  const preservedEffort = firstStringValue(
    recordMetadata.effort,
    recordMetadata.reasoningEffort,
    record?.effort,
  );
  const nextEngine = engine ?? preservedEngine;
  const nextModel = model ?? preservedModel;
  const nextEffort = effort ?? preservedEffort;

  if (permissionMode) {
    const steering = buildCodeAgentSteeringMetadata({
      cwd: getRecordString(record, "cwd"),
      permissionMode,
      engine: nextEngine,
      model: nextModel,
      effort: nextEffort,
      attachments: normalizeCodeAgentPromptAttachments(
        isObject(record?.metadata) ? record.metadata.attachments : undefined,
      ),
    });
    touchCodeAgentRunRecord(runId, {
      ...(newTitle ? { title: newTitle } : {}),
      permissionMode,
      steering,
      metadata: {
        ...userMetadata,
        permissionMode,
        ...(nextEngine ? { engine: nextEngine } : {}),
        ...(nextModel ? { model: nextModel } : {}),
        ...(nextEffort ? { effort: nextEffort } : {}),
        steering,
      },
    });
  } else if (requestedEngine || model || effort) {
    const steering = buildCodeAgentSteeringMetadata({
      cwd: getRecordString(record, "cwd"),
      permissionMode: readCodeAgentPermissionMode(record),
      engine: nextEngine,
      model: nextModel,
      effort: nextEffort,
      attachments: normalizeCodeAgentPromptAttachments(
        isObject(record?.metadata) ? record.metadata.attachments : undefined,
      ),
    });
    touchCodeAgentRunRecord(runId, {
      ...(newTitle ? { title: newTitle } : {}),
      steering,
      metadata: {
        ...userMetadata,
        ...(nextEngine ? { engine: nextEngine } : {}),
        ...(nextModel ? { model: nextModel } : {}),
        ...(nextEffort ? { effort: nextEffort } : {}),
        steering,
      },
    });
  } else if (newTitle || Object.keys(userMetadata).length > 0) {
    touchCodeAgentRunRecord(runId, {
      ...(newTitle ? { title: newTitle } : {}),
      ...(Object.keys(userMetadata).length > 0
        ? { metadata: userMetadata }
        : {}),
    });
  }

  const run = readDesktopCodeAgentRun(runId);
  return {
    ok: Boolean(run),
    run: run ?? undefined,
    message: run
      ? "Agent-Native Code session updated."
      : "Session update failed.",
    error: run ? undefined : "Could not read the updated session record.",
  };
}

function getHomeDirectory(): string {
  try {
    return app.getPath("home");
  } catch {
    return os.homedir();
  }
}

function hasUrlProtocol(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value);
}

function isWindowsDrivePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value);
}

function expandPathCandidate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("file:")) {
    try {
      return fileURLToPath(trimmed);
    } catch (error) {
      void error;
      return null;
    }
  }

  if (hasUrlProtocol(trimmed) && !isWindowsDrivePath(trimmed)) {
    return null;
  }

  if (trimmed === "~") {
    return getHomeDirectory();
  }
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path.join(getHomeDirectory(), trimmed.slice(2));
  }

  return trimmed;
}

function isFilesystemRoot(dir: string): boolean {
  return path.parse(dir).root === dir;
}

function resolveUsableDirectory(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const expanded = expandPathCandidate(value);
  if (!expanded) return null;
  const resolved = path.resolve(expanded);
  if (isFilesystemRoot(resolved)) return null;

  try {
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) return resolved;
    if (stat.isFile()) {
      const parent = path.dirname(resolved);
      return isFilesystemRoot(parent) ? null : parent;
    }
  } catch {
    return null;
  }

  return null;
}

function resolveCodeAgentsTerminalCwd(
  request: unknown,
): CodeAgentTerminalResult["cwd"] {
  const record =
    request && typeof request === "object"
      ? (request as Partial<CodeAgentTerminalRequest>)
      : {};
  const candidates: unknown[] = [
    record.sourceRoot,
    record.outputRoot,
    record.cwd,
    process.env.AGENT_NATIVE_PROJECT_ROOT,
    process.env.CODE_AGENTS_PROJECT_ROOT,
    process.env.INIT_CWD,
    process.env.PWD,
    IS_DEV ? process.cwd() : undefined,
    getHomeDirectory(),
    os.homedir(),
  ];

  for (const candidate of candidates) {
    const dir = resolveUsableDirectory(candidate);
    if (dir) return dir;
  }

  return getHomeDirectory();
}

function projectFolderId(folderPath: string): string {
  return Buffer.from(folderPath).toString("base64url").slice(0, 48);
}

function projectFolderName(folderPath: string): string {
  const base = path.basename(folderPath);
  return base || folderPath;
}

function normalizeProjectFolder(folderPath: string): CodeAgentProjectFolder {
  return {
    id: projectFolderId(folderPath),
    path: folderPath,
    name: projectFolderName(folderPath),
    updatedAt: new Date().toISOString(),
  };
}

function readCodeAgentProjectsState(): {
  selectedPath?: string;
  projects: CodeAgentProjectFolder[];
} {
  const filePath = codeAgentProjectsFile();
  const raw = fs.existsSync(filePath) ? readJsonObjectFile(filePath) : null;
  const rawProjects = Array.isArray(raw?.projects)
    ? (raw.projects as unknown[])
    : [];
  const projects = rawProjects
    .map((item): CodeAgentProjectFolder | null => {
      if (!isObject(item) || typeof item.path !== "string") return null;
      const dir = resolveUsableDirectory(item.path);
      if (!dir) return null;
      const project: CodeAgentProjectFolder = {
        id: typeof item.id === "string" ? item.id : projectFolderId(dir),
        path: dir,
        name:
          typeof item.name === "string" && item.name.trim()
            ? item.name
            : projectFolderName(dir),
      };
      if (typeof item.updatedAt === "string")
        project.updatedAt = item.updatedAt;
      return project;
    })
    .filter((item): item is CodeAgentProjectFolder => Boolean(item));
  const selectedPath =
    typeof raw?.selectedPath === "string"
      ? (resolveUsableDirectory(raw.selectedPath) ?? undefined)
      : undefined;
  return { selectedPath, projects };
}

function writeCodeAgentProjectsState(state: {
  selectedPath?: string;
  projects: CodeAgentProjectFolder[];
}) {
  writeJsonFileAtomically(codeAgentProjectsFile(), state);
}

function upsertCodeAgentProject(
  folderPath: string,
): CodeAgentProjectSelectResult {
  const dir = resolveUsableDirectory(folderPath);
  if (!dir) {
    const state = readCodeAgentProjectsState();
    return {
      ok: false,
      projects: state.projects,
      selectedPath: state.selectedPath,
      error: "Choose an existing folder.",
    };
  }

  const state = readCodeAgentProjectsState();
  const project = normalizeProjectFolder(dir);
  const projects = [
    project,
    ...state.projects.filter((item) => item.path !== dir),
  ].slice(0, 20);
  writeCodeAgentProjectsState({ selectedPath: dir, projects });
  return {
    ok: true,
    project,
    projects,
    selectedPath: dir,
  };
}

function listCodeAgentProjects(): CodeAgentProjectListResult {
  try {
    const defaultPath = resolveCodeAgentsTerminalCwd({});
    const state = readCodeAgentProjectsState();
    const defaultProject = normalizeProjectFolder(defaultPath);
    const projects = [
      defaultProject,
      ...state.projects.filter((item) => item.path !== defaultPath),
    ];
    return {
      status: "ok",
      projects,
      selectedPath: state.selectedPath ?? defaultPath,
      defaultPath,
    };
  } catch (err) {
    return {
      status: "unavailable",
      projects: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function listMultiFrontierWorkspaces(): {
  selectedPath?: string;
  workspaces: Array<{ id: string; path: string }>;
} {
  const defaultPath = resolveCodeAgentsTerminalCwd({});
  const state = readCodeAgentProjectsState();
  const projects = [
    normalizeProjectFolder(defaultPath),
    ...state.projects.filter((project) => project.path !== defaultPath),
  ];
  return {
    selectedPath: state.selectedPath ?? defaultPath,
    workspaces: projects.map(({ id, path: projectPath }) => ({
      id,
      path: projectPath,
    })),
  };
}

function disposeMultiFrontierAppIntegration(): Promise<void> {
  if (!multiFrontierDisposePromise) {
    multiFrontierDisposePromise =
      multiFrontierAppIntegration?.dispose() ?? Promise.resolve();
  }
  return multiFrontierDisposePromise;
}

function initializeMultiFrontierAppIntegrationForRuntime(): void {
  multiFrontierDisposePromise = undefined;
  multiFrontierAppIntegration = initializeMultiFrontierAppIntegration({
    ipcMain,
    storeRoot: codeAgentStoreRoot(),
    loginCwd: resolveCodeAgentsTerminalCwd({}),
    listWorkspaces: listMultiFrontierWorkspaces,
    resolveDirectory: resolveUsableDirectory,
  });
}

async function chooseCodeAgentProject(): Promise<CodeAgentProjectSelectResult> {
  const result = await dialog.showOpenDialog({
    title: "Choose Agent-Native Code project folder",
    properties: ["openDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) {
    const state = readCodeAgentProjectsState();
    return {
      ok: false,
      projects: state.projects,
      selectedPath: state.selectedPath,
      error: "No folder selected.",
    };
  }
  return upsertCodeAgentProject(result.filePaths[0]);
}

function packageManagerForFolder(
  dir: string,
  pkg: Record<string, unknown> | null,
): string {
  const packageManager = firstStringValue(pkg?.packageManager);
  const packageManagerName = packageManager?.split("@")[0]?.trim();
  if (
    packageManagerName === "pnpm" ||
    packageManagerName === "npm" ||
    packageManagerName === "yarn" ||
    packageManagerName === "bun"
  ) {
    return packageManagerName;
  }
  if (fs.existsSync(path.join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(dir, "yarn.lock"))) return "yarn";
  if (
    fs.existsSync(path.join(dir, "bun.lock")) ||
    fs.existsSync(path.join(dir, "bun.lockb"))
  ) {
    return "bun";
  }
  if (fs.existsSync(path.join(dir, "package-lock.json"))) return "npm";
  return "pnpm";
}

function scriptCommand(packageManager: string, scriptName: string): string {
  if (packageManager === "npm") {
    return scriptName === "start" ? "npm start" : `npm run ${scriptName}`;
  }
  if (packageManager === "bun") return `bun run ${scriptName}`;
  return `${packageManager} ${scriptName}`;
}

function scriptsFromPackage(
  pkg: Record<string, unknown> | null,
): Record<string, string> {
  const scripts = isObject(pkg?.scripts) ? pkg.scripts : {};
  return Object.fromEntries(
    Object.entries(scripts).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function selectedDevScriptName(scripts: Record<string, string>): string {
  if (scripts.dev) return "dev";
  if (scripts.start) return "start";
  return "dev";
}

function stripPackageScope(value: string): string {
  return value.startsWith("@") ? (value.split("/")[1] ?? value) : value;
}

function titleizePackageName(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function localAppNameForFolder(
  dir: string,
  pkg: Record<string, unknown> | null,
): string {
  const displayName = firstStringValue(pkg?.displayName, pkg?.productName);
  if (displayName) return displayName;
  const packageName = firstStringValue(pkg?.name);
  if (packageName) return titleizePackageName(stripPackageScope(packageName));
  return titleizePackageName(path.basename(dir) || dir);
}

function explicitPortFromScript(script: string | undefined): number | null {
  if (!script) return null;
  const patterns = [
    /\bPORT=(\d{2,5})\b/i,
    /\b--port(?:=|\s+)(\d{2,5})\b/i,
    /\b-p\s+(\d{2,5})\b/i,
    /\b(?:localhost|127\.0\.0\.1|\[::1\]):(\d{2,5})\b/i,
  ];
  for (const pattern of patterns) {
    const match = script.match(pattern);
    const port = match?.[1] ? Number(match[1]) : NaN;
    if (Number.isInteger(port) && port > 0 && port <= 65535) return port;
  }
  return null;
}

function localAppDevPortForFolder(
  dir: string,
  pkg: Record<string, unknown> | null,
  devScript: string | undefined,
): number {
  const explicitPort = explicitPortFromScript(devScript);
  if (explicitPort) return explicitPort;

  const isWorkspaceRoot = fs.existsSync(path.join(dir, "pnpm-workspace.yaml"));
  if (isWorkspaceRoot || /\bworkspace-dev\b/.test(devScript ?? "")) return 8080;

  const packageName = firstStringValue(pkg?.name);
  const template = packageName
    ? getTemplate(stripPackageScope(packageName))
    : undefined;
  if (template?.devPort) return template.devPort;

  if (/\b(agent-native\s+dev|vite)\b/.test(devScript ?? "")) return 5173;

  return 3000;
}

function quotePosixShellPath(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function commandForLocalAppFolder(dir: string, command: string): string {
  if (process.platform === "win32") {
    return `cd /d ${quoteWindowsCmdPath(dir)} && ${command}`;
  }
  return `cd ${quotePosixShellPath(dir)} && ${command}`;
}

function inspectLocalAppFolder(dir: string): LocalAppFolderInfo {
  const packagePath = path.join(dir, "package.json");
  const pkg = readJsonObjectFile(packagePath);
  const scripts = scriptsFromPackage(pkg);
  const scriptName = selectedDevScriptName(scripts);
  const packageManager = packageManagerForFolder(dir, pkg);
  const runCommand = scriptCommand(packageManager, scriptName);
  const devScript = scripts[scriptName];
  const devPort = localAppDevPortForFolder(dir, pkg, devScript);
  return {
    path: dir,
    name: localAppNameForFolder(dir, pkg),
    devUrl: `http://localhost:${devPort}`,
    devPort,
    devCommand: commandForLocalAppFolder(dir, runCommand),
    packageManager,
    warning: pkg
      ? undefined
      : "No package.json was found. Fill in the dev URL manually if needed.",
  };
}

async function chooseLocalAppFolder(): Promise<LocalAppFolderSelectResult> {
  const result = await dialog.showOpenDialog({
    title: "Choose local app folder",
    properties: ["openDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return {
      ok: false,
      error: "No folder selected.",
    };
  }
  const dir = resolveUsableDirectory(result.filePaths[0]);
  if (!dir) {
    return {
      ok: false,
      error: "Choose an existing folder.",
    };
  }
  return {
    ok: true,
    folder: inspectLocalAppFolder(dir),
  };
}

const managedDesktopAppProcesses = new Map<string, ChildProcess>();
const managedDesktopAppRetryTimers = new Map<
  string,
  ReturnType<typeof setTimeout>
>();
const managedDesktopAppStarts = new Set<string>();
const managedDesktopAppStartAttempts = new Map<string, number>();
type ManagedDesktopAppDemandSource = "active-app" | "chat-first-preview";
const managedDesktopAppDemand = new Map<
  string,
  Set<ManagedDesktopAppDemandSource>
>();

function hasManagedDesktopAppDemand(appId: string): boolean {
  return (managedDesktopAppDemand.get(appId)?.size ?? 0) > 0;
}

function stopManagedDesktopAppProcess(appId: string): void {
  const child = managedDesktopAppProcesses.get(appId);
  if (!child) return;
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  } else {
    child.kill("SIGTERM");
  }
  managedDesktopAppProcesses.delete(appId);
}

function setManagedDesktopAppDemand(
  appId: string,
  source: ManagedDesktopAppDemandSource,
  demanded: boolean,
): void {
  if (!appId) return;
  const sources = managedDesktopAppDemand.get(appId) ?? new Set();
  if (demanded) {
    if (!AppStore.isDesktopManagedApp(appId)) return;
    sources.add(source);
    managedDesktopAppDemand.set(appId, sources);
    if (!managedDesktopAppProcesses.get(appId)?.pid) {
      scheduleManagedDesktopAppStart(appId);
    }
    return;
  }

  sources.delete(source);
  if (sources.size > 0) {
    managedDesktopAppDemand.set(appId, sources);
    return;
  }
  managedDesktopAppDemand.delete(appId);
  clearManagedDesktopAppRetry(appId);
  managedDesktopAppStartAttempts.delete(appId);
  stopManagedDesktopAppProcess(appId);
}

function setDesktopActiveAppId(appId: string): void {
  const nextAppId = appId.trim();
  if (activeAppId === nextAppId) return;

  const previousAppId = activeAppId;
  if (previousAppId) {
    setManagedDesktopAppDemand(previousAppId, "active-app", false);
    if (previousAppId === CODE_AGENTS_SURFACE_ID && chatFirstPreviewAppId) {
      setManagedDesktopAppDemand(
        chatFirstPreviewAppId,
        "chat-first-preview",
        false,
      );
    }
  }

  activeAppId = nextAppId;
  if (nextAppId) setManagedDesktopAppDemand(nextAppId, "active-app", true);
  if (nextAppId === CODE_AGENTS_SURFACE_ID && chatFirstPreviewAppId) {
    setManagedDesktopAppDemand(
      chatFirstPreviewAppId,
      "chat-first-preview",
      true,
    );
  }
}

function desktopAppCreationSettings(): DesktopAppCreationSettings {
  return {
    appsRoot: AppStore.loadDesktopAppPreferences().appsRoot,
  };
}

function normalizeDesktopAppsRoot(value: unknown): string | null {
  const expanded =
    typeof value === "string" ? expandPathCandidate(value.trim()) : "";
  if (!expanded) return null;
  const resolved = path.resolve(expanded);
  return isFilesystemRoot(resolved) ? null : resolved;
}

function appFolderSlug(prompt: string): string {
  const normalized = prompt
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter(Boolean)
    .slice(0, 5)
    .join("-");
  return normalized || "new-app";
}

function uniqueDesktopAppFolder(
  root: string,
  baseSlug: string,
): {
  name: string;
  path: string;
} {
  for (let index = 1; index < 10_000; index += 1) {
    const name = index === 1 ? baseSlug : `${baseSlug}-${index}`;
    const candidate = path.join(root, name);
    if (!fs.existsSync(candidate)) return { name, path: candidate };
  }
  const name = `${baseSlug}-${randomUUID().slice(0, 8)}`;
  return { name, path: path.join(root, name) };
}

function titleizeAppFolder(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function requestedDesktopAppName(prompt: string): string | undefined {
  const quotedMatch = prompt.match(
    /\b(?:called|named)\s+["“]([^"”\n]{1,48})["”]/i,
  );
  const unquotedMatch = prompt.match(
    /\b(?:called|named)\s+([A-Za-z][A-Za-z0-9&' -]{0,47}?)(?=\s*(?:[.!?,;:\n]|\s+(?:that|which|with|for|to|and|it|so)\b|$))/i,
  );
  const name = (quotedMatch?.[1] ?? unquotedMatch?.[1] ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return name || undefined;
}

function nextDesktopManagedAppPort(apps: AppConfig[]): number {
  const used = new Set(
    apps
      .map((candidate) => candidate.devPort)
      .filter((port) => Number.isInteger(port) && port > 0),
  );
  for (let port = 5180; port <= 5999; port += 1) {
    if (!used.has(port)) return port;
  }
  return 6000 + Math.floor(Math.random() * 1000);
}

function preferredDesktopManagedAppPort(
  apps: AppConfig[],
  appId: string,
  preferredPort: number,
): number {
  const used = new Set(
    apps
      .filter((candidate) => candidate.id !== appId)
      .map((candidate) => candidate.devPort)
      .filter((port) => Number.isInteger(port) && port > 0),
  );
  return Number.isInteger(preferredPort) &&
    preferredPort > 0 &&
    !used.has(preferredPort)
    ? preferredPort
    : nextDesktopManagedAppPort(apps);
}

function buildDesktopCreateAppAgentPrompt(input: {
  userPrompt: string;
  folderName: string;
  targetPath: string;
  port: number;
}): string {
  return buildChatFirstAppCreationPrompt({
    appId: input.folderName,
    prompt: input.userPrompt,
    selectedKeys: [],
    selectedResources: [],
    vaultAccessMode: "all-apps",
    appRoot: input.targetPath,
    mountPath: "/",
    scaffoldCommand: `Run this non-interactive scaffold command from the current directory, then work only inside ${input.targetPath}:\nnpx --yes @agent-native/core@latest create ${input.folderName} --template chat`,
    additionalInstructions: [
      `The Desktop shell will run the app on port ${input.port}; do not leave a long-running dev server running yourself.`,
      "Use production-quality behavior by default. Keep local development conveniences out of the shipped app unless the user is actively editing it.",
    ],
  });
}

function buildDesktopLocalCodeChangeAgentPrompt(input: {
  sourceTemplate: string;
  userPrompt: string;
  folderName: string;
  targetPath: string;
  appsRoot: string;
  port: number;
  existingLocalApp: boolean;
}): string {
  const scaffold = `npx --yes @agent-native/core@latest create ${input.folderName} --standalone --template ${input.sourceTemplate}`;
  const scaffoldCommand = input.existingLocalApp
    ? `The local app already exists at ${input.targetPath}. Do not scaffold a second app. Work only inside that folder.`
    : `Run this non-interactive scaffold command from ${input.appsRoot}, then work only inside ${input.targetPath}:\n${commandForLocalAppFolder(input.appsRoot, scaffold)}`;
  return buildChatFirstAppCreationPrompt({
    appId: input.sourceTemplate,
    prompt: input.userPrompt,
    selectedKeys: [],
    selectedResources: [],
    vaultAccessMode: "all-apps",
    appRoot: input.targetPath,
    mountPath: "/",
    scaffoldCommand,
    additionalInstructions: [
      "This is an explicit request to customize a first-party template locally. The user chose local development from the Desktop app.",
      `The source template is ${input.sourceTemplate}. Preserve its app identity and behavior unless the user's request changes them.`,
      input.existingLocalApp
        ? `Start by running pnpm install from ${input.targetPath} if dependencies are missing or stale.`
        : `After scaffolding, run pnpm install from ${input.targetPath} before making the requested code changes.`,
      "Never edit a hosted or production checkout. This local folder is the only source you may modify for this request; leave the production URL and deployment configuration untouched.",
      `The Desktop shell will run the local app on port ${input.port}; do not leave a long-running dev server running yourself.`,
      "Keep local-only setup in the local clone. Do not add development shortcuts or fake data to the production-facing app behavior unless the user explicitly asks for them.",
    ],
  });
}

async function createDesktopAppFromPrompt(
  input: DesktopCreateAppRequest,
): Promise<DesktopCreateAppResult> {
  const prompt = typeof input?.prompt === "string" ? input.prompt.trim() : "";
  const currentApps = AppStore.loadApps();
  if (!prompt) {
    return {
      ok: false,
      apps: currentApps,
      message: "Describe the app you want to build.",
      error: "Missing prompt.",
    };
  }
  if (prompt.length > 8_000) {
    return {
      ok: false,
      apps: currentApps,
      message: "Keep the first app prompt under 8,000 characters.",
      error: "Prompt is too long.",
    };
  }

  const appsRoot = normalizeDesktopAppsRoot(
    input.appsRoot ?? AppStore.loadDesktopAppPreferences().appsRoot,
  );
  if (!appsRoot) {
    return {
      ok: false,
      apps: currentApps,
      message: "Choose a valid folder for new apps.",
      error: "Invalid apps folder.",
    };
  }

  try {
    fs.mkdirSync(appsRoot, { recursive: true });
    AppStore.saveDesktopAppPreferences({ appsRoot });
  } catch (err) {
    return {
      ok: false,
      apps: currentApps,
      message: "Desktop could not prepare the apps folder.",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const folder = uniqueDesktopAppFolder(appsRoot, appFolderSlug(prompt));
  const port = nextDesktopManagedAppPort(currentApps);
  const appId = `local-${folder.name}-${randomUUID().slice(0, 8)}`;
  const agentPrompt = buildDesktopCreateAppAgentPrompt({
    userPrompt: prompt,
    folderName: folder.name,
    targetPath: folder.path,
    port,
  });
  // The target is intentionally empty until the coding agent runs the
  // scaffold command. Start the runner from the framework workspace so the
  // local Codex/Claude CLIs can initialize before they write into the target.
  const appCreationCwd = resolveRepositoryRoot(appsRoot);
  const runResult = await createCodeAgentRun({
    goalId: "task",
    prompt: agentPrompt,
    cwd: appCreationCwd,
    permissionMode: "full-auto",
    metadata: {
      kind: "desktop-create-app",
      appId,
      appPath: folder.path,
      userPrompt: prompt,
    },
  });
  if (!runResult.ok || !runResult.run) {
    return {
      ok: false,
      apps: currentApps,
      message: runResult.message,
      error: runResult.error,
    };
  }

  const generatedName = runResult.run.title?.trim();
  const requestedName = requestedDesktopAppName(prompt);
  const appConfig: AppConfig = {
    id: appId,
    name:
      requestedName ??
      (generatedName &&
      generatedName !== "Coding task" &&
      generatedName.length <= 48 &&
      !generatedName.endsWith("...")
        ? generatedName
        : titleizeAppFolder(folder.name)),
    icon: "Code",
    description: prompt.replace(/\s+/g, " ").slice(0, 180),
    url: "",
    devPort: port,
    devUrl: `http://localhost:${port}`,
    devCommand: `pnpm exec agent-native dev --port ${port} --host 127.0.0.1`,
    localPath: folder.path,
    isBuiltIn: false,
    enabled: true,
    mode: "dev",
  };
  const apps = AppStore.addApp(appConfig);
  AppStore.markDesktopManagedApp(appId, appsRoot);
  if (chatFirstPreviewAppId && chatFirstPreviewAppId !== appId) {
    setManagedDesktopAppDemand(
      chatFirstPreviewAppId,
      "chat-first-preview",
      false,
    );
  }
  chatFirstPreviewAppId = appId;
  setManagedDesktopAppDemand(appId, "chat-first-preview", true);
  refreshDesktopShortcutBindings();
  return {
    ok: true,
    apps,
    app: appConfig,
    run: runResult.run,
    message: `Building ${appConfig.name}.`,
  };
}

async function prepareDesktopAppForLocalCodeChange(
  input: DesktopPrepareLocalCodeChangeRequest,
): Promise<DesktopPrepareLocalCodeChangeResult> {
  const prompt = typeof input?.prompt === "string" ? input.prompt.trim() : "";
  const appId = typeof input?.appId === "string" ? input.appId.trim() : "";
  const currentApps = AppStore.loadApps();
  const appConfig = currentApps.find((candidate) => candidate.id === appId);
  if (!appConfig) {
    return {
      ok: false,
      apps: currentApps,
      message: "That app is no longer available in Desktop.",
      error: "Unknown app.",
    };
  }
  if (!prompt) {
    return {
      ok: false,
      apps: currentApps,
      message: "Describe the code change you want to make.",
      error: "Missing prompt.",
    };
  }
  if (prompt.length > 8_000) {
    return {
      ok: false,
      apps: currentApps,
      message: "Keep the code-change prompt under 8,000 characters.",
      error: "Prompt is too long.",
    };
  }

  const template = getTemplate(appId);
  const existingLocalPath = resolveUsableDirectory(appConfig.localPath);
  const existingLocalApp = Boolean(
    existingLocalPath &&
    fs.existsSync(path.join(existingLocalPath, "package.json")),
  );
  if (!template && !existingLocalApp) {
    return {
      ok: false,
      apps: currentApps,
      message: "This app does not have a local template to clone yet.",
      error: "No local template.",
    };
  }

  const appsRoot = normalizeDesktopAppsRoot(
    AppStore.loadDesktopAppPreferences().appsRoot,
  );
  if (!appsRoot) {
    return {
      ok: false,
      apps: currentApps,
      message: "Choose a valid folder for local apps in Desktop settings.",
      error: "Invalid apps folder.",
    };
  }

  let targetPath = existingLocalApp ? existingLocalPath : "";
  let folderName = targetPath ? path.basename(targetPath) : "";
  if (!targetPath) {
    try {
      fs.mkdirSync(appsRoot, { recursive: true });
      AppStore.saveDesktopAppPreferences({ appsRoot });
    } catch (err) {
      return {
        ok: false,
        apps: currentApps,
        message: "Desktop could not prepare the local apps folder.",
        error: err instanceof Error ? err.message : String(err),
      };
    }
    const folder = uniqueDesktopAppFolder(appsRoot, `${appId}-local`);
    targetPath = folder.path;
    folderName = folder.name;
  }

  const sourceTemplate = template?.name ?? appId;
  const port = preferredDesktopManagedAppPort(
    currentApps,
    appId,
    appConfig.devPort || template?.devPort || 5173,
  );
  const agentPrompt = buildDesktopLocalCodeChangeAgentPrompt({
    sourceTemplate,
    userPrompt: prompt,
    folderName,
    targetPath,
    appsRoot,
    port,
    existingLocalApp,
  });
  // The template CLI creates into its current directory. Running from the
  // configured apps root keeps the generated checkout beside the path saved
  // in AppStore, even when Desktop itself is launched outside the repository.
  const appCreationCwd = appsRoot;
  const runResult = await createCodeAgentRun({
    goalId: "task",
    prompt: agentPrompt,
    cwd: appCreationCwd,
    permissionMode: "full-auto",
    metadata: {
      kind: "desktop-local-code-change",
      appId,
      sourceTemplate,
      appPath: targetPath,
      userPrompt: prompt,
    },
  });
  if (!runResult.ok || !runResult.run) {
    return {
      ok: false,
      apps: currentApps,
      message: runResult.message,
      error: runResult.error,
    };
  }

  const apps = AppStore.updateApp(appId, {
    mode: "dev",
    devPort: port,
    devUrl: `http://localhost:${port}`,
    devCommand: `pnpm exec agent-native dev --port ${port} --host 127.0.0.1`,
    localPath: targetPath,
  });
  const updatedApp = apps.find((candidate) => candidate.id === appId);
  if (!updatedApp) {
    return {
      ok: false,
      apps: currentApps,
      message: "Desktop could not save the local app configuration.",
      error: "App disappeared while preparing local code change.",
    };
  }

  AppStore.markDesktopManagedApp(appId, appsRoot);
  if (activeAppId === appId) {
    setManagedDesktopAppDemand(appId, "active-app", true);
  }
  refreshDesktopShortcutBindings();
  return {
    ok: true,
    apps,
    app: updatedApp,
    run: runResult.run,
    message: `Preparing ${updatedApp.name} locally.`,
  };
}

const lastDesktopAppRuntimeStatus = new Map<string, string>();

/**
 * This is a state, not an event stream: a managed dev server emits a stdout
 * chunk per HMR update and per transform, and each one re-sends the identical
 * "running / Preview updated." status. Forwarding every one floods the renderer
 * with IPC and re-renders for a status that has not changed. Send only on an
 * actual transition.
 */
function emitDesktopAppRuntimeStatus(status: DesktopAppRuntimeStatus): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const signature = `${status.state} ${status.message ?? ""}`;
  if (lastDesktopAppRuntimeStatus.get(status.appId) === signature) return;
  lastDesktopAppRuntimeStatus.set(status.appId, signature);
  mainWindow.webContents.send(IPC.APP_STATUS, status);
}

async function desktopAppUrlIsReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(1_500),
    });
    return response.status > 0;
  } catch {
    return false;
  }
}

function clearManagedDesktopAppRetry(appId: string): void {
  const timer = managedDesktopAppRetryTimers.get(appId);
  if (timer) clearTimeout(timer);
  managedDesktopAppRetryTimers.delete(appId);
}

function scheduleManagedDesktopAppStart(appId: string, delay = 2_000): void {
  if (appIsQuitting || !hasManagedDesktopAppDemand(appId)) return;
  clearManagedDesktopAppRetry(appId);
  managedDesktopAppRetryTimers.set(
    appId,
    setTimeout(() => {
      managedDesktopAppRetryTimers.delete(appId);
      void ensureManagedDesktopAppRunning(appId);
    }, delay),
  );
}

async function ensureManagedDesktopAppRunning(appId: string): Promise<void> {
  if (
    appIsQuitting ||
    !hasManagedDesktopAppDemand(appId) ||
    !AppStore.isDesktopManagedApp(appId) ||
    managedDesktopAppStarts.has(appId)
  ) {
    return;
  }
  const appConfig = AppStore.loadApps().find(
    (candidate) =>
      candidate.id === appId &&
      candidate.enabled !== false &&
      candidate.mode === "dev",
  );
  if (!appConfig?.localPath || !appConfig.devUrl || !appConfig.devCommand) {
    return;
  }
  if (managedDesktopAppProcesses.get(appId)?.pid) return;

  managedDesktopAppStarts.add(appId);
  try {
    if (await desktopAppUrlIsReachable(appConfig.devUrl)) {
      emitDesktopAppRuntimeStatus({
        appId,
        state: "running",
        message: "Preview ready.",
      });
      return;
    }
    if (
      !fs.existsSync(appConfig.localPath) ||
      !fs.existsSync(path.join(appConfig.localPath, "package.json"))
    ) {
      emitDesktopAppRuntimeStatus({
        appId,
        state: "waiting",
        message: "The coding agent is creating this app.",
      });
      scheduleManagedDesktopAppStart(appId);
      return;
    }

    if (!hasManagedDesktopAppDemand(appId)) return;
    emitDesktopAppRuntimeStatus({
      appId,
      state: "starting",
      message: `Starting ${appConfig.name}.`,
    });
    managedDesktopAppStartAttempts.set(
      appId,
      (managedDesktopAppStartAttempts.get(appId) ?? 0) + 1,
    );
    const child = spawn(appConfig.devCommand, {
      cwd: appConfig.localPath,
      env: {
        ...process.env,
        BROWSER: "none",
      },
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    managedDesktopAppProcesses.set(appId, child);
    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (!text) return;
      console.log(`[desktop-app:${appId}] ${text}`);
      emitDesktopAppRuntimeStatus({
        appId,
        state: "starting",
        message: "Building the local preview.",
      });
    });
    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (!text) return;
      console.error(`[desktop-app:${appId}] ${text}`);
      if (/\b(error|failed|fatal|compile|syntaxerror)\b/i.test(text)) {
        emitDesktopAppRuntimeStatus({
          appId,
          state: "error",
          message: "The local preview reported a build error.",
        });
      }
    });
    child.once("error", () => {
      if (managedDesktopAppProcesses.get(appId) === child) {
        managedDesktopAppProcesses.delete(appId);
      }
      emitDesktopAppRuntimeStatus({
        appId,
        state: "error",
        message: "The local preview could not start.",
      });
    });
    child.once("exit", (code) => {
      if (managedDesktopAppProcesses.get(appId) === child) {
        managedDesktopAppProcesses.delete(appId);
      }
      if (appIsQuitting) return;
      emitDesktopAppRuntimeStatus({
        appId,
        state: code === 0 ? "stopped" : "error",
        message:
          code === 0
            ? `${appConfig.name} stopped.`
            : "The local preview process exited unexpectedly.",
      });
      if ((managedDesktopAppStartAttempts.get(appId) ?? 0) < 20) {
        scheduleManagedDesktopAppStart(appId, 3_000);
      }
    });

    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (!hasManagedDesktopAppDemand(appId)) {
        stopManagedDesktopAppProcess(appId);
        return;
      }
      if (await desktopAppUrlIsReachable(appConfig.devUrl)) {
        managedDesktopAppStartAttempts.delete(appId);
        emitDesktopAppRuntimeStatus({
          appId,
          state: "running",
          message: "Preview ready.",
        });
        return;
      }
      if (child.exitCode !== null || child.killed) return;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    emitDesktopAppRuntimeStatus({
      appId,
      state: "error",
      message: "The local preview did not become ready.",
    });
  } catch {
    emitDesktopAppRuntimeStatus({
      appId,
      state: "error",
      message: "The local preview could not start.",
    });
  } finally {
    managedDesktopAppStarts.delete(appId);
  }
}

function stopManagedDesktopApp(appId: string): void {
  managedDesktopAppDemand.delete(appId);
  if (chatFirstPreviewAppId === appId) chatFirstPreviewAppId = null;
  clearManagedDesktopAppRetry(appId);
  managedDesktopAppStartAttempts.delete(appId);
  stopManagedDesktopAppProcess(appId);
}

function showDesktopAppContextMenu(
  appId: string,
): Promise<DesktopAppContextAction | null> {
  const apps = AppStore.loadApps();
  const index = apps.findIndex((candidate) => candidate.id === appId);
  const appConfig = apps[index];
  if (!appConfig) return Promise.resolve(null);

  return new Promise((resolve) => {
    let selected: DesktopAppContextAction | null = null;
    const choose = (action: DesktopAppContextAction) => {
      selected = action;
    };
    const menu = Menu.buildFromTemplate([
      { label: "Edit App…", click: () => choose("edit") },
      { type: "separator" },
      {
        label: "Move Up",
        enabled: index > 0,
        click: () => choose("move-up"),
      },
      {
        label: "Move Down",
        enabled: index < apps.length - 1,
        click: () => choose("move-down"),
      },
      { type: "separator" },
      {
        label: appConfig.isBuiltIn
          ? "Hide from Sidebar"
          : "Remove from Sidebar",
        click: () => choose("remove"),
      },
    ]);
    menu.popup({
      window: mainWindow ?? undefined,
      callback: () => resolve(selected),
    });
  });
}

const CONTENT_FILES_STORE_FILE = "content-file-sync.json";
const CONTENT_SOURCE_ROOT = "content";
const CONTENT_SOURCE_EXTENSIONS = [".md", ".mdx"] as const;
const CONTENT_SOURCE_FILE_MAX_BYTES = 2 * 1024 * 1024;
const LOCAL_CONTROL_RESOURCE_MAX_BYTES = 2 * 1024 * 1024;
const LOCAL_CONTROL_RESOURCE_FILES = [
  "AGENTS.md",
  "agent-native.json",
  "mcp.config.json",
  ".mcp.json",
] as const;
const LOCAL_CONTROL_RESOURCE_SKILL_ROOTS = [
  ".agents/skills",
  ".agent/skills",
] as const;
const LOCAL_CONTROL_RESOURCE_TEXT_EXTENSIONS = new Set([
  ".css",
  ".csv",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mdx",
  ".py",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);
const CONTENT_IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "dist",
  "node_modules",
]);

function assertInsideLocalFolder(folder: string, target: string): string {
  const resolvedFolder = path.resolve(folder);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedFolder, resolvedTarget);
  if (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  ) {
    return resolvedTarget;
  }
  throw new Error("Local file path escaped the linked folder.");
}

function assertRealPathInsideLocalFolder(
  folder: string,
  target: string,
): string {
  const resolvedTarget = assertInsideLocalFolder(folder, target);
  const realFolder = fs.realpathSync(folder);
  const realTarget = fs.realpathSync(resolvedTarget);
  const relative = path.relative(realFolder, realTarget);
  if (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  ) {
    return realTarget;
  }
  throw new Error("Local file path escaped the linked folder.");
}

function isLocalControlResourceTextPath(filePath: string): boolean {
  return LOCAL_CONTROL_RESOURCE_TEXT_EXTENSIONS.has(
    path.extname(filePath).toLowerCase(),
  );
}

function readLocalControlResourceWithoutSymlink(
  filePath: string,
): string | null {
  let fd: number | null = null;
  try {
    const stat = fs.lstatSync(filePath);
    if (
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      stat.size > LOCAL_CONTROL_RESOURCE_MAX_BYTES
    ) {
      return null;
    }
    fd = fs.openSync(
      filePath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    );
    const openedStat = fs.fstatSync(fd);
    if (
      !openedStat.isFile() ||
      openedStat.size > LOCAL_CONTROL_RESOURCE_MAX_BYTES
    ) {
      return null;
    }
    return fs.readFileSync(fd, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP") {
      return null;
    }
    throw err;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

function isMissingLocalControlResourceError(
  err: unknown,
): err is NodeJS.ErrnoException {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP";
}

async function collectLocalControlResources(
  folder: string,
): Promise<Record<string, string>> {
  const resources: Record<string, string> = {};

  for (const file of LOCAL_CONTROL_RESOURCE_FILES) {
    const filePath = assertInsideLocalFolder(folder, path.join(folder, file));
    const content = readLocalControlResourceWithoutSymlink(filePath);
    if (content !== null) resources[file] = content;
  }

  async function walkSkillRoot(
    rootName: (typeof LOCAL_CONTROL_RESOURCE_SKILL_ROOTS)[number],
    directory: string,
    prefix: string = rootName,
  ): Promise<void> {
    let stat: fs.Stats;
    try {
      stat = await fs.promises.lstat(directory);
    } catch (err) {
      if (isMissingLocalControlResourceError(err)) return;
      throw err;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) return;
    try {
      assertRealPathInsideLocalFolder(folder, directory);
    } catch (err) {
      if (isMissingLocalControlResourceError(err)) return;
      throw err;
    }
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch (err) {
      if (isMissingLocalControlResourceError(err)) return;
      throw err;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name === ".DS_Store") continue;
      const filePath = assertInsideLocalFolder(
        folder,
        path.join(directory, entry.name),
      );
      const resourcePath = `${prefix}/${entry.name}`.replace(/\\/g, "/");
      if (entry.isDirectory()) {
        await walkSkillRoot(rootName, filePath, resourcePath);
        continue;
      }
      if (!entry.isFile() || !isLocalControlResourceTextPath(resourcePath)) {
        continue;
      }
      const content = readLocalControlResourceWithoutSymlink(filePath);
      if (content !== null) resources[resourcePath] = content;
    }
  }

  for (const rootName of LOCAL_CONTROL_RESOURCE_SKILL_ROOTS) {
    const rootPath = assertInsideLocalFolder(
      folder,
      path.join(folder, rootName),
    );
    await walkSkillRoot(rootName, rootPath);
  }

  return resources;
}

export interface ContentFilesGrant {
  id: string;
  path: string;
  kind: "persistent" | "temporary";
  name?: string;
  repository?: DesktopContentFilesRepository;
  contentSource?: {
    sourceId: string;
    databaseId?: string;
  };
  createdAt?: string;
  sourcePrefix?: string;
  updatedAt?: string;
}

interface ContentFilesStore {
  version: 1;
  activeGrantId?: string;
  grant?: ContentFilesGrant;
  grants?: Record<string, ContentFilesGrant>;
}

const contentFilesChangeSubscribers = new Map<number, Set<string>>();
const contentFilesWatchers = new Map<string, fs.FSWatcher>();
const contentFilesChangeTimers = new Map<
  string,
  ReturnType<typeof setTimeout>
>();

function stopContentFilesWatcher(folderId: string): void {
  const timer = contentFilesChangeTimers.get(folderId);
  if (timer) clearTimeout(timer);
  contentFilesChangeTimers.delete(folderId);
  contentFilesWatchers.get(folderId)?.close();
  contentFilesWatchers.delete(folderId);
}

function contentFilesChangeRevision(): string {
  return createHash("sha256")
    .update(`${Date.now()}:${randomUUID()}`)
    .digest("hex");
}

function emitContentFilesChange(
  folderId: string,
  missing = false,
  reason: "attached" | "changed" | "missing" = missing ? "missing" : "changed",
): void {
  const changedAt = new Date().toISOString();
  for (const [webContentsId, folderIds] of contentFilesChangeSubscribers) {
    if (!folderIds.has(folderId)) continue;
    const subscriber = webContents.fromId(webContentsId);
    if (!subscriber || subscriber.isDestroyed()) {
      contentFilesChangeSubscribers.delete(webContentsId);
      continue;
    }
    subscriber.send(IPC.CONTENT_FILES_CHANGED, {
      folderId,
      revision: contentFilesChangeRevision(),
      changedAt,
      ...(missing ? { missing: true } : {}),
      reason,
    });
  }
}

function watchContentFilesGrant(grant: ContentFilesGrant): void {
  if (contentFilesWatchers.has(grant.id)) return;
  try {
    const watcher = fs.watch(grant.path, { recursive: true }, () => {
      const activeTimer = contentFilesChangeTimers.get(grant.id);
      if (activeTimer) clearTimeout(activeTimer);
      contentFilesChangeTimers.set(
        grant.id,
        setTimeout(() => {
          contentFilesChangeTimers.delete(grant.id);
          const missing = !resolveUsableContentFolder(grant.path);
          if (missing && grant.kind === "temporary") {
            stopContentFilesWatcher(grant.id);
            clearContentFilesGrant(grant.id);
          }
          emitContentFilesChange(grant.id, missing);
        }, 120),
      );
    });
    watcher.on("error", () => {
      if (
        grant.kind === "temporary" &&
        !resolveUsableContentFolder(grant.path)
      ) {
        stopContentFilesWatcher(grant.id);
        clearContentFilesGrant(grant.id);
        emitContentFilesChange(grant.id, true);
      }
    });
    contentFilesWatchers.set(grant.id, watcher);
  } catch {
    if (grant.kind === "temporary" && !resolveUsableContentFolder(grant.path)) {
      emitContentFilesChange(grant.id, true);
    }
  }
}

function subscribeContentFilesChanges(
  event: IpcMainInvokeEvent,
  folderId?: string,
): DesktopContentFilesResult {
  const grant = getContentFilesGrant(folderId);
  if (!grant) return { ok: false, error: "No local folder is linked." };
  const subscriberIds =
    contentFilesChangeSubscribers.get(event.sender.id) ?? new Set<string>();
  subscriberIds.add(grant.id);
  contentFilesChangeSubscribers.set(event.sender.id, subscriberIds);
  event.sender.once("destroyed", () =>
    contentFilesChangeSubscribers.delete(event.sender.id),
  );
  watchContentFilesGrant(grant);
  return { ok: true, folder: contentFilesFolderInfo(grant) };
}

function unsubscribeContentFilesChanges(
  event: IpcMainInvokeEvent,
  folderId?: string,
): DesktopContentFilesResult {
  const grant = getContentFilesGrant(folderId);
  if (!grant) return { ok: false, error: "No local folder is linked." };
  const subscriberIds = contentFilesChangeSubscribers.get(event.sender.id);
  if (!subscriberIds)
    return { ok: true, folder: contentFilesFolderInfo(grant) };
  if (folderId) subscriberIds.delete(grant.id);
  else subscriberIds.clear();
  if (subscriberIds.size === 0)
    contentFilesChangeSubscribers.delete(event.sender.id);
  const stillSubscribed = [...contentFilesChangeSubscribers.values()].some(
    (ids) => ids.has(grant.id),
  );
  if (!stillSubscribed) stopContentFilesWatcher(grant.id);
  return { ok: true, folder: contentFilesFolderInfo(grant) };
}

function contentFilesStorePath(): string {
  return path.join(app.getPath("userData"), CONTENT_FILES_STORE_FILE);
}

function resolveUsableContentFolder(value: unknown): string | null {
  const folder = resolveUsableDirectory(value);
  if (!folder) return null;
  try {
    const stat = fs.lstatSync(folder);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return null;
    return folder;
  } catch {
    return null;
  }
}

function contentFilesGrantId(folder: string): string {
  return `folder-${Buffer.from(path.resolve(folder)).toString("base64url")}`;
}

function contentFilesSourcePrefixBase(name: string): string {
  const prefix = name
    .replace(/[\\/]/g, "-")
    .replace(/\0/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!prefix || prefix === "." || prefix === "..") return "Local folder";
  return prefix;
}

function uniqueContentFilesSourcePrefix(
  base: string,
  grants: Record<string, ContentFilesGrant>,
  exceptId?: string,
): string {
  const used = new Set(
    Object.values(grants)
      .filter((grant) => grant.id !== exceptId)
      .map((grant) => grant.sourcePrefix)
      .filter((prefix): prefix is string => Boolean(prefix)),
  );
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}

function normalizeContentFilesGrant(
  value: unknown,
  grants: Record<string, ContentFilesGrant>,
): ContentFilesGrant | null {
  if (!isObject(value)) return null;
  const storedPath = firstStringValue(value.path)?.trim();
  if (!storedPath || storedPath.includes("\0")) return null;
  const folder = path.resolve(expandPathCandidate(storedPath) ?? storedPath);
  if (isFilesystemRoot(folder)) return null;
  const id = firstStringValue(value.id)?.trim() || contentFilesGrantId(folder);
  const existing = grants[id];
  const prefixBase = contentFilesSourcePrefixBase(
    path.basename(folder) || folder,
  );
  const storedPrefix = firstStringValue(value.sourcePrefix)?.trim();
  const kind = value.kind === "temporary" ? "temporary" : "persistent";
  const name = firstStringValue(value.name)?.trim();
  const contentSource = isObject(value.contentSource)
    ? {
        sourceId: firstStringValue(value.contentSource.sourceId)?.trim(),
        databaseId: firstStringValue(value.contentSource.databaseId)?.trim(),
      }
    : undefined;
  const sourcePrefix =
    storedPrefix && storedPrefix !== "." && storedPrefix !== ".."
      ? storedPrefix
      : uniqueContentFilesSourcePrefix(prefixBase, grants, id);
  return {
    id,
    path: folder,
    kind,
    ...(name ? { name } : {}),
    ...(isObject(value.repository) &&
    typeof value.repository.localId === "string"
      ? {
          repository: {
            localId: value.repository.localId,
            ...(typeof value.repository.branch === "string"
              ? { branch: value.repository.branch }
              : {}),
            ...(typeof value.repository.commit === "string"
              ? { commit: value.repository.commit }
              : {}),
            ...(value.repository.detached === true ? { detached: true } : {}),
          },
        }
      : {}),
    ...(contentSource?.sourceId
      ? {
          contentSource: {
            sourceId: contentSource.sourceId,
            ...(contentSource.databaseId
              ? { databaseId: contentSource.databaseId }
              : {}),
          },
        }
      : {}),
    createdAt: firstStringValue(value.createdAt),
    sourcePrefix: existing?.sourcePrefix ?? sourcePrefix,
    updatedAt: firstStringValue(value.updatedAt),
  };
}

function loadContentFilesStore(): ContentFilesStore {
  try {
    const raw = JSON.parse(
      fs.readFileSync(contentFilesStorePath(), "utf-8"),
    ) as Partial<ContentFilesStore>;
    const grants: Record<string, ContentFilesGrant> = {};
    if (raw.grants && typeof raw.grants === "object") {
      for (const grant of Object.values(raw.grants)) {
        const normalized = normalizeContentFilesGrant(grant, grants);
        if (normalized) grants[normalized.id] = normalized;
      }
    }
    const legacyGrant = normalizeContentFilesGrant(raw.grant, grants);
    if (legacyGrant) grants[legacyGrant.id] = legacyGrant;
    let removedTemporaryGrant = false;
    for (const [id, grant] of Object.entries(grants)) {
      if (
        grant.kind === "temporary" &&
        !resolveUsableContentFolder(grant.path)
      ) {
        delete grants[id];
        removedTemporaryGrant = true;
      }
    }
    const grantIds = Object.keys(grants);
    if (grantIds.length === 0) {
      const store = { version: 1 as const, grants: {} };
      if (removedTemporaryGrant) saveContentFilesStore(store);
      return store;
    }
    const activeGrantId =
      firstStringValue(raw.activeGrantId) &&
      grants[firstStringValue(raw.activeGrantId)!]
        ? firstStringValue(raw.activeGrantId)
        : grantIds[0];
    const store: ContentFilesStore = {
      version: 1,
      activeGrantId,
      grants,
    };
    if (removedTemporaryGrant) saveContentFilesStore(store);
    return store;
  } catch {
    return { version: 1, grants: {} };
  }
}

function saveContentFilesStore(store: ContentFilesStore): void {
  writeJsonFileAtomically(contentFilesStorePath(), store);
}

function contentFilesFolderInfo(
  grant: ContentFilesGrant,
): DesktopContentFilesFolder {
  return {
    id: grant.id,
    name: grant.name ?? (path.basename(grant.path) || grant.path),
    kind: grant.kind,
    repository: grant.repository,
    contentSource: grant.contentSource,
    sourcePrefix: grant.sourcePrefix,
    updatedAt: grant.updatedAt,
  };
}

function associateContentFilesSource(
  request: DesktopContentFilesAssociateSourceRequest,
): DesktopContentFilesResult {
  const folderId = request.folderId.trim();
  const sourceId = request.sourceId.trim();
  const databaseId = request.databaseId?.trim();
  if (!folderId || !sourceId) {
    return {
      ok: false,
      code: "invalid-request",
      error: "A folder and Content source are required.",
    };
  }
  const store = loadContentFilesStore();
  const grants = { ...(store.grants ?? {}) };
  const grant = grants[folderId];
  if (!grant) return { ok: false, error: "No local folder is linked." };
  const updatedGrant: ContentFilesGrant = {
    ...grant,
    contentSource: {
      sourceId,
      ...(databaseId ? { databaseId } : {}),
    },
  };
  grants[folderId] = updatedGrant;
  saveContentFilesStore({ ...store, grants });
  return { ok: true, folder: contentFilesFolderInfo(updatedGrant) };
}

function getContentFilesGrants(): ContentFilesGrant[] {
  const store = loadContentFilesStore();
  return Object.values(store.grants ?? {}).sort((a, b) =>
    contentFilesFolderInfo(a).name.localeCompare(
      contentFilesFolderInfo(b).name,
    ),
  );
}

function contentFilesFoldersInfo(
  grants = getContentFilesGrants(),
): DesktopContentFilesFolder[] {
  return grants.map(contentFilesFolderInfo);
}

function getContentFilesGrant(folderId?: string): ContentFilesGrant | null {
  const store = loadContentFilesStore();
  const grants = store.grants ?? {};
  if (folderId) return grants[folderId] ?? null;
  if (
    store.activeGrantId &&
    grants[store.activeGrantId]?.kind !== "temporary"
  ) {
    return grants[store.activeGrantId];
  }
  return (
    Object.values(grants).find((grant) => grant.kind !== "temporary") ??
    Object.values(grants)[0] ??
    null
  );
}

function setContentFilesGrant(folder: string): {
  grant: ContentFilesGrant;
  grants: ContentFilesGrant[];
} {
  const store = loadContentFilesStore();
  const grants = { ...(store.grants ?? {}) };
  const id = contentFilesGrantId(folder);
  const existing = grants[id];
  const prefixBase = contentFilesSourcePrefixBase(
    path.basename(folder) || folder,
  );
  const grant: ContentFilesGrant = {
    id,
    path: folder,
    kind: existing?.kind ?? "persistent",
    name: existing?.name,
    repository:
      existing?.repository ?? deriveContentFilesRepositoryIdentity(folder),
    contentSource: existing?.contentSource,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    sourcePrefix:
      existing?.sourcePrefix ??
      uniqueContentFilesSourcePrefix(prefixBase, grants, id),
    updatedAt: new Date().toISOString(),
  };
  grants[id] = grant;
  saveContentFilesStore({ version: 1, activeGrantId: id, grants });
  return { grant, grants: Object.values(grants) };
}

/**
 * Trusted Desktop seam for an agent host that has already obtained an exact
 * local folder reference. It creates no shared path record and requires a
 * human-facing working-copy name.
 */
export function attachTemporaryContentFilesWorkingCopy(
  folder: string,
  name: string,
): ContentFilesGrant {
  const resolved = resolveUsableContentFolder(folder);
  const displayName = name.trim();
  if (!resolved || !displayName || displayName.includes("\0")) {
    throw new Error("A named, existing local working copy is required.");
  }
  const store = loadContentFilesStore();
  const grants = { ...(store.grants ?? {}) };
  const existing = Object.values(grants).find(
    (candidate) => candidate.path === resolved,
  );
  const id = existing?.id ?? `folder-${randomUUID()}`;
  if (existing && existing.kind !== "temporary") {
    throw new Error(
      "This folder is already the persistent Content workspace; open a distinct working-copy folder.",
    );
  }
  const grant: ContentFilesGrant = {
    id,
    path: resolved,
    kind: "temporary",
    name: displayName,
    repository: deriveContentFilesRepositoryIdentity(resolved),
    contentSource: existing?.contentSource,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    sourcePrefix:
      existing?.sourcePrefix ??
      uniqueContentFilesSourcePrefix(
        contentFilesSourcePrefixBase(path.basename(resolved) || resolved),
        grants,
        id,
      ),
    updatedAt: new Date().toISOString(),
  };
  grants[id] = grant;
  saveContentFilesStore({ version: 1, activeGrantId: id, grants });
  for (const folderIds of contentFilesChangeSubscribers.values()) {
    folderIds.add(id);
  }
  watchContentFilesGrant(grant);
  emitContentFilesChange(id, false, "attached");
  return grant;
}

function clearContentFilesGrant(folderId?: string): DesktopContentFilesResult {
  const store = loadContentFilesStore();
  const grants = { ...(store.grants ?? {}) };
  const existing = getContentFilesGrant(folderId);
  if (existing) {
    delete grants[existing.id];
    stopContentFilesWatcher(existing.id);
  }
  const nextGrantIds = Object.keys(grants);
  const activeGrantId =
    store.activeGrantId && grants[store.activeGrantId]
      ? store.activeGrantId
      : nextGrantIds[0];
  saveContentFilesStore({ version: 1, activeGrantId, grants });
  if (!existing) return { ok: false, error: "No local folder is linked." };
  return {
    ok: true,
    folder: contentFilesFolderInfo(existing),
    folders: contentFilesFoldersInfo(Object.values(grants)),
  };
}

function contentFilesWebviewAccessDenial(
  event: IpcMainInvokeEvent,
): ReturnType<typeof contentFilesWebviewDenialReason> {
  const sender = event.sender;
  const contentApp = loadAppsForAuthContext().find(
    (candidate) => candidate.id === "content" && candidate.enabled !== false,
  );
  const contentDevPort = getTemplate("content")?.devPort;
  return contentFilesWebviewDenialReason({
    senderType: sender.getType(),
    senderId: sender.id,
    senderUrl: sender.getURL(),
    activeAppId,
    activeWebviewContentsId,
    contentAppAvailable: Boolean(contentApp),
    trustedOrigins: contentApp
      ? [getAppOrigin(contentApp), getConfiguredAppOrigin(contentApp)].filter(
          (origin): origin is string => Boolean(origin),
        )
      : [],
    developmentOrigins: [
      `http://localhost:${FRAME_PORT}`,
      ...(contentDevPort != null ? [`http://localhost:${contentDevPort}`] : []),
    ],
    development: IS_DEV,
  });
}

function requireContentFilesWebviewAccess(
  event: IpcMainInvokeEvent,
): DesktopContentFilesResult | null {
  const denialReason = contentFilesWebviewAccessDenial(event);
  if (!denialReason) return null;
  console.warn("[content-files] rejected webview request", { denialReason });
  return {
    ok: false,
    error: "Content local files are only available to the Content desktop app.",
  };
}

function normalizeContentSourcePath(value: string): string | null {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    return null;
  }
  return normalized;
}

function isContentSourceMarkdownPath(filePath: string): boolean {
  const normalized = normalizeContentSourcePath(filePath);
  if (!normalized) return false;
  return CONTENT_SOURCE_EXTENSIONS.some((ext) =>
    normalized.toLowerCase().endsWith(ext),
  );
}

function assertContentSourceTextSize(filePath: string, content: string): void {
  if (Buffer.byteLength(content, "utf-8") > CONTENT_SOURCE_FILE_MAX_BYTES) {
    throw new Error(`${filePath} is larger than 2 MB.`);
  }
}

function assertInsideContentFolder(folder: string, target: string): string {
  const resolvedFolder = path.resolve(folder);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedFolder, resolvedTarget);
  if (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  ) {
    return resolvedTarget;
  }
  throw new Error("Content file path escaped the linked folder.");
}

async function assertUsableContentFolder(folder: string): Promise<void> {
  const stat = await fs.promises.lstat(folder);
  if (stat.isSymbolicLink()) {
    throw new Error("Linked content folders cannot be symlinks.");
  }
  if (!stat.isDirectory()) {
    throw new Error("The linked content folder is not a directory.");
  }
}

async function assertNoContentSymlink(filePath: string): Promise<void> {
  try {
    const stat = await fs.promises.lstat(filePath);
    if (stat.isSymbolicLink()) {
      throw new Error("Linked content folders cannot contain symlinked files.");
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    throw err;
  }
}

function noFollowOpenFlags(): number {
  return fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
}

function readContentMarkdownFileWithoutSymlink(
  filePath: string,
): string | null {
  let fd: number | null = null;
  try {
    const stat = fs.lstatSync(filePath);
    if (
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      stat.size > CONTENT_SOURCE_FILE_MAX_BYTES
    ) {
      return null;
    }

    fd = fs.openSync(filePath, noFollowOpenFlags());
    const openedStat = fs.fstatSync(fd);
    if (
      !openedStat.isFile() ||
      openedStat.size > CONTENT_SOURCE_FILE_MAX_BYTES
    ) {
      return null;
    }
    return fs.readFileSync(fd, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP") {
      return null;
    }
    throw err;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

async function chooseContentFilesFolder(): Promise<DesktopContentFilesResult> {
  const result = await dialog.showOpenDialog({
    title: "Choose Content source folder",
    message: "Choose the folder to sync Markdown and MDX files.",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, canceled: true, error: "No folder selected." };
  }
  const folder = resolveUsableContentFolder(result.filePaths[0]);
  if (!folder) {
    return {
      ok: false,
      error: "Choose an existing folder that is not a symlink.",
    };
  }

  const { grant, grants } = setContentFilesGrant(folder);
  return {
    ok: true,
    folder: contentFilesFolderInfo(grant),
    folders: contentFilesFoldersInfo(grants),
    controlResources: await collectLocalControlResources(grant.path),
  };
}

function getRequiredContentFilesGrant(folderId?: string): ContentFilesGrant {
  const grant = getContentFilesGrant(folderId);
  if (!grant) {
    throw new Error("Choose a local folder before syncing Content files.");
  }
  const folder = resolveUsableContentFolder(grant.path);
  if (!folder) {
    throw new Error("The linked local folder no longer exists.");
  }
  return { ...grant, path: folder };
}

async function contentReadRoot(folder: string): Promise<{
  folder: string;
  prefix: string;
}> {
  if (path.basename(folder) === CONTENT_SOURCE_ROOT) {
    return { folder, prefix: `${CONTENT_SOURCE_ROOT}/` };
  }
  const contentFolder = assertInsideContentFolder(
    folder,
    path.join(folder, CONTENT_SOURCE_ROOT),
  );
  try {
    await assertUsableContentFolder(contentFolder);
    return { folder: contentFolder, prefix: `${CONTENT_SOURCE_ROOT}/` };
  } catch {
    return { folder, prefix: "" };
  }
}

async function contentWriteRoot(folder: string): Promise<{
  folder: string;
  prefix: string;
}> {
  if (path.basename(folder) === CONTENT_SOURCE_ROOT) {
    return { folder, prefix: `${CONTENT_SOURCE_ROOT}/` };
  }
  const contentFolder = assertInsideContentFolder(
    folder,
    path.join(folder, CONTENT_SOURCE_ROOT),
  );
  try {
    await assertUsableContentFolder(contentFolder);
    return { folder: contentFolder, prefix: `${CONTENT_SOURCE_ROOT}/` };
  } catch {
    return { folder, prefix: "" };
  }
}

async function collectContentMarkdownFiles(
  folder: string,
  prefix = "",
  identities?: Record<string, string>,
  identitySalt = "",
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(folder, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const sourcePath = `${prefix}${entry.name}`;
    const filePath = assertInsideContentFolder(
      folder,
      path.join(folder, entry.name),
    );
    if (entry.isDirectory()) {
      if (CONTENT_IGNORED_DIRECTORIES.has(entry.name)) continue;
      try {
        const stat = fs.lstatSync(filePath);
        if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR") continue;
        throw err;
      }
      Object.assign(
        files,
        await collectContentMarkdownFiles(
          filePath,
          `${sourcePath}/`,
          identities,
          identitySalt,
        ),
      );
      continue;
    }

    if (!entry.isFile() || !isContentSourceMarkdownPath(sourcePath)) continue;
    const content = readContentMarkdownFileWithoutSymlink(filePath);
    if (content !== null) {
      files[sourcePath] = content;
      if (identities) {
        const stat = await fs.promises.stat(filePath);
        identities[sourcePath] = createHash("sha256")
          .update(`${identitySalt}:${stat.dev}:${stat.ino}`)
          .digest("hex");
      }
    }
  }

  return files;
}

async function writeContentSourceFile(
  root: string,
  filePath: string,
  content: string,
  expectedRevision?: string | null,
): Promise<string> {
  const { normalized, target } = await resolveContentSourceFilePath(root, {
    createDirectories: true,
    filePath,
  });
  assertContentSourceTextSize(normalized, content);
  const actualRevision = await contentSourceFileRevision(target);
  if (
    expectedRevision !== undefined &&
    (actualRevision ?? null) !== expectedRevision
  ) {
    throw new ContentFilesRevisionConflict(
      normalized,
      expectedRevision,
      actualRevision,
    );
  }
  const temporary = `${target}.${randomUUID()}.tmp`;
  const backup = `${target}.${randomUUID()}.cas-backup`;
  try {
    await fs.promises.writeFile(temporary, content, {
      encoding: "utf-8",
      flag: "wx",
    });
    if (expectedRevision === undefined) {
      await fs.promises.rename(temporary, target);
      return normalized;
    }

    if (expectedRevision === null) {
      try {
        await fs.promises.link(temporary, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        throw new ContentFilesRevisionConflict(
          normalized,
          expectedRevision,
          await contentSourceFileRevision(target),
        );
      }
      return normalized;
    }

    const existingStat = await fs.promises.stat(target);
    await fs.promises.chmod(temporary, existingStat.mode);
    await fs.promises.rename(target, backup);
    if (!(await waitForContentFileHandlesToClose(backup))) {
      await fs.promises.rename(backup, target);
      throw new ContentFilesRevisionConflict(
        normalized,
        expectedRevision,
        await contentSourceFileRevision(target),
      );
    }
    const claimedRevision = await contentSourceFileRevision(backup);
    if (claimedRevision !== expectedRevision) {
      await fs.promises.rename(backup, target);
      throw new ContentFilesRevisionConflict(
        normalized,
        expectedRevision,
        claimedRevision,
      );
    }
    try {
      // A hard link publishes the fully written inode only if the destination
      // is still absent. If another editor recreates the path after our claim,
      // EEXIST fails closed instead of replacing its newer file.
      await fs.promises.link(temporary, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        await fs.promises.rename(backup, target).catch(() => undefined);
        throw error;
      }
      const competingRevision = await contentSourceFileRevision(target);
      await fs.promises.rm(backup, { force: true });
      throw new ContentFilesRevisionConflict(
        normalized,
        expectedRevision,
        competingRevision,
      );
    }
    await fs.promises.rm(backup, { force: true });
  } finally {
    await fs.promises.rm(temporary, { force: true }).catch(() => undefined);
  }
  return normalized;
}

async function waitForContentFileHandlesToClose(filePath: string) {
  // macOS keeps an editor's existing descriptor attached to the inode after
  // the path is claimed. Wait for that descriptor to close before publishing;
  // otherwise a late write to the claimed inode could be discarded as stale.
  if (process.platform !== "darwin") return false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const handles = spawnSync("lsof", ["-t", "--", filePath], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (handles.status !== 0 || !handles.stdout.trim()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

class ContentFilesRevisionConflict extends Error {
  constructor(
    readonly filePath: string,
    readonly expectedRevision: string | null,
    readonly actualRevision?: string,
  ) {
    super("The local file changed before Content could save it.");
  }
}

async function deleteContentSourceFile(
  root: string,
  filePath: string,
  expectedRevision: string,
): Promise<string> {
  const { normalized, target } = await resolveContentSourceFilePath(root, {
    filePath,
  });
  const actualRevision = await contentSourceFileRevision(target);
  if (actualRevision !== expectedRevision) {
    throw new ContentFilesRevisionConflict(
      normalized,
      expectedRevision,
      actualRevision,
    );
  }

  const claimed = `${target}.${randomUUID()}.delete-claim`;
  await fs.promises.rename(target, claimed);
  if (!(await waitForContentFileHandlesToClose(claimed))) {
    await fs.promises.rename(claimed, target);
    throw new ContentFilesRevisionConflict(
      normalized,
      expectedRevision,
      await contentSourceFileRevision(target),
    );
  }
  const claimedRevision = await contentSourceFileRevision(claimed);
  if (claimedRevision !== expectedRevision) {
    await fs.promises.rename(claimed, target);
    throw new ContentFilesRevisionConflict(
      normalized,
      expectedRevision,
      claimedRevision,
    );
  }
  const competingRevision = await contentSourceFileRevision(target);
  if (competingRevision !== undefined) {
    await fs.promises.rm(claimed);
    throw new ContentFilesRevisionConflict(
      normalized,
      expectedRevision,
      competingRevision,
    );
  }
  await fs.promises.rm(claimed);
  return normalized;
}

async function contentSourceFileRevision(
  filePath: string,
): Promise<string | undefined> {
  await assertNoContentSymlink(filePath);
  try {
    const content = await fs.promises.readFile(filePath);
    if (content.byteLength > CONTENT_SOURCE_FILE_MAX_BYTES) {
      throw new Error("The local file is larger than 2 MB.");
    }
    return createHash("sha256").update(content).digest("hex");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return undefined;
    throw err;
  }
}

async function resolveContentSourceFilePath(
  root: string,
  options: { filePath: string; createDirectories?: boolean },
): Promise<{ normalized: string; target: string }> {
  const { filePath, createDirectories = false } = options;
  const normalized = normalizeContentSourcePath(filePath);
  if (!normalized || !isContentSourceMarkdownPath(normalized)) {
    throw new Error("Only .md and .mdx source files can be used.");
  }
  const writePath =
    path.basename(root) === CONTENT_SOURCE_ROOT &&
    normalized.startsWith(`${CONTENT_SOURCE_ROOT}/`)
      ? normalized.slice(CONTENT_SOURCE_ROOT.length + 1)
      : normalized;
  const parts = writePath.split("/").filter(Boolean);
  const filename = parts.pop();
  if (!filename) throw new Error("Invalid content source path.");

  let dir = root;
  for (const part of parts) {
    dir = assertInsideContentFolder(root, path.join(dir, part));
    await assertNoContentSymlink(dir);
    if (createDirectories) {
      await fs.promises.mkdir(dir, { recursive: true });
    }
  }

  const target = assertInsideContentFolder(root, path.join(dir, filename));
  await assertNoContentSymlink(target);
  return { normalized, target };
}

async function removeStaleContentMarkdownFiles(
  folder: string,
  prefix: string,
  expectedPaths: Set<string>,
  expectedRevisions: Record<string, string | null>,
): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(folder, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const sourcePath = `${prefix}${entry.name}`;
    const filePath = assertInsideContentFolder(
      folder,
      path.join(folder, entry.name),
    );
    if (entry.isDirectory()) {
      if (CONTENT_IGNORED_DIRECTORIES.has(entry.name)) continue;
      await removeStaleContentMarkdownFiles(
        filePath,
        `${sourcePath}/`,
        expectedPaths,
        expectedRevisions,
      );
      continue;
    }

    if (
      entry.isFile() &&
      isContentSourceMarkdownPath(sourcePath) &&
      !expectedPaths.has(sourcePath)
    ) {
      const expectedRevision = expectedRevisions[sourcePath];
      if (!expectedRevision) {
        throw new ContentFilesRevisionConflict(
          sourcePath,
          expectedRevision ?? null,
          await contentSourceFileRevision(filePath),
        );
      }
      await deleteContentSourceFile(folder, entry.name, expectedRevision);
    }
  }
}

async function assertContentFilesWriteRevisions(
  root: string,
  files: Record<string, string>,
  expectedRevisions: Record<string, string | null>,
): Promise<void> {
  for (const filePath of Object.keys(files)) {
    const { normalized, target } = await resolveContentSourceFilePath(root, {
      filePath,
    });
    const observedRevision = await contentSourceFileRevision(target);
    const actualRevision =
      observedRevision === undefined ? null : observedRevision;
    if (actualRevision !== expectedRevisions[filePath]) {
      throw new ContentFilesRevisionConflict(
        normalized,
        expectedRevisions[filePath],
        actualRevision ?? undefined,
      );
    }
  }

  const expectedPaths = new Set(Object.keys(files));
  const inspectStale = async (
    folder: string,
    prefix: string,
  ): Promise<void> => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const sourcePath = `${prefix}${entry.name}`;
      const filePath = assertInsideContentFolder(
        root,
        path.join(folder, entry.name),
      );
      if (entry.isDirectory()) {
        if (!CONTENT_IGNORED_DIRECTORIES.has(entry.name)) {
          await inspectStale(filePath, `${sourcePath}/`);
        }
      } else if (
        entry.isFile() &&
        isContentSourceMarkdownPath(sourcePath) &&
        !expectedPaths.has(sourcePath)
      ) {
        const expectedRevision = expectedRevisions[sourcePath];
        const actualRevision = await contentSourceFileRevision(filePath);
        if (!expectedRevision || actualRevision !== expectedRevision) {
          throw new ContentFilesRevisionConflict(
            sourcePath,
            expectedRevision ?? null,
            actualRevision,
          );
        }
      }
    }
  };
  await inspectStale(root, "");
}

function normalizeContentFilesWriteRequest(
  request: DesktopContentFilesWriteRequest,
): {
  files: Record<string, string>;
  expectedRevisions: Record<string, string | null>;
} | null {
  if (
    !isObject(request) ||
    !isObject(request.files) ||
    !isObject(request.expectedRevisions)
  ) {
    return null;
  }
  const files: Record<string, string> = {};
  for (const [rawPath, content] of Object.entries(request.files)) {
    const filePath = normalizeContentSourcePath(rawPath);
    if (!filePath || !isContentSourceMarkdownPath(filePath)) return null;
    if (typeof content !== "string") return null;
    assertContentSourceTextSize(filePath, content);
    files[filePath] = content;
  }
  const expectedRevisions: Record<string, string | null> = {};
  for (const [rawPath, revision] of Object.entries(request.expectedRevisions)) {
    const filePath = normalizeContentSourcePath(rawPath);
    if (!filePath || !isContentSourceMarkdownPath(filePath)) return null;
    if (revision !== null && !/^[a-f0-9]{64}$/i.test(String(revision))) {
      return null;
    }
    expectedRevisions[filePath] = revision as string | null;
  }
  return { files, expectedRevisions };
}

function normalizeContentFileWriteRequest(
  request: DesktopContentFileWriteRequest,
): {
  path: string;
  content: string;
  expectedRevision: string | null;
} | null {
  if (
    !isObject(request) ||
    typeof request.content !== "string" ||
    !Object.prototype.hasOwnProperty.call(request, "expectedRevision")
  ) {
    return null;
  }
  const filePath = normalizeContentSourcePath(
    firstStringValue(request.path) ?? "",
  );
  if (!filePath || !isContentSourceMarkdownPath(filePath)) return null;
  assertContentSourceTextSize(filePath, request.content);
  const expectedRevision = request.expectedRevision;
  if (expectedRevision === undefined) return null;
  if (expectedRevision !== null && !/^[a-f0-9]{64}$/i.test(expectedRevision)) {
    return null;
  }
  return { path: filePath, content: request.content, expectedRevision };
}

function normalizeContentFileRevealRequest(
  request: DesktopContentFileRevealRequest,
): { path: string } | null {
  if (!isObject(request)) return null;
  const filePath = normalizeContentSourcePath(
    firstStringValue(request.path) ?? "",
  );
  if (!filePath || !isContentSourceMarkdownPath(filePath)) return null;
  return { path: filePath };
}

function normalizeContentFileDeleteRequest(
  request: DesktopContentFileDeleteRequest,
): { path: string; expectedRevision: string } | null {
  if (!isObject(request)) return null;
  const filePath = normalizeContentSourcePath(
    firstStringValue(request.path) ?? "",
  );
  if (!filePath || !isContentSourceMarkdownPath(filePath)) return null;
  if (!/^[a-f0-9]{64}$/i.test(request.expectedRevision)) return null;
  return { path: filePath, expectedRevision: request.expectedRevision };
}

async function writeContentFilesForRequest(
  request: DesktopContentFilesWriteRequest,
): Promise<DesktopContentFilesResult> {
  try {
    const normalized = normalizeContentFilesWriteRequest(request);
    if (!normalized) {
      return { ok: false, error: "Invalid Content source files." };
    }
    const { files, expectedRevisions } = normalized;

    const grant = getRequiredContentFilesGrant(request.folderId);
    const expectedPaths = new Set(Object.keys(files));
    for (const filePath of expectedPaths) {
      if (!(filePath in expectedRevisions)) {
        return { ok: false, error: `Missing revision for "${filePath}".` };
      }
    }
    const writeRoot = await contentWriteRoot(grant.path);
    await assertContentFilesWriteRevisions(
      writeRoot.folder,
      files,
      expectedRevisions,
    );
    const written: string[] = [];
    for (const [filePath, content] of Object.entries(files)) {
      written.push(
        await writeContentSourceFile(
          grant.path,
          filePath,
          content,
          expectedRevisions[filePath],
        ),
      );
    }
    await removeStaleContentMarkdownFiles(
      writeRoot.folder,
      writeRoot.prefix,
      expectedPaths,
      expectedRevisions,
    );
    emitContentFilesChange(grant.id);
    const { grant: updatedGrant, grants } = setContentFilesGrant(grant.path);
    return {
      ok: true,
      folder: contentFilesFolderInfo(updatedGrant),
      folders: contentFilesFoldersInfo(grants),
      files: written,
      controlResources: await collectLocalControlResources(updatedGrant.path),
    };
  } catch (err) {
    if (err instanceof ContentFilesRevisionConflict) {
      return {
        ok: false,
        code: "conflict",
        error: err.message,
        conflict: {
          path: err.filePath,
          expectedRevision: err.expectedRevision,
          actualRevision: err.actualRevision,
        },
      };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function writeContentFileForRequest(
  request: DesktopContentFileWriteRequest,
): Promise<DesktopContentFilesResult> {
  try {
    const file = normalizeContentFileWriteRequest(request);
    if (!file) return { ok: false, error: "Invalid Content source file." };

    const grant = getRequiredContentFilesGrant(request.folderId);
    const writeRoot = await contentWriteRoot(grant.path);
    const written = await writeContentSourceFile(
      writeRoot.folder,
      file.path,
      file.content,
      file.expectedRevision,
    );
    emitContentFilesChange(grant.id);
    const { grant: updatedGrant, grants } = setContentFilesGrant(grant.path);
    return {
      ok: true,
      folder: contentFilesFolderInfo(updatedGrant),
      folders: contentFilesFoldersInfo(grants),
      files: [written],
      controlResources: await collectLocalControlResources(updatedGrant.path),
    };
  } catch (err) {
    if (err instanceof ContentFilesRevisionConflict) {
      return {
        ok: false,
        code: "conflict",
        error: err.message,
        conflict: {
          path: err.filePath,
          expectedRevision: err.expectedRevision,
          actualRevision: err.actualRevision,
        },
      };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function deleteContentFileForRequest(
  request: DesktopContentFileDeleteRequest,
): Promise<DesktopContentFilesResult> {
  try {
    const file = normalizeContentFileDeleteRequest(request);
    if (!file) return { ok: false, error: "Invalid Content source file." };

    const grant = getRequiredContentFilesGrant(request.folderId);
    const readRoot = await contentReadRoot(grant.path);
    await deleteContentSourceFile(
      readRoot.folder,
      file.path,
      file.expectedRevision,
    );
    emitContentFilesChange(grant.id);
    const { grant: updatedGrant, grants } = setContentFilesGrant(grant.path);
    return {
      ok: true,
      folder: contentFilesFolderInfo(updatedGrant),
      folders: contentFilesFoldersInfo(grants),
      files: [file.path],
      controlResources: await collectLocalControlResources(updatedGrant.path),
    };
  } catch (err) {
    if (err instanceof ContentFilesRevisionConflict) {
      return {
        ok: false,
        code: "conflict",
        error: err.message,
        conflict: {
          path: err.filePath,
          expectedRevision: err.expectedRevision,
          actualRevision: err.actualRevision,
        },
      };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function revealContentFileForRequest(
  request: DesktopContentFileRevealRequest,
): Promise<DesktopContentFilesResult> {
  try {
    const file = normalizeContentFileRevealRequest(request);
    if (!file) return { ok: false, error: "Invalid Content source file." };

    const grant = getRequiredContentFilesGrant(request.folderId);
    const readRoot = await contentReadRoot(grant.path);
    const { target } = await resolveContentSourceFilePath(readRoot.folder, {
      filePath: file.path,
    });
    await fs.promises.access(target, fs.constants.F_OK);
    shell.showItemInFolder(target);
    const { grant: updatedGrant, grants } = setContentFilesGrant(grant.path);
    return {
      ok: true,
      folder: contentFilesFolderInfo(updatedGrant),
      folders: contentFilesFoldersInfo(grants),
      files: [file.path],
      controlResources: await collectLocalControlResources(updatedGrant.path),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function readContentFilesForRequest(
  request: DesktopContentFilesFolderRequest = {},
): Promise<DesktopContentFilesResult> {
  try {
    const grant = getRequiredContentFilesGrant(request.folderId);
    const root = await contentReadRoot(grant.path);
    const identities: Record<string, string> = {};
    const sources = await collectContentMarkdownFiles(
      root.folder,
      root.prefix,
      identities,
      grant.id,
    );
    const revisions = Object.fromEntries(
      Object.entries(sources).map(([filePath, content]) => [
        filePath,
        createHash("sha256").update(content, "utf-8").digest("hex"),
      ]),
    );
    const { grant: updatedGrant, grants } = setContentFilesGrant(grant.path);
    return {
      ok: true,
      folder: contentFilesFolderInfo(updatedGrant),
      folders: contentFilesFoldersInfo(grants),
      sources,
      revisions,
      identities,
      controlResources: await collectLocalControlResources(updatedGrant.path),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

const PLAN_FILES_STORE_FILE = "plan-file-sync.json";
const PLAN_TEXT_FILE_NAMES = [
  "plan.mdx",
  "canvas.mdx",
  "prototype.mdx",
  ".plan-state.json",
] as const;
const PLAN_OPTIONAL_TEXT_FILE_NAMES = [
  "canvas.mdx",
  "prototype.mdx",
  ".plan-state.json",
] as const;
const PLAN_TEXT_FILE_MAX_BYTES = 2 * 1024 * 1024;
const PLAN_ASSET_MAX_BYTES = 2 * 1024 * 1024;
const PLAN_ASSETS_MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const PLAN_ASSET_FILENAME_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g|gif|webp|svg)$/i;

export interface PlanFilesGrant {
  path: string;
  title?: string;
  updatedAt?: string;
}

interface PlanFilesStore {
  version: 1;
  grants: Record<string, PlanFilesGrant>;
}

function planFilesStorePath(): string {
  return path.join(app.getPath("userData"), PLAN_FILES_STORE_FILE);
}

function loadPlanFilesStore(): PlanFilesStore {
  try {
    const raw = JSON.parse(
      fs.readFileSync(planFilesStorePath(), "utf-8"),
    ) as Partial<PlanFilesStore>;
    const grants: Record<string, PlanFilesGrant> = {};
    if (raw.grants && typeof raw.grants === "object") {
      for (const [planId, grant] of Object.entries(raw.grants)) {
        if (!isValidPlanFilePlanId(planId)) continue;
        if (!isObject(grant)) continue;
        const folder = resolveUsablePlanFolder(firstStringValue(grant.path));
        if (!folder) continue;
        grants[planId] = {
          path: folder,
          title: firstStringValue(grant.title),
          updatedAt: firstStringValue(grant.updatedAt),
        };
      }
    }
    return { version: 1, grants };
  } catch {
    return { version: 1, grants: {} };
  }
}

function savePlanFilesStore(store: PlanFilesStore): void {
  writeJsonFileAtomically(planFilesStorePath(), store);
}

function isValidPlanFilePlanId(value: unknown): value is string {
  return (
    typeof value === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(value.trim())
  );
}

function sanitizePlanFilesTitle(value: unknown): string | undefined {
  const title = firstStringValue(value)?.trim();
  return title ? title.slice(0, 200) : undefined;
}

function planFilesFolderInfo(
  planId: string,
  grant: PlanFilesGrant,
): DesktopPlanFilesFolder {
  return {
    name: path.basename(grant.path) || grant.path,
    planId,
    title: grant.title,
    updatedAt: grant.updatedAt,
  };
}

function getPlanFilesGrant(planId: string): PlanFilesGrant | null {
  return loadPlanFilesStore().grants[planId] ?? null;
}

function setPlanFilesGrant(
  planId: string,
  grant: Omit<PlanFilesGrant, "updatedAt"> & { updatedAt?: string },
): PlanFilesGrant {
  const store = loadPlanFilesStore();
  const next = {
    path: grant.path,
    title: grant.title,
    updatedAt: grant.updatedAt ?? new Date().toISOString(),
  };
  store.grants[planId] = next;
  savePlanFilesStore(store);
  return next;
}

function clearPlanFilesGrant(planId: string): DesktopPlanFilesResult {
  const store = loadPlanFilesStore();
  const existing = store.grants[planId];
  delete store.grants[planId];
  savePlanFilesStore(store);
  if (!existing) return { ok: false, error: "No local folder is linked." };
  return {
    ok: true,
    folder: planFilesFolderInfo(planId, existing),
  };
}

function normalizePlanFilesRequestPlanId(request: unknown): string | null {
  if (!isObject(request)) return null;
  const planId = firstStringValue(request.planId)?.trim();
  return isValidPlanFilePlanId(planId) ? planId : null;
}

function isPlanFilesWebviewSender(event: IpcMainInvokeEvent): boolean {
  const sender = event.sender;
  if (sender.getType() !== "webview") return false;
  if (activeAppId !== "plan") return false;
  if (!activeWebviewContentsId || activeWebviewContentsId !== sender.id) {
    return false;
  }
  const planApp = loadAppsForAuthContext().find(
    (candidate) => candidate.id === "plan" && candidate.enabled !== false,
  );
  if (!planApp) return false;

  let url: URL;
  try {
    url = new URL(sender.getURL());
  } catch {
    return false;
  }

  const trustedOrigin = getAppOrigin(planApp);
  if (trustedOrigin && url.origin === trustedOrigin) return true;
  return (
    IS_DEV &&
    url.origin === `http://localhost:${FRAME_PORT}` &&
    url.searchParams.get("app") === "plan"
  );
}

function requirePlanFilesWebviewAccess(
  event: IpcMainInvokeEvent,
): DesktopPlanFilesResult | null {
  if (isPlanFilesWebviewSender(event)) return null;
  return {
    ok: false,
    error: "Plan local files are only available to the Plan desktop app.",
  };
}

function isDesktopPlanMdxFolder(value: unknown): value is DesktopPlanMdxFolder {
  if (!isObject(value)) return false;
  if (typeof value["plan.mdx"] !== "string" || !value["plan.mdx"].trim()) {
    return false;
  }
  for (const file of PLAN_OPTIONAL_TEXT_FILE_NAMES) {
    if (value[file] !== undefined && typeof value[file] !== "string") {
      return false;
    }
  }
  const assets = value["assets/"];
  if (assets !== undefined) {
    if (!isObject(assets)) return false;
    for (const [filename, base64] of Object.entries(assets)) {
      if (!PLAN_ASSET_FILENAME_PATTERN.test(filename)) return false;
      if (typeof base64 !== "string") return false;
    }
  }
  return true;
}

function assertPlanFileTextSize(file: string, content: string): void {
  if (Buffer.byteLength(content, "utf-8") > PLAN_TEXT_FILE_MAX_BYTES) {
    throw new Error(`${file} is larger than 2 MB.`);
  }
}

function assertInsidePlanFolder(folder: string, target: string): string {
  const resolvedFolder = path.resolve(folder);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedFolder, resolvedTarget);
  if (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  ) {
    return resolvedTarget;
  }
  throw new Error("Plan file path escaped the linked folder.");
}

function resolveUsablePlanFolder(value: unknown): string | null {
  const folder = resolveUsableDirectory(value);
  if (!folder) return null;
  try {
    const stat = fs.lstatSync(folder);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return null;
    return folder;
  } catch {
    return null;
  }
}

async function assertUsablePlanFolder(folder: string): Promise<void> {
  const stat = await fs.promises.lstat(folder);
  if (stat.isSymbolicLink()) {
    throw new Error("Linked plan folders cannot be symlinks.");
  }
  if (!stat.isDirectory()) {
    throw new Error("The linked plan folder is not a directory.");
  }
}

async function assertNoSymlink(filePath: string): Promise<void> {
  try {
    const stat = await fs.promises.lstat(filePath);
    if (stat.isSymbolicLink()) {
      throw new Error("Linked plan folders cannot contain symlinked files.");
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    throw err;
  }
}

async function writePlanTextFile(
  folder: string,
  file: (typeof PLAN_TEXT_FILE_NAMES)[number],
  content: string,
): Promise<void> {
  assertPlanFileTextSize(file, content);
  const filePath = assertInsidePlanFolder(folder, path.join(folder, file));
  await assertNoSymlink(filePath);
  await fs.promises.writeFile(filePath, content, "utf-8");
}

async function removePlanTextFile(
  folder: string,
  file: (typeof PLAN_OPTIONAL_TEXT_FILE_NAMES)[number],
): Promise<void> {
  const filePath = assertInsidePlanFolder(folder, path.join(folder, file));
  await assertNoSymlink(filePath);
  await fs.promises.rm(filePath, { force: true });
}

async function writePlanAssets(
  folder: string,
  assets: Record<string, string> | undefined,
): Promise<string[]> {
  const assetsPath = assertInsidePlanFolder(
    folder,
    path.join(folder, "assets"),
  );
  await assertNoSymlink(assetsPath);

  if (!assets || Object.keys(assets).length === 0) {
    await fs.promises.rm(assetsPath, { recursive: true, force: true });
    return [];
  }

  await fs.promises.mkdir(assetsPath, { recursive: true });
  const written: string[] = [];
  let totalBytes = 0;
  const expected = new Set<string>();

  for (const [filename, base64] of Object.entries(assets)) {
    if (!PLAN_ASSET_FILENAME_PATTERN.test(filename)) continue;
    expected.add(filename);
    const filePath = assertInsidePlanFolder(
      assetsPath,
      path.join(assetsPath, filename),
    );
    await assertNoSymlink(filePath);
    const bytes = Buffer.from(base64, "base64");
    if (bytes.byteLength > PLAN_ASSET_MAX_BYTES) {
      throw new Error(`${filename} is larger than 2 MB.`);
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > PLAN_ASSETS_MAX_TOTAL_BYTES) {
      throw new Error("Plan assets are larger than 10 MB total.");
    }
    await fs.promises.writeFile(filePath, bytes);
    written.push(`assets/${filename}`);
  }

  try {
    const entries = await fs.promises.readdir(assetsPath, {
      withFileTypes: true,
    });
    await Promise.all(
      entries.map(async (entry) => {
        if (!entry.isFile() || expected.has(entry.name)) return;
        const stalePath = assertInsidePlanFolder(
          assetsPath,
          path.join(assetsPath, entry.name),
        );
        await assertNoSymlink(stalePath);
        await fs.promises.rm(stalePath, { force: true });
      }),
    );
  } catch {
    // Stale asset cleanup is best-effort.
  }

  return written;
}

async function writePlanMdxFolder(
  folder: string,
  mdx: DesktopPlanMdxFolder,
): Promise<string[]> {
  await assertUsablePlanFolder(folder);
  await fs.promises.mkdir(folder, { recursive: true });
  await writePlanTextFile(folder, "plan.mdx", mdx["plan.mdx"]);
  const written = ["plan.mdx"];

  for (const file of PLAN_OPTIONAL_TEXT_FILE_NAMES) {
    const content = mdx[file];
    if (typeof content === "string" && content.length > 0) {
      await writePlanTextFile(folder, file, content);
      written.push(file);
    } else {
      await removePlanTextFile(folder, file);
    }
  }

  written.push(...(await writePlanAssets(folder, mdx["assets/"])));
  return written;
}

async function readOptionalPlanTextFile(
  folder: string,
  file: (typeof PLAN_TEXT_FILE_NAMES)[number],
): Promise<string | undefined> {
  const filePath = assertInsidePlanFolder(folder, path.join(folder, file));
  await assertNoSymlink(filePath);
  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) return undefined;
    if (stat.size > PLAN_TEXT_FILE_MAX_BYTES) {
      throw new Error(`${file} is larger than 2 MB.`);
    }
    return await fs.promises.readFile(filePath, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return undefined;
    throw err;
  }
}

async function readPlanAssets(
  folder: string,
): Promise<Record<string, string> | undefined> {
  const assetsPath = assertInsidePlanFolder(
    folder,
    path.join(folder, "assets"),
  );
  await assertNoSymlink(assetsPath);
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(assetsPath, { withFileTypes: true });
  } catch {
    return undefined;
  }

  const assets: Record<string, string> = {};
  let totalBytes = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !PLAN_ASSET_FILENAME_PATTERN.test(entry.name)) {
      continue;
    }
    const filePath = assertInsidePlanFolder(
      assetsPath,
      path.join(assetsPath, entry.name),
    );
    await assertNoSymlink(filePath);
    const stat = await fs.promises.stat(filePath);
    if (stat.size > PLAN_ASSET_MAX_BYTES) continue;
    totalBytes += stat.size;
    if (totalBytes > PLAN_ASSETS_MAX_TOTAL_BYTES) break;
    const bytes = await fs.promises.readFile(filePath);
    assets[entry.name] = bytes.toString("base64");
  }

  return Object.keys(assets).length > 0 ? assets : undefined;
}

async function readPlanMdxFolder(
  folder: string,
): Promise<DesktopPlanMdxFolder> {
  await assertUsablePlanFolder(folder);
  const plan = await readOptionalPlanTextFile(folder, "plan.mdx");
  if (!plan) throw new Error("The linked folder does not contain plan.mdx.");
  const mdx: DesktopPlanMdxFolder = { "plan.mdx": plan };
  for (const file of PLAN_OPTIONAL_TEXT_FILE_NAMES) {
    const content = await readOptionalPlanTextFile(folder, file);
    if (content !== undefined) mdx[file] = content;
  }
  const assets = await readPlanAssets(folder);
  if (assets) mdx["assets/"] = assets;
  return mdx;
}

function getRequiredPlanFilesGrant(planId: string): PlanFilesGrant {
  const grant = getPlanFilesGrant(planId);
  if (!grant) {
    throw new Error("Choose a local folder before syncing this plan.");
  }
  const folder = resolveUsablePlanFolder(grant.path);
  if (!folder) {
    throw new Error("The linked local folder no longer exists.");
  }
  return { ...grant, path: folder };
}

async function choosePlanFilesFolder(
  request: DesktopPlanFilesChooseFolderRequest,
): Promise<DesktopPlanFilesResult> {
  const planId = normalizePlanFilesRequestPlanId(request);
  if (!planId) return { ok: false, error: "Invalid plan ID." };

  const result = await dialog.showOpenDialog({
    title: "Choose local plan folder",
    message: "Choose the folder that contains this plan's MDX files.",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, canceled: true, error: "No folder selected." };
  }
  const folder = resolveUsablePlanFolder(result.filePaths[0]);
  if (!folder) {
    return {
      ok: false,
      error: "Choose an existing folder that is not a symlink.",
    };
  }

  const grant = setPlanFilesGrant(planId, {
    path: folder,
    title: sanitizePlanFilesTitle(request.title),
  });
  return {
    ok: true,
    folder: planFilesFolderInfo(planId, grant),
    controlResources: await collectLocalControlResources(grant.path),
  };
}

async function writePlanFilesForRequest(
  request: DesktopPlanFilesWriteRequest,
): Promise<DesktopPlanFilesResult> {
  const planId = normalizePlanFilesRequestPlanId(request);
  if (!planId) return { ok: false, error: "Invalid plan ID." };
  if (!isDesktopPlanMdxFolder(request.mdx)) {
    return { ok: false, error: "Invalid Plan MDX folder." };
  }

  try {
    const grant = getRequiredPlanFilesGrant(planId);
    const files = await writePlanMdxFolder(grant.path, request.mdx);
    const updatedGrant = setPlanFilesGrant(planId, {
      path: grant.path,
      title: sanitizePlanFilesTitle(request.title) ?? grant.title,
    });
    return {
      ok: true,
      folder: planFilesFolderInfo(planId, updatedGrant),
      files,
      controlResources: await collectLocalControlResources(updatedGrant.path),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function readPlanFilesForRequest(
  request: DesktopPlanFilesReadRequest,
): Promise<DesktopPlanFilesResult> {
  const planId = normalizePlanFilesRequestPlanId(request);
  if (!planId) return { ok: false, error: "Invalid plan ID." };

  try {
    const grant = getRequiredPlanFilesGrant(planId);
    return {
      ok: true,
      folder: planFilesFolderInfo(planId, grant),
      mdx: await readPlanMdxFolder(grant.path),
      controlResources: await collectLocalControlResources(grant.path),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function quoteWindowsCmdPath(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function openTerminalForCodeAgents(
  request?: unknown,
): Promise<CodeAgentTerminalResult> {
  const cwd = resolveCodeAgentsTerminalCwd(request);
  if (process.platform === "darwin") {
    return spawnDetached("open", ["-a", "Terminal", cwd], cwd);
  }
  if (process.platform === "win32") {
    return spawnDetached(
      "cmd.exe",
      ["/d", "/k", `cd /d ${quoteWindowsCmdPath(cwd)}`],
      cwd,
    );
  }
  if (process.platform === "linux") {
    return spawnDetached(
      "x-terminal-emulator",
      ["--working-directory", cwd],
      cwd,
    );
  }
  return {
    ok: false,
    cwd,
    error: `Opening a terminal is not supported on ${process.platform}.`,
  };
}

function isCommandAvailable(command: string): boolean {
  try {
    return (
      spawnSync("which", [command], {
        stdio: "ignore",
      }).status === 0
    );
  } catch {
    return false;
  }
}

async function openCodexLoginTerminal(): Promise<CodeAgentTerminalResult> {
  const cwd = getHomeDirectory();
  const launch = getCodexLoginLaunchSpec(
    process.platform,
    process.platform === "linux" ? isCommandAvailable : undefined,
  );
  if (!launch.ok) return { ok: false, cwd, error: launch.error };
  return spawnDetached(launch.command, launch.args, cwd, undefined, {
    waitForExit: process.platform === "darwin",
  });
}

function readPackageMetadata(packagePath: string): {
  name?: string;
  version?: string;
} {
  const pkg = readJsonObjectFile(packagePath);
  return {
    name: firstStringValue(pkg?.name),
    version: firstStringValue(pkg?.version),
  };
}

const RESERVED_CODE_AGENT_COMMANDS = new Set([
  ...CODE_AGENT_GOALS.flatMap((goal) => [
    goal.id,
    goal.slashCommand.replace(/^\//, ""),
    goal.cliCommand,
  ]),
  "approve",
  "attach",
  "e",
  "exec",
  "exit",
  "goals",
  "help",
  "list",
  "ps",
  "quit",
  "resume",
  "run",
  "start",
  "status",
  "stop",
  "todo",
  "ui",
]);

function listCodeAgentProjectPacks(input?: unknown): CodeAgentCodePackResult {
  try {
    const root = resolveCodeAgentsTerminalCwd(input);
    const commandsRoot = path.join(root, ".agents", "commands");
    const skillsRoot = path.join(root, ".agents", "skills");
    const commands = fs.existsSync(commandsRoot)
      ? walkMarkdownFiles(commandsRoot)
          .map((filePath) => {
            const raw = fs.readFileSync(filePath, "utf-8");
            const parsed = parseSimpleFrontmatter(raw);
            const relative = path.relative(commandsRoot, filePath);
            const name = relative
              .replace(/\.md$/i, "")
              .replaceAll(path.sep, ":")
              .toLowerCase();
            return {
              kind: "command" as const,
              name,
              path: filePath,
              relativePath: relative,
              description: parsed.data.description,
              argumentHint: parsed.data["argument-hint"],
              reserved: RESERVED_CODE_AGENT_COMMANDS.has(name),
            };
          })
          .filter((command) => command.name && command.name !== "readme")
      : [];
    const skills = fs.existsSync(skillsRoot)
      ? walkMarkdownFiles(skillsRoot)
          .filter(
            (filePath) => path.basename(filePath).toLowerCase() === "skill.md",
          )
          .map((filePath) => {
            const raw = fs.readFileSync(filePath, "utf-8");
            const parsed = parseSimpleFrontmatter(raw);
            const relative = path.relative(skillsRoot, filePath);
            const skillDir = path.dirname(relative);
            const fallbackName =
              skillDir === "." ? path.basename(skillsRoot) : skillDir;
            return {
              kind: "skill" as const,
              name:
                parsed.data.name ??
                fallbackName.replaceAll(path.sep, ":").toLowerCase(),
              path: filePath,
              relativePath: relative,
              description: parsed.data.description,
            };
          })
          .filter((skill) => skill.name)
      : [];
    return {
      status: "ok",
      pack: {
        schemaVersion: 1,
        root,
        commands,
        skills,
      },
    };
  } catch (err) {
    return {
      status: "unavailable",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function walkMarkdownFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(entryPath);
      }
    }
  };
  visit(root);
  return files.sort((a, b) => a.localeCompare(b));
}

function parseSimpleFrontmatter(raw: string): {
  data: Record<string, string>;
} {
  if (!raw.startsWith("---\n")) return { data: {} };
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return { data: {} };
  const data: Record<string, string> = {};
  const lines = raw.slice(4, end).trim().split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (value === ">-" || value === ">" || value === "|" || value === "|-") {
      const block: string[] = [];
      while (index + 1 < lines.length && /^\s+/.test(lines[index + 1])) {
        index += 1;
        block.push(lines[index].trim());
      }
      data[key] = value.startsWith("|")
        ? block.join("\n").trim()
        : block.join(" ").trim();
      continue;
    }
    data[key] = value.replace(/^["']|["']$/g, "").trim();
  }
  return { data };
}

function getCodeAgentLlmProviderStatus(): NonNullable<
  CodeAgentHostMetadata["llmProvider"]
> {
  if (process.env.AGENT_NATIVE_CODE_AGENT_FAKE_RESPONSE !== undefined) {
    return {
      configured: true,
      label: "Fake Agent-Native Code",
      configuredProviders: ["Fake Agent-Native Code"],
      missingEnvVars: [],
    };
  }

  const settings = AppStore.getCodeAgentProviderSettingsStatus();
  const codex = getLocalCodexCliStatus();
  const claude = getLocalClaudeCliStatus();
  const configuredCredentialKeys = new Set(
    settings.providers.flatMap((provider) => provider.configuredKeys),
  );
  const configuredProviders = [
    ...(process.env.AGENT_ENGINE ? ["Custom"] : []),
    ...(codex.authenticated ? [codex.label] : []),
    ...(claude.authenticated ? [claude.label] : []),
    ...settings.configuredProviders,
  ];

  return {
    configured: configuredProviders.length > 0,
    label: configuredProviders[0],
    configuredProviders,
    missingEnvVars: CODE_AGENT_PROVIDER_SETTING_KEYS.filter(
      (key) => !process.env[key] && !configuredCredentialKeys.has(key),
    ),
  };
}

function hasRuntimeCodeAgentLlmProvider(): boolean {
  if (hasRuntimeNonCodexCodeAgentLlmProvider()) return true;
  if (getLocalCodexCliStatus().authenticated) return true;
  if (getLocalClaudeCliStatus().authenticated) return true;
  if (
    getLocalCliAvailability("pi", "Pi", localPiCliAvailabilityCache).available
  ) {
    return true;
  }
  if (
    getLocalCliAvailability(
      "opencode",
      "OpenCode",
      localOpenCodeCliAvailabilityCache,
    ).available
  ) {
    return true;
  }
  return false;
}

function hasRuntimeNonCodexCodeAgentLlmProvider(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (process.env.AGENT_NATIVE_CODE_AGENT_FAKE_RESPONSE !== undefined) {
    return true;
  }
  if (env.AGENT_ENGINE) return true;
  if (env.ANTHROPIC_API_KEY) return true;
  if (env.OPENAI_API_KEY) return true;
  if (env.GOOGLE_GENERATIVE_AI_API_KEY) return true;
  return Boolean(env.BUILDER_PRIVATE_KEY && env.BUILDER_PUBLIC_KEY);
}

function normalizeCodeAgentRequestedEngine(
  engine: string | undefined,
): string | undefined {
  const trimmed = engine?.trim();
  if (trimmed && trimmed !== "auto") return trimmed;
  if (
    !hasRuntimeNonCodexCodeAgentLlmProvider() &&
    getLocalCodexCliStatus().authenticated
  ) {
    return CODEX_CLI_ENGINE_NAME;
  }
  if (
    !hasRuntimeNonCodexCodeAgentLlmProvider() &&
    getLocalClaudeCliStatus().authenticated
  ) {
    return CLAUDE_CLI_ENGINE_NAME;
  }
  return undefined;
}

function ensureCodeAgentLlmProvider(): {
  ok: boolean;
  error?: string;
} {
  if (process.env.AGENT_NATIVE_CODE_AGENT_FAKE_RESPONSE !== undefined) {
    return { ok: true };
  }
  if (hasRuntimeCodeAgentLlmProvider()) return { ok: true };

  // Provider credentials saved in Desktop settings are intentionally kept out
  // of the main process environment. Check the same effective environment
  // that the runner receives before reporting a missing provider.
  const providerEnv = AppStore.getCodeAgentProviderProcessEnv(process.env);
  if (hasRuntimeNonCodexCodeAgentLlmProvider(providerEnv)) return { ok: true };

  const applyResult = AppStore.applyCodeAgentProviderCredentialsToEnv();
  if (applyResult.failedKeys.length > 0) {
    return {
      ok: false,
      error:
        "Agent Native could not read the saved code provider keys. Reconnect the provider in Settings.",
    };
  }
  return {
    ok: false,
    error:
      "Connect Builder.io, run `codex login` or `claude auth login --claudeai`, or add an API key.",
  };
}

const CLI_PROBE_TIMEOUT_MS = 1500;

interface CliRun {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: NodeJS.ErrnoException;
}

function runCliSync(command: string, args: string[]): CliRun {
  const result = spawnSync(command, args, {
    encoding: "utf-8",
    timeout: CLI_PROBE_TIMEOUT_MS,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: (result.error as NodeJS.ErrnoException | undefined) ?? undefined,
  };
}

function runCliAsync(command: string, args: string[]): Promise<CliRun> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { encoding: "utf-8", timeout: CLI_PROBE_TIMEOUT_MS },
      (error, stdout, stderr) => {
        const errno = error as NodeJS.ErrnoException | null;
        // A non-zero exit is an answer ("not logged in"), not a probe failure —
        // only a failure to run the binary at all is reported as `error`.
        const spawnFailed = Boolean(errno && typeof errno.code === "string");
        resolve({
          status: errno
            ? typeof errno.code === "number"
              ? errno.code
              : null
            : 0,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          error: spawnFailed ? (errno ?? undefined) : undefined,
        });
      },
    );
  });
}

interface LocalCodexCliStatus {
  available: boolean;
  authenticated: boolean;
  label: string;
  authMode?: string;
  version?: string;
  model?: string;
  error?: string;
}

const localCodexCliStatusCache = createCliStatusCache<LocalCodexCliStatus>();

function getLocalCodexCliStatus(): LocalCodexCliStatus {
  return cachedCliStatus(
    localCodexCliStatusCache,
    () => {
      const version = runCliSync("codex", ["--version"]);
      if (version.error) return parseLocalCodexCliStatus(version, null);
      return parseLocalCodexCliStatus(
        version,
        runCliSync("codex", ["login", "status"]),
      );
    },
    async () => {
      const version = await runCliAsync("codex", ["--version"]);
      if (version.error) return parseLocalCodexCliStatus(version, null);
      return parseLocalCodexCliStatus(
        version,
        await runCliAsync("codex", ["login", "status"]),
      );
    },
  );
}

function parseLocalCodexCliStatus(
  versionResult: CliRun,
  statusResult: CliRun | null,
): LocalCodexCliStatus {
  if (versionResult.error || !statusResult) {
    return {
      available: false,
      authenticated: false,
      label: "Codex CLI",
      error:
        versionResult.error?.code === "ENOENT"
          ? "Codex CLI was not found."
          : versionResult.error?.message,
    };
  }
  const statusText =
    `${statusResult.stdout ?? ""}\n${statusResult.stderr ?? ""}`.trim();
  const authMode = /using\s+(.+)$/i.exec(statusText)?.[1]?.trim();
  const authenticated = statusResult.status === 0;
  return {
    available: true,
    authenticated,
    label: authenticated && authMode ? `Codex CLI (${authMode})` : "Codex CLI",
    authMode,
    version: (versionResult.stdout ?? versionResult.stderr ?? "").trim(),
    model: readConfiguredCodexModel(),
    error: authenticated
      ? undefined
      : statusText || "Codex CLI is not logged in.",
  };
}

function readConfiguredCodexModel(): string | undefined {
  const codexHomes = new Set(
    [
      process.env.CODEX_HOME?.trim(),
      path.join(getHomeDirectory(), ".codex"),
      path.join(os.homedir(), ".codex"),
    ].filter((value): value is string => Boolean(value)),
  );
  for (const codexHome of codexHomes) {
    try {
      const config = fs.readFileSync(
        path.join(codexHome, "config.toml"),
        "utf-8",
      );
      const model = /^\s*model\s*=\s*["']([^"']+)["']\s*$/m
        .exec(config)?.[1]
        ?.trim();
      if (model) return model;
    } catch (error) {
      // Try the next known Codex config location.
      if (error instanceof Error) continue;
      throw error;
    }
  }
  return undefined;
}

interface LocalClaudeCliStatus {
  available: boolean;
  authenticated: boolean;
  label: string;
  version?: string;
  error?: string;
}

const localClaudeCliStatusCache = createCliStatusCache<LocalClaudeCliStatus>();

function getLocalClaudeCliStatus(): LocalClaudeCliStatus {
  return cachedCliStatus(
    localClaudeCliStatusCache,
    () => {
      const version = runCliSync("claude", ["--version"]);
      if (version.error) return parseLocalClaudeCliStatus(version, null);
      return parseLocalClaudeCliStatus(
        version,
        runCliSync("claude", ["auth", "status", "--json"]),
      );
    },
    async () => {
      const version = await runCliAsync("claude", ["--version"]);
      if (version.error) return parseLocalClaudeCliStatus(version, null);
      return parseLocalClaudeCliStatus(
        version,
        await runCliAsync("claude", ["auth", "status", "--json"]),
      );
    },
  );
}

function parseLocalClaudeCliStatus(
  versionResult: CliRun,
  statusResult: CliRun | null,
): LocalClaudeCliStatus {
  if (versionResult.error || !statusResult) {
    return {
      available: false,
      authenticated: false,
      label: "Claude Code",
      error:
        versionResult.error?.code === "ENOENT"
          ? "Claude Code CLI was not found."
          : versionResult.error?.message,
    };
  }

  let status: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(statusResult.stdout ?? "") as unknown;
    status = isObject(parsed) ? parsed : null;
  } catch {
    status = null;
  }
  const authenticated = Boolean(
    statusResult.status === 0 &&
    status?.loggedIn === true &&
    isClaudeSubscriptionAuthMethod(
      typeof status?.authMethod === "string" ? status.authMethod : undefined,
    ) &&
    status?.apiProvider === "firstParty" &&
    typeof status?.subscriptionType === "string" &&
    status.subscriptionType.trim(),
  );
  return {
    available: true,
    authenticated,
    label: "Claude subscription",
    version: (versionResult.stdout ?? versionResult.stderr ?? "").trim(),
    error: authenticated
      ? undefined
      : "Claude Code is not signed in with a Claude subscription.",
  };
}

interface LocalCliAvailability {
  available: boolean;
  label: string;
  version?: string;
  error?: string;
}

const localPiCliAvailabilityCache =
  createCliStatusCache<LocalCliAvailability>();
const localOpenCodeCliAvailabilityCache =
  createCliStatusCache<LocalCliAvailability>();

function getLocalCliAvailability(
  command: string,
  label: string,
  cache: CliStatusCache<LocalCliAvailability>,
): LocalCliAvailability {
  return cachedCliStatus(
    cache,
    () =>
      parseLocalCliAvailability(
        command,
        label,
        runCliSync(command, ["--version"]),
      ),
    async () =>
      parseLocalCliAvailability(
        command,
        label,
        await runCliAsync(command, ["--version"]),
      ),
  );
}

function parseLocalCliAvailability(
  command: string,
  label: string,
  result: CliRun,
): LocalCliAvailability {
  const version = (result.stdout || result.stderr).trim();
  return {
    available: !result.error && result.status === 0,
    label,
    ...(version ? { version } : {}),
    ...(!result.error && result.status === 0
      ? {}
      : {
          error:
            result.error?.code === "ENOENT"
              ? `${label} was not found.`
              : version || `${command} could not be started.`,
        }),
  };
}

function getCodeAgentProviderSettings(): CodeAgentProviderSettings {
  return withLocalCodexProviderStatus(
    AppStore.getCodeAgentProviderSettingsStatus(),
  );
}

function withLocalCodexProviderStatus(
  settings: CodeAgentProviderSettings,
): CodeAgentProviderSettings {
  const codex = getLocalCodexCliStatus();
  if (!codex.available) return settings;
  const provider = {
    id: "codex" as const,
    label: "ChatGPT subscription",
    configured: codex.authenticated,
    configuredKeys: [] as CodeAgentProviderCredentialKey[],
    missingKeys: [] as CodeAgentProviderCredentialKey[],
    savedKeys: [] as CodeAgentProviderCredentialKey[],
    source: codex.authenticated ? ("local-codex" as const) : undefined,
    error: codex.error,
  };
  const providers = [
    provider,
    ...settings.providers.filter((item) => item.id !== "codex"),
  ];
  return {
    ...settings,
    configured: providers.some((item) => item.configured),
    configuredProviders: providers
      .filter((item) => item.configured)
      .map((item) => item.label),
    providers,
  };
}

function updateCodeAgentProviderSettings(
  input: unknown,
): CodeAgentProviderSettingsUpdateResult {
  const payload = isObject(input) ? input : {};
  const updates: CodeAgentProviderSettingsUpdate = {};
  for (const key of CODE_AGENT_PROVIDER_SETTING_KEYS) {
    if (!(key in payload)) continue;
    const value = payload[key];
    if (value === null) {
      updates[key] = null;
    } else if (typeof value === "string") {
      updates[key] = value;
    }
  }
  try {
    const settings = withLocalCodexProviderStatus(
      AppStore.saveCodeAgentProviderCredentials(updates),
    );
    return {
      ok: true,
      settings,
      message: settings.configured
        ? "Code provider settings saved."
        : "Code provider settings cleared.",
    };
  } catch (err) {
    return {
      ok: false,
      settings: getCodeAgentProviderSettings(),
      message: "Could not save code provider settings.",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function providerStatusById(settings: CodeAgentProviderSettings, id: string) {
  return settings.providers.find((provider) => provider.id === id);
}

function pushCodeAgentModelOptions(
  models: CodeAgentModelOption[],
  options: {
    engine: string;
    engineLabel: string;
    supportedModels: readonly string[];
    configured: boolean;
    statusLabel?: string;
    isSubscription?: boolean;
  },
): void {
  for (const model of options.supportedModels) {
    models.push({
      engine: options.engine,
      engineLabel: options.engineLabel,
      model,
      label: model,
      configured: options.configured,
      ...(options.statusLabel ? { statusLabel: options.statusLabel } : {}),
      ...(options.isSubscription ? { isSubscription: true } : {}),
    });
  }
}

function getCodeAgentModelList(): CodeAgentModelListResult {
  try {
    const settings = AppStore.getCodeAgentProviderSettingsStatus();
    const models: CodeAgentModelOption[] = [];
    const builderConfigured = Boolean(
      providerStatusById(settings, "builder")?.configured,
    );
    const codex = getLocalCodexCliStatus();
    const claude = getLocalClaudeCliStatus();
    const pi = getLocalCliAvailability("pi", "Pi", localPiCliAvailabilityCache);
    const opencode = getLocalCliAvailability(
      "opencode",
      "OpenCode",
      localOpenCodeCliAvailabilityCache,
    );
    const anthropicConfigured = Boolean(
      providerStatusById(settings, "anthropic")?.configured,
    );
    const openAiConfigured = Boolean(
      providerStatusById(settings, "openai")?.configured,
    );
    const customEngine = process.env.AGENT_ENGINE?.trim();
    const customModel = process.env.AGENT_MODEL?.trim();

    if (customEngine) {
      models.push({
        engine: customEngine,
        engineLabel: "Custom",
        model: customModel || BUILDER_MODEL_CONFIG.defaultModel,
        label: customModel || BUILDER_MODEL_CONFIG.defaultModel,
        configured: true,
      });
    }

    if (builderConfigured) {
      pushCodeAgentModelOptions(models, {
        engine: "builder",
        engineLabel: "Builder.io",
        supportedModels: BUILDER_MODEL_CONFIG.supportedModels,
        configured: true,
      });
    }
    if (codex.available) {
      const codexModels = Array.from(
        new Set([
          ...(codex.model && codex.model !== CODEX_CLI_ENGINE_NAME
            ? [codex.model]
            : []),
          ...AI_SDK_MODEL_CONFIG.openai.supportedModels,
          CODEX_CLI_DEFAULT_MODEL,
        ]),
      );
      for (const model of codexModels) {
        models.push({
          engine: CODEX_CLI_ENGINE_NAME,
          engineLabel: "OpenAI",
          model,
          label: model,
          description:
            "Run locally through your signed-in ChatGPT subscription.",
          configured: codex.authenticated,
          ...(codex.authenticated
            ? { statusLabel: "ChatGPT subscription", isSubscription: true }
            : {}),
        });
      }
    }
    if (claude.available) {
      models.push({
        engine: CLAUDE_CLI_ENGINE_NAME,
        engineLabel: "Anthropic",
        model: ANTHROPIC_MODEL_CONFIG.defaultModel,
        label: ANTHROPIC_MODEL_CONFIG.defaultModel,
        description: "Run locally through your signed-in Claude subscription.",
        configured: claude.authenticated,
        ...(claude.authenticated
          ? { statusLabel: "Claude subscription", isSubscription: true }
          : {}),
      });
    }
    if (pi.available) {
      models.push({
        engine: PI_CLI_ENGINE_NAME,
        engineLabel: "Pi",
        model: PI_CLI_ENGINE_NAME,
        label: "Pi",
        description: "Run locally through the Pi coding agent.",
        configured: true,
        statusLabel: "Installed",
      });
    }
    if (opencode.available) {
      models.push({
        engine: OPENCODE_CLI_ENGINE_NAME,
        engineLabel: "OpenCode",
        model: OPENCODE_CLI_ENGINE_NAME,
        label: "OpenCode",
        description: "Run locally through the OpenCode coding agent.",
        configured: true,
        statusLabel: "Installed",
      });
    }
    pushCodeAgentModelOptions(models, {
      engine: "ai-sdk:openai",
      engineLabel: "OpenAI",
      supportedModels: AI_SDK_MODEL_CONFIG.openai.supportedModels,
      configured: openAiConfigured,
    });
    pushCodeAgentModelOptions(models, {
      engine: "anthropic",
      engineLabel: "Anthropic",
      supportedModels: ANTHROPIC_MODEL_CONFIG.supportedModels,
      configured: anthropicConfigured,
    });

    const selected = customEngine
      ? {
          engine: customEngine,
          model: customModel || BUILDER_MODEL_CONFIG.defaultModel,
        }
      : (models.find(
          (option) =>
            option.configured &&
            (option.engine === CODEX_CLI_ENGINE_NAME ||
              option.engine === CLAUDE_CLI_ENGINE_NAME),
        ) ??
        models.find((option) => option.configured) ??
        models[0]);

    return {
      status: "ok",
      models,
      ...(selected
        ? { selected: { engine: selected.engine, model: selected.model } }
        : {}),
    };
  } catch (err) {
    return {
      status: "unavailable",
      models: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function getCodeAgentHostMetadata(): CodeAgentHostMetadata {
  try {
    const cwd = resolveCodeAgentsTerminalCwd({});
    const repoRoot = resolveRepositoryRoot(cwd);
    const corePackagePath = path.join(repoRoot, "packages/core/package.json");
    const corePackage = fs.existsSync(corePackagePath)
      ? readPackageMetadata(corePackagePath)
      : {};
    const cliEntry = path.join(repoRoot, "packages/core/dist/cli/index.js");
    return {
      status: "ok",
      platform: process.platform,
      desktopVersion: app.getVersion(),
      storeRoot: codeAgentStoreRoot(),
      runsDir: codeAgentRunsDir(),
      transcriptsDir: codeAgentEventsDir(),
      codePack: {
        name: corePackage.name ?? "@agent-native/core",
        version: corePackage.version,
        root: fs.existsSync(path.join(repoRoot, "packages/core"))
          ? path.join(repoRoot, "packages/core")
          : repoRoot,
        packagePath: fs.existsSync(corePackagePath)
          ? corePackagePath
          : undefined,
        cliEntry,
        available: fs.existsSync(cliEntry),
      },
      llmProvider: getCodeAgentLlmProviderStatus(),
      computerControl: getDesktopComputerControlMetadata(),
      capabilities: {
        fileBackedRuns: true,
        nativeTaskRunner: true,
        queueMetadata: true,
        steeringMetadata: true,
        retryRun: true,
        rerunRun: true,
        openTerminal: true,
        controlCommands: [
          "resume",
          "status",
          "stop",
          "approve",
          "retry",
          "rerun",
        ],
      },
    };
  } catch (err) {
    return {
      status: "unavailable",
      platform: process.platform,
      desktopVersion: app.getVersion(),
      storeRoot: codeAgentStoreRoot(),
      runsDir: codeAgentRunsDir(),
      transcriptsDir: codeAgentEventsDir(),
      llmProvider: getCodeAgentLlmProviderStatus(),
      computerControl: getDesktopComputerControlMetadata(),
      capabilities: {
        fileBackedRuns: true,
        nativeTaskRunner: false,
        queueMetadata: true,
        steeringMetadata: true,
        retryRun: false,
        rerunRun: false,
        openTerminal: true,
        controlCommands: ["resume", "status", "stop", "approve"],
      },
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function getDesktopComputerControlMetadata(): NonNullable<
  CodeAgentHostMetadata["computerControl"]
> {
  const permissions =
    process.platform === "darwin"
      ? getComputerPermissionStatus(systemPreferences)
      : { accessibility: false, screenRecording: "unknown" as const };
  const extensionPath = getBundledChromeExtensionPath();
  return {
    available: Boolean(desktopComputerMcpBridge),
    desktop: permissions,
    browser: {
      nativeHostInstalled: Boolean(
        browserNativeHostManifestPath &&
        fs.existsSync(browserNativeHostManifestPath),
      ),
      extensionBundled: fs.existsSync(extensionPath),
      connected:
        desktopBrowserControlBridge?.status().nativeHostConnected ?? false,
    },
  };
}

function getBundledChromeExtensionPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "chrome-extension")
    : path.resolve(__dirname, "../../../agent-chrome-extension/dist");
}

function retryCodeAgentRun(input: unknown): CodeAgentRetryRunResult {
  const payload = isObject(input) ? input : {};
  const runId = normalizeCodeAgentRunId(payload.runId);
  const requestedPermissionMode = firstStringValue(payload.permissionMode);
  const permissionMode = requestedPermissionMode
    ? getCodeAgentPermissionMode(requestedPermissionMode)
    : undefined;
  const goal =
    getCodeAgentGoal(firstStringValue(payload.goalId)) ??
    getCodeAgentGoal(inferCodeAgentGoalIdFromRunId(runId ?? undefined)) ??
    CODE_AGENT_GOALS[0];

  if (!runId) {
    return {
      ok: false,
      message: "Select a session first.",
      error: "Missing or invalid run id.",
    };
  }
  if (requestedPermissionMode && !permissionMode) {
    return {
      ok: false,
      message: "Choose a valid run mode.",
      error: `Unsupported run mode: ${requestedPermissionMode}`,
    };
  }
  if (goal.surfaceKind !== "native") {
    return {
      ok: false,
      message: `${goal.surfaceLabel} sessions open in their app surface.`,
      error: `Native retry is not available for goal ${goal.id}.`,
    };
  }
  if (activeCodeAgentProcesses.has(runId)) {
    return {
      ok: true,
      run: readDesktopCodeAgentRun(runId) ?? undefined,
      message: "This Agent-Native Code run is already running.",
    };
  }

  const runRecord = readCodeAgentRunRecord(runId);
  if (!runRecord) {
    return {
      ok: false,
      message: "Agent-Native Code session was not found.",
      error: `No run record exists for ${runId}.`,
    };
  }

  const now = new Date().toISOString();
  const queue = buildCodeAgentQueueMetadata({
    goalId: goal.id,
    queuedAt: now,
    attempt: readCodeAgentAttempt(runRecord) + 1,
    retryOf: runId,
  });
  const userMetadata = isObject(payload.metadata) ? payload.metadata : {};
  const engine = normalizeCodeAgentRequestedEngine(
    firstStringValue(payload.engine),
  );
  const model = firstStringValue(payload.model);
  const effort = firstStringValue(payload.effort);
  appendCodeAgentStatusEvent(runId, "Retry requested from Desktop.", {
    source: "desktop",
    command: "retry",
    queue,
    ...(permissionMode ? { permissionMode } : {}),
  });
  touchCodeAgentRunRecord(runId, {
    status: "queued",
    phase: "retry-queued",
    ...(permissionMode ? { permissionMode } : {}),
    queue,
    metadata: {
      ...userMetadata,
      retryOf: runId,
      queue,
      lastRetryQueuedAt: now,
      ...(permissionMode ? { permissionMode } : {}),
      ...(engine ? { engine } : {}),
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
    },
  });
  const cwd =
    getRecordString(runRecord, "cwd") ?? resolveCodeAgentsTerminalCwd({});
  spawnCodeAgentRunner(runId, cwd, permissionMode);
  return {
    ok: true,
    run: readDesktopCodeAgentRun(runId) ?? undefined,
    message: "Retry started for this Agent-Native Code run.",
  };
}

async function controlCodeAgentRun(
  input: unknown,
): Promise<CodeAgentControlResult> {
  const payload = input && typeof input === "object" ? input : {};
  const record = payload as Record<string, unknown>;
  const command = record.command as CodeAgentControlCommand | undefined;
  const runId = typeof record.runId === "string" ? record.runId : "";
  const requestedPermissionMode = firstStringValue(record.permissionMode);
  const permissionMode = requestedPermissionMode
    ? getCodeAgentPermissionMode(requestedPermissionMode)
    : undefined;
  const defaultGoalId = CODE_AGENT_GOALS[0]?.id ?? "task";
  const goal = getCodeAgentGoal(
    typeof record.goalId === "string" ? record.goalId : defaultGoalId,
  );

  if (!goal) {
    return {
      ok: false,
      command: command ?? "status",
      action: "none",
      message: "Unknown Agent-Native Code goal.",
      error: "Unknown Agent-Native Code goal.",
    };
  }

  if (!runId) {
    return {
      ok: false,
      command: command ?? "status",
      action: "none",
      message: "Select a run first.",
      error: "Missing run id.",
    };
  }

  if (requestedPermissionMode && !permissionMode) {
    return {
      ok: false,
      command: command ?? "status",
      action: "none",
      message: "Choose a valid run mode.",
      error: `Unsupported run mode: ${requestedPermissionMode}`,
    };
  }

  const portalRecord = readCodeAgentRunRecord(runId);
  if (portalRecord && isPortalCodeAgentRunRecord(portalRecord)) {
    const portalMetadata = isObject(portalRecord.metadata)
      ? portalRecord.metadata
      : {};
    const portalRemote = isObject(portalMetadata.remote)
      ? portalMetadata.remote
      : {};
    const portalRelayUrl = firstStringValue(portalRemote.relayUrl);
    const portalHostId = firstStringValue(portalRemote.deviceId);
    const portalRunId = firstStringValue(portalRemote.remoteRunId) ?? runId;
    if (command === "stop") {
      if (!portalRelayUrl || !portalHostId) {
        return {
          ok: false,
          command,
          action: "none",
          message: "Portal host details are missing from this session.",
          error: "Invalid Portal execution residence.",
        };
      }
      const result = await portalRelayRequest(
        portalRelayUrl,
        "POST",
        "/_agent-native/integrations/remote/enqueue",
        {
          operation: "code-agent.run.stop",
          payload: {
            hostId: portalHostId,
            runId: portalRunId,
          },
        },
      );
      return {
        ok: result.ok !== false,
        command,
        action: "refresh",
        message:
          firstStringValue(result.message) ??
          (result.ok === false
            ? "Could not stop the Portal run."
            : "Stop sent to Portal."),
        error: result.error,
      };
    }
    if (
      command === "approve" ||
      command === "approve-always" ||
      command === "deny"
    ) {
      return {
        ok: false,
        command,
        action: "open-ui",
        message:
          "Approve or deny this Portal run from the paired computer or phone.",
      };
    }
  }

  if (permissionMode) {
    touchCodeAgentRunRecord(runId, {
      permissionMode,
      metadata: { permissionMode },
    });
  }

  if (
    (command === "approve" ||
      command === "approve-always" ||
      command === "deny") &&
    goal.surfaceKind === "native"
  ) {
    const result = await desktopCodeBackgroundAgentController.control({
      runId,
      command,
    });
    return backgroundControlResultToDesktopControlResult(command, result);
  }

  if (
    command === "approve" ||
    command === "approve-always" ||
    command === "deny"
  ) {
    return {
      ok: true,
      command,
      action: "open-ui",
      message: `Open ${goal.surfaceLabel} to ${command === "deny" ? "deny" : "approve"} this run.`,
    };
  }

  if (command === "resume" && goal.surfaceKind === "native") {
    const result = await desktopCodeBackgroundAgentController.control({
      runId,
      command,
    });
    return backgroundControlResultToDesktopControlResult(command, result);
  }

  if (command === "resume") {
    return {
      ok: true,
      command,
      action: "open-ui",
      message: `Opening ${goal.surfaceLabel} for this run.`,
    };
  }
  if (command === "status") {
    return {
      ok: true,
      command,
      action: "refresh",
      message: "Status refreshed.",
    };
  }
  if (command === "stop") {
    const result = await desktopCodeBackgroundAgentController.control({
      runId,
      command,
    });
    return backgroundControlResultToDesktopControlResult(command, result);
  }

  return {
    ok: false,
    command: "status",
    action: "none",
    message: "Unsupported Agent-Native Code command.",
    error: "Unsupported Agent-Native Code command.",
  };
}

// ---------- IPC: Clipboard + Agent-Native Code (background code agents) ----------
// See main/ipc/code-agents.ts.
registerCodeAgentsIpc({
  isObject,
  firstStringValue,
  timestampSlug,
  normalizeCodeAgentRunId,
  listDesktopCodeAgentRuns,
  listCodeAgentSchedules: () =>
    desktopCodeAgentScheduler.list() satisfies CodeAgentScheduleListResult,
  createCodeAgentSchedule: (input) =>
    desktopCodeAgentScheduler.create(input) satisfies CodeAgentScheduleResult,
  updateCodeAgentSchedule: (input) =>
    desktopCodeAgentScheduler.update(input) satisfies CodeAgentScheduleResult,
  deleteCodeAgentSchedule: (input) =>
    desktopCodeAgentScheduler.delete(input) satisfies CodeAgentScheduleResult,
  runCodeAgentScheduleNow: (input) => desktopCodeAgentScheduler.runNow(input),
  listCodeAgentWorktrees,
  createCodeAgentRun,
  forkCodeAgentRun,
  restoreCodeAgentWorktree,
  submitCodeAgentRemoteWaitlist,
  getCodeAgentModelList,
  readCodeAgentTranscript,
  removeCodeAgentTranscriptSubscription,
  initializeCodeAgentTranscriptSubscriptionKeys,
  watchCodeAgentTranscriptSubscription,
  setCodeAgentTranscriptSubscription: (subscriptionId, subscription) =>
    codeAgentTranscriptSubscriptions.set(subscriptionId, subscription),
  sendCodeAgentTranscriptSubscriptionBatch,
  appendCodeAgentFollowUp,
  transferCodeAgentRun,
  transferAllCodeAgentRuns,
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
  openCodeAgentCodexLogin: openCodexLoginTerminal,
  getRemoteConnectorStatus,
  setRemoteConnectorEnabled,
  pairRemoteCodeAgentConnector,
});

const codeAgentWorktreeSweepTimer = setInterval(
  cleanupDueManagedCodeAgentWorktrees,
  60 * 60 * 1000,
);
codeAgentWorktreeSweepTimer.unref?.();

registerQuickPromptIpc({
  createCodeAgentRun,
  sendOpenRequestToRenderer,
});

// ---------- Native context menus ----------
// Electron does not provide Chromium's standard right-click menu by default,
// so add the useful browser/editing actions for both the shell and app webviews.

const contextMenuContents = new WeakSet<Electron.WebContents>();

function openExternalUrl(url: string) {
  if (!canOpenDesktopExternalUrl(url, process.platform)) return;
  if (process.platform !== "darwin" || !/^https?:/i.test(url)) {
    shell.openExternal(url).catch(() => {});
    return;
  }

  let fellBack = false;
  const fallback = () => {
    if (fellBack) return;
    fellBack = true;
    shell.openExternal(url).catch(() => {});
  };

  try {
    const child = spawn("open", ["-a", "Google Chrome", url], {
      detached: true,
      stdio: "ignore",
    });
    child.once("error", fallback);
    child.once("close", (code) => {
      if (code !== 0) fallback();
    });
    child.unref();
  } catch {
    fallback();
  }
}

ipcMain.handle(IPC.SHELL_OPEN_EXTERNAL, (_event, url: unknown) => {
  if (typeof url !== "string") return;
  openExternalUrl(url);
});

function handleDesktopProtocolUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== `${DEEP_LINK_PROTOCOL}:`) return false;
    void handleDeepLink(url);
    return true;
  } catch {
    return false;
  }
}

function cleanContextMenuTemplate(
  template: Electron.MenuItemConstructorOptions[],
): Electron.MenuItemConstructorOptions[] {
  while (template[0]?.type === "separator") template.shift();
  while (template.at(-1)?.type === "separator") template.pop();
  return template.filter((item, index, items) => {
    if (item.type !== "separator") return true;
    return items[index - 1]?.type !== "separator";
  });
}

function addContextMenuSeparator(
  template: Electron.MenuItemConstructorOptions[],
) {
  if (template.length === 0 || template.at(-1)?.type === "separator") return;
  template.push({ type: "separator" });
}

function buildContextMenuTemplate(
  contents: Electron.WebContents,
  params: Electron.ContextMenuParams,
): Electron.MenuItemConstructorOptions[] {
  const template: Electron.MenuItemConstructorOptions[] = [];
  const editFlags = params.editFlags;
  const hasLink = params.linkURL.trim().length > 0;
  const hasSelection = params.selectionText.trim().length > 0;
  const hasMediaSource = params.srcURL.trim().length > 0;
  const hasImage = params.mediaType === "image" && params.hasImageContents;

  if (hasLink) {
    template.push(
      {
        label: "Open Link in Browser",
        enabled: canOpenDesktopExternalUrl(params.linkURL, process.platform),
        click: () => openExternalUrl(params.linkURL),
      },
      {
        label: "Copy Link",
        click: () => clipboard.writeText(params.linkURL),
      },
    );
  }

  if (hasImage || hasMediaSource) {
    addContextMenuSeparator(template);
    if (hasImage) {
      template.push({
        label: "Copy Image",
        click: () => contents.copyImageAt(params.x, params.y),
      });
    }
    if (hasMediaSource) {
      template.push({
        label: hasImage ? "Copy Image Address" : "Copy Media Address",
        click: () => clipboard.writeText(params.srcURL),
      });
    }
  }

  if (params.isEditable) {
    if (
      params.misspelledWord &&
      params.dictionarySuggestions &&
      params.dictionarySuggestions.length > 0
    ) {
      addContextMenuSeparator(template);
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        template.push({
          label: suggestion,
          click: () => contents.replaceMisspelling(suggestion),
        });
      }
    }

    addContextMenuSeparator(template);
    template.push(
      {
        label: "Undo",
        enabled: editFlags.canUndo,
        click: () => contents.undo(),
      },
      {
        label: "Redo",
        enabled: editFlags.canRedo,
        click: () => contents.redo(),
      },
      { type: "separator" },
      {
        label: "Cut",
        enabled: editFlags.canCut,
        click: () => contents.cut(),
      },
      {
        label: "Copy",
        enabled: editFlags.canCopy || hasSelection,
        click: () => contents.copy(),
      },
      {
        label: "Paste",
        enabled: editFlags.canPaste,
        click: () => contents.paste(),
      },
      {
        label: "Paste and Match Style",
        enabled: editFlags.canPaste && editFlags.canEditRichly,
        click: () => contents.pasteAndMatchStyle(),
      },
      {
        label: "Delete",
        enabled: editFlags.canDelete,
        click: () => contents.delete(),
      },
      { type: "separator" },
      {
        label: "Select All",
        enabled: editFlags.canSelectAll,
        click: () => contents.selectAll(),
      },
    );
  } else if (hasSelection) {
    addContextMenuSeparator(template);
    template.push({
      label: "Copy",
      click: () => contents.copy(),
    });
  }

  if (IS_DEV) {
    addContextMenuSeparator(template);
    template.push({
      label: "Inspect Element",
      click: () => contents.inspectElement(params.x, params.y),
    });
  }

  return cleanContextMenuTemplate(template);
}

function installContextMenu(contents: Electron.WebContents) {
  if (contextMenuContents.has(contents)) return;
  contextMenuContents.add(contents);

  contents.on("context-menu", (event, params) => {
    const template = buildContextMenuTemplate(contents, params);
    if (template.length === 0) return;

    event.preventDefault();
    const menu = Menu.buildFromTemplate(template);
    const window =
      BrowserWindow.fromWebContents(contents) ||
      BrowserWindow.getFocusedWindow() ||
      BrowserWindow.getAllWindows()[0];
    menu.popup({ window, x: params.x, y: params.y });
  });
}

// ---------- IPC: Window controls ----------
// See main/ipc/window.ts.
registerWindowIpc();

// ---------- IPC: App config management ----------
// See main/ipc/apps.ts.
registerAppsIpc({
  getManagedDesktopAppIds: () => Array.from(managedDesktopAppProcesses.keys()),
  stopManagedDesktopApp,
  refreshDesktopShortcutBindings,
  chooseLocalAppFolder,
  desktopAppCreationSettings,
  normalizeDesktopAppsRoot,
  createDesktopAppFromPrompt,
  prepareDesktopAppForLocalCodeChange,
  showDesktopAppContextMenu,
  loadWorkspaceApps: () => {
    const generation = ++desktopWorkspaceAppsGeneration;
    const dispatch = DESKTOP_DEFAULT_APPS.find(
      (appConfig) => appConfig.id === "dispatch",
    );
    const dispatchOrigin = dispatch ? getAppOrigin(dispatch) : null;
    if (!dispatchOrigin) {
      const result = {
        enabled: false,
        apps: [],
      } satisfies DesktopWorkspaceAppListResult;
      cacheDesktopWorkspaceApps(result, generation);
      return Promise.resolve(result);
    }
    const dispatchApp = resolveDesktopIdentityApp("dispatch");
    return loadDesktopWorkspaceApps({
      identitySession:
        dispatchApp?.session ?? session.fromPartition("persist:app-dispatch"),
      dispatchOrigin,
    }).then((result) => {
      cacheDesktopWorkspaceApps(result, generation);
      return result;
    });
  },
});

registerDesktopChatIpc();

registerChatFirstMcpIpc({
  resolveMcpHost: resolveDesktopMcpHost,
  codeAgentWorkspaceRoot: () => resolveCodeAgentsTerminalCwd({}),
});

// See main/ipc/plan-files.ts.
registerPlanFilesIpc({
  requirePlanFilesWebviewAccess,
  normalizePlanFilesRequestPlanId,
  getPlanFilesGrant,
  planFilesFolderInfo,
  collectLocalControlResources,
  choosePlanFilesFolder,
  writePlanFilesForRequest,
  readPlanFilesForRequest,
  clearPlanFilesGrant,
});

// See main/ipc/content-files.ts.
registerContentFilesIpc({
  requireContentFilesWebviewAccess,
  getContentFilesGrants,
  getContentFilesGrant,
  contentFilesFolderInfo,
  contentFilesFoldersInfo,
  chooseContentFilesFolder,
  associateContentFilesSource,
  writeContentFilesForRequest,
  writeContentFileForRequest,
  deleteContentFileForRequest,
  readContentFilesForRequest,
  revealContentFileForRequest,
  clearContentFilesGrant,
  subscribeContentFilesChanges,
  unsubscribeContentFilesChanges,
});

// ---------- IPC: Local app-launch shortcuts ----------
// See main/ipc/shortcuts.ts.
registerShortcutsIpc({
  getDesktopShortcutSettings,
  registerDesktopShortcutBindings,
});

// ---------- IPC: Inter-app message relay ----------
// Routes messages from one app to all renderer windows so webviews can forward
// them. See main/ipc/inter-app.ts.
registerInterAppIpc();

// ---------- OAuth handling ----------
// OAuth providers we recognize and keep out of app webviews. Depending on the
// provider and flow, the URL is opened in an Electron BrowserWindow or the
// system browser. Signed Builder app-webview connects can use the system
// browser because the callback carries email-bound state; older unsigned
// connect URLs still use the Electron popup so the callback shares the app
// session. The desktop Code provider has its own loopback browser flow. Each
// provider specifies:
//   - a `matches` predicate on the initial URL (from window.open)
//   - a `callbackPathFragment` used to detect when the OAuth callback has
//     been reached so we can auto-close the popup
//
// Builder is matched on two URL shapes: (1) the localhost 302 starter at
// `/_agent-native/builder/connect`, which is what the in-app button opens,
// and (2) the resolved `builder.io/cli-auth` URL, so both shapes can be
// routed out of the app webview. Private keys delivered by the callback are
// written server-side (template `.env` + SQL `persisted-env-vars`) — they
// never touch the webview/renderer. See credential-provider.ts.
interface OAuthProvider {
  name: string;
  matches: (url: URL, context?: OAuthMatchContext) => boolean;
  /** Substrings to look for in the navigation URL to detect callback arrival. */
  callbackPathFragments: string[];
}

interface OAuthMatchContext {
  sourceUrl?: string;
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function isGoogleOAuthStarterPath(pathname: string): boolean {
  return (
    pathname.endsWith("/_agent-native/google/auth-url") ||
    pathname.endsWith("/_agent-native/google/add-account/auth-url")
  );
}

function getUrlOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function isTrustedGoogleOAuthStarter(
  url: URL,
  context?: OAuthMatchContext,
): boolean {
  if (!isGoogleOAuthStarterPath(url.pathname)) return false;
  if (isLoopbackHost(url.hostname)) return true;
  return getUrlOrigin(context?.sourceUrl) === url.origin;
}

function isBuilderAppHost(host: string): boolean {
  return (
    host === "builder.io" ||
    host.endsWith(".builder.io") ||
    host === "builder.my" ||
    host.endsWith(".builder.my")
  );
}

const OAUTH_PROVIDERS: OAuthProvider[] = [
  {
    name: "google",
    matches: (u, context) =>
      u.hostname === "accounts.google.com" ||
      isTrustedGoogleOAuthStarter(u, context),
    callbackPathFragments: ["google/callback", "google/add-account/callback"],
  },
  {
    name: "builder",
    matches: (u) => {
      const host = u.hostname.toLowerCase();
      const isLocalhost =
        host === "localhost" || host === "127.0.0.1" || host === "[::1]";
      // (a) The localhost 302 starter the in-app button opens.
      if (
        isLocalhost &&
        u.pathname.endsWith("/_agent-native/builder/connect")
      ) {
        return true;
      }
      // (b) The resolved Builder CLI-auth URL. Gate on `/cli-auth` so
      // ordinary builder.io links (docs, marketing, etc.) opened from a
      // webview don't get hijacked into the OAuth popup — they'd load
      // fine but never hit the callback and the popup would just sit
      // open on a docs page.
      return isBuilderAppHost(host) && u.pathname.startsWith("/cli-auth");
    },
    callbackPathFragments: ["/_agent-native/builder/callback"],
  },
];

function getBuilderCliAuthHost(): string {
  return process.env.BUILDER_APP_HOST || "https://builder.io";
}

function buildDesktopBuilderCliAuthUrl(callbackUrl: string): string {
  const callback = new URL(callbackUrl);
  const authUrl = new URL("/cli-auth", getBuilderCliAuthHost());
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("host", "agent-native-desktop");
  authUrl.searchParams.set("client_id", "Agent Native Desktop");
  authUrl.searchParams.set("redirect_url", callback.toString());
  authUrl.searchParams.set("preview_url", callback.origin);
  authUrl.searchParams.set("framework", "agent-native");
  authUrl.searchParams.set("signupSource", "agent-native");
  authUrl.searchParams.set("agentNativeFlow", "desktop_code");
  authUrl.searchParams.set("agentNativeApp", "agent-native-desktop");
  authUrl.searchParams.set(
    "agentNativeConnectSource",
    "desktop_code_provider_settings",
  );
  authUrl.searchParams.set("utm_source", "agent-native");
  authUrl.searchParams.set("utm_medium", "product");
  authUrl.searchParams.set("utm_campaign", "onboarding");
  authUrl.searchParams.set("utm_content", "desktop_code_provider_settings");
  return authUrl.toString();
}

function desktopBuilderCallbackPage(
  kind: "success" | "error",
  message: string,
) {
  const title =
    kind === "success" ? "Builder.io connected" : "Builder.io connect failed";
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #111; color: #fff; font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { max-width: 360px; padding: 24px; text-align: center; }
      p { color: #aaa; line-height: 1.5; }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${message}</p>
    </main>
  </body>
</html>`;
}

function connectDesktopBuilderProvider(): Promise<CodeAgentProviderSettingsUpdateResult> {
  return new Promise((resolve) => {
    let settled = false;
    let callbackServer: HttpServer | null = null;
    let callbackOrigin: string | null = null;
    let timeout: NodeJS.Timeout | null = null;

    const finish = (result: CodeAgentProviderSettingsUpdateResult) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (callbackServer) {
        callbackServer.close(() => {});
      }
      resolve(result);
    };

    const handleCallbackRequest = (
      req: IncomingMessage,
      res: ServerResponse,
    ) => {
      const origin = callbackOrigin;
      if (!origin) {
        res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Callback server is not ready");
        return;
      }
      let requestUrl: URL;
      try {
        requestUrl = new URL(req.url ?? "/", origin);
      } catch {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Bad request");
        return;
      }

      if (requestUrl.pathname !== "/_agent-native/desktop-builder/callback") {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }

      const privateKey = requestUrl.searchParams.get("p-key");
      const publicKey = requestUrl.searchParams.get("api-key");
      if (!privateKey || !publicKey) {
        const message = "Builder did not return credentials.";
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(desktopBuilderCallbackPage("error", message));
        finish({
          ok: false,
          settings: getCodeAgentProviderSettings(),
          message: "Could not connect Builder.io.",
          error: message,
        });
        return;
      }

      const settings = withLocalCodexProviderStatus(
        AppStore.saveCodeAgentProviderCredentials({
          BUILDER_PRIVATE_KEY: privateKey,
          BUILDER_PUBLIC_KEY: publicKey,
        }),
      );
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        desktopBuilderCallbackPage(
          "success",
          "You can close this tab and return to Agent Native Desktop.",
        ),
      );
      finish({
        ok: true,
        settings,
        message: "Builder.io connected for Code.",
      });
    };

    callbackServer = createServer();

    callbackServer.once("error", (err) => {
      finish({
        ok: false,
        settings: getCodeAgentProviderSettings(),
        message: "Could not start Builder.io connect flow.",
        error: err instanceof Error ? err.message : String(err),
      });
    });

    callbackServer.listen(0, "127.0.0.1", () => {
      const server = callbackServer;
      if (!server) {
        finish({
          ok: false,
          settings: getCodeAgentProviderSettings(),
          message: "Could not start Builder.io connect flow.",
          error: "No callback server was available.",
        });
        return;
      }
      const address = server.address() as AddressInfo | null;
      if (!address) {
        finish({
          ok: false,
          settings: getCodeAgentProviderSettings(),
          message: "Could not start Builder.io connect flow.",
          error: "No callback port was assigned.",
        });
        return;
      }

      callbackOrigin = `http://127.0.0.1:${address.port}`;
      server.on("request", handleCallbackRequest);
      const callbackUrl = `http://127.0.0.1:${address.port}/_agent-native/desktop-builder/callback`;
      const authUrl = buildDesktopBuilderCliAuthUrl(callbackUrl);
      if (!canOpenDesktopExternalUrl(authUrl, process.platform)) {
        finish({
          ok: false,
          settings: getCodeAgentProviderSettings(),
          message: "Could not open Builder.io connect.",
          error: "The Builder.io connect URL was not valid.",
        });
        return;
      }

      shell.openExternal(authUrl).catch((err) => {
        finish({
          ok: false,
          settings: getCodeAgentProviderSettings(),
          message: "Could not open Builder.io connect.",
          error: err instanceof Error ? err.message : String(err),
        });
      });
      timeout = setTimeout(() => {
        finish({
          ok: false,
          settings: getCodeAgentProviderSettings(),
          message: "Builder.io connect timed out.",
          error: "No callback was received before the connect flow timed out.",
        });
      }, DESKTOP_BUILDER_CONNECT_TIMEOUT_MS);
    });
  });
}

function matchOAuthProvider(
  urlString: string,
  context?: OAuthMatchContext,
): OAuthProvider | null {
  try {
    const parsed = new URL(urlString);
    return OAUTH_PROVIDERS.find((p) => p.matches(parsed, context)) ?? null;
  } catch {
    return null;
  }
}

function shouldRememberOAuthStateFromNavigation(
  provider: OAuthProvider,
  url: URL,
): boolean {
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (provider.name === "google") {
    return url.hostname === "accounts.google.com";
  }
  return provider.matches(url);
}

function rememberOAuthStateFromNavigation(
  provider: OAuthProvider,
  url: string,
  target?: OAuthInjectionTarget,
) {
  try {
    const parsed = new URL(url);
    if (shouldRememberOAuthStateFromNavigation(provider, parsed)) {
      rememberOAuthState(url, target);
    }
  } catch {
    // Malformed URL — ignore
  }
}

function builderOAuthUsesDesktopProvider(url: URL): boolean {
  if (!url.pathname.startsWith("/cli-auth")) return false;
  if (url.searchParams.get("host") === "agent-native-desktop") return true;
  const redirectUrl = url.searchParams.get("redirect_url");
  if (!redirectUrl) return false;
  try {
    return new URL(redirectUrl).pathname.endsWith(
      "/_agent-native/desktop-builder/callback",
    );
  } catch {
    return false;
  }
}

function builderOAuthUsesSignedBrowserProvider(url: URL): boolean {
  if (!url.pathname.startsWith("/cli-auth")) return false;
  const redirectUrl = url.searchParams.get("redirect_url");
  if (!redirectUrl) return false;
  try {
    const callbackUrl = new URL(redirectUrl);
    return (
      callbackUrl.pathname.endsWith("/_agent-native/builder/callback") &&
      callbackUrl.searchParams.has("_an_state")
    );
  } catch {
    return false;
  }
}

function builderConnectUsesSignedBrowserProvider(url: URL): boolean {
  return (
    url.pathname.endsWith("/_agent-native/builder/connect") &&
    url.searchParams.has("_an_connect")
  );
}

function shouldOpenOAuthInSystemBrowser(provider: OAuthProvider, url: URL) {
  if (provider.name === "builder") {
    return (
      builderOAuthUsesDesktopProvider(url) ||
      builderOAuthUsesSignedBrowserProvider(url) ||
      builderConnectUsesSignedBrowserProvider(url)
    );
  }
  // Desktop Google OAuth carries a browser-binding cookie created by the
  // bootstrap request. It must complete in the source session, not in the
  // system browser's unrelated cookie jar. Non-desktop Google OAuth already
  // uses the same in-app popup path.
  return false;
}

function openMatchedOAuthUrl(
  url: string,
  parsed: URL,
  sourceSession: Electron.Session | undefined,
  provider: OAuthProvider,
  sourceUrl?: string,
) {
  if (shouldOpenOAuthInSystemBrowser(provider, parsed)) {
    openExternalUrl(url);
    return;
  }
  routeOAuthToBoundSession(url, sourceSession, (boundUrl, callbackSession) =>
    openOAuthWindow(boundUrl, callbackSession, provider, sourceUrl),
  );
}

function isAllowedOAuthChildPopup(provider: OAuthProvider, url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (provider.name === "builder") {
    return (
      host === "accounts.google.com" ||
      host.endsWith(".google.com") ||
      host.endsWith(".gstatic.com") ||
      host.endsWith(".firebaseapp.com") ||
      host === "builder.io" ||
      host.endsWith(".builder.io") ||
      host === "builder.my" ||
      host.endsWith(".builder.my")
    );
  }
  if (provider.name === "google") {
    return (
      host === "accounts.google.com" ||
      host.endsWith(".google.com") ||
      host.endsWith(".gstatic.com")
    );
  }
  return provider.matches(url);
}

function openOAuthWindow(
  url: string,
  sourceSession: Electron.Session | undefined,
  provider: OAuthProvider,
  sourceUrl?: string,
) {
  const injectionTarget = getOAuthInjectionTarget(sourceSession, sourceUrl);
  rememberOAuthStateFromNavigation(provider, url, injectionTarget);
  const mainWin = BrowserWindow.getAllWindows()[0];

  // Critical: the popup MUST share the source webview's session so the
  // OAuth callback hits the server with the user's auth cookies. Without
  // this, the callback runs in Electron's default session (no cookies),
  // sees `local@localhost`, and saves tokens under the connected account's
  // email instead of the actual signed-in user — turning the "connect"
  // flow into an infinite redirect loop in dev mode.
  const oauthWin = new BrowserWindow({
    width: 500,
    height: 700,
    title: "Sign in",
    backgroundColor: "#111111",
    parent: mainWin || undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      ...(sourceSession ? { session: sourceSession } : {}),
    },
  });

  oauthWin.loadURL(url);

  // Allow nested popups inside the OAuth window. Builder's /cli-auth uses
  // Firebase, and Firebase signs the user into Google via `window.open()`.
  // Electron's default is to silently block window.open, which manifests
  // inside the popup as `FirebaseError: Firebase: Unable to establish a
  // connection with the popup. It may have been blocked by the browser.
  // (auth/popup-blocked)` — the user sees a brief blank screen, the popup
  // closes, and the parent OAuth window never gets the auth result. By
  // returning `action: "allow"` here we let Electron spawn a child window
  // that shares the same session (so Firebase's postMessage handshake to
  // window.opener still works) and inherits the OAuth window as parent.
  oauthWin.webContents.setWindowOpenHandler(({ url: childUrl }) => {
    try {
      const parsed = new URL(childUrl);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return { action: "deny" as const };
      }
      if (!isAllowedOAuthChildPopup(provider, parsed)) {
        openExternalUrl(childUrl);
        return { action: "deny" as const };
      }
    } catch {
      return { action: "deny" as const };
    }
    return {
      action: "allow" as const,
      overrideBrowserWindowOptions: {
        width: 500,
        height: 700,
        backgroundColor: "#111111",
        parent: oauthWin,
        modal: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          ...(sourceSession ? { session: sourceSession } : {}),
        },
      },
    };
  });

  // Close once we've reached the OAuth callback URL. Matching on path
  // fragment works for both Google (callback on localhost /api/google/*)
  // and Builder (callback on localhost /_agent-native/builder/callback).
  // The Builder callback HTML also calls window.close() itself; this
  // close-path is the Electron-side safety net if the page's script
  // hasn't fired yet (or doesn't, e.g. on future callback redesigns).
  const popupCloser = createOAuthPopupCloser(oauthWin);
  const scheduleClose = () => popupCloser.scheduleCloseAfterFinishLoad();

  const onNavigate = (_event: Electron.Event, navUrl: string) => {
    try {
      const parsed = new URL(navUrl);
      rememberOAuthStateFromNavigation(provider, navUrl, injectionTarget);
      // Detect the OAuth callback (works for both /api/google/callback and
      // /_agent-native/google/callback).
      if (
        provider.callbackPathFragments.some((fragment) =>
          parsed.pathname.includes(fragment),
        )
      ) {
        scheduleClose();
      }
      // Detect agentnative:// deep link — handle it and close the popup.
      if (parsed.protocol === `${DEEP_LINK_PROTOCOL}:`) {
        handleDeepLink(navUrl);
        scheduleClose();
      }
    } catch {
      // Malformed URL — ignore
    }
  };

  oauthWin.webContents.on("did-navigate", onNavigate);
  oauthWin.webContents.on("did-redirect-navigation", onNavigate);

  // Intercept deep link navigations that would fail to load — handle the
  // deep link and close the popup instead of showing a blank error page.
  oauthWin.webContents.on(
    "will-navigate",
    (event: Electron.Event, navUrl: string) => {
      if (navUrl.startsWith(`${DEEP_LINK_PROTOCOL}:`)) {
        event.preventDefault();
        handleDeepLink(navUrl);
        scheduleClose();
      }
    },
  );

  // A genuine load failure (DNS, connection refused, timeout, etc.) means
  // nothing else is going to load in this popup — close it directly instead
  // of waiting for a did-finish-load that will never fire, which otherwise
  // strands the user on a permanently blank popup after clicking "Allow".
  oauthWin.webContents.on("did-fail-load", (_event, errorCode) => {
    popupCloser.onLoadFailed(errorCode);
  });

  // Builder credentials now land in SQL-backed app_secrets and the webview
  // side polls /builder/status, so closing the popup should leave the current
  // chat mounted. Google success still reloads through the agentnative://
  // session-cookie handoff in handleDeepLink().
}

const webviewOAuthNavigationHandlers = new WeakSet<Electron.WebContents>();
const webviewReloadGuardHandlers = new WeakSet<Electron.WebContents>();
const routeChunkReloadBlockedUntil = new WeakMap<
  Electron.WebContents,
  number
>();

function isRouteChunkReloadMessage(message: string): boolean {
  return (
    /Error loading route module `[^`]+`, reloading page\.\.\./.test(message) ||
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("error loading dynamically imported module") ||
    message.includes("Importing a module script failed")
  );
}

function installWebviewReloadGuard(contents: Electron.WebContents) {
  if (webviewReloadGuardHandlers.has(contents)) return;
  webviewReloadGuardHandlers.add(contents);

  // Stale React Router chunks can ask the page to reload after a deploy.
  // In the desktop shell, block that renderer-initiated refresh and let the
  // user choose when to manually refresh the app.
  contents.on(
    "console-message",
    (_event, _level, message: string | undefined) => {
      if (!message || !isRouteChunkReloadMessage(message)) return;
      routeChunkReloadBlockedUntil.set(contents, Date.now() + 2_000);
    },
  );

  contents.on("will-navigate", (event, url) => {
    const blockUntil = routeChunkReloadBlockedUntil.get(contents) ?? 0;
    if (Date.now() > blockUntil) return;
    try {
      const current = new URL(contents.getURL());
      const next = new URL(url);
      // Allow the targeted route navigation used by the app-side recovery
      // handler. Only suppress a reload that points at the exact current URL.
      if (current.origin !== next.origin || current.href !== next.href) return;
    } catch {
      return;
    }
    event.preventDefault();
    console.warn(
      "[main] blocked renderer-initiated reload after stale route chunk failure",
    );
  });
}

function openOAuthFromWebviewNavigation(
  url: string,
  sourceContents: Electron.WebContents,
): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return false;
    }
    const provider = matchOAuthProvider(url, {
      sourceUrl: sourceContents.getURL(),
    });
    if (!provider) return false;
    openMatchedOAuthUrl(
      url,
      parsed,
      sourceContents.session,
      provider,
      sourceContents.getURL(),
    );
    return true;
  } catch {
    return false;
  }
}

function normalizedNavigationHost(hostname: string): string {
  return isLoopbackHost(hostname.toLowerCase()) ? "loopback" : hostname;
}

function defaultPortForProtocol(protocol: string): string {
  if (protocol === "http:") return "80";
  if (protocol === "https:") return "443";
  return "";
}

function navigationPort(url: URL): string {
  return url.port || defaultPortForProtocol(url.protocol);
}

function isSameWebviewAppOrigin(current: URL, next: URL): boolean {
  if (current.origin === next.origin) return true;
  if (isAllowedEnvironmentNavigation(current, next)) return true;
  if (current.protocol !== next.protocol) return false;
  return (
    normalizedNavigationHost(current.hostname) ===
      normalizedNavigationHost(next.hostname) &&
    navigationPort(current) === navigationPort(next)
  );
}

function shouldOpenWebviewNavigationExternally(
  url: string,
  sourceContents: Electron.WebContents,
): boolean {
  if (!canOpenDesktopExternalUrl(url, process.platform)) return false;
  let next: URL;
  try {
    next = new URL(url);
  } catch {
    return false;
  }

  if (next.protocol !== "http:" && next.protocol !== "https:") return true;

  try {
    const current = new URL(sourceContents.getURL());
    if (current.protocol !== "http:" && current.protocol !== "https:") {
      return false;
    }
    return !isSameWebviewAppOrigin(current, next);
  } catch {
    return false;
  }
}

function handleWindowOpenForContents(
  contents: Electron.WebContents,
  url: string,
) {
  if (handleDesktopProtocolUrl(url)) {
    return { action: "deny" as const };
  }

  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" &&
      parsed.protocol !== "http:" &&
      !canOpenDesktopExternalUrl(url, process.platform)
    ) {
      return { action: "deny" as const };
    }
    const provider = matchOAuthProvider(url, {
      sourceUrl: contents.getURL(),
    });
    if (provider) {
      openMatchedOAuthUrl(
        url,
        parsed,
        contents.session,
        provider,
        contents.getURL(),
      );
    } else {
      openExternalUrl(url);
    }
  } catch {
    // malformed URL — ignore
  }
  return { action: "deny" as const };
}

function installWebviewOAuthNavigationHandler(contents: Electron.WebContents) {
  if (webviewOAuthNavigationHandlers.has(contents)) return;
  webviewOAuthNavigationHandlers.add(contents);

  const handleNavigation = (
    event: Electron.Event,
    url: string,
    options: { isMainFrame: boolean },
  ) => {
    if (handleDesktopProtocolUrl(url)) {
      event.preventDefault();
      return;
    }
    if (openOAuthFromWebviewNavigation(url, contents)) {
      event.preventDefault();
      return;
    }
    if (process.platform === "darwin" && isAllowedMacPrivacySettingsUrl(url)) {
      event.preventDefault();
      openExternalUrl(url);
      return;
    }
    if (
      options.isMainFrame &&
      shouldOpenWebviewNavigationExternally(url, contents)
    ) {
      event.preventDefault();
      openExternalUrl(url);
    }
  };

  installWebviewNavigationListeners(contents, handleNavigation);
}

// ---------- Webview popup handling ----------
// React 19 sets <webview allowpopups={true}> as a DOM property, not an HTML
// attribute. Electron only reads the attribute, so popups are silently
// blocked. The renderer now creates <webview> via document.createElement and
// sets the attribute imperatively, but setWindowOpenHandler must also be
// registered via did-attach-webview (the web-contents-created path alone
// doesn't reliably catch webviews created this way).

app.on("web-contents-created", (_event, contents) => {
  installContextMenu(contents);
  installSentryWebContentsInstrumentation(contents, {
    role: contents.getType() === "webview" ? "app-webview" : "web-contents",
  });

  if (contents.getType() !== "webview") {
    contents.setWindowOpenHandler(({ url }) =>
      handleWindowOpenForContents(contents, url),
    );
    contents.on(
      "did-attach-webview",
      (_event, webviewContents: WebContents) => {
        installContextMenu(webviewContents);
        installSentryWebContentsInstrumentation(webviewContents, {
          role: "app-webview",
        });
        installWebviewReloadGuard(webviewContents);
        installWebviewOAuthNavigationHandler(webviewContents);

        webviewContents.setWindowOpenHandler(({ url }) => {
          return handleWindowOpenForContents(webviewContents, url);
        });
      },
    );
    return;
  }

  installWebviewReloadGuard(contents);
  installWebviewOAuthNavigationHandler(contents);

  contents.setWindowOpenHandler(({ url }) => {
    return handleWindowOpenForContents(contents, url);
  });

  // Forward keyboard shortcuts from focused webview guests to the shell
  // renderer so they work even when a webview has keyboard focus.
  contents.on("before-input-event", (event, input) => {
    if (!(input.meta || input.control) || input.type !== "keyDown") return;

    const key = input.key.toLowerCase();

    // Cmd+Option+I (and legacy Cmd+Shift+I) — toggle devtools for the active app webview
    if (key === "i" && (input.alt || input.shift)) {
      event.preventDefault();
      toggleWebviewDevTools();
      return;
    }

    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;

    // Cmd+W — close tab (dedicated channel for backwards compat)
    if (key === "w") {
      event.preventDefault();
      win.webContents.send("shortcut:close-tab");
      return;
    }

    // Cmd+Option+Up/Down — previous/next app
    if (input.alt && (key === "arrowup" || key === "arrowdown")) {
      event.preventDefault();
      win.webContents.send("shortcut:keydown", {
        key: input.key,
        shiftKey: input.shift,
        altKey: true,
        ctrlKey: input.control,
      });
      return;
    }

    // Ctrl+Option+X: switch to code tab
    if (
      input.control &&
      input.alt &&
      !input.meta &&
      !input.shift &&
      key === "x"
    ) {
      event.preventDefault();
      win.webContents.send("shortcut:keydown", {
        key: "x",
        shiftKey: false,
        altKey: true,
        ctrlKey: true,
      });
      return;
    }

    const isAgentSidebarToggleShortcut =
      !input.alt &&
      !input.shift &&
      (key === "\\" || input.code === "Backslash");

    // Forward other Cmd+ shortcuts: F, L, R, T, Shift+T, 1-9, [, ], \
    const isShortcut =
      key === "f" ||
      key === "l" ||
      key === "r" ||
      key === "t" ||
      key === "[" ||
      key === "]" ||
      isAgentSidebarToggleShortcut ||
      (key >= "1" && key <= "9");

    if (isShortcut) {
      event.preventDefault();
      win.webContents.send("shortcut:keydown", {
        key: isAgentSidebarToggleShortcut ? "\\" : input.key,
        shiftKey: input.shift,
        altKey: false,
        ctrlKey: input.control,
      });
    }
  });
});

// ---------- App lifecycle ----------

function buildUpdateMenuItem(): Electron.MenuItemConstructorOptions {
  const currentUpdateStatus = getCurrentUpdateStatus();

  if (currentUpdateStatus.state === "unsupported") {
    return {
      label: currentUpdateStatus.reason,
      enabled: false,
    };
  }

  if (currentUpdateStatus.state === "downloaded") {
    return {
      label: currentUpdateStatus.version
        ? `Relaunch to Install Update ${currentUpdateStatus.version}`
        : "Relaunch to Install Update",
      click: () => void installDownloadedUpdate(),
    };
  }

  if (currentUpdateStatus.state === "downloading") {
    return {
      label: `Downloading Update (${currentUpdateStatus.percent}%)`,
      enabled: false,
    };
  }

  if (currentUpdateStatus.state === "available") {
    return {
      label: currentUpdateStatus.version
        ? `Downloading Update ${currentUpdateStatus.version}`
        : "Downloading Update",
      enabled: false,
    };
  }

  if (currentUpdateStatus.state === "checking") {
    return {
      label: "Checking for Updates...",
      enabled: false,
    };
  }

  if (currentUpdateStatus.state === "not-available") {
    return {
      label: `Up to Date — Version ${currentUpdateStatus.currentVersion}`,
      click: () => void checkForAppUpdates({ notifyOnResult: true }),
    };
  }

  return {
    label:
      currentUpdateStatus.state === "error"
        ? "Retry Update Check"
        : "Check for Updates...",
    click: () => void checkForAppUpdates({ notifyOnResult: true }),
  };
}

function buildCurrentVersionMenuItem(): Electron.MenuItemConstructorOptions {
  return {
    label: `Current Version ${app.getVersion()}`,
    enabled: false,
  };
}

function installApplicationMenu() {
  const isMac = process.platform === "darwin";
  const appMenu: Electron.MenuItemConstructorOptions = {
    label: app.getName(),
    submenu: [
      { role: "about" as const },
      { type: "separator" as const },
      buildUpdateMenuItem(),
      buildCurrentVersionMenuItem(),
      { type: "separator" as const },
      ...(desktopIdentityBroker && desktopIdentityBroker.getStatus() !== "idle"
        ? [
            {
              label: "Sign Out of Agent Native",
              click: () =>
                void desktopIdentityBroker?.signOut(
                  listDesktopIdentityCleanupApps(),
                ),
            } satisfies Electron.MenuItemConstructorOptions,
            { type: "separator" as const },
          ]
        : []),
      { role: "services" as const },
      { type: "separator" as const },
      // Keep Cmd+H explicit because the custom menu replaces Electron's
      // default app menu, whose implicit hide accelerator is easy to lose.
      { role: "hide" as const, accelerator: "Command+H" },
      { role: "hideOthers" as const },
      { role: "unhide" as const },
      { type: "separator" as const },
      { role: "quit" as const },
    ],
  };

  const openLogsMenuItem: Electron.MenuItemConstructorOptions = {
    label: "Open Logs Folder",
    click: () => revealLogFolder(),
  };

  const helpMenu: Electron.MenuItemConstructorOptions = {
    role: "help" as const,
    submenu: isMac
      ? [
          buildCurrentVersionMenuItem(),
          { type: "separator" as const },
          openLogsMenuItem,
        ]
      : [
          buildUpdateMenuItem(),
          buildCurrentVersionMenuItem(),
          { type: "separator" as const },
          {
            label: "Learn More",
            click: () => void shell.openExternal("https://agent-native.com"),
          },
          { type: "separator" as const },
          openLogsMenuItem,
        ],
  };

  // Replace the default app menu so Cmd+Option+I doesn't open shell DevTools.
  // We handle this shortcut ourselves via before-input-event → toggleWebviewDevTools().
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [appMenu] : []),
    { role: "fileMenu" as const },
    { role: "editMenu" as const },
    {
      label: "View",
      submenu: [
        { role: "reload" as const },
        { role: "forceReload" as const },
        {
          label: "Toggle Developer Tools",
          accelerator: "CmdOrCtrl+Option+I",
          click: () => toggleWebviewDevTools(),
        },
        { type: "separator" as const },
        {
          label: "Actual Size",
          accelerator: "CmdOrCtrl+0",
          click: () => resetActiveWebviewZoom(),
        },
        {
          label: "Zoom In",
          accelerator: "CmdOrCtrl+Plus",
          click: () => zoomActiveWebview(ZOOM_STEP),
        },
        {
          label: "Zoom Out",
          accelerator: "CmdOrCtrl+-",
          click: () => zoomActiveWebview(-ZOOM_STEP),
        },
        { type: "separator" as const },
        { role: "togglefullscreen" as const },
      ],
    },
    { role: "windowMenu" as const },
    helpMenu,
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function refreshApplicationMenu() {
  if (!app.isReady()) return;
  installApplicationMenu();
}

const MAC_SCREEN_RECORDING_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";

let screenCapturePromptOpen = false;

/**
 * Recovery path for a capture request macOS refused. An app that has never
 * asked for screen recording is absent from System Settings entirely, so users
 * hunt for an entry they cannot find — `getSources` forces the request that
 * registers this app in the list before we point them at it.
 */
async function handleBlockedScreenCapture() {
  if (process.platform !== "darwin" || screenCapturePromptOpen) return;
  screenCapturePromptOpen = true;
  try {
    const status = systemPreferences.getMediaAccessStatus("screen");
    console.warn("[display-capture] screen access status", { status });
    if (status !== "granted") {
      await desktopCapturer
        .getSources({
          types: ["screen"],
          thumbnailSize: { width: 1, height: 1 },
        })
        .catch(() => []);
    }
    const appName = app.getName();
    const { response } = await dialog.showMessageBox({
      type: "info",
      title: "Screen recording is blocked",
      message: `macOS is blocking screen recording for ${appName}.`,
      detail: `Open System Settings > Privacy & Security > Screen & System Audio Recording and turn on ${appName}, then quit and reopen ${appName} and start the recording again.\n\nLook for ${appName} in that list — individual apps like Clips are never listed separately.`,
      buttons: ["Open System Settings", "Not now"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) openExternalUrl(MAC_SCREEN_RECORDING_SETTINGS_URL);
  } catch (err) {
    console.error("[display-capture] permission recovery failed:", err);
  } finally {
    screenCapturePromptOpen = false;
  }
}

function configurePermissionHandlers(
  sess: Electron.Session,
  getTargetAppId: () => string | null,
) {
  if (permissionConfiguredSessions.has(sess)) return;
  permissionConfiguredSessions.add(sess);

  sess.setPermissionCheckHandler(
    (contents, permission, requestingOrigin, details) => {
      return (
        isAllowedWebviewPermission(permission) &&
        isTrustedPermissionRequest(
          contents,
          getTargetAppId(),
          requestingOrigin,
          details,
        )
      );
    },
  );

  sess.setPermissionRequestHandler(
    (contents, permission, callback, details) => {
      callback(
        isAllowedWebviewPermission(permission) &&
          isTrustedPermissionRequest(
            contents,
            getTargetAppId(),
            undefined,
            details,
          ),
      );
    },
  );

  if (getTargetAppId() === "clips") {
    console.info("[display-capture] registering clips display media handler", {
      platform: process.platform,
      osRelease: os.release(),
    });
    sess.setDisplayMediaRequestHandler(
      (_request, callback) => {
        // Only reached when Electron cannot provide the system picker. Log as a
        // warning because it means native screen selection did not engage.
        console.warn(
          "[display-capture] system picker did not engage — denying capture request",
        );
        callback({});
        void handleBlockedScreenCapture();
      },
      {
        // Uses the OS-native screen picker (macOS 15+ / ScreenCaptureKit).
        useSystemPicker: process.platform === "darwin",
      },
    );
  }
}

app.whenReady().then(async () => {
  if (isDesktopSsoEnabled()) {
    // Create the optional broker without blocking startup. The first eligible
    // app asks it to refresh status, which keeps a slow identity authority
    // from delaying the shell before the user opens an app.
    ensureDesktopIdentityBroker();
  }

  const shouldContinueStartup = await runDesktopStartupStep({
    start: initializeDesktopComputerMcpBridge,
    isShuttingDown: () => appIsQuitting,
    abort: closeDesktopComputerMcpBridge,
  });
  if (!shouldContinueStartup) return;
  desktopCodeAgentScheduler.start();
  // Process any deep link that arrived before the app was ready
  if (pendingDeepLink) {
    handleDeepLink(pendingDeepLink);
    pendingDeepLink = null;
  }

  // Webviews now run in per-app persisted partitions (persist:app-<id>), so
  // webRequest handlers must be attached to each partitioned session, not
  // just session.defaultSession.
  const configuredSessions = new WeakSet<Electron.Session>();
  const sessionTargetAppIds = new WeakMap<Electron.Session, string | null>();
  function configureWebviewSession(
    sess: Electron.Session,
    targetAppId: string | null,
  ) {
    if (targetAppId) {
      sessionTargetAppIds.set(sess, targetAppId);
    } else if (!sessionTargetAppIds.has(sess)) {
      sessionTargetAppIds.set(sess, null);
    }
    const getTargetAppId = () => sessionTargetAppIds.get(sess) ?? null;
    if (configuredSessions.has(sess)) return;
    configuredSessions.add(sess);
    configurePermissionHandlers(sess, getTargetAppId);

    if (IS_DEV) {
      sess.webRequest.onHeadersReceived((details, callback) => {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            "Content-Security-Policy": [
              "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:",
            ],
          },
        });
      });
    }

    if (isDesktopSsoEnabled()) {
      sess.cookies.on("changed", (_event, cookie, _cause, removed) => {
        if (!isDesktopSsoEnabled()) return;
        if (removed) return;
        const appId = getTargetAppId();
        if (!appId) return;
        const identityApp = resolveDesktopIdentityApp(appId);
        if (!identityApp || !identityApp.cookieNames.includes(cookie.name)) {
          return;
        }
        void desktopIdentityBroker?.adoptAppSession(identityApp.id);
      });
    }

    // Intercept OAuth callbacks on the frame port and redirect to the app's server.
    // Google redirects to localhost:3334/api/google/... but the frame doesn't
    // serve API routes — the actual app server runs on a different port.
    // Each partition is bound to a specific app, so route to that app's port
    // rather than falling back to a hardcoded mail/calendar preference.
    sess.webRequest.onBeforeRequest(
      {
        urls: [
          `http://localhost:${FRAME_PORT}/api/google/*`,
          "*://*/_agent-native/auth/logout",
          "*://*/_agent-native/auth/logout-all",
        ],
      },
      (details, callback) => {
        const appId = getTargetAppId();
        const identityApp = appId ? resolveDesktopIdentityApp(appId) : null;
        const logoutPath = identityApp
          ? desktopWorkspaceLogoutPath(details.url, identityApp)
          : null;
        if (
          identityApp &&
          logoutPath &&
          details.method === "POST" &&
          desktopIdentityBroker &&
          desktopIdentityBroker.getStatus() !== "idle" &&
          !desktopIdentityBroker.isInternalRevocationRequest(details.url)
        ) {
          void desktopIdentityBroker
            .prepareExternalSignOut(listDesktopIdentityCleanupApps(), {
              logoutPath,
              alreadyRevokedAppId: identityApp.id,
            })
            .then(
              () => callback({}),
              (error) => {
                console.error(
                  "[main] Failed to prepare Desktop workspace sign-out:",
                  error,
                );
                callback({});
              },
            );
          return;
        }
        if (
          !details.url.startsWith(`http://localhost:${FRAME_PORT}/api/google/`)
        ) {
          callback({});
          return;
        }
        let apps: AppConfig[] = [];
        try {
          apps = AppStore.loadApps();
        } catch (err) {
          console.error("[main] OAuth redirect: loadApps failed:", err);
          callback({});
          return;
        }
        const resolvedAppId = getTargetAppId();
        const app =
          (resolvedAppId && apps.find((a) => a.id === resolvedAppId)) ||
          apps.find((a) => a.id === "mail") ||
          apps.find((a) => a.id === "calendar");
        if (app) {
          const gatewayAppUrl = resolveDesktopTemplateGatewayUrl(app);
          const appUrl = details.url.replace(
            `http://localhost:${FRAME_PORT}`,
            gatewayAppUrl || `http://localhost:${app.devPort}`,
          );
          callback({ redirectURL: appUrl });
        } else {
          callback({});
        }
      },
    );

    sess.webRequest.onCompleted(
      {
        urls: [
          "*://*/_agent-native/auth/logout",
          "*://*/_agent-native/auth/logout-all",
        ],
      },
      (details) => {
        const appId = getTargetAppId();
        const identityApp = appId ? resolveDesktopIdentityApp(appId) : null;
        const logoutPath = identityApp
          ? desktopWorkspaceLogoutPath(details.url, identityApp)
          : null;
        if (
          !identityApp ||
          !logoutPath ||
          desktopIdentityBroker?.isInternalRevocationRequest(details.url) ||
          details.method !== "POST" ||
          !desktopIdentityBroker ||
          desktopIdentityBroker.getStatus() === "idle"
        ) {
          return;
        }
        void desktopIdentityBroker.completeExternalSignOut(
          listDesktopIdentityCleanupApps(),
          { logoutPath, alreadyRevokedAppId: identityApp.id },
          details.statusCode >= 200 && details.statusCode < 300,
        );
      },
    );

    sess.webRequest.onErrorOccurred(
      {
        urls: [
          "*://*/_agent-native/auth/logout",
          "*://*/_agent-native/auth/logout-all",
        ],
      },
      (details) => {
        const appId = getTargetAppId();
        const identityApp = appId ? resolveDesktopIdentityApp(appId) : null;
        const logoutPath = identityApp
          ? desktopWorkspaceLogoutPath(details.url, identityApp)
          : null;
        if (
          !identityApp ||
          !logoutPath ||
          desktopIdentityBroker?.isInternalRevocationRequest(details.url) ||
          details.method !== "POST" ||
          !desktopIdentityBroker ||
          desktopIdentityBroker.getStatus() === "idle"
        ) {
          return;
        }
        void desktopIdentityBroker.completeExternalSignOut(
          listDesktopIdentityCleanupApps(),
          { logoutPath, alreadyRevokedAppId: identityApp.id },
          false,
        );
      },
    );
  }

  // Also configure session.defaultSession so the OAuth BrowserWindow (which
  // is not a webview and uses defaultSession) gets the redirect handler.
  // With no specific targetAppId, the handler falls back to mail/calendar.
  configureWebviewSession(session.defaultSession, null);

  // Pre-configure each known app's partition so handlers are ready before
  // the first request fires. Each partition knows its own app id.
  let initialApps: AppConfig[] = [];
  try {
    initialApps = loadAppsForAuthContext();
  } catch (err) {
    console.error("[main] failed to load apps for session setup:", err);
  }
  const sessionToAppId = new Map<Electron.Session, string>();
  for (const appConfig of initialApps) {
    const sess = session.fromPartition(`persist:app-${appConfig.id}`);
    sessionToAppId.set(sess, appConfig.id);
    configureWebviewSession(sess, appConfig.id);
  }

  // Catch any webview sessions we didn't pre-configure (e.g. custom apps
  // added at runtime) when their web contents are created. Derive the app
  // id from the webview URL's ?app= param or exact configured origin.
  function resolveDesktopWebviewAppId(
    contents: Electron.WebContents,
  ): string | null {
    const knownId =
      sessionToAppId.get(contents.session) ??
      desktopWebviewAppIds.get(contents);
    if (knownId) return knownId;
    try {
      const sourceUrl = contents.getURL();
      const parsed = new URL(sourceUrl);
      const appId = parsed.searchParams.get("app");
      const apps = loadAppsForAuthContext();
      if (appId) {
        const configured = apps.find((candidate) => candidate.id === appId);
        if (configured && getAppOrigin(configured) === parsed.origin) {
          return configured.id;
        }
        return null;
      }
      return (
        apps.find((candidate) => getAppOrigin(candidate) === parsed.origin)
          ?.id ?? null
      );
    } catch {
      // coercion-ok: malformed webview URLs have no associated app identity.
      return null;
    }
  }

  app.on("web-contents-created", (_event, wc) => {
    if (wc.getType() !== "webview") return;
    wc.on("before-input-event", (event, input) => {
      forwardDesktopNavigationShortcut(event, input);
    });
    let id = resolveDesktopWebviewAppId(wc);
    configureWebviewSession(wc.session, id);
    if (id) desktopWebviewAppIds.set(wc, id);

    const syncLoadedApp = () => {
      id = resolveDesktopWebviewAppId(wc);
      if (!id) return;
      const appId = id;
      configureWebviewSession(wc.session, appId);
      desktopWebviewAppIds.set(wc, appId);
      if (isDesktopSsoEnabled() && resolveDesktopIdentityApp(appId)) {
        void wc
          .executeJavaScript(HIDE_EMBEDDED_IDENTITY_SSO_SCRIPT, false)
          .catch(() => {});
      }
      // Ordinary navigation only synchronizes an app after the identity
      // authority is already signed in. Adoption is reserved for an explicit
      // cookie transition so a persisted stale app session cannot switch the
      // workspace account merely by being opened.
      const broker = desktopIdentityBroker;
      if (broker) {
        void broker.ensureAppSession(appId).catch(() => undefined);
      }
    };
    wc.on("dom-ready", syncLoadedApp);
    wc.on("did-navigate", syncLoadedApp);
    wc.on("did-navigate-in-page", syncLoadedApp);
    wc.on("did-stop-loading", syncLoadedApp);
    wc.on("did-finish-load", syncLoadedApp);

    // Capture renderer console messages to the log file so they survive
    // across sessions without DevTools needing to be open.
    captureWebviewLogs(wc, id ?? "webview");
  });

  installApplicationMenu();

  console.info("[main] log file:", getLogFilePath());

  reconcileInterruptedCodeAgentRuns("startup");
  initializeMultiFrontierAppIntegrationForRuntime();
  registerDesktopShortcutBindings();

  const win = createWindow();
  for (const { record } of listRawCodeAgentRunRecords()) {
    reclaimTerminalCodeAgentWorktree(record);
  }
  reconcileManagedCodeAgentWorktreeLeases();
  resumeQueuedCodeAgentWorktreeRuns();
  const initialWorktreeCleanup = setTimeout(
    cleanupDueManagedCodeAgentWorktrees,
    0,
  );
  initialWorktreeCleanup.unref?.();
  registerQuickPromptShortcut();
  // Pairing details persist, but background access is opt-in per launch.
  // A read-only status check must never spawn a process or unlock Keychain.
  remoteConnectorEnabled = false;
  if (AppStore.loadRemoteConnectorSettings().enabled) {
    AppStore.saveRemoteConnectorSettings({ enabled: false });
  }

  // Intercept keyboard shortcuts on the shell renderer
  win.webContents.on("before-input-event", (_event, input) => {
    if (forwardDesktopNavigationShortcut(_event, input)) return;
    if (!(input.meta || input.control) || input.type !== "keyDown") return;

    const key = input.key.toLowerCase();

    // Cmd+Option+I (and legacy Cmd+Shift+I) — open devtools for the active webview, not the shell
    if (key === "i" && (input.alt || input.shift)) {
      _event.preventDefault();
      toggleWebviewDevTools();
      return;
    }

    // Cmd+R — refresh active webview, not the shell
    if (key === "r") {
      _event.preventDefault();
      win.webContents.send("shortcut:keydown", {
        key: "r",
        shiftKey: input.shift,
        ctrlKey: input.control,
      });
      return;
    }

    // Cmd+F — search inside the active webview, not the shell
    if (key === "f") {
      _event.preventDefault();
      win.webContents.send("shortcut:keydown", {
        key: "f",
        shiftKey: input.shift,
        ctrlKey: input.control,
      });
      return;
    }

    // Cmd+L — copy the active webview URL.
    if (key === "l") {
      _event.preventDefault();
      win.webContents.send("shortcut:keydown", {
        key: "l",
        shiftKey: input.shift,
        ctrlKey: input.control,
      });
      return;
    }

    // Cmd+\ — toggle the agent sidebar for the active webview
    if (
      !input.alt &&
      !input.shift &&
      (key === "\\" || input.code === "Backslash")
    ) {
      _event.preventDefault();
      win.webContents.send("shortcut:keydown", {
        key: "\\",
        shiftKey: false,
        ctrlKey: input.control,
      });
      return;
    }

    // Cmd+W — close tab instead of window
    if (key === "w") {
      _event.preventDefault();
      win.webContents.send("shortcut:close-tab");
    }
  });

  // Broadcast window maximized state changes to the renderer
  const broadcastMaximized = (isMaximized: boolean) =>
    win.webContents.send(IPC.WINDOW_MAXIMIZED_CHANGED, isMaximized);

  win.on("maximize", () => broadcastMaximized(true));
  win.on("unmaximize", () => broadcastMaximized(false));
  win.on("enter-full-screen", () => broadcastMaximized(true));
  win.on("leave-full-screen", () => broadcastMaximized(false));

  // macOS: restore/focus the window when dock icon is clicked
  app.on("activate", () => {
    if (isQuickPromptActive()) return;
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (multiFrontierQuitGuard(event)) return;
  desktopCodeAgentScheduler.stop();
  if (!appIsQuitting) {
    appIsQuitting = true;
    for (const appId of managedDesktopAppProcesses.keys()) {
      stopManagedDesktopApp(appId);
    }
    pauseActiveCodeAgentProcessesForShutdown();
    if (remoteConnectorRestartTimer) {
      clearTimeout(remoteConnectorRestartTimer);
      remoteConnectorRestartTimer = null;
    }
    remoteConnectorProcess?.kill("SIGTERM");
    remoteConnectorProcess = null;
    void closeDesktopComputerMcpBridge().catch((error) => {
      console.warn(
        "[computer-control] failed to close desktop bridges during shutdown:",
        error instanceof Error ? error.message : error,
      );
    });
  }
});

app.on("will-quit", () => {
  unregisterDesktopShortcutBindings();
});
