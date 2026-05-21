import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  Notification,
  session,
  shell,
  webContents,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { autoUpdater } from "electron-updater";
import {
  IPC,
  type ActiveWebviewTarget,
  type CodeAgentCodePackResult,
  type CodeAgentCreateRunResult,
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
  type CodeAgentPromptAttachment,
  type CodeAgentRetryRunResult,
  type CodeAgentRerunResult,
  type CodeAgentRun,
  type CodeAgentRunListResult,
  type CodeAgentQueueMetadata,
  type CodeAgentSteeringMetadata,
  type CodeAgentTranscriptEvent,
  type CodeAgentTranscriptEventType,
  type CodeAgentTranscriptResult,
  type CodeAgentTerminalRequest,
  type CodeAgentTerminalResult,
  type CodeAgentRemoteConnectorControlResult,
  type CodeAgentRemoteConnectorPairRequest,
  type CodeAgentRemoteConnectorPairResult,
  type CodeAgentRemoteConnectorStatus,
  type CodeAgentProviderCredentialKey,
  type CodeAgentProviderSettings,
  type CodeAgentProviderSettingsUpdate,
  type CodeAgentProviderSettingsUpdateResult,
  type DesktopOpenRequest,
  type InterAppMessage,
  type LocalAppFolderInfo,
  type LocalAppFolderSelectResult,
  type UpdateStatus,
} from "@shared/ipc-channels";
import {
  FRAME_PORT,
  getTemplate,
  getTemplateGatewayAppUrl,
} from "@shared/app-registry";
import type { AppConfig } from "@shared/app-registry";
import {
  getBackgroundAgentRun,
  listBackgroundAgentRuns,
  listBackgroundAgentTranscriptEvents,
  type BackgroundAgentRun,
  type BackgroundAgentTranscriptEvent,
} from "../../../core/src/code-agents/background-run.js";
import {
  AI_SDK_MODEL_CONFIG,
  ANTHROPIC_MODEL_CONFIG,
  BUILDER_MODEL_CONFIG,
} from "../../../core/src/agent/model-config.js";
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
import * as AppStore from "./app-store";

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

if (IS_DEV) {
  // Keep local electron-vite runs out of the packaged app's Chromium profile.
  // Sharing the same userData directory lets dev and prod processes fight over
  // persisted webview storage (notably IndexedDB LevelDB LOCK files).
  const devUserDataPath = path.join(app.getPath("appData"), "Agent Native Dev");
  try {
    fs.mkdirSync(devUserDataPath, { recursive: true });
    app.setPath("userData", devUserDataPath);
  } catch (err) {
    console.warn("[main] failed to isolate dev userData directory:", err);
  }
}

// ---------- User-Agent marker ----------
// Tag every request from this Electron app so the server can distinguish
// Agent Native desktop from other Electron-based webviews (Builder.io's
// Fusion, Slack desktop, Discord, etc.). Without this, any Electron UA
// would trigger the desktop-only OAuth deep-link page (`agentnative://...`),
// stranding users in non-Agent-Native Electron contexts on a "Connected!
// Open Agent Native" screen whose deep link can't fire.
app.userAgentFallback = `${app.userAgentFallback} AgentNativeDesktop/${app.getVersion()}`;

// ---------- Deep link protocol (agentnative://) ----------
// Register before app is ready so macOS associates the scheme with this app.

const DEEP_LINK_PROTOCOL = "agentnative";
if (IS_DEV) {
  app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL, process.execPath, [
    path.resolve(process.argv[1]),
  ]);
} else {
  app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL);
}

let pendingDeepLink: string | null = null;
let mainWindow: BrowserWindow | null = null;
const pendingOpenRequests: DesktopOpenRequest[] = [];
const PENDING_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const CODE_AGENT_PROVIDER_SETTING_KEYS: CodeAgentProviderCredentialKey[] = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "BUILDER_PRIVATE_KEY",
  "BUILDER_PUBLIC_KEY",
];
const DESKTOP_BUILDER_CONNECT_TIMEOUT_MS = 5 * 60 * 1000;
const CODE_AGENTS_SUBSCRIBE_TRANSCRIPT_CHANNEL =
  "code-agents:subscribe-transcript";
const CODE_AGENTS_UNSUBSCRIBE_TRANSCRIPT_CHANNEL =
  "code-agents:unsubscribe-transcript";
const CODE_AGENTS_TRANSCRIPT_EVENTS_CHANNEL = "code-agents:transcript-events";

type DesktopBackgroundAgentControlCommand =
  | "approve"
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

interface CodeAgentTranscriptSubscriptionBatch {
  subscriptionId: string;
  status: CodeAgentTranscriptResult["status"];
  runId: string;
  events: CodeAgentTranscriptEvent[];
  eventFile?: string;
  reason?: string;
  error?: string;
}

interface CodeAgentTranscriptSubscription {
  id: string;
  runId: string;
  senderId: number;
  knownEventKeys: Set<string>;
  watcher?: fs.FSWatcher;
  flushTimer?: NodeJS.Timeout;
  reason?: string;
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

function extractFlowFromOAuthState(state: string | null): string | undefined {
  const parsed = decodeOAuthStatePayload(state);
  return typeof parsed?.f === "string" ? parsed.f : undefined;
}

function getCookieNameForApp(id: string | null | undefined): string {
  const slug = (id ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug ? `an_session_${slug}` : "an_session";
}

function resolveAppBaseUrl(appConfig: AppConfig): string | null {
  const isProdMode = appConfig.mode !== "dev";
  if (isProdMode && appConfig.url) return appConfig.url;
  if (!isProdMode) {
    return (
      getTemplateGatewayAppUrl(appConfig.id) ||
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
    return withCodeAgentApps(AppStore.loadApps());
  } catch (err) {
    console.error("[main] failed to load apps for auth context:", err);
    return withCodeAgentApps([]);
  }
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
  const appConfig = loadAppsForAuthContext().find((app) => app.id === appId);
  if (!appConfig) return null;
  return {
    appId: appConfig.id,
    origin: getAppOrigin(appConfig),
    session: session.fromPartition(`persist:app-${appConfig.id}`),
  };
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

function focusMainWindow(): BrowserWindow | null {
  const win =
    mainWindow && !mainWindow.isDestroyed()
      ? mainWindow
      : BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return win;
  }

  if (app.isReady()) return createWindow();
  return null;
}

function sendOpenRequestToRenderer(request: DesktopOpenRequest) {
  const win = focusMainWindow();
  if (!win || win.isDestroyed() || win.webContents.isLoading()) {
    pendingOpenRequests.push(request);
    return;
  }
  win.webContents.send(IPC.DEEP_LINK_OPEN, request);
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
      } else {
        focusMainWindow();
      }
    }
  } catch {
    // Malformed URL — ignore
  }
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

// ---------- Auto-updates ----------
//
// In production, electron-updater pulls release metadata from the
// `publish:` target in electron-builder.yml (currently the BuilderIO/agent-native
// GitHub repo). We auto-download in the background, surface progress and
// readiness to the renderer over IPC, and let the user trigger
// quitAndInstall from a sidebar pill / restart prompt. The app also
// installs queued updates automatically on quit.
//
// In dev, autoUpdater is unsupported (no app signature, no dev-app-update.yml),
// so we report an "unsupported" status and skip all autoUpdater calls.

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const UPDATE_FOCUS_CHECK_MIN_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_DESKTOP_UPDATE_FEED_URL =
  "https://agent-native.com/api/desktop-updates";
const DESKTOP_UPDATE_FEED_URL = (
  process.env.AGENT_NATIVE_DESKTOP_UPDATE_FEED_URL ||
  DEFAULT_DESKTOP_UPDATE_FEED_URL
).replace(/\/+$/, "");

let currentUpdateStatus: UpdateStatus = IS_DEV
  ? { state: "unsupported", reason: "Auto-update is disabled in development" }
  : { state: "idle" };
let updateCheckInFlight: Promise<unknown> | null = null;
let lastUpdateCheckStartedAt = 0;
let notifiedUpdateVersion: string | null = null;

function broadcastUpdateStatus(status: UpdateStatus) {
  currentUpdateStatus = status;
  refreshApplicationMenu();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.UPDATE_STATUS_CHANGED, status);
    }
  }
}

async function checkForAppUpdates(): Promise<UpdateStatus> {
  if (IS_DEV) return currentUpdateStatus;
  if (currentUpdateStatus.state === "downloaded") return currentUpdateStatus;

  if (!updateCheckInFlight) {
    lastUpdateCheckStartedAt = Date.now();
    updateCheckInFlight = autoUpdater
      .checkForUpdates()
      .catch((err) => {
        broadcastUpdateStatus({
          state: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        updateCheckInFlight = null;
      });
  }

  await updateCheckInFlight;
  return currentUpdateStatus;
}

function maybeCheckForAppUpdates() {
  if (IS_DEV) return;
  if (currentUpdateStatus.state === "downloaded") return;
  if (
    updateCheckInFlight ||
    Date.now() - lastUpdateCheckStartedAt < UPDATE_FOCUS_CHECK_MIN_INTERVAL_MS
  ) {
    return;
  }
  void checkForAppUpdates();
}

function showUpdateReadyNotification(version: string) {
  if (!Notification.isSupported()) return;
  if (notifiedUpdateVersion === version) return;
  notifiedUpdateVersion = version;

  const notification = new Notification({
    title: "Agent Native update ready",
    body: `Version ${version} is downloaded. Open Agent Native to relaunch and install it.`,
  });
  notification.on("click", focusMainWindow);
  notification.show();
}

if (!IS_DEV) {
  // The GitHub provider reads the repository-wide latest release feed, which
  // also contains npm package releases and Clips desktop releases. Use the
  // Agent Native feed that filters the shared repo down to desktop assets.
  autoUpdater.setFeedURL({
    provider: "generic",
    url: DESKTOP_UPDATE_FEED_URL,
  });
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    broadcastUpdateStatus({ state: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    broadcastUpdateStatus({
      state: "available",
      version: info.version,
      releaseNotes:
        typeof info.releaseNotes === "string" ? info.releaseNotes : undefined,
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    broadcastUpdateStatus({
      state: "not-available",
      currentVersion: info.version ?? app.getVersion(),
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    broadcastUpdateStatus({
      state: "downloading",
      percent: Math.round(progress.percent ?? 0),
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    broadcastUpdateStatus({
      state: "downloaded",
      version: info.version,
      releaseNotes:
        typeof info.releaseNotes === "string" ? info.releaseNotes : undefined,
    });
    showUpdateReadyNotification(info.version);
  });

  autoUpdater.on("error", (err) => {
    broadcastUpdateStatus({
      state: "error",
      message: err?.message ?? String(err),
    });
  });

  app.whenReady().then(() => {
    void checkForAppUpdates();
    setInterval(() => void checkForAppUpdates(), UPDATE_CHECK_INTERVAL_MS);
  });

  app.on("browser-window-focus", maybeCheckForAppUpdates);
  app.on("activate", maybeCheckForAppUpdates);
}

ipcMain.handle(IPC.UPDATE_GET_STATUS, (): UpdateStatus => currentUpdateStatus);

ipcMain.handle(IPC.UPDATE_CHECK, async (): Promise<UpdateStatus> => {
  return checkForAppUpdates();
});

ipcMain.handle(IPC.UPDATE_DOWNLOAD, async (): Promise<UpdateStatus> => {
  if (IS_DEV) return currentUpdateStatus;
  try {
    await autoUpdater.downloadUpdate();
  } catch (err) {
    broadcastUpdateStatus({
      state: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
  return currentUpdateStatus;
});

ipcMain.handle(IPC.UPDATE_INSTALL, () => {
  if (IS_DEV) return;
  // isSilent=false so any installer UI shows; isForceRunAfter=true so the
  // app relaunches after the update completes.
  autoUpdater.quitAndInstall(false, true);
});

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

    // macOS: hidden title bar with traffic lights positioned in the tab bar
    // Windows/Linux: fully frameless, custom controls in renderer
    titleBarStyle: "hidden",
    // Traffic lights in the far top-left of the tab bar
    ...(isMac && { trafficLightPosition: { x: 14, y: 12 } }),

    backgroundColor: "#111111",
    show: false,

    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      webSecurity: true,
    },
  });

  // Avoid white flash — show window once content is ready
  win.once("ready-to-show", () => win.show());
  win.webContents.on("did-finish-load", () => flushPendingOpenRequests(win));

  // In dev, load from the Vite dev server; in prod, load built files
  if (IS_DEV && process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    // DevTools will be opened for the active webview via Cmd+Shift+I
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  return win;
}

// ---------- DevTools: target the active app webview ----------

let activeAppId = "";
let activeWebviewContentsId: number | undefined;

ipcMain.on(IPC.SET_ACTIVE_APP, (_event: IpcMainEvent, appId: string) => {
  activeAppId = appId;
});

ipcMain.on(
  IPC.SET_ACTIVE_WEBVIEW,
  (_event: IpcMainEvent, target: ActiveWebviewTarget) => {
    activeAppId = target.appId;
    activeWebviewContentsId = target.webContentsId;
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

let remoteConnectorEnabled = true;
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
}): void {
  const configPath = remoteDeviceConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        token: config.token,
        relayUrl: config.relayUrl,
        deviceId: config.deviceId,
        deviceName: config.deviceName,
      },
      null,
      2,
    ),
    { encoding: "utf-8", mode: 0o600 },
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
    const child = spawn(invocation.command, args, {
      cwd: invocation.cwd,
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...invocation.env,
        AGENT_NATIVE_CODE_AGENTS_HOME: codeAgentStoreRoot(),
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
      if (remoteConnectorProcess === child) remoteConnectorProcess = null;
      remoteConnectorLastExitAt = new Date().toISOString();
      remoteConnectorLastExitCode = code;
      remoteConnectorLastExitSignal = signal;
      if (!appIsQuitting && remoteConnectorEnabled) {
        scheduleRemoteConnectorRestart();
      }
    });
    child.on("error", (err) => {
      remoteConnectorError = err instanceof Error ? err.message : String(err);
      if (remoteConnectorProcess === child) remoteConnectorProcess = null;
      if (!appIsQuitting && remoteConnectorEnabled) {
        scheduleRemoteConnectorRestart();
      }
    });
  } catch (err) {
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
    const cookieHeader = await cookieHeaderForRelay(relaySession, relayUrl);
    if (!cookieHeader) {
      return {
        ok: false,
        status: getRemoteConnectorStatus(),
        error: "Sign in to that app in Desktop before pairing this computer.",
      };
    }

    const response = await fetch(
      new URL("/_agent-native/integrations/remote/register", relayUrl),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: cookieHeader,
        },
        body: JSON.stringify({
          label: request.label ?? `${os.hostname()} Desktop`,
        }),
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
    writeRemoteDeviceConfig({
      token,
      relayUrl,
      deviceId,
      deviceName,
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
  const runs = desktopCodeBackgroundAgentController.list({
    goalId,
  }) as BackgroundAgentRun[];
  return runs.map(backgroundRunToDesktopRun);
}

function readDesktopCodeAgentRun(runId: string): CodeAgentRun | null {
  reconcileInterruptedCodeAgentRun(runId, "read");
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
    (reason !== "shutdown" && activeCodeAgentProcesses.has(runId))
  )
    return;
  if (!isDesktopCodeAgentRunInterruptible(currentRecord)) return;
  if (reason !== "shutdown" && hasLivePersistedCodeAgentRunner(currentRecord))
    return;

  currentRecord = readCodeAgentRunRecord(runId) ?? currentRecord;
  if (
    reason !== "shutdown" &&
    (activeCodeAgentProcesses.has(runId) ||
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
    needsApproval: approvalInterrupted ? true : false,
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

function textFromUnknown(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => {
        if (typeof item === "string") return item;
        if (!isObject(item)) return "";
        return firstStringValue(item.text, item.content, item.message) ?? "";
      })
      .map((part) => part.trim())
      .filter(Boolean);
    return parts.length > 0 ? parts.join("\n") : undefined;
  }
  if (isObject(value)) {
    return firstStringValue(value.text, value.content, value.message);
  }
  return undefined;
}

function firstTextValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = textFromUnknown(value);
    if (text) return text;
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
  if (fallback.source) metadata.source = fallback.source;

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

function readCodeAgentTranscript(input: unknown): CodeAgentTranscriptResult {
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
  const result = readCodeAgentTranscript({ runId: subscription.runId });
  subscription.knownEventKeys = new Set(
    result.events.map(codeAgentTranscriptEventKey),
  );
  return result;
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
  const result = readCodeAgentTranscript({ runId: subscription.runId });
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
    events,
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
  fs.mkdirSync(path.dirname(eventFile), { recursive: true });
  fs.appendFileSync(
    eventFile,
    `${JSON.stringify({
      schemaVersion: 1,
      role: event.type,
      ...event,
      kind: event.type,
      message: event.text,
    })}\n`,
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

function spawnCodeAgentRunner(
  runId: string,
  cwd: string,
  permissionMode?: CodeAgentPermissionMode,
): void {
  if (activeCodeAgentProcesses.has(runId)) return;
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
    return;
  }
  const repoRoot = resolveRepositoryRoot(cwd);
  const runRecord = readCodeAgentRunRecord(runId);
  const normalizedPermissionMode =
    permissionMode ??
    readCodeAgentPermissionMode(runRecord) ??
    DEFAULT_CODE_AGENT_PERMISSION_MODE;
  const localCli = path.join(repoRoot, "packages/core/dist/cli/index.js");
  const command = fs.existsSync(localCli) ? "node" : "pnpm";
  const args = fs.existsSync(localCli)
    ? [path.relative(repoRoot, localCli), "code", "run", runId]
    : [
        "--filter",
        "@agent-native/core",
        "exec",
        "node",
        "dist/cli/index.js",
        "code",
        "run",
        runId,
      ];
  try {
    const child = spawn(command, args, {
      cwd: repoRoot,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        AGENT_NATIVE_CODE_AGENTS_HOME: codeAgentStoreRoot(),
        AGENT_NATIVE_CODE_AGENT_PERMISSION_MODE: normalizedPermissionMode,
      },
    });
    const runnerStartedAt = new Date().toISOString();
    const runnerCommand = `${command} ${args.join(" ")}`;
    activeCodeAgentProcesses.set(runId, {
      pid: child.pid,
      command: runnerCommand,
      cwd: repoRoot,
      startedAt: runnerStartedAt,
      permissionMode: normalizedPermissionMode,
    });
    touchCodeAgentRunRecord(runId, {
      status: "running",
      phase: "executing",
      metadata: {
        permissionMode: normalizedPermissionMode,
        runnerState: "running",
        runnerPid: child.pid,
        runnerCommand,
        runnerCwd: repoRoot,
        runnerStartedAt,
      },
    });
    child.stdout?.on("data", (chunk) => {
      appendCodeAgentAssistantDeltaEvent(runId, chunk.toString());
    });
    child.stderr?.on("data", (chunk) => {
      appendCodeAgentStatusEvent(runId, chunk.toString().trim(), {
        source: "runner-stderr",
      });
    });
    child.on("exit", (code, signal) => {
      activeCodeAgentProcesses.delete(runId);
      codeAgentAssistantDeltaSeq.delete(runId);
      appendCodeAgentStatusEvent(
        runId,
        code === 0
          ? "Agent-Native Code process exited."
          : `Agent-Native Code process exited with ${signal ?? code}.`,
        { source: "desktop-runner", code, signal },
      );
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
    child.unref();
  } catch (err) {
    appendCodeAgentStatusEvent(
      runId,
      "Could not start Agent-Native Code process.",
      {
        source: "desktop-runner",
        error: err instanceof Error ? err.message : String(err),
      },
    );
    touchCodeAgentRunRecord(runId, {
      status: "errored",
      phase: "runner-error",
      metadata: {
        runnerState: "failed",
        runnerError: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

function spawnCodeAgentApprovalRunner(
  runId: string,
  cwd: string,
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
  const localCli = path.join(repoRoot, "packages/core/dist/cli/index.js");
  const command = fs.existsSync(localCli) ? "node" : "pnpm";
  const args = fs.existsSync(localCli)
    ? [path.relative(repoRoot, localCli), "code", "approve", runId]
    : [
        "--filter",
        "@agent-native/core",
        "exec",
        "node",
        "dist/cli/index.js",
        "code",
        "approve",
        runId,
      ];

  try {
    const child = spawn(command, args, {
      cwd: repoRoot,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        AGENT_NATIVE_CODE_AGENTS_HOME: codeAgentStoreRoot(),
        AGENT_NATIVE_CODE_AGENT_PERMISSION_MODE: normalizedPermissionMode,
      },
    });
    const runnerStartedAt = new Date().toISOString();
    const runnerCommand = `${command} ${args.join(" ")}`;
    activeCodeAgentProcesses.set(runId, {
      pid: child.pid,
      command: runnerCommand,
      cwd: repoRoot,
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
        approvalRunnerStartedAt: runnerStartedAt,
      },
    });
    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (!text) return;
      appendCodeAgentStatusEvent(runId, text, {
        source: "approval-stdout",
      });
    });
    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (!text) return;
      appendCodeAgentStatusEvent(runId, text, {
        source: "approval-stderr",
      });
    });
    child.on("exit", (code, signal) => {
      activeCodeAgentProcesses.delete(runId);
      appendCodeAgentStatusEvent(
        runId,
        code === 0
          ? "Approval process exited."
          : `Approval process exited with ${signal ?? code}.`,
        { source: "desktop-approval-runner", code, signal },
      );
      touchCodeAgentRunRecord(runId, {
        updatedAt: new Date().toISOString(),
        metadata: {
          approvalRunnerExitedAt: new Date().toISOString(),
          approvalRunnerExitCode: code,
          approvalRunnerExitSignal: signal,
        },
      });
    });
    child.unref();
    return {
      ok: true,
      command: "approve",
      action: "refresh",
      message: "Approval command started.",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    appendCodeAgentStatusEvent(runId, "Could not start the approval command.", {
      source: "desktop-approval-runner",
      error: message,
    });
    touchCodeAgentRunRecord(runId, {
      status: "needs-approval",
      phase: "approval-error",
      needsApproval: true,
      metadata: {
        approvalRunnerError: message,
      },
    });
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
  const runIsActive =
    activeCodeAgentProcesses.has(input.runId) ||
    isActiveDesktopCodeAgentRun(currentRunRecord);
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

  if (input.command === "approve") {
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
    const result = spawnCodeAgentApprovalRunner(input.runId, cwd);
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
  if (!filePath || !fs.existsSync(filePath)) return;
  const record = readJsonObjectFile(filePath);
  if (!record) return;
  const metadata = isObject(record.metadata)
    ? { ...(record.metadata as Record<string, unknown>) }
    : {};
  const updateMetadata = isObject(updates.metadata) ? updates.metadata : {};
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(
      {
        ...record,
        ...updates,
        metadata: { ...metadata, ...updateMetadata },
      },
      null,
      2,
    )}\n`,
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
  const apiKey = process.env.ANTHROPIC_API_KEY;

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
  const provider = ensureCodeAgentLlmProvider();
  if (!provider.ok) {
    return {
      ok: false,
      message: "Connect a model provider before starting a coding chat.",
      error: provider.error,
    };
  }

  const goal =
    getCodeAgentGoal(firstStringValue(payload.goalId)) ?? CODE_AGENT_GOALS[0];
  const now = new Date().toISOString();
  const runId = `${goal.id}-${timestampSlug(now)}-${randomUUID().slice(0, 8)}`;
  const cwd = resolveCodeAgentsTerminalCwd({ cwd: payload.cwd });
  const permissionMode =
    getCodeAgentPermissionMode(firstStringValue(payload.permissionMode)) ??
    DEFAULT_CODE_AGENT_PERMISSION_MODE;
  const engine = firstStringValue(payload.engine);
  const model = firstStringValue(payload.model);
  const effort = firstStringValue(payload.effort);
  const attachments = normalizeCodeAgentPromptAttachments(payload.attachments);
  const userMetadata = isObject(payload.metadata) ? payload.metadata : {};
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
    return {
      ok: false,
      message: "Could not create a session id.",
      error: "Invalid generated run id.",
    };
  }

  try {
    fs.mkdirSync(path.dirname(runFile), { recursive: true });
    fs.writeFileSync(runFile, `${JSON.stringify(record, null, 2)}\n`);
    const event = createDesktopUserTranscriptEvent(runId, prompt, goal.id, {
      queue,
      steering,
      attachments,
      retryOf,
      rerunOf,
    });
    const eventFile = appendCodeAgentTranscriptEvent(event);
    if (goal.surfaceKind === "native") {
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
    return {
      ok: false,
      message: "Could not record the coding session.",
      error: err instanceof Error ? err.message : String(err),
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
  const engine = firstStringValue(payload.engine);
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
    const goalId = firstStringValue(payload.goalId);
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
  const engine = firstStringValue(payload.engine);
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

  if (permissionMode) {
    const record = readCodeAgentRunRecord(runId);
    const steering = buildCodeAgentSteeringMetadata({
      cwd: getRecordString(record, "cwd"),
      permissionMode,
      engine,
      model,
      effort,
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
        ...(engine ? { engine } : {}),
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
        steering,
      },
    });
  } else if (engine || model || effort) {
    const record = readCodeAgentRunRecord(runId);
    const steering = buildCodeAgentSteeringMetadata({
      cwd: getRecordString(record, "cwd"),
      permissionMode: readCodeAgentPermissionMode(record),
      engine,
      model,
      effort,
      attachments: normalizeCodeAgentPromptAttachments(
        isObject(record?.metadata) ? record.metadata.attachments : undefined,
      ),
    });
    touchCodeAgentRunRecord(runId, {
      ...(newTitle ? { title: newTitle } : {}),
      steering,
      metadata: {
        ...userMetadata,
        ...(engine ? { engine } : {}),
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
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

function spawnDetached(
  command: string,
  args: string[],
  cwd: string,
): CodeAgentTerminalResult {
  try {
    const child = spawn(command, args, {
      cwd,
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.unref();
    return { ok: true, cwd };
  } catch (err) {
    return {
      ok: false,
      cwd,
      error: err instanceof Error ? err.message : String(err),
    };
  }
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
    } catch {
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
  const filePath = codeAgentProjectsFile();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`);
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

function quoteWindowsCmdPath(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function openTerminalForCodeAgents(request?: unknown): CodeAgentTerminalResult {
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
  const configuredProviders = [
    ...(process.env.AGENT_ENGINE ? ["Custom"] : []),
    ...settings.configuredProviders,
  ];

  return {
    configured: configuredProviders.length > 0,
    label: configuredProviders[0],
    configuredProviders,
    missingEnvVars: CODE_AGENT_PROVIDER_SETTING_KEYS.filter(
      (key) => !process.env[key],
    ),
  };
}

function hasRuntimeCodeAgentLlmProvider(): boolean {
  if (process.env.AGENT_ENGINE) return true;
  if (process.env.ANTHROPIC_API_KEY) return true;
  if (process.env.OPENAI_API_KEY) return true;
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) return true;
  return Boolean(
    process.env.BUILDER_PRIVATE_KEY && process.env.BUILDER_PUBLIC_KEY,
  );
}

function ensureCodeAgentLlmProvider(): {
  ok: boolean;
  error?: string;
} {
  if (process.env.AGENT_NATIVE_CODE_AGENT_FAKE_RESPONSE !== undefined) {
    return { ok: true };
  }
  if (hasRuntimeCodeAgentLlmProvider()) return { ok: true };

  const applyResult = AppStore.applyCodeAgentProviderCredentialsToEnv();
  if (hasRuntimeCodeAgentLlmProvider()) return { ok: true };
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
      "Set ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, or Builder credentials.",
  };
}

function getCodeAgentProviderSettings(): CodeAgentProviderSettings {
  return AppStore.getCodeAgentProviderSettingsStatus();
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
    const settings = AppStore.saveCodeAgentProviderCredentials(updates);
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
      settings: AppStore.getCodeAgentProviderSettingsStatus(),
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
  },
): void {
  for (const model of options.supportedModels) {
    models.push({
      engine: options.engine,
      engineLabel: options.engineLabel,
      model,
      label: model,
      configured: options.configured,
    });
  }
}

function getCodeAgentModelList(): CodeAgentModelListResult {
  try {
    const settings = AppStore.getCodeAgentProviderSettingsStatus();
    const models: CodeAgentModelOption[] = [
      {
        engine: "auto",
        engineLabel: "Auto",
        model: "auto",
        label: "Default model",
        description: "Use the connected provider and saved default.",
        configured: true,
      },
    ];
    const builderConfigured = Boolean(
      providerStatusById(settings, "builder")?.configured,
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
    } else {
      pushCodeAgentModelOptions(models, {
        engine: "anthropic",
        engineLabel: "Anthropic",
        supportedModels: ANTHROPIC_MODEL_CONFIG.supportedModels,
        configured: Boolean(
          providerStatusById(settings, "anthropic")?.configured,
        ),
      });
      pushCodeAgentModelOptions(models, {
        engine: "ai-sdk:openai",
        engineLabel: "OpenAI",
        supportedModels: AI_SDK_MODEL_CONFIG.openai.supportedModels,
        configured: Boolean(providerStatusById(settings, "openai")?.configured),
      });
      pushCodeAgentModelOptions(models, {
        engine: "ai-sdk:google",
        engineLabel: "Gemini",
        supportedModels: AI_SDK_MODEL_CONFIG.google.supportedModels,
        configured: Boolean(providerStatusById(settings, "google")?.configured),
      });
    }

    const selected = customEngine
      ? {
          engine: customEngine,
          model: customModel || BUILDER_MODEL_CONFIG.defaultModel,
        }
      : builderConfigured
        ? {
            engine: "builder",
            model: BUILDER_MODEL_CONFIG.defaultModel,
          }
        : { engine: "auto", model: "auto" };

    return {
      status: "ok",
      models,
      selected,
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
  const engine = firstStringValue(payload.engine);
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

  if (permissionMode) {
    touchCodeAgentRunRecord(runId, {
      permissionMode,
      metadata: { permissionMode },
    });
  }

  if (command === "approve" && goal.surfaceKind === "native") {
    const result = await desktopCodeBackgroundAgentController.control({
      runId,
      command,
    });
    return backgroundControlResultToDesktopControlResult(command, result);
  }

  if (command === "approve") {
    return {
      ok: true,
      command,
      action: "open-ui",
      message: `Open ${goal.surfaceLabel} to approve this run.`,
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
    const goal = getCodeAgentGoal(goalId ?? CODE_AGENT_GOALS[0]?.id ?? "task");
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
    const result = initializeCodeAgentTranscriptSubscriptionKeys(subscription);
    codeAgentTranscriptSubscriptions.set(subscriptionId, subscription);
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
  (_event: IpcMainInvokeEvent, input: unknown): Promise<CodeAgentRerunResult> =>
    rerunCodeAgentRun(input),
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
  (_event: IpcMainInvokeEvent, request?: unknown): CodeAgentTerminalResult => {
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

// ---------- Native context menus ----------
// Electron does not provide Chromium's standard right-click menu by default,
// so add the useful browser/editing actions for both the shell and app webviews.

const contextMenuContents = new WeakSet<Electron.WebContents>();

function canOpenExternalUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return (
      protocol === "http:" ||
      protocol === "https:" ||
      protocol === "mailto:" ||
      protocol === "tel:"
    );
  } catch {
    return false;
  }
}

function openExternalUrl(url: string) {
  if (!canOpenExternalUrl(url)) return;
  shell.openExternal(url).catch(() => {});
}

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
        enabled: canOpenExternalUrl(params.linkURL),
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

ipcMain.on(IPC.WINDOW_MINIMIZE, (event: IpcMainEvent) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.on(IPC.WINDOW_MAXIMIZE, (event: IpcMainEvent) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  win.isMaximized() ? win.restore() : win.maximize();
});

ipcMain.on(IPC.WINDOW_CLOSE, (event: IpcMainEvent) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.handle(
  IPC.WINDOW_IS_MAXIMIZED,
  (event: IpcMainInvokeEvent): boolean => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  },
);

// ---------- IPC: App config management ----------

ipcMain.handle(IPC.APPS_LOAD, (): AppConfig[] => {
  return AppStore.loadApps();
});

ipcMain.handle(
  IPC.APPS_ADD,
  (_event: IpcMainInvokeEvent, app: AppConfig): AppConfig[] => {
    return AppStore.addApp(app);
  },
);

ipcMain.handle(
  IPC.APPS_REMOVE,
  (_event: IpcMainInvokeEvent, id: string): AppConfig[] => {
    return AppStore.removeApp(id);
  },
);

ipcMain.handle(
  IPC.APPS_UPDATE,
  (
    _event: IpcMainInvokeEvent,
    id: string,
    updates: Partial<AppConfig>,
  ): AppConfig[] => {
    return AppStore.updateApp(id, updates);
  },
);

ipcMain.handle(IPC.APPS_RESET, (): AppConfig[] => {
  return AppStore.resetToDefaults();
});

ipcMain.handle(
  IPC.APPS_CHOOSE_LOCAL_FOLDER,
  (): Promise<LocalAppFolderSelectResult> => chooseLocalAppFolder(),
);

// ---------- IPC: Frame settings ----------

ipcMain.handle(IPC.FRAME_LOAD, () => {
  return AppStore.loadFrameSettings();
});

ipcMain.handle(
  IPC.FRAME_UPDATE,
  (_event: IpcMainInvokeEvent, settings: Partial<AppStore.FrameSettings>) => {
    return AppStore.saveFrameSettings(settings);
  },
);

// ---------- IPC: Inter-app message relay ----------
// Routes messages from one app to all renderer windows so webviews can forward them.

ipcMain.on(IPC.INTER_APP_SEND, (event: IpcMainEvent, msg: InterAppMessage) => {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send(IPC.INTER_APP_MESSAGE, msg);
  });
});

// ---------- OAuth handling ----------
// OAuth providers we recognize and keep out of app webviews. Depending on the
// provider and flow, the URL is opened in an Electron BrowserWindow or the
// system browser. App-webview Builder connect stays in an Electron popup so the
// callback shares the app session; the desktop Code provider has its own
// loopback browser flow. Each provider specifies:
//   - a `matches` predicate on the initial URL (from window.open)
//   - a `callbackPathFragment` used to detect when the OAuth callback has
//     been reached so we can auto-close the popup
//
// Builder is matched on two URL shapes: (1) the localhost 302 starter at
// `/_agent-native/builder/connect`, which is what the in-app button opens,
// and (2) the resolved `builder.io/cli-auth` URL, so both shapes route
// through the same popup. Private keys delivered by the callback are
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
  authUrl.searchParams.set(
    "agentNativeConnectSource",
    "desktop_code_provider_settings",
  );
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
          settings: AppStore.getCodeAgentProviderSettingsStatus(),
          message: "Could not connect Builder.io.",
          error: message,
        });
        return;
      }

      const settings = AppStore.saveCodeAgentProviderCredentials({
        BUILDER_PRIVATE_KEY: privateKey,
        BUILDER_PUBLIC_KEY: publicKey,
      });
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
        settings: AppStore.getCodeAgentProviderSettingsStatus(),
        message: "Could not start Builder.io connect flow.",
        error: err instanceof Error ? err.message : String(err),
      });
    });

    callbackServer.listen(0, "127.0.0.1", () => {
      const server = callbackServer;
      if (!server) {
        finish({
          ok: false,
          settings: AppStore.getCodeAgentProviderSettingsStatus(),
          message: "Could not start Builder.io connect flow.",
          error: "No callback server was available.",
        });
        return;
      }
      const address = server.address() as AddressInfo | null;
      if (!address) {
        finish({
          ok: false,
          settings: AppStore.getCodeAgentProviderSettingsStatus(),
          message: "Could not start Builder.io connect flow.",
          error: "No callback port was assigned.",
        });
        return;
      }

      callbackOrigin = `http://127.0.0.1:${address.port}`;
      server.on("request", handleCallbackRequest);
      const callbackUrl = `http://127.0.0.1:${address.port}/_agent-native/desktop-builder/callback`;
      const authUrl = buildDesktopBuilderCliAuthUrl(callbackUrl);
      if (!canOpenExternalUrl(authUrl)) {
        finish({
          ok: false,
          settings: AppStore.getCodeAgentProviderSettingsStatus(),
          message: "Could not open Builder.io connect.",
          error: "The Builder.io connect URL was not valid.",
        });
        return;
      }

      shell.openExternal(authUrl).catch((err) => {
        finish({
          ok: false,
          settings: AppStore.getCodeAgentProviderSettingsStatus(),
          message: "Could not open Builder.io connect.",
          error: err instanceof Error ? err.message : String(err),
        });
      });
      timeout = setTimeout(() => {
        finish({
          ok: false,
          settings: AppStore.getCodeAgentProviderSettingsStatus(),
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

function googleOAuthUsesDesktopExchange(url: URL): boolean {
  if (url.searchParams.has("flow_id")) return true;
  return !!extractFlowFromOAuthState(url.searchParams.get("state"));
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

function shouldOpenOAuthInSystemBrowser(provider: OAuthProvider, url: URL) {
  if (provider.name === "builder") {
    return builderOAuthUsesDesktopProvider(url);
  }
  // Google blocks embedded/Electron OAuth surfaces. Framework pages that pass
  // a flow id poll /desktop-exchange, so the system browser can complete the
  // OAuth callback and the app webview can claim the resulting session token.
  return provider.name === "google" && googleOAuthUsesDesktopExchange(url);
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
  openOAuthWindow(url, sourceSession, provider, sourceUrl);
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
  let closeScheduled = false;

  function scheduleClose() {
    if (closeScheduled) return;
    closeScheduled = true;
    oauthWin.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        if (!oauthWin.isDestroyed()) oauthWin.close();
      }, 600);
    });
  }

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

  oauthWin.webContents.on("did-fail-load", () => {
    scheduleClose();
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
      if (current.origin !== next.origin) return;
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

function handleWindowOpenForContents(
  contents: Electron.WebContents,
  url: string,
) {
  if (handleDesktopProtocolUrl(url)) {
    return { action: "deny" as const };
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
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

  const handleNavigation = (event: Electron.Event, url: string) => {
    if (handleDesktopProtocolUrl(url)) {
      event.preventDefault();
      return;
    }
    if (!openOAuthFromWebviewNavigation(url, contents)) return;
    event.preventDefault();
  };

  contents.on("will-frame-navigate", (event) => {
    if (event.isMainFrame) return;
    handleNavigation(event, event.url);
  });

  // Belt-and-suspenders for existing deployed app bundles that may still
  // fall back to assigning window.location when Electron reports a manually
  // handled popup as null. Keep Builder/Google OAuth out of the app webview.
  contents.on("will-navigate", (event) => {
    handleNavigation(event, event.url);
  });
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

  if (contents.getType() !== "webview") {
    contents.setWindowOpenHandler(({ url }) =>
      handleWindowOpenForContents(contents, url),
    );
    contents.on("did-attach-webview" as any, (_e: any, wc: any) => {
      installContextMenu(wc);
      installWebviewReloadGuard(wc);
      installWebviewOAuthNavigationHandler(wc);

      wc.setWindowOpenHandler(({ url }: any) => {
        return handleWindowOpenForContents(wc, url);
      });
    });
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
      });
    }
  });
});

// ---------- App lifecycle ----------

function buildUpdateMenuItem(): Electron.MenuItemConstructorOptions {
  if (IS_DEV) {
    return {
      label: "Check for Updates...",
      enabled: false,
    };
  }

  if (currentUpdateStatus.state === "downloaded") {
    return {
      label: currentUpdateStatus.version
        ? `Relaunch to Install Update ${currentUpdateStatus.version}`
        : "Relaunch to Install Update",
      click: () => autoUpdater.quitAndInstall(false, true),
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

  return {
    label:
      currentUpdateStatus.state === "error"
        ? "Retry Update Check"
        : "Check for Updates...",
    click: () => void checkForAppUpdates(),
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
      { role: "services" as const },
      { type: "separator" as const },
      { role: "hide" as const },
      { role: "hideOthers" as const },
      { role: "unhide" as const },
      { type: "separator" as const },
      { role: "quit" as const },
    ],
  };

  const helpMenu: Electron.MenuItemConstructorOptions = {
    role: "help" as const,
    submenu: isMac
      ? [buildCurrentVersionMenuItem()]
      : [
          buildUpdateMenuItem(),
          buildCurrentVersionMenuItem(),
          { type: "separator" as const },
          {
            label: "Learn More",
            click: () => void shell.openExternal("https://agent-native.com"),
          },
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

app.whenReady().then(() => {
  // Process any deep link that arrived before the app was ready
  if (pendingDeepLink) {
    handleDeepLink(pendingDeepLink);
    pendingDeepLink = null;
  }

  // Webviews now run in per-app persisted partitions (persist:app-<id>), so
  // webRequest handlers must be attached to each partitioned session, not
  // just session.defaultSession.
  const configuredSessions = new WeakSet<Electron.Session>();
  function configureWebviewSession(
    sess: Electron.Session,
    targetAppId: string | null,
  ) {
    if (configuredSessions.has(sess)) return;
    configuredSessions.add(sess);

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

    // Intercept OAuth callbacks on the frame port and redirect to the app's server.
    // Google redirects to localhost:3334/api/google/... but the frame doesn't
    // serve API routes — the actual app server runs on a different port.
    // Each partition is bound to a specific app, so route to that app's port
    // rather than falling back to a hardcoded mail/calendar preference.
    sess.webRequest.onBeforeRequest(
      { urls: [`http://localhost:${FRAME_PORT}/api/google/*`] },
      (details, callback) => {
        let apps: AppConfig[] = [];
        try {
          apps = AppStore.loadApps();
        } catch (err) {
          console.error("[main] OAuth redirect: loadApps failed:", err);
          callback({});
          return;
        }
        const app =
          (targetAppId && apps.find((a) => a.id === targetAppId)) ||
          apps.find((a) => a.id === "mail") ||
          apps.find((a) => a.id === "calendar");
        if (app) {
          const gatewayAppUrl = getTemplateGatewayAppUrl(app.id);
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
  // id from the webview URL's ?app= param when possible.
  app.on("web-contents-created", (_event, wc) => {
    if (wc.getType() !== "webview") return;
    let id = sessionToAppId.get(wc.session) ?? null;
    if (!id) {
      try {
        id = new URL(wc.getURL()).searchParams.get("app");
      } catch {}
    }
    configureWebviewSession(wc.session, id);
  });

  installApplicationMenu();

  reconcileInterruptedCodeAgentRuns("startup");

  const win = createWindow();
  remoteConnectorEnabled = AppStore.loadRemoteConnectorSettings().enabled;
  startRemoteCodeAgentConnector();

  // Intercept keyboard shortcuts on the shell renderer
  win.webContents.on("before-input-event", (_event, input) => {
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
      });
      return;
    }

    // Cmd+F — search inside the active webview, not the shell
    if (key === "f") {
      _event.preventDefault();
      win.webContents.send("shortcut:keydown", {
        key: "f",
        shiftKey: input.shift,
      });
      return;
    }

    // Cmd+L — copy the active webview URL.
    if (key === "l") {
      _event.preventDefault();
      win.webContents.send("shortcut:keydown", {
        key: "l",
        shiftKey: input.shift,
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

app.on("before-quit", () => {
  appIsQuitting = true;
  pauseActiveCodeAgentProcessesForShutdown();
  if (remoteConnectorRestartTimer) {
    clearTimeout(remoteConnectorRestartTimer);
    remoteConnectorRestartTimer = null;
  }
  remoteConnectorProcess?.kill("SIGTERM");
  remoteConnectorProcess = null;
});
