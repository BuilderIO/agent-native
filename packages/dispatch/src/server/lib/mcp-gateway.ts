import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";

import {
  appCapabilityManifestSchema,
  resolveManifestScreenPath,
  validateAppManifestPath,
  type AppCapabilityManifest,
} from "@agent-native/core";
import {
  A2AClient,
  canonicalA2AAudience,
  extractA2APersistedMutationReceipts,
  getGlobalA2ASecret,
  signA2AOrgMemberDelegationToken,
  signA2AOrganizationToken,
  signA2AToken,
  stripA2APersistedArtifactMarkers,
  type A2APersistedMutationReceipt,
  type Task,
} from "@agent-native/core/a2a";
import { fail, NoWriteError } from "@agent-native/core/action";
import { getAppConfig } from "@agent-native/core/app-config";
import { isFeatureFlagEnabled } from "@agent-native/core/feature-flags";
import {
  buildMcpToolName,
  getMcpOAuthAccessToken,
  listRemoteServers,
  McpClientManager,
  mcpToolCallWasNotSent,
} from "@agent-native/core/mcp-client";
import { getOrgA2ASecret, getOrgDomain } from "@agent-native/core/org";
import {
  buildDeepLink,
  buildEmbedStartPath,
  createEmbedSessionTicket,
  FULL_APP_EMBED_SCOPE,
  getAppProductionUrl,
  getConfiguredAppBasePath,
  getRequestContext,
  getRequestOrgId,
  getRequestRunContext,
  getRequestUserEmail,
  platformWaitUntil,
  resolveAppRuntimeUrl,
  type ViewportMode,
} from "@agent-native/core/server";
import {
  discoverAgents,
  getBuiltinAgents,
  type DiscoveredAgent,
} from "@agent-native/core/server/agent-discovery";
import { EMBED_START_PATH } from "@agent-native/core/shared";

import { matchDispatchAppCandidates } from "../../lib/dispatch-app-identity.js";
import { DISPATCH_CHILD_BROWSER_TAB_PARAM } from "../../shared/chat-first-pane.js";
import { DESKTOP_WORKSPACE_SSO_FLAG } from "../../shared/feature-flags.js";
import {
  DISPATCH_WORKSPACE_SSO_FLAG,
  isWorkspaceSsoAppUrl,
} from "../../shared/workspace-sso.js";
import { listWorkspaceApps } from "./app-creation-store.js";
import { resolveDispatchChildBrowserTab } from "./dispatch-pane-context.js";
import {
  projectEnvironmentUrl,
  requestEnvironmentLane,
} from "./environment-lane.js";
import {
  getDispatchMcpAppAccessSettings,
  isAppAllowedByMcpAccess,
  type DispatchMcpAppAccessSettings,
} from "./mcp-access-store.js";
import {
  discoverDispatchMcpApps,
  type DispatchMcpDegradedSource,
} from "./mcp-app-discovery.js";

const DISPATCH_APP_ID = "dispatch";
const DISPATCH_NAME = "Dispatch";
const DISPATCH_DESCRIPTION =
  "Workspace control plane for extensions, agents, vault, integrations, approvals, and app routing.";
const DISPATCH_COLOR = "#14B8A6";
const TARGET_EMBED_SESSION_ATTEMPTS = 3;
const TARGET_EMBED_SESSION_RETRY_BASE_MS = 250;
const TARGET_EMBED_SESSION_CONNECT_TIMEOUT_MS = 90_000;
const TARGET_EMBED_SESSION_BUDGET_MS = 95_000;
// open_app answers with its link by then; a panel is worth a short wait, not
// the full mint budget.
const OPEN_APP_EMBED_WAIT_MS = 15_000;
const BROWSER_EMBED_PREFETCH_WAIT_MS = 1_000;
const PENDING_EMBED_LIMIT = 32;
const DISPATCH_ASK_APP_DEFAULT_INLINE_WAIT_MS = 20_000;
const DISPATCH_ASK_APP_MAX_INLINE_WAIT_MS = 20_000;
const DISPATCH_ASK_APP_POLL_INTERVAL_MS = 1_500;
const DISPATCH_A2A_REQUEST_TIMEOUT_MS = 10_000;
const DISPATCH_ASK_APP_STATUS_RETRY_DELAYS_MS = [250, 750, 1_500] as const;
const DISPATCH_ASK_APP_TERMINAL_STATES = new Set([
  "completed",
  "failed",
  "canceled",
  "input-required",
]);
const DISPATCH_TASK_HANDLE_VERSION = 1;
const DISPATCH_TASK_HANDLE_TTL_SECONDS = 60 * 60;
const DISPATCH_TASK_HANDLE_DOMAIN =
  "agent-native:dispatch-ask-app-task-handle:v1";
const DISPATCH_TASK_HANDLE_PREFIX = "v1";
const DISPATCH_TASK_HANDLE_IV_BYTES = 12;
const DISPATCH_TASK_HANDLE_AUTH_TAG_BYTES = 16;
const INVALID_DISPATCH_ASK_APP_TASK_HANDLE_ERROR =
  "Invalid or expired ask_app task handle. To keep polling the same task, " +
  "call ask_app_status with the app and taskId from the ask_app result and " +
  "leave out taskHandle. Do not resubmit ask_app; that can duplicate work.";

let ephemeralDevTaskHandleSecret: string | null = null;

function getEphemeralDevTaskHandleSecret(): string {
  if (ephemeralDevTaskHandleSecret === null) {
    ephemeralDevTaskHandleSecret = randomBytes(32).toString("hex");
  }
  return ephemeralDevTaskHandleSecret;
}

function dispatchTaskHandleSecrets(orgSecret?: string | null): string[] {
  const globalA2A = getGlobalA2ASecret()?.trim();
  const betterAuth = process.env.BETTER_AUTH_SECRET?.trim();
  const org = orgSecret?.trim();
  const configured = [globalA2A, betterAuth, org].filter(
    (value): value is string => Boolean(value),
  );
  if (configured.length > 0) return [...new Set(configured)];
  if (process.env.NODE_ENV === "production") return [];
  return [getEphemeralDevTaskHandleSecret()];
}

function dispatchTaskHandleKey(rootSecret: string): Buffer {
  return createHmac("sha256", rootSecret)
    .update(DISPATCH_TASK_HANDLE_DOMAIN)
    .digest();
}

function normalizeTaskHandleIdentity(value: string): string {
  return value.trim().toLowerCase();
}

function validDispatchTaskTargetUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    // coercion-ok: invalid target URL fails task handle validation closed.
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    return null;
  }
  return parsed.toString().replace(/\/+$/, "");
}

function sealDispatchAskAppTaskHandle(params: {
  app: string;
  targetUrl: string;
  taskId: string;
  userEmail: string;
  orgId: string | null;
  orgSecret: string | null;
  expiresInSeconds?: number;
}): string | undefined {
  const secrets = dispatchTaskHandleSecrets(params.orgSecret);
  const primarySecret = secrets[0];
  if (!primarySecret) return undefined;
  const app = normalizeAppId(params.app);
  const targetUrl = validDispatchTaskTargetUrl(params.targetUrl);
  const taskId = params.taskId.trim();
  const userEmail = normalizeTaskHandleIdentity(params.userEmail);
  const orgId = normalizeTaskHandleIdentity(params.orgId ?? "");
  if (!app || !targetUrl || !taskId || !userEmail) return undefined;

  const payload = Buffer.from(
    JSON.stringify({
      version: DISPATCH_TASK_HANDLE_VERSION,
      app,
      targetUrl,
      taskId,
      userEmail,
      orgId,
      expiresAt:
        Math.floor(Date.now() / 1000) +
        (params.expiresInSeconds ?? DISPATCH_TASK_HANDLE_TTL_SECONDS),
    }),
    "utf8",
  );
  const iv = randomBytes(DISPATCH_TASK_HANDLE_IV_BYTES);
  const cipher = createCipheriv(
    "aes-256-gcm",
    dispatchTaskHandleKey(primarySecret),
    iv,
  );
  cipher.setAAD(Buffer.from(DISPATCH_TASK_HANDLE_DOMAIN, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    DISPATCH_TASK_HANDLE_PREFIX,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    authTag.toString("base64url"),
  ].join(".");
}

function unsealDispatchAskAppTaskHandle(
  handle: string,
  expected: {
    app: string;
    taskId: string;
    userEmail: string;
    orgId: string | null;
    orgSecret: string | null;
  },
): { app: string; targetUrl: string; taskId: string } {
  const invalid = () => new Error(INVALID_DISPATCH_ASK_APP_TASK_HANDLE_ERROR);
  const trimmedHandle = handle.trim();
  const expectedApp = normalizeAppId(expected.app);
  const expectedTaskId = expected.taskId.trim();
  const expectedUserEmail = normalizeTaskHandleIdentity(expected.userEmail);
  const expectedOrgId = normalizeTaskHandleIdentity(expected.orgId ?? "");
  if (!trimmedHandle || !expectedApp || !expectedTaskId || !expectedUserEmail) {
    throw invalid();
  }

  const parts = trimmedHandle.split(".");
  const [prefix, ivPart, ciphertextPart, authTagPart] = parts;
  if (
    parts.length !== 4 ||
    prefix !== DISPATCH_TASK_HANDLE_PREFIX ||
    !ivPart ||
    !ciphertextPart ||
    !authTagPart
  ) {
    throw invalid();
  }
  const iv = Buffer.from(ivPart, "base64url");
  const ciphertext = Buffer.from(ciphertextPart, "base64url");
  const authTag = Buffer.from(authTagPart, "base64url");
  if (
    iv.length !== DISPATCH_TASK_HANDLE_IV_BYTES ||
    ciphertext.length === 0 ||
    authTag.length !== DISPATCH_TASK_HANDLE_AUTH_TAG_BYTES ||
    iv.toString("base64url") !== ivPart ||
    ciphertext.toString("base64url") !== ciphertextPart ||
    authTag.toString("base64url") !== authTagPart
  ) {
    throw invalid();
  }

  const secrets = dispatchTaskHandleSecrets(expected.orgSecret);
  const nowSeconds = Math.floor(Date.now() / 1000);
  for (const rootSecret of secrets) {
    let parsed: unknown;
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        dispatchTaskHandleKey(rootSecret),
        iv,
      );
      decipher.setAAD(Buffer.from(DISPATCH_TASK_HANDLE_DOMAIN, "utf8"));
      decipher.setAuthTag(authTag);
      const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);
      parsed = JSON.parse(plaintext.toString("utf8")) as unknown;
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      continue;
    }
    const claims = parsed as Record<string, unknown>;
    const targetUrl =
      typeof claims.targetUrl === "string"
        ? validDispatchTaskTargetUrl(claims.targetUrl)
        : null;
    if (
      claims.version !== DISPATCH_TASK_HANDLE_VERSION ||
      claims.app !== expectedApp ||
      claims.taskId !== expectedTaskId ||
      claims.userEmail !== expectedUserEmail ||
      claims.orgId !== expectedOrgId ||
      targetUrl === null ||
      typeof claims.expiresAt !== "number" ||
      !Number.isFinite(claims.expiresAt) ||
      claims.expiresAt <= nowSeconds
    ) {
      continue;
    }
    return {
      app: expectedApp,
      targetUrl,
      taskId: expectedTaskId,
    };
  }
  throw invalid();
}

class DispatchAskAppInlineDeadlineError extends Error {
  constructor() {
    super("ask_app inline wait deadline reached");
    this.name = "DispatchAskAppInlineDeadlineError";
  }
}

export interface DispatchMcpAccessibleApp {
  id: string;
  name: string;
  description: string;
  url: string;
  homeUrl?: string;
  mcpUrl?: string;
  workspaceMount?: boolean;
  color: string;
  source?: DiscoveredAgent["source"];
  aliases?: string[];
  granted: boolean;
  mountedPathUnavailable?: boolean;
  manifest?: AppCapabilityManifest;
}

const grantedAppManifestCache = new Map<string, AppCapabilityManifest>();

/** Registers or clears a parsed capability manifest for a granted app id. */
export function registerGrantedAppManifest(
  appId: string,
  manifest: unknown,
): AppCapabilityManifest | undefined {
  const key = normalizeAppId(appId);
  if (!key) return undefined;
  if (manifest === undefined || manifest === null) {
    grantedAppManifestCache.delete(key);
    return undefined;
  }
  const parsed = appCapabilityManifestSchema.safeParse(manifest);
  if (!parsed.success) return undefined;
  grantedAppManifestCache.set(key, parsed.data);
  return parsed.data;
}

/** Clears cached granted app capability manifests. */
export function clearGrantedAppManifestCache(): void {
  grantedAppManifestCache.clear();
}

function getGrantedAppManifest(
  target: DispatchMcpAccessibleApp,
): AppCapabilityManifest | undefined {
  if (target.manifest) {
    const parsed = appCapabilityManifestSchema.safeParse(target.manifest);
    if (parsed.success) return parsed.data;
  }
  return grantedAppManifestCache.get(normalizeAppId(target.id));
}

function stripTargetBasePath(
  target: DispatchMcpAccessibleApp,
  rawPath: string,
): string {
  const basePath = appBasePath(target);
  if (!basePath) return rawPath;
  const parsed = new URL(rawPath, "https://agent-native.invalid");
  const lowerBase = basePath.toLowerCase();
  const lowerPathname = parsed.pathname.toLowerCase();
  if (lowerPathname === lowerBase) {
    return `/${parsed.search}${parsed.hash}`;
  }
  if (lowerPathname.startsWith(`${lowerBase}/`)) {
    const stripped = parsed.pathname.slice(basePath.length) || "/";
    return `${stripped}${parsed.search}${parsed.hash}`;
  }
  return rawPath;
}

function normalizeAppId(value: string): string {
  return value.trim().toLowerCase();
}

function boundedDispatchAskAppWaitMs(raw: unknown): number {
  if (raw == null || raw === "") {
    return DISPATCH_ASK_APP_DEFAULT_INLINE_WAIT_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DISPATCH_ASK_APP_DEFAULT_INLINE_WAIT_MS;
  return Math.max(
    0,
    Math.min(DISPATCH_ASK_APP_MAX_INLINE_WAIT_MS, Math.trunc(parsed)),
  );
}

async function dispatchAskAppIdempotencyKey(
  target: DispatchMcpAccessibleApp,
  message: string,
): Promise<string> {
  const requestId = getRequestContext()?.mcpRequestId;
  if (!requestId) return `ask-app:${globalThis.crypto.randomUUID()}`;

  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify({
        requestId,
        app: target.id,
        targetUrl: target.url,
        message,
      }),
    ),
  );
  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return `ask-app:v1:${hex}`;
}

function isTerminalDispatchTask(task: Task): boolean {
  return DISPATCH_ASK_APP_TERMINAL_STATES.has(String(task.status.state));
}

function dispatchTaskText(task: Task): string {
  return (
    task.status.message?.parts
      ?.filter(
        (part): part is { type: "text"; text: string } => part.type === "text",
      )
      .map((part) => part.text)
      .join("\n")
      .trim() ?? ""
  );
}

type DispatchMutationReceipt = A2APersistedMutationReceipt;

function dispatchTaskMutationReceipts(
  task: Task,
  app: string,
  identity: {
    userEmail: string;
    orgId: string | null;
    orgSecret: string | null;
  },
): DispatchMutationReceipt[] {
  if (app !== "content" || !identity.orgSecret) return [];
  const text = dispatchTaskText(task);
  if (!text) return [];
  const result = [{ tool: "call-agent", result: text }];
  const receipts = extractA2APersistedMutationReceipts(result, {
    persistedArtifactSecrets: [identity.orgSecret],
    expectedDelegatedTaskId: task.id,
  });
  return receipts.filter((receipt) => {
    if (receipt.target.authorityScopeKind === "personal") {
      return (
        receipt.target.authorityScopeId.toLowerCase() ===
        identity.userEmail.toLowerCase()
      );
    }
    return (
      identity.orgId !== null &&
      receipt.target.authorityScopeId === identity.orgId
    );
  });
}

type DispatchAskAppStatusErrorCategory =
  | "transport"
  | "timeout"
  | "upstream_5xx"
  | "rate_limited";

type DispatchAskAppTaskResult = {
  app: string;
  routedVia: "a2a";
  taskId: string;
  taskHandle?: string;
  status: string;
  response?: string;
  receipts?: DispatchMutationReceipt[];
  error?: string;
  inputRequired?: string;
  statusRead?: "unavailable";
  retryable?: true;
  errorCategory?: DispatchAskAppStatusErrorCategory;
  attempts?: number;
  pollAfterMs?: number;
  poll?: {
    tool: "ask_app_status";
    arguments: { app: string; taskId: string; taskHandle?: string };
  };
  message?: string;
};

function dispatchAskAppTaskResult(
  app: string,
  task: Task,
  identity: {
    userEmail: string;
    orgId: string | null;
    orgSecret: string | null;
  },
  taskHandle?: string,
): DispatchAskAppTaskResult {
  const status = String(task.status.state);
  const response = stripA2APersistedArtifactMarkers(dispatchTaskText(task));
  const receipts = dispatchTaskMutationReceipts(task, app, identity);
  const base = {
    app,
    routedVia: "a2a" as const,
    taskId: task.id,
    status,
  };

  if (status === "completed") {
    return {
      ...base,
      response: response || "(no response)",
      ...(receipts.length > 0 ? { receipts } : {}),
    };
  }
  if (status === "failed" || status === "canceled") {
    return {
      ...base,
      ...(response ? { response } : {}),
      error: response || `ask_app task ${status}.`,
    };
  }
  if (status === "input-required") {
    const inputRequired =
      response || "The agent needs additional input before it can continue.";
    return {
      ...base,
      response: inputRequired,
      inputRequired,
      message: inputRequired,
    };
  }
  return {
    ...base,
    ...(taskHandle ? { taskHandle } : {}),
    pollAfterMs: DISPATCH_ASK_APP_POLL_INTERVAL_MS,
    poll: {
      tool: "ask_app_status",
      arguments: {
        app,
        taskId: task.id,
        ...(taskHandle ? { taskHandle } : {}),
      },
    },
    message:
      `ask_app is still ${status}. Call ask_app_status with ` +
      (taskHandle
        ? `taskId "${task.id}" and the returned taskHandle to retrieve the final response.`
        : `taskId "${task.id}" to retrieve the final response.`),
  };
}

async function createDispatchA2AClient(input: {
  targetUrl: string;
  userEmail: string;
  orgId?: string;
  orgDomain?: string;
  orgSecret?: string;
  deadline?: number;
  childBrowserTabId?: string;
  viewportMode?: ViewportMode;
}): Promise<{
  client: A2AClient;
  metadata: Record<string, unknown>;
}> {
  const apiKeys: string[] = [];
  const addSignedToken = async (preferGlobalSecret: boolean) => {
    if (input.orgId && !input.orgDomain?.trim()) return;
    try {
      const audience = canonicalA2AAudience(input.targetUrl);
      const token = preferGlobalSecret
        ? await signA2AToken(input.userEmail, input.orgDomain, undefined, {
            preferGlobalSecret: true,
            audience,
          })
        : input.orgDomain && input.orgSecret
          ? await signA2AOrganizationToken(
              input.orgDomain,
              input.orgSecret,
              undefined,
              { audience },
            )
          : undefined;
      if (token && !apiKeys.includes(token)) apiKeys.push(token);
    } catch {
      // A2A can still be configured for local/dev unauthenticated calls. If
      // signing is unavailable, let the target return its own auth error.
    }
  };

  if (getGlobalA2ASecret()) await addSignedToken(true);
  if (input.orgSecret) await addSignedToken(false);

  const metadata: Record<string, unknown> = {
    userEmail: input.userEmail,
    ...(input.orgDomain ? { orgDomain: input.orgDomain } : {}),
    ...(getRequestContext()?.requestOrigin
      ? { requestOrigin: getRequestContext()?.requestOrigin }
      : {}),
    ...(input.childBrowserTabId
      ? { browserTabId: input.childBrowserTabId }
      : {}),
    ...(input.viewportMode ? { viewportMode: input.viewportMode } : {}),
  };
  const transportHeaders: Record<string, string> = {
    ...(input.childBrowserTabId
      ? { "x-agent-native-browser-tab": input.childBrowserTabId }
      : {}),
    ...(input.viewportMode
      ? { "x-agent-native-viewport-mode": input.viewportMode }
      : {}),
  };
  const remainingMs =
    input.deadline == null ? null : input.deadline - Date.now();
  return {
    client: new A2AClient(input.targetUrl, apiKeys[0], {
      requestTimeoutMs:
        remainingMs == null
          ? DISPATCH_A2A_REQUEST_TIMEOUT_MS
          : Math.max(1, Math.min(DISPATCH_A2A_REQUEST_TIMEOUT_MS, remainingMs)),
      ...(apiKeys.length > 1 ? { fallbackApiKeys: apiKeys.slice(1) } : {}),
      ...(Object.keys(transportHeaders).length > 0 ? { transportHeaders } : {}),
    }),
    metadata,
  };
}

function isTransientDispatchAskAppStatusError(err: unknown): boolean {
  return dispatchAskAppStatusErrorCategory(err) != null;
}

function dispatchAskAppStatusErrorCategory(
  err: unknown,
): DispatchAskAppStatusErrorCategory | null {
  const message = err instanceof Error ? err.message : safeJson(err);
  const causeCode = dispatchAskAppStatusErrorCauseCode(err) ?? "";
  const diagnostic = `${message} ${causeCode}`;
  if (/A2A request failed \(429\)/i.test(message)) return "rate_limited";
  if (/A2A request failed \((?:500|502|503|504)\)/i.test(message)) {
    return "upstream_5xx";
  }
  if (/etimedout|timeout|aborted|aborterror/i.test(diagnostic)) {
    return "timeout";
  }
  if (
    /\bfetch failed\b|failed to fetch|networkerror|socket hang up|econnreset/i.test(
      diagnostic,
    )
  ) {
    return "transport";
  }
  return null;
}

function dispatchAskAppStatusErrorCauseCode(err: unknown): string | undefined {
  if (!(err instanceof Error)) return undefined;
  const directCode = (err as Error & { code?: unknown }).code;
  if (typeof directCode === "string" && directCode.trim()) {
    return directCode.trim();
  }
  if (!err.cause || typeof err.cause !== "object") return undefined;
  const code = (err.cause as { code?: unknown }).code;
  return typeof code === "string" && code.trim() ? code.trim() : undefined;
}

function dispatchAskAppStatusOriginHost(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return "unknown";
  }
}

function dispatchAskAppStatusReadUnavailableResult(
  app: string,
  taskId: string,
  errorCategory: DispatchAskAppStatusErrorCategory,
  attempts: number,
  taskHandle?: string,
): DispatchAskAppTaskResult {
  return {
    app,
    routedVia: "a2a",
    taskId,
    ...(taskHandle ? { taskHandle } : {}),
    status: "unknown",
    statusRead: "unavailable",
    retryable: true,
    errorCategory,
    attempts,
    pollAfterMs: DISPATCH_ASK_APP_POLL_INTERVAL_MS,
    poll: {
      tool: "ask_app_status",
      arguments: {
        app,
        taskId,
        ...(taskHandle ? { taskHandle } : {}),
      },
    },
    message:
      "The durable ask_app task status could not be read after bounded retries. " +
      "The task may still be running or completed. Retry ask_app_status " +
      (taskHandle
        ? "with the same app, taskId, and taskHandle; do not resubmit ask_app."
        : "with the same app and taskId; do not resubmit ask_app."),
  };
}

async function runBeforeDispatchAskAppDeadline<T>(
  operation: () => Promise<T>,
  deadline: number,
): Promise<T> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw new DispatchAskAppInlineDeadlineError();

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new DispatchAskAppInlineDeadlineError()),
          remainingMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function waitForDispatchA2ATask(
  client: A2AClient,
  task: Task,
  deadline: number | undefined,
): Promise<Task> {
  if (deadline == null || isTerminalDispatchTask(task)) return task;
  let current = task;
  while (!isTerminalDispatchTask(current)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return current;
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Math.min(DISPATCH_ASK_APP_POLL_INTERVAL_MS, remaining),
      ),
    );
    if (Date.now() >= deadline) return current;
    try {
      current = await runBeforeDispatchAskAppDeadline(
        () => client.getTask(task.id),
        deadline,
      );
    } catch (err) {
      if (err instanceof DispatchAskAppInlineDeadlineError) return current;
      if (!isTransientDispatchAskAppStatusError(err)) throw err;
      if (Date.now() >= deadline) return current;
    }
  }
  return current;
}

function normalizeBaseUrl(raw: string | undefined | null): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function normalizeBasePath(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "/") return "";
  const normalized = trimmed.replace(/^\/+/, "").replace(/\/+$/, "");
  return normalized ? `/${normalized}` : "";
}

function withConfiguredBasePath(baseUrl: string): string {
  const basePath = normalizeBasePath(
    process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH,
  );
  if (!basePath) return baseUrl;
  try {
    const url = new URL(baseUrl);
    const path = normalizeBasePath(url.pathname);
    if (path === basePath || path.startsWith(`${basePath}/`)) {
      return baseUrl;
    }
    url.pathname = path && path !== "/" ? `${basePath}${path}` : `${basePath}/`;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return baseUrl;
  }
}

function dispatchSelfBaseUrl(): string {
  const requestOrigin = normalizeBaseUrl(getRequestContext()?.requestOrigin);
  if (requestOrigin && isTrustedRequestOrigin(requestOrigin)) {
    return withConfiguredBasePath(requestOrigin);
  }

  const configured =
    normalizeBaseUrl(process.env.WORKSPACE_GATEWAY_URL) ??
    normalizeBaseUrl(process.env.APP_URL) ??
    normalizeBaseUrl(process.env.URL) ??
    normalizeBaseUrl(process.env.DEPLOY_URL) ??
    normalizeBaseUrl(process.env.BETTER_AUTH_URL);
  if (configured) return withConfiguredBasePath(configured);

  return process.env.NODE_ENV === "production"
    ? "https://dispatch.agent-native.com"
    : "http://localhost:8092";
}

function isTrustedRequestOrigin(value: string): boolean {
  // An embed ticket is fetched from this origin and becomes a bearer token.
  const origin = new URL(value).origin;
  const candidates = [
    { source: "production", value: getAppProductionUrl() },
    { source: "runtime", value: resolveAppRuntimeUrl() },
  ];
  return candidates.some(({ source, value }) => {
    if (!value) return false;
    const url = normalizeBaseUrl(value);
    if (!url) {
      console.warn("[dispatch] invalid configured request origin", { source });
      return false;
    }
    return new URL(url).origin === origin;
  });
}

function dispatchSelfApp(
  settings: DispatchMcpAppAccessSettings,
): DispatchMcpAccessibleApp {
  return {
    id: DISPATCH_APP_ID,
    name: DISPATCH_NAME,
    description: DISPATCH_DESCRIPTION,
    url: dispatchSelfBaseUrl(),
    color: DISPATCH_COLOR,
    granted: isAppAllowedByMcpAccess(DISPATCH_APP_ID, settings),
  };
}

const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f]");

function safeAppPath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const value = raw.trim();
  if (CONTROL_CHARS.test(value)) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  if (/%(?:2f|5c)/i.test(value)) return null;
  const rawPath = value.split(/[?#]/, 1)[0] ?? value;
  let parsed: URL;
  try {
    parsed = new URL(value, "http://agent-native.invalid");
  } catch {
    return null;
  }
  if (parsed.pathname !== rawPath) return null;
  return value;
}

function safeJson(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "[unserializable]";
  }
}

function appendParamsToPath(
  path: string,
  params: Record<string, string | number | boolean> | undefined,
): string {
  if (!params || Object.keys(params).length === 0) return path;
  const url = new URL(path, "http://agent-native.invalid");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function safeAppOrigin(
  app: Pick<DispatchMcpAccessibleApp, "url">,
): string | null {
  try {
    const url = new URL(app.url);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

function isDispatchAppPageUrl(url: string): boolean {
  if (safeAppOrigin({ url }) === null) return false;
  const { pathname } = new URL(url);
  const basePath = getConfiguredAppBasePath();
  return (
    pathname.startsWith("/dispatch/apps/") ||
    (basePath !== "" && pathname.startsWith(`${basePath}/dispatch/apps/`))
  );
}

function mountedWorkspaceAppHomeUrl(app: {
  path: string;
  url: string | null;
}): string | null {
  const appUrl = app.url;
  const origin = appUrl ? safeAppOrigin({ url: appUrl }) : null;
  const path = safeAppPath(app.path);
  if (!origin || !path) return null;
  const url = new URL(path, `${origin}/`);
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

function appBaseUrl(app: DispatchMcpAccessibleApp): string {
  return app.url.replace(/\/+$/, "");
}

// The owner-bound bearer for a cross-app session goes to this endpoint, so it
// must not travel over plain HTTP beyond the developer's own machine.
function targetEndpointKeepsCredentialsPrivate(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (url.protocol === "https:") return true;
    const host = url.hostname.replace(/^\[|\]$/g, "");
    return (
      url.protocol === "http:" &&
      (host === "localhost" ||
        host === "127.0.0.1" ||
        host === "::1" ||
        host.endsWith(".localhost"))
    );
    // coercion-ok: an unparsable endpoint is not one to send a bearer to; the caller skips the session and warns.
  } catch {
    return false;
  }
}

function collapseRepeatedLeadingPathSegment(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length < 2) return pathname;
  let start = 0;
  while (start + 1 < segments.length) {
    const current = segments[start];
    const next = segments[start + 1];
    if (!current || !next || current.toLowerCase() !== next.toLowerCase()) {
      break;
    }
    start += 1;
  }
  if (start === 0) return pathname;
  return `/${segments.slice(start).join("/")}`;
}

export function appHomeBaseUrl(
  app: Pick<DispatchMcpAccessibleApp, "url" | "homeUrl">,
): string {
  const normalize = (raw: string): string => {
    const parsed = new URL(raw);
    parsed.pathname = collapseRepeatedLeadingPathSegment(parsed.pathname);
    return parsed.toString().replace(/\/+$/, "");
  };
  const configured = app.homeUrl?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "http:" || url.protocol === "https:") {
        return normalize(configured);
      }
    } catch {
      // coercion-ok: invalid optional home URL falls back to endpoint.
    }
  }
  try {
    return normalize(app.url);
  } catch {
    // coercion-ok: fallback preserves pre-validated app base URL string.
    return app.url.replace(/\/+$/, "");
  }
}

export function joinAppBaseUrlAndPath(
  baseUrl: string,
  relPath: string,
): string {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  let parsedBase: URL;
  let parsedRel: URL;
  try {
    parsedBase = new URL(cleanBase);
    parsedRel = new URL(relPath, "https://agent-native.invalid");
  } catch {
    // coercion-ok: fallback preserves direct concatenation for non-URL test inputs.
    return `${cleanBase}${relPath}`;
  }
  const basePath = collapseRepeatedLeadingPathSegment(
    parsedBase.pathname.replace(/\/+$/, "") || "/",
  );
  const relPathname = collapseRepeatedLeadingPathSegment(
    parsedRel.pathname || "/",
  );
  const normalizedBasePath = basePath === "/" ? "" : basePath;
  const suffix = `${parsedRel.search}${parsedRel.hash}`;
  if (!normalizedBasePath) {
    return `${parsedBase.origin}${relPathname}${suffix}`;
  }
  const lowerBase = normalizedBasePath.toLowerCase();
  const lowerRel = relPathname.toLowerCase();
  const effectiveRel =
    lowerRel === lowerBase
      ? "/"
      : lowerRel.startsWith(`${lowerBase}/`)
        ? relPathname.slice(normalizedBasePath.length)
        : relPathname;
  const joinedPath =
    effectiveRel === "/"
      ? `${normalizedBasePath}/`
      : `${normalizedBasePath}${effectiveRel.startsWith("/") ? effectiveRel : `/${effectiveRel}`}`;
  return `${parsedBase.origin}${joinedPath}${suffix}`;
}

function workspaceGatewayMcpUrl(appUrl: string): string | undefined {
  const configuredGateway = getAppConfig().workspace.gatewayUrl?.trim();
  if (!configuredGateway) return undefined;

  let configuredUrl: URL;
  try {
    configuredUrl = new URL(configuredGateway);
  } catch {
    throw new Error(
      "WORKSPACE_GATEWAY_URL must be a valid absolute HTTP(S) URL.",
    );
  }
  if (
    configuredUrl.protocol !== "http:" &&
    configuredUrl.protocol !== "https:"
  ) {
    throw new Error("WORKSPACE_GATEWAY_URL must use http or https.");
  }

  const gateway = new URL(projectEnvironmentUrl(configuredUrl.toString()));
  if (gateway.protocol !== "http:" && gateway.protocol !== "https:") {
    throw new Error("WORKSPACE_GATEWAY_URL must use http or https.");
  }
  const target = new URL(appUrl);
  if (gateway.origin !== target.origin) return undefined;
  const requestOrigin = normalizeBaseUrl(getRequestContext()?.requestOrigin);
  if (requestOrigin && new URL(requestOrigin).origin === gateway.origin) {
    // Same-deployment embeds must use the mounted app endpoint, not call back into this gateway.
    return undefined;
  }
  const configuredBasePath = getConfiguredAppBasePath();
  const gatewayPath = gateway.pathname.replace(/\/+$/, "");
  const basePath =
    configuredBasePath &&
    gatewayPath !== configuredBasePath &&
    !gatewayPath.startsWith(`${configuredBasePath}/`)
      ? `${configuredBasePath}${gatewayPath}`
      : gatewayPath;
  gateway.pathname = `${basePath}/mcp`;
  gateway.search = "";
  gateway.hash = "";
  return gateway.toString().replace(/\/$/, "");
}

function appMcpUrl(app: DispatchMcpAccessibleApp): string {
  const explicit = app.mcpUrl?.trim();
  return (
    explicit?.replace(/\/+$/, "") ??
    workspaceGatewayMcpUrl(app.url) ??
    `${appHomeBaseUrl(app)}/mcp`
  );
}

function appMcpBaseUrl(app: DispatchMcpAccessibleApp): string {
  const url = new URL(appMcpUrl(app));
  url.pathname = url.pathname.replace(/\/mcp\/?$/, "") || "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function appChatBaseUrl(app: DispatchMcpAccessibleApp): string {
  const homeUrl = new URL(appHomeBaseUrl(app));
  if (homeUrl.pathname !== "/") {
    return homeUrl.toString().replace(/\/+$/, "");
  }
  return appMcpBaseUrl(app);
}

function resolveGrantedAppEmbedStartUrl(
  app: DispatchMcpAccessibleApp,
  startUrl: string,
): string {
  try {
    const baseUrl = appMcpBaseUrl(app);
    const resolved = new URL(startUrl, `${baseUrl}/`);
    const base = new URL(baseUrl);
    const basePath = base.pathname.replace(/\/+$/, "");
    const expectedPath = `${basePath}${EMBED_START_PATH}`;
    if (resolved.origin !== base.origin || resolved.pathname !== expectedPath) {
      throw new Error(
        "Target app returned an embed start URL outside the granted app.",
      );
    }
    return resolved.toString();
  } catch {
    throw new Error("Target app returned an invalid embed start URL.");
  }
}

function appBasePath(app: DispatchMcpAccessibleApp): string {
  const pathname = new URL(appHomeBaseUrl(app)).pathname.replace(/\/+$/, "");
  return pathname === "/" ? "" : pathname;
}

function appMatchesUrlPath(app: DispatchMcpAccessibleApp, url: URL): boolean {
  const origin = new URL(appHomeBaseUrl(app)).origin;
  if (!origin || url.origin !== origin) return false;
  const basePath = appBasePath(app);
  if (!basePath) return true;
  return url.pathname === basePath || url.pathname.startsWith(`${basePath}/`);
}

function appPathSpecificity(app: DispatchMcpAccessibleApp): number {
  return appBasePath(app).length;
}

function appRelativePath(app: DispatchMcpAccessibleApp, url: URL): string {
  const basePath = appBasePath(app);
  const path = basePath
    ? url.pathname === basePath
      ? "/"
      : url.pathname.slice(basePath.length)
    : url.pathname;
  return `${path || "/"}${url.search}${url.hash}`;
}

function defaultWorkspaceSsoHomeUrl(
  app: DispatchMcpAccessibleApp,
  builtinHomeUrls: ReadonlyMap<string, string>,
): string | undefined {
  const builtinHomeUrl = builtinHomeUrls.get(app.id);
  if (builtinHomeUrl) return builtinHomeUrl;
  return safeAppOrigin(app) ?? undefined;
}

function isDispatchControlPath(path: string | null): boolean {
  if (!path) return false;
  const route = path.split(/[?#]/, 1)[0] ?? path;
  return (
    route === "/extensions" ||
    route.startsWith("/extensions/") ||
    route === "/tools" ||
    route.startsWith("/tools/")
  );
}

function assertAppCanOpenPath(app: DispatchMcpAccessibleApp, path: string) {
  if (app.id !== DISPATCH_APP_ID && isDispatchControlPath(path)) {
    throw new Error(
      `Path "${path}" belongs to Dispatch. Use app: "dispatch" for Dispatch extension and tool routes.`,
    );
  }
}

function toAccessibleApp(
  agent: DiscoveredAgent,
  settings: DispatchMcpAppAccessSettings,
): DispatchMcpAccessibleApp {
  return {
    id: agent.id,
    name: agent.name,
    // Deployment manifest and directory entries may omit a description even
    // though the discovered type declares one.
    description: typeof agent.description === "string" ? agent.description : "",
    url: projectEnvironmentUrl(agent.url),
    color: agent.color,
    ...(agent.source ? { source: agent.source } : {}),
    ...(agent.aliases?.length ? { aliases: agent.aliases } : {}),
    granted: isAppAllowedByMcpAccess(agent.id, settings),
  };
}

export async function listDispatchMcpApps(): Promise<{
  settings: DispatchMcpAppAccessSettings;
  apps: DispatchMcpAccessibleApp[];
  degradedSources: DispatchMcpDegradedSource[];
}> {
  const [settings, { agents, mountedApps, degradedSources }] =
    await Promise.all([
      getDispatchMcpAppAccessSettings(),
      discoverDispatchMcpApps(),
    ]);
  const mountedAppsById = new Map(
    mountedApps.map((app) => [normalizeAppId(app.id), app]),
  );
  return {
    settings,
    degradedSources,
    apps: [
      dispatchSelfApp(settings),
      ...agents
        .filter((agent) => normalizeAppId(agent.id) !== DISPATCH_APP_ID)
        .map((agent) => {
          const accessible = toAccessibleApp(agent, settings);
          const mountedApp = mountedAppsById.get(normalizeAppId(agent.id));
          const mountedUrl = mountedApp?.url;
          const sameOriginMount =
            !!mountedUrl &&
            safeAppOrigin({ url: mountedUrl }) === safeAppOrigin(accessible);
          const homeUrl =
            mountedApp && sameOriginMount
              ? mountedWorkspaceAppHomeUrl(mountedApp)
              : null;
          if (homeUrl) return { ...accessible, homeUrl, workspaceMount: true };
          return agent.source === "workspace" ||
            isDispatchAppPageUrl(accessible.url)
            ? { ...accessible, mountedPathUnavailable: true }
            : accessible;
        }),
    ],
  };
}

export async function listGrantedDispatchMcpAppsWithStatus(): Promise<{
  apps: DispatchMcpAccessibleApp[];
  degradedSources: DispatchMcpDegradedSource[];
}> {
  const { apps, degradedSources } = await listDispatchMcpApps();
  return {
    degradedSources,
    apps: apps.filter(
      (app) => app.granted && !app.mountedPathUnavailable && safeAppOrigin(app),
    ),
  };
}

export async function listGrantedDispatchMcpApps(): Promise<
  DispatchMcpAccessibleApp[]
> {
  return (await listGrantedDispatchMcpAppsWithStatus()).apps;
}

export async function listGrantedDispatchMcpAppOrigins(): Promise<string[]> {
  const apps = await listGrantedDispatchMcpApps();
  return Array.from(new Set(apps.flatMap((app) => safeAppOrigin(app) ?? [])));
}

export async function resolveGrantedDispatchMcpApp(
  app: string,
): Promise<DispatchMcpAccessibleApp> {
  const target = normalizeAppId(app);
  if (!target) throw new Error("app is required");
  const { apps } = await listDispatchMcpApps();
  const candidates = matchDispatchAppCandidates(apps, target);
  if (candidates.length > 1) {
    throw new Error(
      `Ambiguous app "${app}". Choose one of: ${candidates.map((candidate) => candidate.id).join(", ")}.`,
    );
  }
  const match = candidates[0];
  if (!match) {
    throw new Error(
      `Unknown app "${app}". Call list_apps to see apps available through Dispatch MCP.`,
    );
  }
  if (!match.granted) {
    throw new Error(
      `Dispatch MCP access to "${match.id}" is not granted. Open Dispatch > Agents to change MCP app access.`,
    );
  }
  if (match.mountedPathUnavailable) {
    throw new Error(
      `Dispatch MCP app "${match.id}" is unavailable until its Workspace mount resolves. Try again shortly.`,
    );
  }
  if (!safeAppOrigin(match)) {
    throw new Error(
      `Dispatch MCP app "${match.id}" has an invalid URL and cannot be opened through MCP.`,
    );
  }
  return match;
}

async function isEligibleWorkspaceSsoApp(
  candidate: DispatchMcpAccessibleApp,
): Promise<boolean> {
  return isWorkspaceSsoAppUrl(candidate, {
    nodeEnv: process.env.NODE_ENV,
    registryRaw: getAppConfig().auth.identitySsoAppRegistryJson,
    environmentLane: requestEnvironmentLane(),
  });
}

async function listWorkspaceSsoApps(): Promise<DispatchMcpAccessibleApp[]> {
  const [agents, mountedApps] = await Promise.all([
    discoverAgents("dispatch"),
    listWorkspaceApps({ includeAgentCards: false }),
  ]);
  const builtinHomeUrls = new Map(
    getBuiltinAgents("dispatch").map((agent) => [
      agent.id,
      projectEnvironmentUrl(agent.url),
    ]),
  );
  const candidatesById = new Map<string, DispatchMcpAccessibleApp>();
  for (const agent of agents) {
    if (normalizeAppId(agent.id) === DISPATCH_APP_ID) continue;
    const accessible = toAccessibleApp(agent, {
      mode: "all-apps",
      selectedAppIds: [],
    });
    // A Dispatch app-page URL is only routable through a verified mount.
    if (isDispatchAppPageUrl(accessible.url)) continue;
    candidatesById.set(agent.id, {
      ...accessible,
      homeUrl: defaultWorkspaceSsoHomeUrl(accessible, builtinHomeUrls),
      granted: true,
    });
  }
  for (const app of mountedApps) {
    if (app.isDispatch || !app.url) continue;
    const homeUrl = mountedWorkspaceAppHomeUrl(app);
    if (!homeUrl) continue;
    const mcpUrl = workspaceGatewayMcpUrl(app.url);
    candidatesById.set(app.id, {
      id: app.id,
      name: app.name,
      description: app.description,
      url: app.url,
      homeUrl,
      workspaceMount: true,
      ...(mcpUrl ? { mcpUrl } : {}),
      color: DISPATCH_COLOR,
      granted: true,
    });
  }
  const candidates = [...candidatesById.values()];
  const eligible = [] as DispatchMcpAccessibleApp[];
  for (const candidate of candidates) {
    if (await isEligibleWorkspaceSsoApp(candidate)) {
      eligible.push(candidate);
    }
  }
  return [
    {
      id: DISPATCH_APP_ID,
      name: DISPATCH_NAME,
      description: DISPATCH_DESCRIPTION,
      url: dispatchSelfBaseUrl(),
      color: DISPATCH_COLOR,
      granted: true,
    },
    ...eligible,
  ];
}

async function resolveWorkspaceSsoApp(
  app: string,
): Promise<DispatchMcpAccessibleApp> {
  const target = normalizeAppId(app);
  if (!target) throw new Error("app is required");
  const apps = await listWorkspaceSsoApps();
  const candidates = matchDispatchAppCandidates(apps, target);
  if (candidates.length > 1) {
    throw new Error(
      `Ambiguous app "${app}". Choose one of: ${candidates.map((candidate) => candidate.id).join(", ")}.`,
    );
  }
  const match = candidates[0];
  if (!match) {
    throw new Error(
      `Workspace app "${app}" is not registered for workspace sign-in.`,
    );
  }
  return match;
}

export async function askGrantedDispatchMcpApp(
  app: string,
  message: string,
  options?: {
    async?: boolean;
    maxWaitMs?: number;
    viewportMode?: ViewportMode;
  },
): Promise<ReturnType<typeof dispatchAskAppTaskResult>> {
  const trimmedMessage = message.trim();
  if (!trimmedMessage) throw new Error("message is required");
  const target = await resolveGrantedDispatchMcpApp(app);
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");

  const orgId = getRequestOrgId();
  const [orgDomain, orgSecret] = orgId
    ? await Promise.all([
        getOrgDomain(orgId).catch(() => null),
        getOrgA2ASecret(orgId).catch(() => null),
      ])
    : [null, null];

  const requestedViewportMode =
    options?.viewportMode ?? getRequestRunContext()?.viewportMode;
  const childBrowserTabId =
    requestedViewportMode === "background"
      ? undefined
      : await resolveDispatchChildBrowserTab(target);
  const viewportMode: ViewportMode | undefined =
    requestedViewportMode ?? (childBrowserTabId ? "foreground" : undefined);

  const inlineWaitMs =
    options?.async === true
      ? 0
      : boundedDispatchAskAppWaitMs(options?.maxWaitMs);
  const deadline = inlineWaitMs > 0 ? Date.now() + inlineWaitMs : undefined;
  const submissionDeadline =
    deadline ?? Date.now() + DISPATCH_A2A_REQUEST_TIMEOUT_MS;

  const { client, metadata } = await createDispatchA2AClient({
    targetUrl: target.url,
    userEmail,
    orgId: orgId ?? undefined,
    orgDomain: orgDomain ?? undefined,
    orgSecret: orgSecret ?? undefined,
    deadline: submissionDeadline,
    ...(childBrowserTabId ? { childBrowserTabId } : {}),
    ...(viewportMode ? { viewportMode } : {}),
  });
  const idempotencyKey = await dispatchAskAppIdempotencyKey(
    target,
    trimmedMessage,
  );
  const task = await client.send(
    {
      role: "user",
      parts: [{ type: "text", text: trimmedMessage }],
    },
    {
      async: true,
      metadata,
      idempotencyKey,
      deadlineMs: submissionDeadline,
    },
  );
  const finalOrRunning = await waitForDispatchA2ATask(client, task, deadline);
  const taskHandle = isTerminalDispatchTask(finalOrRunning)
    ? undefined
    : sealDispatchAskAppTaskHandle({
        app: target.id,
        targetUrl: target.url,
        taskId: finalOrRunning.id,
        userEmail,
        orgId: orgId ?? null,
        orgSecret: orgSecret ?? null,
      });
  return dispatchAskAppTaskResult(
    target.id,
    finalOrRunning,
    {
      userEmail,
      orgId: orgId ?? null,
      orgSecret: orgSecret ?? null,
    },
    taskHandle,
  );
}

export async function getGrantedDispatchMcpAppTask(
  app: string,
  taskId: string,
  options?: { taskHandle?: string },
): Promise<DispatchAskAppTaskResult> {
  const trimmedTaskId = taskId.trim();
  if (!trimmedTaskId) throw new Error("taskId is required");
  if (!normalizeAppId(app)) throw new Error("app is required");
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");

  const orgId = getRequestOrgId();
  const [orgDomain, orgSecret] = orgId
    ? await Promise.all([
        getOrgDomain(orgId).catch(() => null),
        getOrgA2ASecret(orgId).catch(() => null),
      ])
    : [null, null];

  let targetAppId: string;
  let targetUrl: string;
  let verifiedHandle: string | undefined;

  if (options?.taskHandle !== undefined) {
    const verified = unsealDispatchAskAppTaskHandle(options.taskHandle, {
      app,
      taskId: trimmedTaskId,
      userEmail,
      orgId: orgId ?? null,
      orgSecret: orgSecret ?? null,
    });
    const settings = await getDispatchMcpAppAccessSettings();
    if (!isAppAllowedByMcpAccess(verified.app, settings)) {
      throw new Error(
        `Dispatch MCP access to "${verified.app}" is not granted. Open Dispatch > Agents to change MCP app access.`,
      );
    }
    targetAppId = verified.app;
    targetUrl = verified.targetUrl;
    verifiedHandle = options.taskHandle.trim();
  } else {
    const target = await resolveGrantedDispatchMcpApp(app);
    targetAppId = target.id;
    targetUrl = target.url;
  }

  const { client } = await createDispatchA2AClient({
    targetUrl,
    userEmail,
    orgId: orgId ?? undefined,
    orgDomain: orgDomain ?? undefined,
    orgSecret: orgSecret ?? undefined,
  });
  const maxAttempts = DISPATCH_ASK_APP_STATUS_RETRY_DELAYS_MS.length + 1;
  for (
    let attempt = 0;
    attempt <= DISPATCH_ASK_APP_STATUS_RETRY_DELAYS_MS.length;
    attempt++
  ) {
    const startedAt = Date.now();
    try {
      const task = await client.getTask(trimmedTaskId);
      return dispatchAskAppTaskResult(
        targetAppId,
        task,
        {
          userEmail,
          orgId: orgId ?? null,
          orgSecret: orgSecret ?? null,
        },
        verifiedHandle,
      );
    } catch (err) {
      const delayMs = DISPATCH_ASK_APP_STATUS_RETRY_DELAYS_MS[attempt];
      const errorCategory = dispatchAskAppStatusErrorCategory(err);
      const retryable = errorCategory != null;
      const willRetry = retryable && delayMs != null;
      if (retryable) {
        console.warn("[ask_app_status] tasks/get attempt failed", {
          app: targetAppId,
          routedVia: "a2a",
          taskId: trimmedTaskId,
          originHost: dispatchAskAppStatusOriginHost(targetUrl),
          attempt: attempt + 1,
          maxAttempts,
          elapsedMs: Date.now() - startedAt,
          errorCategory,
          errorName: err instanceof Error ? err.name : typeof err,
          causeCode: dispatchAskAppStatusErrorCauseCode(err),
          willRetry,
        });
      }
      if (!retryable) throw err;
      if (delayMs == null) {
        return dispatchAskAppStatusReadUnavailableResult(
          targetAppId,
          trimmedTaskId,
          errorCategory,
          maxAttempts,
          verifiedHandle,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error("ask_app_status retry loop exited unexpectedly.");
}

export async function openGrantedDispatchMcpApp(
  input: {
    app: string;
    screen?: string | undefined;
    view?: string | undefined;
    path?: string | undefined;
    params?: Record<string, string | number | boolean> | undefined;
    focus?: boolean | undefined;
    embed?: boolean | undefined;
    chrome?: "full" | "minimal" | undefined;
  },
  options?: { prefetchEmbed: boolean },
): Promise<{
  app: string;
  screen?: string;
  view?: string;
  path?: string;
  url: string;
  focus?: boolean;
  embed?: boolean;
  chrome?: "full" | "minimal";
  embedStartUrl?: string;
  embedTargetPath?: string;
  embedExpiresAt?: number;
  embedUnavailable?: string;
}> {
  const screen = input.screen?.trim() ?? "";
  const view = input.view?.trim() ?? "";
  const hasPathInput = input.path != null;
  let path = safeAppPath(input.path ?? (view || screen ? undefined : "/"));
  if (hasPathInput && !path) {
    throw new Error("path must be a safe app-relative route");
  }
  const target = await resolveGrantedDispatchMcpApp(input.app);
  const manifest = getGrantedAppManifest(target);
  let effectiveParams = input.params;
  if (screen && !path) {
    if (manifest?.screens && Object.keys(manifest.screens).length > 0) {
      const resolvedScreen = resolveManifestScreenPath(
        manifest,
        screen,
        input.params,
      );
      if ("error" in resolvedScreen) {
        fail(
          `Cannot open screen "${screen}" on app "${target.id}": ${resolvedScreen.error}`,
          { errorCode: "invalid_app_route", statusCode: 400 },
        );
      }
      path = safeAppPath(resolvedScreen.path);
      if (!path) {
        fail(
          `Resolved route "${resolvedScreen.path}" for screen "${screen}" on app "${target.id}" is not a safe app-relative route.`,
          { errorCode: "invalid_app_route", statusCode: 400 },
        );
      }
      effectiveParams =
        Object.keys(resolvedScreen.remainingParams).length > 0
          ? resolvedScreen.remainingParams
          : undefined;
    } else if (!view) {
      path = "/";
    }
  }
  if (path) {
    assertAppCanOpenPath(target, path);
    if (manifest) {
      const manifestPath = stripTargetBasePath(target, path);
      const validation = validateAppManifestPath(manifest, manifestPath);
      if (!validation.valid) {
        const templates = validation.validTemplates
          .map((entry) => `${entry.screenId} (${entry.route})`)
          .join(", ");
        fail(
          `Invalid route "${path}" for app "${target.id}". Valid screens: ${templates}.`,
          { errorCode: "invalid_app_route", statusCode: 400 },
        );
      }
    }
  }
  const relUrl = path
    ? appendParamsToPath(path, effectiveParams)
    : buildDeepLink({
        app: target.id,
        view: view || screen,
        params: effectiveParams,
      });
  const url = joinAppBaseUrlAndPath(appHomeBaseUrl(target), relUrl);
  let embedSession: Awaited<
    ReturnType<typeof createGrantedDispatchMcpEmbedSession>
  > | null = null;
  // Says why no session came back, so the caller can tell a plain link it
  // asked for from a panel that failed to open.
  let embedUnavailable: string | undefined;
  if (options?.prefetchEmbed && input.embed !== false) {
    prefetchGrantedEmbedSession(target, url);
  } else if (input.embed) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = new AbortController();
    try {
      embedSession = await Promise.race([
        createEmbedSessionForResolvedGrantedApp({
          app: target.id,
          resolvedApp: target,
          url,
          ...(input.chrome ? { chrome: input.chrome } : {}),
          signal: abort.signal,
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            const error = new Error(
              `${target.id} did not return an embed session within ${OPEN_APP_EMBED_WAIT_MS / 1000}s.`,
            );
            // Stop the target request too, so slow targets don't pile up
            // connections and unused tickets behind the link we answer with.
            abort.abort(error);
            reject(error);
          }, OPEN_APP_EMBED_WAIT_MS);
        }),
      ]);
    } catch (error) {
      console.warn(
        `[dispatch] Could not pre-mint MCP embed session for ${target.id}:`,
        error,
      );
      embedUnavailable = (
        error instanceof Error ? error.message : String(error)
      ).slice(0, 300);
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    app: target.id,
    ...(screen ? { screen } : {}),
    ...(view ? { view } : {}),
    ...(path ? { path } : {}),
    url,
    ...(input.focus === true ? { focus: true } : {}),
    ...(input.embed === true ? { embed: true } : {}),
    ...(input.chrome ? { chrome: input.chrome } : {}),
    ...(embedSession?.startUrl ? { embedStartUrl: embedSession.startUrl } : {}),
    ...(embedSession?.targetPath
      ? { embedTargetPath: embedSession.targetPath }
      : {}),
    ...(typeof embedSession?.expiresAt === "number"
      ? { embedExpiresAt: embedSession.expiresAt }
      : {}),
    ...(embedUnavailable ? { embedUnavailable } : {}),
  };
}

function parseMcpToolTextResult(result: unknown): Record<string, unknown> {
  if (result && typeof result === "object") {
    const response = result as Record<string, unknown>;
    const meta =
      response._meta && typeof response._meta === "object"
        ? (response._meta as Record<string, unknown>)
        : undefined;
    const embedStart =
      meta?.["agent-native/embedStart"] &&
      typeof meta["agent-native/embedStart"] === "object"
        ? (meta["agent-native/embedStart"] as Record<string, unknown>)
        : undefined;
    const withEmbedStart = (parsed: Record<string, unknown>) =>
      typeof embedStart?.startUrl === "string"
        ? { ...parsed, startUrl: embedStart.startUrl }
        : parsed;
    const structured = response.structuredContent;
    if (structured && typeof structured === "object") {
      return withEmbedStart(structured as Record<string, unknown>);
    }
    const parts = Array.isArray(response.content)
      ? (response.content as Array<Record<string, unknown>>)
      : [];
    const text = parts.find(
      (part) => part?.type === "text" && typeof part.text === "string",
    )?.text;
    if (typeof text === "string" && text.trim()) {
      if (response.isError) throw new Error(text.trim());
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") {
        return withEmbedStart(parsed as Record<string, unknown>);
      }
    }
  }
  throw new Error("Target app did not return an embed session.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpStatusFromError(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as Record<string, unknown>;
  const nested =
    record.data && typeof record.data === "object"
      ? (record.data as Record<string, unknown>)
      : undefined;
  const status = record.status ?? nested?.status ?? record.code ?? nested?.code;
  return typeof status === "number" && status >= 100 && status <= 599
    ? status
    : undefined;
}

function isRetryableTargetMcpError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : safeJson(error);
  const status = httpStatusFromError(error);
  if (status !== undefined) {
    if (
      status === 408 ||
      status === 429 ||
      status === 502 ||
      status === 503 ||
      status === 504
    )
      return true;
    if (status >= 400 && status < 500) return false;
  }
  if (
    /^(?:MCP server\b.*?\bnot connected:\s+)?HTTP(?:\/\d+(?:\.\d+)?)?\s+(?:502|503|504)\b/i.test(
      message,
    )
  ) {
    return true;
  }
  if (
    /rejected the request|unauthorized|forbidden|401|403|404|405|html/i.test(
      message,
    )
  ) {
    return false;
  }
  return /streamable http|handshake|failed to fetch|fetch failed|networkerror|econnrefused|enotfound|timed out|timeout/i.test(
    message,
  );
}

function targetMcpErrorStatus(error: unknown): number | undefined {
  const status = httpStatusFromError(error);
  if (status !== undefined) return status;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : safeJson(error);
  const matchedStatus = message.match(/\b([45]\d{2})\b/)?.[1];
  return matchedStatus ? Number(matchedStatus) : undefined;
}

function targetMcpRequestDetails(input: {
  app: DispatchMcpAccessibleApp;
  mcpUrl: string;
  url: string;
}): {
  app: string;
  targetOrigin: string;
  targetPath: string;
  mcpOrigin: string;
  mcpPath: string;
} {
  const targetUrl = new URL(input.url);
  const mcpUrl = new URL(input.mcpUrl);
  return {
    app: input.app.id,
    targetOrigin: targetUrl.origin,
    targetPath: targetUrl.pathname,
    mcpOrigin: mcpUrl.origin,
    mcpPath: mcpUrl.pathname,
  };
}

function targetMcpConnectTimeout(deadline: number): number {
  const remaining = deadline - Date.now();
  const budget = Math.min(TARGET_EMBED_SESSION_CONNECT_TIMEOUT_MS, remaining);
  return Math.max(1000, budget);
}

class TargetMcpAuthenticationRejectedError extends Error {
  readonly status?: number;

  constructor(cause: unknown) {
    super("Target MCP authentication was rejected", { cause });
    this.name = "TargetMcpAuthenticationRejectedError";
    const status = httpStatusFromError(cause) ?? targetMcpErrorStatus(cause);
    if (status !== undefined) this.status = status;
  }
}

function isTargetMcpAuthenticationRejected(error: unknown): boolean {
  const status = httpStatusFromError(error);
  return status === 401 || status === 403;
}

function targetMcpRetryDelay(attempt: number): number {
  const base =
    TARGET_EMBED_SESSION_RETRY_BASE_MS * Math.pow(2, Math.max(0, attempt - 1));
  return base + Math.floor(Math.random() * 100);
}

async function callTargetCreateEmbedSession(input: {
  mcpUrl: string;
  token: string;
  url: string;
  chrome?: "full" | "minimal";
  runtime?: "workspace-app-chat";
  firstPartyMcp?: boolean;
  signal?: AbortSignal;
}): Promise<unknown> {
  if (!targetEndpointKeepsCredentialsPrivate(input.mcpUrl)) {
    throw new Error(
      "Cross-app embed sessions need an HTTPS target endpoint; this one is plain HTTP.",
    );
  }
  const serverId = "target";
  const deadline = Date.now() + TARGET_EMBED_SESSION_BUDGET_MS;
  for (let attempt = 1; ; attempt += 1) {
    input.signal?.throwIfAborted();
    const manager = new McpClientManager(
      {
        servers: {
          [serverId]: {
            type: "http",
            url: input.mcpUrl,
            headers: {
              Authorization: `Bearer ${input.token}`,
              // Targets hide create_embed_session from callers that don't declare inline MCP App support.
              "x-agent-native-mcp-inline-apps": "1",
            },
          },
        },
      },
      { connectTimeoutMs: targetMcpConnectTimeout(deadline) },
    );
    let connected = false;
    const stopOnAbort = () => {
      void manager.stop().catch(() => {});
    };
    input.signal?.addEventListener("abort", stopOnAbort, { once: true });
    try {
      await manager.start();
      input.signal?.throwIfAborted();
      const connectErrorStatus = manager.getConnectErrorStatus(serverId);
      if (connectErrorStatus === 401 || connectErrorStatus === 403) {
        const error = Object.assign(new Error(`HTTP ${connectErrorStatus}`), {
          status: connectErrorStatus,
        });
        throw new TargetMcpAuthenticationRejectedError(error);
      }
      connected = true;
      return await manager.callTool(
        buildMcpToolName(serverId, "create_embed_session"),
        {
          url: input.url,
          chrome: input.chrome ?? "full",
          ...(input.runtime ? { runtime: input.runtime } : {}),
        },
      );
    } catch (error) {
      if (
        !connected &&
        !(error instanceof TargetMcpAuthenticationRejectedError) &&
        isTargetMcpAuthenticationRejected(error)
      ) {
        throw new TargetMcpAuthenticationRejectedError(error);
      }
      if (
        input.signal?.aborted ||
        attempt >= TARGET_EMBED_SESSION_ATTEMPTS ||
        !isRetryableTargetMcpError(error) ||
        deadline - Date.now() < TARGET_EMBED_SESSION_RETRY_BASE_MS
      ) {
        throw error;
      }
      await sleep(targetMcpRetryDelay(attempt));
    } finally {
      input.signal?.removeEventListener("abort", stopOnAbort);
      await manager.stop().catch((stopError) => {
        console.warn("[dispatch] Failed to stop target MCP client:", stopError);
      });
    }
  }
}

const TARGET_APP_ACTION_CONNECT_MS = 15_000;
// Embed minting is Dispatch's own handshake with the target, not an app action.
const TARGET_APP_HIDDEN_ACTIONS = new Set([
  "create_embed_session",
  "open_app",
  "list_apps",
]);

export type GrantedAppAction = {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  readOnly?: boolean;
  destructive?: boolean;
};

export type GrantedAppActionResult = {
  isError?: boolean;
  approvalReview?: { url?: string; expiresAt?: number };
  structuredContent?: unknown;
  content: unknown[];
};

export function dispatchDirectAppActionsEnabled(): boolean {
  return getAppConfig().dispatch.directAppActions;
}

/** One direct app action connection, as a header provider sees it before it opens. */
export interface DispatchAppActionRequest {
  app: string;
  /** The action about to be called; undefined when only listing actions. */
  action: string | undefined;
  ownerEmail: string;
  orgId?: string;
}

export type DispatchAppActionHeaderProvider = (
  request: DispatchAppActionRequest,
) =>
  | Record<string, string>
  | undefined
  | Promise<Record<string, string> | undefined>;

let appActionHeaderProvider: DispatchAppActionHeaderProvider | undefined;

/**
 * Let the deployment add headers to direct app action connections, such as a
 * per-turn grant the target app's MCP turn grant admitter recognizes. Returns
 * a function that removes it.
 */
export function setDispatchAppActionHeaderProvider(
  provider: DispatchAppActionHeaderProvider,
): () => void {
  if (appActionHeaderProvider && appActionHeaderProvider !== provider) {
    throw new Error(
      "A Dispatch app action header provider is already registered.",
    );
  }
  appActionHeaderProvider = provider;
  return () => {
    if (appActionHeaderProvider === provider)
      appActionHeaderProvider = undefined;
  };
}

async function appActionHeaders(
  request: DispatchAppActionRequest,
): Promise<Record<string, string>> {
  if (!appActionHeaderProvider) return {};
  const headers = await appActionHeaderProvider(request);
  if (headers === undefined) return {};
  for (const [name, value] of Object.entries(headers)) {
    if (
      name.toLowerCase() === "authorization" ||
      name.toLowerCase() === "x-agent-native-browser-tab" ||
      name.toLowerCase() === "x-agent-native-viewport-mode" ||
      typeof value !== "string"
    ) {
      throw new Error(
        `The app action header provider returned an invalid "${name}" header.`,
      );
    }
  }
  return headers;
}

type RemoteAppOAuth = {
  serverId?: string;
  credential?: TargetMcpCredential;
};

async function findRemoteAppOAuth(
  mcpUrl: string,
  ownerEmail: string,
): Promise<RemoteAppOAuth> {
  try {
    const resource = new URL(mcpUrl).href;
    const servers = await listRemoteServers("user", ownerEmail);
    let reconnectServerId: string | undefined;
    for (const server of servers) {
      if (
        !server.oauthSecretKey ||
        !URL.canParse(server.url) ||
        new URL(server.url).href !== resource
      )
        continue;
      reconnectServerId ??= server.id;
      const options = {
        key: server.oauthSecretKey,
        scope: "user" as const,
        scopeId: ownerEmail,
        serverUrl: mcpUrl,
        throwOnTransientRefreshFailure: true,
      };
      const token = await getMcpOAuthAccessToken(options);
      if (!token) continue;
      return {
        serverId: server.id,
        credential: {
          strategy: "oauth",
          token,
          oauthAccessRefresh: {
            identity: createHash("sha256")
              .update(
                JSON.stringify([ownerEmail, server.oauthSecretKey, resource]),
              )
              .digest("hex"),
            refresh: () =>
              getMcpOAuthAccessToken({ ...options, forceRefresh: true }),
          },
        },
      };
    }
    return reconnectServerId ? { serverId: reconnectServerId } : {};
  } catch {
    throw new NoWriteError(
      "The app's saved connection is unavailable. Try again.",
      {
        errorCode: "app_connection_unavailable",
        statusCode: 503,
      },
    );
  }
}

function appOAuthStartUrl(
  target: DispatchMcpAccessibleApp,
  mcpUrl: string,
  serverId?: string,
): string {
  const params = serverId
    ? new URLSearchParams({ scope: "user", serverId })
    : new URLSearchParams({
        scope: "user",
        name: `app-${createHash("sha256").update(mcpUrl).digest("hex").slice(0, 16)}`,
        url: mcpUrl,
        description: target.name,
      });
  return `${dispatchSelfBaseUrl()}/_agent-native/mcp/servers/oauth/start?${params}`;
}

function appAuthorizationRequired(
  target: DispatchMcpAccessibleApp,
  mcpUrl: string,
  serverId?: string,
): never {
  const authorizationUrl = appOAuthStartUrl(target, mcpUrl, serverId);
  throw new NoWriteError(`Connect ${target.name} to use its actions.`, {
    errorCode: "authorization_required",
    statusCode: 401,
    details: { app: target.id, authorizationUrl },
  });
}

// Runs `withClient` against a connected MCP client for the granted app, signed
// as the requesting user, the way embed sessions reach the same target. Without a
// header provider no per-turn grant is attached, so a target action that
// requires a user turn refuses with its own error code.
async function withGrantedAppMcp<T>(
  app: string,
  action: string | undefined,
  withClient: (manager: McpClientManager, serverId: string) => Promise<T>,
  options?: { viewportMode?: ViewportMode },
): Promise<T> {
  if (!dispatchDirectAppActionsEnabled()) {
    fail("Direct app actions are not enabled on this Dispatch deployment.", {
      errorCode: "direct_app_actions_disabled",
      statusCode: 403,
    });
  }
  const target = await resolveGrantedDispatchMcpApp(app);
  if (target.id === DISPATCH_APP_ID) {
    throw new Error(
      "Dispatch's own actions are tools on this connection; call them directly.",
    );
  }
  const ownerEmail = getRequestUserEmail();
  if (!ownerEmail) throw new Error("no authenticated user");
  const orgId = getRequestOrgId();
  const mcpUrl = appMcpUrl(target);
  if (!targetEndpointKeepsCredentialsPrivate(mcpUrl)) {
    throw new Error("App actions need an HTTPS target endpoint.");
  }
  const firstPartyMcp = isWorkspaceSsoAppUrl(
    { id: target.id, url: mcpUrl },
    { nodeEnv: "production", environmentLane: requestEnvironmentLane() },
  );
  let remote: RemoteAppOAuth | undefined;
  const loadRemote = async () => {
    remote ??= await findRemoteAppOAuth(mcpUrl, ownerEmail);
    return remote;
  };
  if (
    !firstPartyMcp &&
    new URL(mcpUrl).origin !== new URL(dispatchSelfBaseUrl()).origin
  ) {
    await loadRemote();
  }
  const prepared = remote?.credential
    ? undefined
    : await createTargetMcpUserCredentials({
        mcpUrl,
        ownerEmail,
        fullCatalog: true,
        allowMissing: true,
        ...(firstPartyMcp ? { firstPartyMcp: true } : {}),
        ...(orgId !== undefined ? { orgId } : {}),
      });
  const credentials = remote?.credential
    ? [remote.credential]
    : [...(prepared?.credentials ?? [])];
  if (credentials.length === 0) {
    const oauth = await loadRemote();
    if (oauth.credential) credentials.push(oauth.credential);
    else appAuthorizationRequired(target, mcpUrl, oauth.serverId);
  }
  const requestedViewportMode =
    options?.viewportMode ?? getRequestRunContext()?.viewportMode;
  const childBrowserTabId =
    action === undefined || requestedViewportMode === "background"
      ? undefined
      : await resolveDispatchChildBrowserTab(target);
  const viewportMode: ViewportMode | undefined =
    action === undefined
      ? undefined
      : (requestedViewportMode ??
        (childBrowserTabId ? "foreground" : undefined));
  const extraHeaders = await appActionHeaders({
    app: target.id,
    action,
    ownerEmail,
    ...(orgId !== undefined ? { orgId } : {}),
  });
  const serverId = "target";
  let orgMemberTried = credentials.some(
    (credential) => credential.strategy === "org-member-delegation",
  );
  for (const [index, credential] of credentials.entries()) {
    const manager = new McpClientManager(
      {
        servers: {
          [serverId]: {
            type: "http",
            url: mcpUrl,
            ...(credential.oauthAccessRefresh
              ? { oauthAccessRefresh: credential.oauthAccessRefresh }
              : {}),
            headers: {
              ...extraHeaders,
              ...(childBrowserTabId
                ? { "x-agent-native-browser-tab": childBrowserTabId }
                : {}),
              ...(viewportMode
                ? { "x-agent-native-viewport-mode": viewportMode }
                : {}),
              Authorization: `Bearer ${credential.token}`,
              ...(credential.firstPartyMcp
                ? { "x-agent-native-mcp-inline-apps": "1" }
                : {}),
            },
          },
        },
      },
      { connectTimeoutMs: TARGET_APP_ACTION_CONNECT_MS },
    );
    try {
      await manager.start();
      const status = manager.getConnectErrorStatus(serverId);
      if (status === 401 || status === 403) {
        if (credential.strategy === "oauth") {
          throw new NoWriteError(
            `The ${target.name} app rejected the saved connection.`,
            {
              errorCode: "app_connection_rejected",
              statusCode: 403,
              details: {
                app: target.id,
                authorizationUrl: appOAuthStartUrl(
                  target,
                  mcpUrl,
                  remote?.serverId,
                ),
              },
            },
          );
        }
        if (index === credentials.length - 1 && !orgMemberTried) {
          orgMemberTried = true;
          const orgMember = await prepared?.loadOrgMemberCredential();
          if (orgMember) credentials.push(orgMember);
        }
        if (index < credentials.length - 1) continue;
        const oauth = await loadRemote();
        if (oauth.credential) {
          credentials.push(oauth.credential);
          continue;
        }
        appAuthorizationRequired(target, mcpUrl, oauth.serverId);
      }
      if (!manager.hasServer(serverId)) {
        throw new NoWriteError(
          `The ${target.name} app's actions are unreachable.`,
          {
            errorCode: "app_connection_unreachable",
            statusCode: 502,
          },
        );
      }
      return await withClient(manager, serverId);
    } finally {
      await manager.stop().catch((stopError: unknown) => {
        console.warn("[dispatch] Failed to stop target MCP client:", stopError);
      });
    }
  }
  appAuthorizationRequired(target, mcpUrl, remote?.serverId);
}

export async function listGrantedDispatchMcpAppActions(
  app: string,
  names?: string[],
): Promise<GrantedAppAction[]> {
  return withGrantedAppMcp(app, undefined, async (manager, serverId) =>
    manager
      .getToolsForServer(serverId)
      .filter((tool) => !TARGET_APP_HIDDEN_ACTIONS.has(tool.originalName))
      .map((tool) => {
        const detailed = names?.includes(tool.originalName) === true;
        return {
          name: tool.originalName,
          description: detailed
            ? tool.description
            : (tool.description.split(/(?<=\.)\s/)[0] ?? "").slice(0, 160),
          ...(detailed ? { inputSchema: tool.inputSchema } : {}),
          ...(detailed && tool.annotations?.destructiveHint === true
            ? { destructive: true }
            : {}),
          ...(tool.annotations?.readOnlyHint === true
            ? { readOnly: true }
            : {}),
        };
      }),
  );
}

function approvalReviewFrom(
  result: object,
): { url?: string; expiresAt?: number } | undefined {
  const meta = "_meta" in result ? result._meta : undefined;
  const review =
    meta !== null && typeof meta === "object"
      ? (meta as Record<string, unknown>)["agent-native/approvalReview"]
      : undefined;
  if (review === null || typeof review !== "object") return undefined;
  const { url, expiresAt } = review as Record<string, unknown>;
  return {
    ...(typeof url === "string" ? { url } : {}),
    ...(typeof expiresAt === "number" ? { expiresAt } : {}),
  };
}

export async function callGrantedDispatchMcpAppAction(
  app: string,
  action: string,
  args: Record<string, unknown>,
  options?: { viewportMode?: ViewportMode },
): Promise<GrantedAppActionResult> {
  if (TARGET_APP_HIDDEN_ACTIONS.has(action)) {
    throw new NoWriteError(`"${action}" is not an app action.`, {
      errorCode: "app_action_not_found",
      statusCode: 404,
    });
  }
  return withGrantedAppMcp(
    app,
    action,
    async (manager, serverId) => {
      const toolName = buildMcpToolName(serverId, action);
      if (!manager.getTool(toolName)) {
        throw new NoWriteError(
          `The app has no action named "${action}". Call list_app_actions to see them.`,
          { errorCode: "app_action_not_found", statusCode: 404 },
        );
      }
      let result: unknown;
      try {
        result = await manager.callTool(toolName, args);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (mcpToolCallWasNotSent(error)) {
          throw new NoWriteError(`The app action did not run (${reason}).`, {
            errorCode: "app_action_not_sent",
            statusCode:
              (error as { statusCode?: unknown }).statusCode === 403
                ? 403
                : 502,
          });
        }
        fail(
          `The app action failed before returning a result (${reason}). Its write outcome may be unknown; inspect the app before retrying.`,
          { errorCode: "app_action_outcome_unknown", statusCode: 502 },
        );
      }
      if (
        result === null ||
        typeof result !== "object" ||
        !("content" in result) ||
        !Array.isArray(result.content)
      ) {
        fail(
          "The app action returned an unreadable result. Its write outcome may be unknown; inspect the app before retrying.",
          { errorCode: "app_action_result_unreadable", statusCode: 502 },
        );
      }
      const approvalReview = approvalReviewFrom(result);
      return {
        ...("isError" in result && result.isError === true
          ? { isError: true }
          : {}),
        ...(approvalReview ? { approvalReview } : {}),
        ...("structuredContent" in result &&
        result.structuredContent !== undefined
          ? { structuredContent: result.structuredContent }
          : {}),
        content: result.content as unknown[],
      };
    },
    options,
  );
}

type TargetMcpCredential = {
  strategy: "deployment-user" | "org-member-delegation" | "oauth";
  token: string;
  firstPartyMcp?: boolean;
  oauthAccessRefresh?: {
    identity: string;
    refresh: () => Promise<string | null>;
  };
};

async function createTargetMcpUserCredentials(input: {
  mcpUrl: string;
  ownerEmail: string;
  orgId?: string;
  firstPartyMcp?: boolean;
  fullCatalog?: boolean;
  allowMissing?: boolean;
  runtime?: "workspace-app-chat";
}): Promise<{
  credentials: TargetMcpCredential[];
  loadOrgMemberCredential: () => Promise<TargetMcpCredential | undefined>;
}> {
  const audience = canonicalA2AAudience(input.mcpUrl);
  if (input.runtime) {
    const authenticatedAtMs = getRequestContext()?.identityAuthenticatedAtMs;
    if (
      !input.firstPartyMcp ||
      !Number.isSafeInteger(authenticatedAtMs) ||
      typeof authenticatedAtMs !== "number" ||
      authenticatedAtMs <= 0 ||
      authenticatedAtMs > Date.now()
    )
      throw new Error(
        "App chat requires a verified first-party sign-in grant.",
      );
    if (!getGlobalA2ASecret())
      throw new Error("App chat requires a deployment A2A credential.");
  }
  const orgDomain = input.orgId
    ? (await getOrgDomain(input.orgId))?.trim().toLowerCase() || undefined
    : undefined;
  if ((input.firstPartyMcp || input.runtime) && input.orgId && !orgDomain) {
    throw new Error("Workspace organization domain is unavailable.");
  }
  const credentials: TargetMcpCredential[] = [];
  if (getGlobalA2ASecret()) {
    credentials.push({
      strategy: "deployment-user",
      ...(input.firstPartyMcp ? { firstPartyMcp: true } : {}),
      token: await signA2AToken(
        input.ownerEmail,
        input.firstPartyMcp || input.runtime ? orgDomain : undefined,
        undefined,
        {
          expiresIn: "5m",
          audience,
          preferGlobalSecret: true,
          ...(input.firstPartyMcp || input.runtime || input.fullCatalog
            ? {
                extraClaims: {
                  ...(input.fullCatalog ? { catalog_scope: "full" } : {}),
                  ...(input.firstPartyMcp
                    ? {
                        jti: globalThis.crypto.randomUUID(),
                        scope: "mcp-connect",
                        agent_native_first_party_mcp: true,
                      }
                    : {}),
                  ...(input.runtime
                    ? {
                        agent_native_workspace_app_chat: true,
                        agent_native_chat_grant_issued_at_ms:
                          getRequestContext()?.identityAuthenticatedAtMs,
                        ...(!input.orgId ? { org_id: null } : {}),
                      }
                    : {}),
                },
              }
            : {}),
        },
      ),
    });
  }

  const loadOrgMemberCredential = async () => {
    if (input.runtime) return undefined;
    if (!input.orgId || !orgDomain) return undefined;
    const orgSecret = await getOrgA2ASecret(input.orgId);
    if (!orgSecret) return undefined;
    return {
      strategy: "org-member-delegation" as const,
      token: await signA2AOrgMemberDelegationToken(
        input.ownerEmail,
        orgDomain,
        orgSecret,
        audience,
      ),
    };
  };

  if (credentials.length === 0) {
    const orgMemberCredential = await loadOrgMemberCredential();
    if (orgMemberCredential) credentials.push(orgMemberCredential);
  }
  if (credentials.length === 0 && !input.allowMissing) {
    throw new Error(
      "Cross-app embed sessions require a deployment A2A secret or an organization secret with member delegation enabled on the target.",
    );
  }
  return { credentials, loadOrgMemberCredential };
}

async function resolveEmbedTarget(
  input: {
    app?: string;
    resolvedApp?: DispatchMcpAccessibleApp;
    url?: string;
    path?: string;
  },
  options: {
    resolveApp: (app: string) => Promise<DispatchMcpAccessibleApp>;
    listApps: () => Promise<DispatchMcpAccessibleApp[]>;
    urlError: string;
  },
): Promise<{ app: DispatchMcpAccessibleApp; path: string; url: string }> {
  const explicitApp =
    input.resolvedApp ??
    (input.app?.trim() ? await options.resolveApp(input.app) : null);
  if (explicitApp && input.path) {
    const path = safeAppPath(input.path);
    if (!path) throw new Error("path must be a safe app-relative route");
    assertAppCanOpenPath(explicitApp, path);
    return {
      app: explicitApp,
      path,
      url: joinAppBaseUrlAndPath(appHomeBaseUrl(explicitApp), path),
    };
  }

  if (!input.url) {
    throw new Error("create_embed_session requires a url or app + path.");
  }

  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    if (!explicitApp) {
      throw new Error("Relative embed paths require an app id.");
    }
    const path = safeAppPath(input.url);
    if (!path) throw new Error("url must be a safe app route.");
    return {
      app: explicitApp,
      path,
      url: joinAppBaseUrlAndPath(appHomeBaseUrl(explicitApp), path),
    };
  }

  const apps = explicitApp ? [explicitApp] : await options.listApps();
  const target = apps
    .filter((app) => appMatchesUrlPath(app, parsed))
    .sort((a, b) => appPathSpecificity(b) - appPathSpecificity(a))[0];
  if (!target) {
    throw new Error(options.urlError);
  }
  const path = safeAppPath(appRelativePath(target, parsed));
  if (!path) throw new Error("Embed URL path is not safe.");
  assertAppCanOpenPath(target, path);
  return {
    app: target,
    path,
    url: joinAppBaseUrlAndPath(appHomeBaseUrl(target), path),
  };
}

async function resolveDispatchEmbedTarget(input: {
  app?: string;
  resolvedApp?: DispatchMcpAccessibleApp;
  url?: string;
  path?: string;
}): Promise<{ app: DispatchMcpAccessibleApp; path: string; url: string }> {
  return resolveEmbedTarget(input, {
    resolveApp: resolveGrantedDispatchMcpApp,
    listApps: listGrantedDispatchMcpApps,
    urlError: "Embed URL must belong to an app granted through Dispatch.",
  });
}

async function resolveWorkspaceSsoEmbedTarget(input: {
  app?: string;
  url?: string;
  path?: string;
}): Promise<{ app: DispatchMcpAccessibleApp; path: string; url: string }> {
  return resolveEmbedTarget(input, {
    resolveApp: resolveWorkspaceSsoApp,
    listApps: listWorkspaceSsoApps,
    urlError:
      "Embed URL must belong to an app registered for Dispatch workspace sign-in.",
  });
}

async function createDispatchSelfEmbedSession(input: {
  ownerEmail: string;
  orgId?: string;
  path: string;
  baseUrl: string;
  chrome?: "full" | "minimal";
  runtime?: "workspace-app-chat";
}): Promise<{
  startUrl: string;
  targetPath?: string;
  expiresAt?: number;
  app: string;
}> {
  if (input.runtime)
    throw new Error("Host self chat requires its own browser session.");
  const ticket = await createEmbedSessionTicket({
    ownerEmail: input.ownerEmail,
    orgId: input.orgId,
    targetPath: input.path,
    // A full panel is Dispatch's own UI shown to its owner; minimal stays read-only.
    scope: input.chrome === "minimal" ? input.chrome : FULL_APP_EMBED_SCOPE,
  });
  const startPath = buildEmbedStartPath(ticket.ticket);
  return {
    startUrl: new URL(startPath, input.baseUrl).toString(),
    targetPath: input.path,
    expiresAt: ticket.expiresAt,
    app: DISPATCH_APP_ID,
  };
}

type InternalEmbedSession = {
  startUrl?: string;
  chatToken?: string;
  targetPath?: string;
  childBrowserTabId?: string;
  expiresAt?: number;
  app: string;
  appBaseUrl: string;
};

function publicEmbedSession({
  startUrl,
  targetPath,
  childBrowserTabId,
  expiresAt,
  app,
}: InternalEmbedSession) {
  if (!startUrl)
    throw new Error("Document embed requires a browser start URL.");
  return {
    startUrl,
    ...(targetPath ? { targetPath } : {}),
    ...(childBrowserTabId ? { childBrowserTabId } : {}),
    ...(typeof expiresAt === "number" ? { expiresAt } : {}),
    app,
  };
}

type ResolvedEmbedTarget = Awaited<
  ReturnType<typeof resolveDispatchEmbedTarget>
>;
type PendingEmbedSession = {
  result: Promise<InternalEmbedSession>;
  release: () => void;
  abort: () => void;
};

const pendingGrantedEmbeds = new Map<string, PendingEmbedSession>();

function grantedEmbedPrefetchKey(
  ownerEmail: string,
  target: ResolvedEmbedTarget,
): string {
  const request = getRequestContext();
  return JSON.stringify([
    ownerEmail,
    getRequestOrgId(),
    request?.requestOrigin,
    request?.identityAuthenticatedAtMs,
    request?.mcpCredentialIssuedAtMs,
    request?.a2aIdentityAssurance,
    request?.credentialScope,
    target.app.id,
    appMcpUrl(target.app),
    target.url,
  ]);
}

function prefetchGrantedEmbedSession(
  app: DispatchMcpAccessibleApp,
  url: string,
) {
  const ownerEmail = getRequestUserEmail();
  if (!ownerEmail || app.id === DISPATCH_APP_ID) return;
  const work = (async () => {
    const target = await resolveDispatchEmbedTarget({ resolvedApp: app, url });
    const key = grantedEmbedPrefetchKey(ownerEmail, target);
    if (pendingGrantedEmbeds.has(key)) return;
    if (pendingGrantedEmbeds.size >= PENDING_EMBED_LIMIT) {
      pendingGrantedEmbeds.values().next().value?.abort();
    }
    const controller = new AbortController();
    const result = Promise.race([
      createEmbedSessionForResolvedApp({
        ownerEmail,
        orgId: getRequestOrgId(),
        target,
        chrome: "minimal",
        bindBrowserTab: true,
        signal: controller.signal,
      }),
      new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => reject(controller.signal.reason),
          { once: true },
        );
      }),
    ]);
    const release = () => {
      clearTimeout(timer);
      if (pendingGrantedEmbeds.get(key) === entry)
        pendingGrantedEmbeds.delete(key);
    };
    const abort = () => {
      release();
      controller.abort();
    };
    const timer = setTimeout(abort, OPEN_APP_EMBED_WAIT_MS);
    timer.unref();
    const entry = { result, release, abort };
    pendingGrantedEmbeds.set(key, entry);
    try {
      await result;
    } catch {
      release();
    }
  })().catch(() => {});
  const waitUntil = getRequestRunContext()?.waitUntil ?? platformWaitUntil();
  waitUntil?.(work);
}

async function takePrefetchedGrantedEmbedSession(
  ownerEmail: string,
  target: ResolvedEmbedTarget,
): Promise<InternalEmbedSession | undefined> {
  const key = grantedEmbedPrefetchKey(ownerEmail, target);
  const entry = pendingGrantedEmbeds.get(key);
  if (!entry) return;
  pendingGrantedEmbeds.delete(key);
  const claimDeadline = setTimeout(entry.abort, BROWSER_EMBED_PREFETCH_WAIT_MS);
  try {
    const session = await entry.result;
    if (session.expiresAt === undefined || session.expiresAt > Date.now())
      return session;
  } catch {
    // coercion-ok: A failed prefetch requires the normal foreground mint.
  } finally {
    clearTimeout(claimDeadline);
    entry.release();
  }
}

async function createGrantedDispatchMcpEmbedSessionResult(input: {
  app?: string;
  resolvedApp?: DispatchMcpAccessibleApp;
  url?: string;
  path?: string;
  chrome?: "full" | "minimal";
  runtime?: "workspace-app-chat";
  bindBrowserTab?: boolean;
  signal?: AbortSignal;
}): Promise<InternalEmbedSession> {
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");
  const target = await resolveDispatchEmbedTarget(input);
  if (input.bindBrowserTab && input.chrome === "minimal") {
    const prefetched = await takePrefetchedGrantedEmbedSession(
      userEmail,
      target,
    );
    if (prefetched) return prefetched;
  }

  return createEmbedSessionForResolvedApp({
    ownerEmail: userEmail,
    orgId: getRequestOrgId(),
    target,
    chrome: input.chrome,
    runtime: input.runtime,
    bindBrowserTab: input.bindBrowserTab,
    ...(input.signal ? { signal: input.signal } : {}),
  });
}

export async function createGrantedDispatchMcpEmbedSession(
  input: {
    app?: string | undefined;
    url?: string | undefined;
    path?: string | undefined;
    chrome?: "full" | "minimal" | undefined;
  },
  options?: { bindBrowserTab: boolean },
): Promise<ReturnType<typeof publicEmbedSession>> {
  // Copy only public fields so a caller cannot supply a pre-resolved app.
  const { app, url, path, chrome } = input;
  return publicEmbedSession(
    await createGrantedDispatchMcpEmbedSessionResult({
      ...(app === undefined ? {} : { app }),
      ...(url === undefined ? {} : { url }),
      ...(path === undefined ? {} : { path }),
      ...(chrome === undefined ? {} : { chrome }),
      ...(options?.bindBrowserTab ? { bindBrowserTab: true } : {}),
    }),
  );
}

async function createEmbedSessionForResolvedGrantedApp(input: {
  app: string;
  resolvedApp: DispatchMcpAccessibleApp;
  url: string;
  chrome?: "full" | "minimal";
  signal?: AbortSignal;
}): Promise<ReturnType<typeof publicEmbedSession>> {
  return publicEmbedSession(
    await createGrantedDispatchMcpEmbedSessionResult(input),
  );
}

export async function createGrantedDispatchMcpEmbedSessionForWorkspaceAppChat(
  appId: string,
): Promise<{
  token: string;
  appBaseUrl: string;
  targetPath: string;
  expiresAt: number;
}> {
  const session = await createGrantedDispatchMcpEmbedSessionResult({
    app: appId,
    path: "/",
    chrome: "minimal",
    runtime: "workspace-app-chat",
  });
  if (
    !session.chatToken ||
    !session.targetPath ||
    typeof session.expiresAt !== "number"
  )
    throw new Error("Target app did not return a private chat credential.");
  return {
    token: session.chatToken,
    appBaseUrl: session.appBaseUrl,
    targetPath: session.targetPath,
    expiresAt: session.expiresAt,
  };
}

async function createEmbedSessionForResolvedApp(input: {
  ownerEmail: string;
  orgId?: string | undefined;
  target: { app: DispatchMcpAccessibleApp; path: string; url: string };
  chrome?: "full" | "minimal" | undefined;
  runtime?: "workspace-app-chat" | undefined;
  bindBrowserTab?: boolean | undefined;
  signal?: AbortSignal;
}): Promise<InternalEmbedSession> {
  const { ownerEmail, orgId, target, chrome } = input;

  if (target.app.id === DISPATCH_APP_ID) {
    return {
      ...(await createDispatchSelfEmbedSession({
        ownerEmail,
        ...(orgId !== undefined ? { orgId } : {}),
        path: target.path,
        baseUrl: appBaseUrl(target.app),
        ...(chrome !== undefined ? { chrome } : {}),
        ...(input.runtime ? { runtime: input.runtime } : {}),
      })),
      appBaseUrl: appBaseUrl(target.app),
    };
  }

  const targetMcpUrl =
    input.runtime && target.app.workspaceMount
      ? `${appHomeBaseUrl(target.app)}/mcp`
      : appMcpUrl(target.app);
  const firstPartyMcp = isWorkspaceSsoAppUrl(
    { id: target.app.id, url: targetMcpUrl },
    {
      nodeEnv: "production",
      environmentLane: requestEnvironmentLane(),
      registryRaw: getAppConfig().auth.identitySsoAppRegistryJson,
    },
  );
  if (input.runtime && !firstPartyMcp)
    throw new Error("App chat requires a first-party workspace target.");
  const targetCredentials = await createTargetMcpUserCredentials({
    mcpUrl: targetMcpUrl,
    ownerEmail,
    ...(firstPartyMcp ? { firstPartyMcp: true } : {}),
    ...(input.runtime ? { runtime: input.runtime } : {}),
    ...(orgId !== undefined ? { orgId } : {}),
  });
  const targetDetails = targetMcpRequestDetails({
    app: target.app,
    mcpUrl: targetMcpUrl,
    url: target.url,
  });
  const childBrowserTabId = input.bindBrowserTab
    ? crypto.randomUUID()
    : undefined;
  const launchUrl = new URL(target.url);
  if (childBrowserTabId) {
    launchUrl.searchParams.set(
      DISPATCH_CHILD_BROWSER_TAB_PARAM,
      childBrowserTabId,
    );
  }
  let parsed:
    | {
        startUrl?: string;
        runtime?: string;
        token?: string;
        targetPath?: string;
        expiresAt?: number;
      }
    | undefined;
  const credentials = [...targetCredentials.credentials];
  for (const [index, credential] of credentials.entries()) {
    console.info("[dispatch] workspace embed target request", {
      ...targetDetails,
      authStrategy: credential.strategy,
    });
    input.signal?.throwIfAborted();
    try {
      const result = await callTargetCreateEmbedSession({
        mcpUrl: targetMcpUrl,
        token: credential.token,
        url: childBrowserTabId ? launchUrl.toString() : target.url,
        ...(chrome !== undefined ? { chrome } : {}),
        ...(input.runtime ? { runtime: input.runtime } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      });
      parsed = parseMcpToolTextResult(result) as {
        startUrl?: string;
        runtime?: string;
        token?: string;
        targetPath?: string;
        expiresAt?: number;
      };
      break;
    } catch (error) {
      if (
        error instanceof TargetMcpAuthenticationRejectedError &&
        credential.strategy === "deployment-user" &&
        index === credentials.length - 1
      ) {
        const orgMemberCredential =
          await targetCredentials.loadOrgMemberCredential();
        if (orgMemberCredential) credentials.push(orgMemberCredential);
      }
      if (
        error instanceof TargetMcpAuthenticationRejectedError &&
        index < credentials.length - 1
      ) {
        console.warn("[dispatch] workspace embed auth candidate rejected", {
          ...targetDetails,
          authStrategy: credential.strategy,
          status: targetMcpErrorStatus(error),
        });
        continue;
      }
      console.warn("[dispatch] workspace embed target response", {
        ...targetDetails,
        authStrategy: credential.strategy,
        status: targetMcpErrorStatus(error),
        category: isRetryableTargetMcpError(error) ? "transient" : "permanent",
      });
      throw error;
    }
  }
  if (!parsed) throw new Error("Target app did not return an embed session.");
  if (input.runtime) {
    if (
      parsed.runtime !== input.runtime ||
      typeof parsed.token !== "string" ||
      !parsed.token ||
      typeof parsed.targetPath !== "string" ||
      !safeAppPath(parsed.targetPath) ||
      typeof parsed.expiresAt !== "number" ||
      !Number.isFinite(parsed.expiresAt) ||
      parsed.expiresAt <= Date.now() ||
      parsed.startUrl
    ) {
      throw new Error("Target app did not return a private chat credential.");
    }
    return {
      chatToken: parsed.token,
      targetPath: parsed.targetPath,
      expiresAt: parsed.expiresAt,
      app: target.app.id,
      appBaseUrl: target.app.workspaceMount
        ? appHomeBaseUrl(target.app)
        : appChatBaseUrl(target.app),
    };
  }
  if (!parsed.startUrl || parsed.token) {
    throw new Error("Target app did not return an embed start URL.");
  }
  const startUrl = resolveGrantedAppEmbedStartUrl(target.app, parsed.startUrl);
  const startUrlDetails = new URL(startUrl);
  console.info("[dispatch] workspace embed target minted session", {
    ...targetDetails,
    startPath: startUrlDetails.pathname,
    returnedTicket: startUrlDetails.searchParams.has("ticket"),
    returnedTargetPath: typeof parsed.targetPath === "string",
    returnedExpiry: typeof parsed.expiresAt === "number",
  });
  const output: InternalEmbedSession = {
    startUrl,
    app: target.app.id,
    appBaseUrl: appChatBaseUrl(target.app),
  };
  if (parsed.targetPath) {
    output.targetPath = parsed.targetPath;
    const safePath = childBrowserTabId && safeAppPath(parsed.targetPath);
    if (safePath) {
      const reported = new URL(safePath, launchUrl.origin);
      if (
        reported.searchParams.get(DISPATCH_CHILD_BROWSER_TAB_PARAM) ===
        childBrowserTabId
      ) {
        reported.searchParams.delete(DISPATCH_CHILD_BROWSER_TAB_PARAM);
        output.targetPath = reported.pathname + reported.search + reported.hash;
        output.childBrowserTabId = childBrowserTabId;
      }
    }
  }
  if (typeof parsed.expiresAt === "number") output.expiresAt = parsed.expiresAt;
  return output;
}

async function createWorkspaceSsoEmbedSessionResult(input: {
  app?: string | undefined;
  url?: string | undefined;
  path?: string | undefined;
  chrome?: "full" | "minimal" | undefined;
  runtime?: "workspace-app-chat" | undefined;
  bindBrowserTab?: boolean;
}): Promise<InternalEmbedSession> {
  const ownerEmail = getRequestUserEmail();
  if (!ownerEmail) {
    console.warn("[dispatch] workspace embed mint rejected", {
      phase: "dispatch-auth",
      requestedApp: input.app ?? null,
      hasPath: typeof input.path === "string",
      hasUrl: typeof input.url === "string",
      ownerResolved: false,
      orgResolved: Boolean(getRequestOrgId()),
    });
    throw new Error("no authenticated user");
  }
  const scope = {
    userEmail: ownerEmail,
    userKey: ownerEmail,
    orgId: getRequestOrgId(),
  };
  const enabled =
    (await isFeatureFlagEnabled(DISPATCH_WORKSPACE_SSO_FLAG, scope)) ||
    (await isFeatureFlagEnabled(DESKTOP_WORKSPACE_SSO_FLAG, scope));
  if (!enabled) {
    console.warn("[dispatch] workspace embed mint rejected", {
      phase: "feature-flag",
      requestedApp: input.app ?? null,
      hasPath: typeof input.path === "string",
      hasUrl: typeof input.url === "string",
      ownerResolved: true,
      orgResolved: Boolean(getRequestOrgId()),
    });
    throw new Error("Dispatch workspace sign-in is not enabled.");
  }

  const target = await resolveWorkspaceSsoEmbedTarget(input);
  return createEmbedSessionForResolvedApp({
    ownerEmail,
    orgId: getRequestOrgId(),
    target,
    chrome: input.chrome,
    runtime: input.runtime,
    bindBrowserTab: input.bindBrowserTab,
  });
}

export async function createWorkspaceSsoEmbedSession(
  input: {
    app?: string | undefined;
    url?: string | undefined;
    path?: string | undefined;
    chrome?: "full" | "minimal" | undefined;
  },
  options?: { bindBrowserTab: boolean },
): Promise<ReturnType<typeof publicEmbedSession>> {
  const { app, url, path, chrome } = input;
  return publicEmbedSession(
    await createWorkspaceSsoEmbedSessionResult({
      app,
      url,
      path,
      chrome,
      ...(options?.bindBrowserTab ? { bindBrowserTab: true } : {}),
    }),
  );
}

export async function createWorkspaceSsoEmbedSessionForWorkspaceAppChat(
  appId: string,
): Promise<{
  token: string;
  appBaseUrl: string;
  targetPath: string;
  expiresAt: number;
}> {
  const session = await createWorkspaceSsoEmbedSessionResult({
    app: appId,
    path: "/",
    chrome: "minimal",
    runtime: "workspace-app-chat",
  });
  if (
    !session.chatToken ||
    !session.targetPath ||
    typeof session.expiresAt !== "number"
  )
    throw new Error("Target app did not return a private chat credential.");
  return {
    token: session.chatToken,
    appBaseUrl: session.appBaseUrl,
    targetPath: session.targetPath,
    expiresAt: session.expiresAt,
  };
}
