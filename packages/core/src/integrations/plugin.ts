import {
  defineEventHandler,
  setResponseStatus,
  setResponseHeader,
  getMethod,
  getQuery,
  sendRedirect,
} from "h3";
import { getRequestHeader } from "h3";
import { createRemoteJWKSet, jwtVerify } from "jose";

import { abortRun } from "../agent/run-manager.js";
import { getOrgContext, resolveOrgIdForEmail } from "../org/context.js";
import { loadResourcesForPrompt } from "../server/agent-chat-plugin.js";
import { withConfiguredAppBasePath } from "../server/app-base-path.js";
import { getSession } from "../server/auth.js";
import { FRAMEWORK_ROUTE_PREFIX } from "../server/core-routes-plugin.js";
import { resolveSecret } from "../server/credential-provider.js";
import {
  getH3App,
  markDefaultPluginProvided,
} from "../server/framework-request-handler.js";
import {
  decodeOAuthState,
  encodeOAuthState,
  oauthCallbackResponse,
  oauthErrorPage,
  resolveOAuthRedirectUri,
} from "../server/google-oauth.js";
import { readBody } from "../server/h3-helpers.js";
import { runWithRequestContext } from "../server/request-context.js";
import {
  processA2AContinuationById,
  processDueA2AContinuations,
} from "./a2a-continuation-processor.js";
import { failA2AContinuation } from "./a2a-continuations-store.js";
import { discordAdapter } from "./adapters/discord.js";
import { emailAdapter } from "./adapters/email.js";
import { googleDocsAdapter } from "./adapters/google-docs.js";
import { microsoftTeamsAdapter } from "./adapters/microsoft-teams.js";
import { slackAdapter } from "./adapters/slack.js";
import { telegramAdapter } from "./adapters/telegram.js";
import { whatsappAdapter } from "./adapters/whatsapp.js";
import {
  createComputerApprovalRequest,
  decideComputerApproval,
  listComputerApprovalsForOwner,
} from "./computer-supervision-store.js";
import { ComputerSupervisionError } from "./computer-supervision.js";
import { getIntegrationConfig, saveIntegrationConfig } from "./config-store.js";
import { claimIntegrationControl } from "./controls-store.js";
import {
  startGoogleDocsPoller,
  handlePushNotification,
} from "./google-docs-poller.js";
import { resolveDefaultIntegrationExecutionContext } from "./identity.js";
import {
  disconnectIntegrationInstallation,
  listIntegrationInstallations,
  resolveIntegrationTokenBundle,
  updateIntegrationInstallation,
  upsertIntegrationInstallation,
} from "./installations-store.js";
import {
  forgetIntegrationMemory,
  integrationMemoryActions,
  listIntegrationMemory,
  rememberForIntegrationScope,
} from "./integration-memory.js";
import {
  extractBearerToken,
  signInternalToken,
  verifyInternalToken,
} from "./internal-token.js";
import { startPendingTasksRetryJob } from "./pending-tasks-retry-job.js";
import {
  claimPendingTask,
  getNextPendingTaskIdForThread,
  insertPendingTask,
  MAX_PENDING_TASK_ATTEMPTS,
  markTaskCompleted,
  markTaskFailed,
  markTaskRetryable,
} from "./pending-tasks-store.js";
import {
  claimNextComputerCommand,
  claimNextRemoteCommand,
  enqueueComputerCommand,
  enqueueRemoteCommand as enqueueRemoteCommandRow,
  isRemoteCommandKind,
  listRemoteCommandsForOwner,
  updateRemoteCommandResult,
} from "./remote-commands-store.js";
import {
  authenticateRemoteDeviceToken,
  createRemoteDevice,
  getRemoteComputerCapabilities,
  getRemoteDeviceForOwner,
  listRemoteDevicesForOwner,
  revokeRemoteDeviceForOwner,
  toPublicRemoteDevice,
  unregisterRemoteDevice,
  updateRemoteDeviceDetails,
} from "./remote-devices-store.js";
import {
  listRemotePushNotificationsForOwner,
  listRemotePushRegistrationsForOwner,
  queueRemotePushNotifications,
  toPublicRemotePushRegistration,
  unregisterRemotePushRegistrationForOwner,
  upsertRemotePushRegistration,
} from "./remote-push-store.js";
import { startRemoteCommandsRetryJob } from "./remote-retry-job.js";
import {
  insertRemoteRunEvents,
  listRemoteRunEvents,
} from "./remote-run-events-store.js";
import type {
  ComputerCommandEnvelope,
  ComputerOperationClass,
  RemoteCommand,
  RemoteCommandKind,
  RemoteDevice,
} from "./remote-types.js";
import { listIntegrationScopes, saveIntegrationScope } from "./scope-store.js";
import { buildSlackAgentManifest } from "./slack-manifest.js";
import {
  assertSlackInstallAccess,
  buildSlackAuthorizeUrl,
  exchangeSlackOAuthCode,
  slackOAuthResponseToInstallation,
  testSlackAuth,
} from "./slack-oauth.js";
import { getTaskQueueStats } from "./task-queue-stats.js";
import type {
  PlatformAdapter,
  IntegrationsPluginOptions,
  IntegrationStatus,
  IntegrationExecutionContext,
} from "./types.js";
import {
  listIntegrationUsageBudgets,
  saveIntegrationUsageBudget,
} from "./usage-budget-store.js";
import { handleWebhook, processIntegrationTask } from "./webhook-handler.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

let a2aContinuationRetryInterval: ReturnType<typeof setInterval> | null = null;

function startA2AContinuationRetryJob(
  adapters: Map<string, PlatformAdapter>,
): void {
  if (a2aContinuationRetryInterval) return;
  const initialTimer = setTimeout(() => {
    processDueA2AContinuations({ adapters }).catch((err) => {
      console.error("[integrations] A2A continuation retry job failed:", err);
    });
  }, 10_000);
  unrefTimer(initialTimer);
  a2aContinuationRetryInterval = setInterval(() => {
    processDueA2AContinuations({ adapters }).catch((err) => {
      console.error("[integrations] A2A continuation retry job failed:", err);
    });
  }, 60_000);
  unrefTimer(a2aContinuationRetryInterval);
}

function unrefTimer(timer: ReturnType<typeof setInterval>): void {
  (timer as unknown as { unref?: () => void }).unref?.();
}

// ─── Google Pub/Sub OIDC verifier (for Drive changes.watch push) ────────────
// Cache Google's public keys for OIDC verification. jose handles TTL +
// refresh internally — same pattern as templates/mail/.../gmail/push.post.ts.
// Used to verify Google Pub/Sub push notifications carry a valid bearer token
// signed by a configured service account. Without this, the webhook is wide
// open to anonymous callers who can force a Drive sync (H7 in the audit).
const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

/**
 * Verify a Pub/Sub OIDC bearer token. Throws on any verification failure.
 * Requires GOOGLE_DOCS_PUSH_AUDIENCE and GOOGLE_DOCS_PUSH_SIGNER_EMAIL to be
 * set; if either is missing in production, the webhook handler refuses the
 * request entirely (so a misconfigured deployment fails closed, surfacing in
 * Pub/Sub's delivery metrics).
 */
async function verifyGoogleDocsPushToken(authHeader: string): Promise<void> {
  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("missing bearer token");
  }
  const token = authHeader.slice(7);
  const audience = process.env.GOOGLE_DOCS_PUSH_AUDIENCE;
  if (!audience) {
    throw new Error("GOOGLE_DOCS_PUSH_AUDIENCE not configured");
  }
  const { payload } = await jwtVerify(token, GOOGLE_JWKS, {
    issuer: GOOGLE_ISSUERS,
    audience,
  });
  if (payload.email_verified !== true) {
    throw new Error("email_verified claim is not true");
  }
  // Pin to a specific service account — without this, any Google-issued
  // token with the right audience could trigger a Drive sync.
  const expectedSigner = process.env.GOOGLE_DOCS_PUSH_SIGNER_EMAIL;
  if (!expectedSigner) {
    throw new Error("GOOGLE_DOCS_PUSH_SIGNER_EMAIL not configured");
  }
  if (payload.email !== expectedSigner) {
    throw new Error(`unexpected signer: ${String(payload.email)}`);
  }
}

/** Built-in adapters, instantiated lazily */
function getDefaultAdapters(): PlatformAdapter[] {
  return [
    slackAdapter(),
    telegramAdapter(),
    whatsappAdapter(),
    microsoftTeamsAdapter(),
    discordAdapter(),
    googleDocsAdapter(),
    emailAdapter(),
  ];
}

const INTEGRATION_SYSTEM_PROMPT = `You are an AI agent responding via a messaging platform integration (Slack, Microsoft Teams, Discord interactions, Telegram, WhatsApp, etc.).

You have the same capabilities as the web chat agent. Use your tools to help the user.

Keep responses concise — messaging platforms have character limits and users expect shorter replies than in a web interface. Use markdown sparingly (bold and lists are fine, but avoid complex formatting that may not render well on all platforms).

If a task requires many steps, summarize what you did rather than streaming every detail.`;

type RemoteCodeCommandEnvelope = {
  kind?: unknown;
  ownerEmail?: unknown;
  orgId?: unknown;
  command?: unknown;
  source?: unknown;
};

type IntegrationCredentialContext = {
  userEmail: string;
  orgId?: string;
  isIntegrationCaller?: boolean;
};

const REMOTE_DEVICE_ONLINE_MS = 90_000;

export async function enqueueRemoteCommand(
  envelope: RemoteCodeCommandEnvelope,
): Promise<Record<string, unknown>> {
  const ownerEmail = readString(envelope.ownerEmail);
  if (!ownerEmail) throw new Error("ownerEmail is required");
  const hasOrgId = Object.prototype.hasOwnProperty.call(envelope, "orgId");
  const orgId = hasOrgId ? (readString(envelope.orgId) ?? null) : undefined;
  const command = readObject(envelope.command);
  if (!command) throw new Error("command is required");
  const commandType = readString(command.type);
  const commands = await listRemoteCommandsForOwner({
    ownerEmail,
    ...(hasOrgId ? { orgId } : {}),
    limit: 50,
  });

  if (commandType === "list") {
    return {
      ok: true,
      runs: commands.map(remoteCommandToRunSummary).filter(Boolean),
      hostOnline: await hasOnlineRemoteDevice(ownerEmail, orgId),
    };
  }

  if (commandType === "status") {
    const runRef = readString(command.runRef);
    const run = runRef
      ? commands.map(remoteCommandToRunSummary).find((item) => {
          const candidate = item as Record<string, unknown>;
          return candidate.id === runRef || candidate.runId === runRef;
        })
      : undefined;
    const hostOnline = await hasOnlineRemoteDevice(ownerEmail, orgId);
    return {
      ok: true,
      hostOnline,
      hostStatus: hostOnline ? "online" : "offline",
      ...(run ? { run } : {}),
    };
  }

  const devices = await listRemoteDevicesForOwner({
    ownerEmail,
    ...(hasOrgId ? { orgId } : {}),
    status: "active",
    limit: 10,
  });
  const requestedDeviceId =
    readString(command.hostId) ?? readString(command.deviceId);
  const device =
    (requestedDeviceId
      ? devices.find((candidate) => candidate.id === requestedDeviceId)
      : undefined) ?? devices[0];
  if (!device) {
    return {
      ok: false,
      hostOnline: false,
      hostStatus: "offline",
      error: "No paired computer is available for code-agent commands.",
    };
  }

  const source = readObject(envelope.source);
  const kind = remoteCodeCommandKind(commandType);
  if (!kind) throw new Error(`Unsupported code-agent command: ${commandType}`);
  const row = await enqueueRemoteCommandRow({
    deviceId: device.id,
    ownerEmail,
    orgId: device.orgId ?? orgId ?? null,
    kind,
    params: remoteCodeCommandParams(command),
    platform: readString(source?.platform) ?? null,
    externalThreadId: readString(source?.externalThreadId) ?? null,
  });
  const hostOnline = isRemoteDeviceOnline(device);
  return {
    ok: true,
    commandId: row.id,
    requestId: row.id,
    hostOnline,
    hostStatus: hostOnline ? "online" : "offline",
    message:
      commandType === "create"
        ? hostOnline
          ? `Queued code run (${row.id}).`
          : `Queued code run (${row.id}). Your computer looks offline or asleep, so it will pick this up when it wakes.`
        : undefined,
  };
}

function remoteCodeCommandKind(
  commandType: string | undefined,
): RemoteCommandKind | null {
  switch (commandType) {
    case "create":
      return "create-run";
    case "continue":
      return "append-followup";
    case "approve":
      return "approve";
    case "deny":
      return "deny";
    case "stop":
      return "stop";
    default:
      return null;
  }
}

function remoteCodeCommandParams(
  command: Record<string, unknown>,
): Record<string, unknown> {
  const type = readString(command.type);
  if (type === "create") {
    return {
      prompt: readString(command.prompt) ?? "",
      title: readString(command.title),
      cwd: readString(command.cwd),
      goalId: readString(command.goalId) ?? "task",
      permissionMode: readString(command.permissionMode),
    };
  }
  if (type === "continue") {
    return {
      runId: readString(command.runRef) ?? readString(command.runId),
      prompt: readString(command.text) ?? readString(command.prompt),
      permissionMode: readString(command.permissionMode),
    };
  }
  if (type === "approve" || type === "deny") {
    const id = readString(command.approvalId) ?? readString(command.runId);
    return { runId: id, approvalId: id };
  }
  if (type === "stop") {
    return { runId: readString(command.runRef) ?? readString(command.runId) };
  }
  return {};
}

function enqueueBodyToRemoteCodeCommand(
  body: Record<string, unknown>,
): Record<string, unknown> | null {
  const direct = readObject(body.command);
  if (body.kind === "code-agent" && direct) return direct;

  const operation = readString(body.operation) ?? readString(body.type);
  const payload = readObject(body.payload) ?? body;
  if (!operation?.startsWith("code-agent.")) return null;

  if (operation === "code-agent.run.create") {
    return {
      type: "create",
      prompt: payload.prompt,
      title: payload.title,
      hostId: payload.hostId,
      deviceId: payload.deviceId,
      cwd: payload.cwd,
      goalId: payload.goalId,
      permissionMode: payload.permissionMode,
    };
  }
  if (operation === "code-agent.run.follow-up") {
    return {
      type: "continue",
      runRef: payload.runId,
      text: payload.prompt ?? payload.message,
      hostId: payload.hostId,
      deviceId: payload.deviceId,
      permissionMode: payload.permissionMode,
    };
  }
  if (operation === "code-agent.pending-command.decide") {
    return {
      type: payload.decision === "deny" ? "deny" : "approve",
      approvalId: payload.commandId ?? payload.runId,
      runId: payload.runId,
      hostId: payload.hostId,
      deviceId: payload.deviceId,
    };
  }
  if (operation === "code-agent.run.stop") {
    return {
      type: "stop",
      runRef: payload.runId,
      hostId: payload.hostId,
      deviceId: payload.deviceId,
    };
  }
  return null;
}

function remoteCommandToRunSummary(
  command: RemoteCommand,
): Record<string, unknown> | null {
  const result = readObject(command.result);
  const nestedResult = readObject(result?.result) ?? result;
  const run = readObject(nestedResult?.run);
  if (run) {
    return {
      ...run,
      commandId: command.id,
      hostId: command.deviceId,
      status: readString(run.status) ?? command.status,
      updatedAt: readString(run.updatedAt) ?? command.updatedAt,
    };
  }
  if (command.kind !== "create-run") return null;
  const params = readObject(command.params) ?? {};
  return {
    id: command.id,
    runId: command.id,
    hostId: command.deviceId,
    title:
      readString(params.title) ?? readString(params.prompt) ?? "Queued run",
    prompt: readString(params.prompt),
    status: command.status === "failed" ? "errored" : "queued",
    createdAt: command.createdAt,
    updatedAt: command.updatedAt,
    metadata: { remoteCommandId: command.id },
  };
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRemoteDeviceOnline(device: { lastSeenAt: number | null }): boolean {
  return typeof device.lastSeenAt === "number"
    ? Date.now() - device.lastSeenAt <= REMOTE_DEVICE_ONLINE_MS
    : false;
}

async function hasOnlineRemoteDevice(
  ownerEmail: string,
  orgId: string | null | undefined,
): Promise<boolean> {
  const hasOrgId = orgId !== undefined;
  const devices = await listRemoteDevicesForOwner({
    ownerEmail,
    ...(hasOrgId ? { orgId } : {}),
    status: "active",
    limit: 10,
  });
  return devices.some(isRemoteDeviceOnline);
}

function remoteDeviceToHost(device: RemoteDevice): Record<string, unknown> {
  const online = device.status === "active" && isRemoteDeviceOnline(device);
  return {
    id: device.id,
    name: device.label,
    label: device.label,
    status:
      device.status === "active" ? (online ? "online" : "offline") : "revoked",
    lastSeenAt: device.lastSeenAt
      ? new Date(device.lastSeenAt).toISOString()
      : undefined,
    platform: device.platform ?? "desktop",
    appVersion: device.appVersion ?? undefined,
    hostName: device.hostName ?? undefined,
    metadata: device.metadata ?? undefined,
    device: toPublicRemoteDevice(device),
  };
}

function mountedPathParts(event: any, mountSuffix: string): string[] {
  const rawPath = String(
    event.path ?? event.url?.pathname ?? event.node?.req?.url ?? "/",
  ).split("?")[0];
  const normalized = rawPath.replace(/^\/+/, "");
  const marker = mountSuffix.replace(/^\/+/, "");
  const markerIndex = normalized.indexOf(marker);
  const suffix =
    markerIndex >= 0
      ? normalized.slice(markerIndex + marker.length)
      : normalized;
  return suffix
    .split("/")
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));
}

function remoteCommandPushPayload(
  command: RemoteCommand,
): Record<string, unknown> {
  const result = readObject(command.result);
  const status = command.status;
  const title =
    status === "completed"
      ? "Remote run completed"
      : status === "failed"
        ? "Remote run failed"
        : "Remote run updated";
  return {
    title,
    body: command.errorMessage ?? readString(result?.message),
    commandId: command.id,
    hostId: command.deviceId,
    kind: command.kind,
    status,
    result: command.result,
    updatedAt: command.updatedAt,
  };
}

/**
 * Creates a Nitro plugin that mounts messaging platform integration webhook routes.
 *
 * Routes:
 *   POST   /_agent-native/integrations/:platform/webhook  — receive platform webhooks
 *   GET    /_agent-native/integrations/status              — all integrations status
 *   GET    /_agent-native/integrations/:platform/status    — single platform status
 *   POST   /_agent-native/integrations/:platform/enable    — enable integration
 *   POST   /_agent-native/integrations/:platform/disable   — disable integration
 *   POST   /_agent-native/integrations/:platform/setup     — platform-specific setup
 */
export function createIntegrationsPlugin(
  options?: IntegrationsPluginOptions,
): NitroPluginDef {
  return async (nitroApp: any) => {
    markDefaultPluginProvided(nitroApp, "integrations");
    const adapters = options?.adapters ?? getDefaultAdapters();
    const adapterMap = new Map<string, PlatformAdapter>();
    for (const adapter of adapters) {
      adapterMap.set(adapter.platform, adapter);
    }

    const model = options?.model;
    // Read the API key at REQUEST time, not plugin-init time. On Netlify
    // Lambda the plugin module loads in a context where env vars from the
    // site's runtime config may not yet be populated, so capturing at
    // init can leave us with an empty string forever. The getter
    // re-resolves on every webhook so freshly-set secrets work without
    // a redeploy.
    const getApiKey = () => options?.apiKey ?? "";

    // Build the system prompt
    const baseSystemPrompt = options?.systemPrompt ?? INTEGRATION_SYSTEM_PROMPT;

    // Resolve actions — auto-include call-agent so the integration agent can
    // delegate to other A2A apps, matching the behavior of the agent-chat plugin.
    const localActions = options?.actions ?? {};
    let callAgentEntry: Record<string, unknown> = {};
    try {
      const mod = await import("../scripts/call-agent.js");
      callAgentEntry = {
        "call-agent": {
          tool: mod.tool,
          run: (args: Record<string, string>, context: unknown) =>
            mod.run(args, context as any, options?.appId),
        },
      };
    } catch {
      // call-agent script not available — skip
    }
    const actions = {
      ...integrationMemoryActions(),
      ...localActions,
      ...callAgentEntry,
    } as typeof localActions;
    // Keep the app's own actions visible on the first request to the model;
    // defer the framework additions merged in above (integration memory,
    // call-agent) behind the tool-search entry `handleWebhook` /
    // `startGoogleDocsPoller` attach to `actions`. The run loop's mid-run
    // tool expansion still lets the model discover and call them after a
    // search — see `filterInitialEngineTools` / `expandActiveTools`.
    const initialToolNames = Object.keys(localActions);

    const h3 = getH3App(nitroApp);
    const P = `${FRAMEWORK_ROUTE_PREFIX}/integrations`;

    async function requireSession(event: any): Promise<boolean> {
      const session = await getSession(event).catch(() => null);
      if (session?.email) return true;
      setResponseStatus(event, 401);
      return false;
    }

    async function requireSessionContext(
      event: any,
    ): Promise<{ ownerEmail: string; orgId: string | null } | null> {
      const session = await getSession(event).catch(() => null);
      if (!session?.email) {
        setResponseStatus(event, 401);
        return null;
      }
      const orgCtx = await getOrgContext(event).catch(() => null);
      return {
        ownerEmail: session.email,
        orgId: orgCtx?.orgId ?? session.orgId ?? null,
      };
    }

    function toCredentialContext(
      ctx: { ownerEmail: string; orgId: string | null },
      opts?: { isIntegrationCaller?: boolean },
    ): IntegrationCredentialContext {
      return {
        userEmail: ctx.ownerEmail,
        ...(ctx.orgId ? { orgId: ctx.orgId } : {}),
        ...(opts?.isIntegrationCaller ? { isIntegrationCaller: true } : {}),
      };
    }

    async function credentialContextForIntegrationConfig(
      config: Awaited<ReturnType<typeof getIntegrationConfig>>,
    ): Promise<IntegrationCredentialContext | null> {
      const ownerEmail =
        typeof config?.owner === "string" ? config.owner.trim() : "";
      if (!ownerEmail) return null;
      const orgId = await resolveOrgIdForEmail(ownerEmail).catch(() => null);
      return {
        userEmail: ownerEmail,
        ...(orgId ? { orgId } : {}),
        isIntegrationCaller: true,
      };
    }

    async function withCredentialContext<T>(
      context: IntegrationCredentialContext | null,
      fn: () => Promise<T>,
    ): Promise<T> {
      if (!context) return fn();
      return runWithRequestContext(context, fn);
    }

    async function requireRemoteDevice(event: any) {
      const token = extractBearerToken(
        getRequestHeader(event, "authorization"),
      );
      const device = await authenticateRemoteDeviceToken(token);
      if (device) return device;
      setResponseStatus(event, 401);
      return null;
    }

    /**
     * Gate destructive integration writes (enable/disable, setup,
     * setIntegrationConfig…) behind an org-owner/admin check.
     *
     * `integration_configs` is keyed `(platform, config_key)` with no
     * owner column in the PRIMARY KEY — so this row is effectively
     * deployment-wide. Any signed-in user toggling /enable or /disable
     * would otherwise affect every other user (a regular org member could
     * disable Slack/email org-wide, write a malicious allowlist for
     * inbound email, etc.). This check enforces that only owners and
     * admins of the user's active org may mutate integration config.
     *
     * Solo / no-org sessions (i.e. ctx.orgId == null) are allowed — that's
     * the local-dev / single-user case where there's no privilege gradient
     * to enforce. The deployment is single-tenant by definition there.
     *
     * Returns an `{ ok: true }` on pass, or `{ ok: false, error }` with the
     * status already set on the event. The error string lines up with the
     * status code (401 → "unauthorized"; 403 → admin-required message).
     */
    async function checkOrgAdmin(
      event: any,
    ): Promise<{ ok: true } | { ok: false; error: string }> {
      const session = await getSession(event).catch(() => null);
      if (!session?.email) {
        setResponseStatus(event, 401);
        return { ok: false, error: "unauthorized" };
      }
      const ctx = await getOrgContext(event).catch(() => null);
      // Solo (no org membership) — single-tenant flow, allow.
      if (!ctx?.orgId) return { ok: true };
      if (ctx.role === "owner" || ctx.role === "admin") return { ok: true };
      setResponseStatus(event, 403);
      return {
        ok: false,
        error:
          "Only organization owners and admins can mutate integration config",
      };
    }

    // ─── Status endpoint (all integrations) ───────────────────────
    h3.use(
      `${P}/status`,
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const baseUrl = getBaseUrl(event);
        const ctx = await requireSessionContext(event);
        if (!ctx) return { error: "unauthorized" };
        const credentialContext = toCredentialContext(ctx);
        const statuses: IntegrationStatus[] = [];
        for (const adapter of adapters) {
          const status = await withCredentialContext(credentialContext, () =>
            adapter.getStatus(baseUrl),
          );
          const config = await getIntegrationConfig(adapter.platform);
          status.enabled = !!config?.configData?.enabled;
          status.webhookUrl = `${baseUrl}${P}/${adapter.platform}/webhook`;
          if (!status.requiredEnvKeys) {
            try {
              status.requiredEnvKeys = adapter.getRequiredEnvKeys();
            } catch {
              status.requiredEnvKeys = [];
            }
          }
          statuses.push(status);
        }
        return statuses;
      }),
    );

    // ─── Task queue status (observability) ───────────────────────
    // GET /_agent-native/integrations/task-queue/status
    // Returns counts + recent failures for the integration_pending_tasks
    // queue. Requires a normal session — this exposes operational data, not
    // platform secrets. If the queue table doesn't exist yet (no inbound
    // webhook has been processed), returns zeroed stats rather than 500.
    h3.use(
      `${P}/task-queue/status`,
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        if (!(await requireSession(event))) return { error: "unauthorized" };
        try {
          return await getTaskQueueStats();
        } catch (err: any) {
          setResponseStatus(event, 500);
          return { error: err?.message ?? String(err) };
        }
      }),
    );

    // ─── Remote relay endpoints ──────────────────────────────────
    // These routes allow a signed-in browser session to enqueue work for a
    // registered remote device, and the device to claim/complete that work
    // using its one-time-issued bearer token. State lives entirely in SQL so
    // long polling can safely degrade to short polling on serverless hosts.
    h3.use(
      `${P}/remote/register`,
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "POST") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const ctx = await requireSessionContext(event);
        if (!ctx) return { error: "unauthorized" };
        const body = (await readBody(event)) as {
          label?: unknown;
          platform?: unknown;
          appVersion?: unknown;
          version?: unknown;
          hostName?: unknown;
          hostname?: unknown;
          metadata?: unknown;
        };
        const label =
          typeof body.label === "string" && body.label.trim()
            ? body.label.trim().slice(0, 200)
            : "Remote device";
        const { device, token } = await createRemoteDevice({
          ownerEmail: ctx.ownerEmail,
          orgId: ctx.orgId,
          label,
          platform: readString(body.platform),
          appVersion: readString(body.appVersion) ?? readString(body.version),
          hostName: readString(body.hostName) ?? readString(body.hostname),
          metadata: readObject(body.metadata),
        });
        return { device: toPublicRemoteDevice(device), token };
      }),
    );

    h3.use(
      `${P}/remote/hosts`,
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const ctx = await requireSessionContext(event);
        if (!ctx) return { error: "unauthorized" };
        const devices = await listRemoteDevicesForOwner({
          ownerEmail: ctx.ownerEmail,
          orgId: ctx.orgId,
          limit: 50,
        });
        const hosts = devices.map(remoteDeviceToHost);
        const parts = mountedPathParts(event, "remote/hosts");
        if (parts[0]) {
          const host = hosts.find((candidate) => candidate.id === parts[0]);
          if (!host) {
            setResponseStatus(event, 404);
            return { error: "host not found" };
          }
          return { host, device: host.device };
        }
        return { hosts, devices: hosts };
      }),
    );

    h3.use(
      `${P}/remote/devices`,
      defineEventHandler(async (event) => {
        const method = getMethod(event);
        if (method !== "GET" && method !== "DELETE" && method !== "POST") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const ctx = await requireSessionContext(event);
        if (!ctx) return { error: "unauthorized" };
        const parts = mountedPathParts(event, "remote/devices");

        if (method === "GET") {
          if (!parts[0]) {
            const devices = await listRemoteDevicesForOwner({
              ownerEmail: ctx.ownerEmail,
              orgId: ctx.orgId,
              limit: 100,
            });
            return {
              devices: devices.map(toPublicRemoteDevice),
              hosts: devices.map(remoteDeviceToHost),
            };
          }
          const device = await getRemoteDeviceForOwner({
            id: parts[0],
            ownerEmail: ctx.ownerEmail,
            orgId: ctx.orgId,
          });
          if (!device) {
            setResponseStatus(event, 404);
            return { error: "device not found" };
          }
          return {
            device: toPublicRemoteDevice(device),
            host: remoteDeviceToHost(device),
          };
        }

        const id = parts[0];
        const action = parts[1];
        if (!id || (method === "POST" && action !== "revoke")) {
          setResponseStatus(event, 404);
          return { error: "not found" };
        }
        const device = await revokeRemoteDeviceForOwner({
          id,
          ownerEmail: ctx.ownerEmail,
          orgId: ctx.orgId,
        });
        if (!device) {
          setResponseStatus(event, 404);
          return { error: "device not found" };
        }
        return { ok: true, device: toPublicRemoteDevice(device) };
      }),
    );

    h3.use(
      `${P}/remote/unregister`,
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "POST" && getMethod(event) !== "DELETE") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const device = await requireRemoteDevice(event);
        if (!device) return { error: "unauthorized" };
        await unregisterRemoteDevice(device.id);
        return { ok: true, deviceId: device.id };
      }),
    );

    h3.use(
      `${P}/remote/heartbeat`,
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "POST") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const device = await requireRemoteDevice(event);
        if (!device) return { error: "unauthorized" };
        const body = (await readBody(event)) as Record<string, unknown>;
        const updated = await updateRemoteDeviceDetails({
          id: device.id,
          label: readString(body.label),
          platform: readString(body.platform),
          appVersion: readString(body.appVersion) ?? readString(body.version),
          hostName: readString(body.hostName) ?? readString(body.hostname),
          metadata: readObject(body.metadata),
        });
        return {
          ok: true,
          device: updated ? toPublicRemoteDevice(updated) : null,
        };
      }),
    );

    h3.use(
      `${P}/remote/push/register`,
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "POST") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const ctx = await requireSessionContext(event);
        if (!ctx) return { error: "unauthorized" };
        const body = (await readBody(event)) as Record<string, unknown>;
        const token = readString(body.token);
        if (!token) {
          setResponseStatus(event, 400);
          return { error: "token required" };
        }
        const registration = await upsertRemotePushRegistration({
          ownerEmail: ctx.ownerEmail,
          orgId: ctx.orgId,
          provider: readString(body.provider) ?? "unknown",
          token,
          platform: readString(body.platform),
          clientDeviceId:
            readString(body.clientDeviceId) ?? readString(body.deviceId),
          label: readString(body.label),
        });
        return {
          registration: toPublicRemotePushRegistration(registration),
        };
      }),
    );

    h3.use(
      `${P}/remote/push/registrations`,
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const ctx = await requireSessionContext(event);
        if (!ctx) return { error: "unauthorized" };
        const registrations = await listRemotePushRegistrationsForOwner({
          ownerEmail: ctx.ownerEmail,
          orgId: ctx.orgId,
          includeInactive: getQuery(event).includeInactive === "true",
          limit: 100,
        });
        return {
          registrations: registrations.map(toPublicRemotePushRegistration),
        };
      }),
    );

    h3.use(
      `${P}/remote/push/unregister`,
      defineEventHandler(async (event) => {
        const method = getMethod(event);
        if (method !== "POST" && method !== "DELETE") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const ctx = await requireSessionContext(event);
        if (!ctx) return { error: "unauthorized" };
        const body = (await readBody(event)) as Record<string, unknown>;
        const removed = await unregisterRemotePushRegistrationForOwner({
          ownerEmail: ctx.ownerEmail,
          orgId: ctx.orgId,
          id: readString(body.id) ?? readString(body.registrationId),
          token: readString(body.token),
        });
        if (!removed) {
          setResponseStatus(event, 404);
          return { error: "registration not found" };
        }
        return { ok: true };
      }),
    );

    h3.use(
      `${P}/remote/push/notifications`,
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const ctx = await requireSessionContext(event);
        if (!ctx) return { error: "unauthorized" };
        const query = getQuery(event);
        const status =
          query.status === "delivered" ||
          query.status === "failed" ||
          query.status === "pending"
            ? query.status
            : undefined;
        const notifications = await listRemotePushNotificationsForOwner({
          ownerEmail: ctx.ownerEmail,
          orgId: ctx.orgId,
          status,
          limit: Number(query.limit ?? 50) || 50,
        });
        return { notifications };
      }),
    );

    h3.use(
      `${P}/remote/runs`,
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const ctx = await requireSessionContext(event);
        if (!ctx) return { error: "unauthorized" };
        const parts = mountedPathParts(event, "remote/runs");
        const commands = await listRemoteCommandsForOwner({
          ownerEmail: ctx.ownerEmail,
          orgId: ctx.orgId,
          limit: 100,
        });

        if (parts.length === 0) {
          return {
            runs: commands.map(remoteCommandToRunSummary).filter(Boolean),
          };
        }

        const runId = decodeURIComponent(parts[0] ?? "");
        const match = commands.find((command) => {
          const run = remoteCommandToRunSummary(command);
          return (
            command.id === runId || run?.id === runId || run?.runId === runId
          );
        });
        if (!match) {
          setResponseStatus(event, 404);
          return { error: "run not found" };
        }
        const run = remoteCommandToRunSummary(match);

        if (parts[1] === "transcript") {
          const remoteRunId =
            readString(run?.runId) ??
            readString(run?.id) ??
            readString(match.id);
          const events = remoteRunId
            ? await listRemoteRunEvents({
                deviceId: match.deviceId,
                remoteRunId,
                limit: 1000,
              })
            : [];
          return {
            run,
            events: events.map((event) => event.event),
          };
        }

        if (parts.length === 1) return { run };
        setResponseStatus(event, 404);
        return { error: "not found" };
      }),
    );

    h3.use(
      `${P}/remote/computer/approvals`,
      defineEventHandler(async (event) => {
        const method = getMethod(event);
        if (method !== "GET" && method !== "POST") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const ctx = await requireSessionContext(event);
        if (!ctx) return { error: "unauthorized" };
        const parts = mountedPathParts(event, "remote/computer/approvals");
        if (method === "GET") {
          if (parts.length > 0) {
            setResponseStatus(event, 404);
            return { error: "not found" };
          }
          const query = getQuery(event);
          const status = readComputerApprovalStatus(query.status);
          return {
            approvals: await listComputerApprovalsForOwner({
              ownerEmail: ctx.ownerEmail,
              orgId: ctx.orgId,
              deviceId: readString(query.deviceId),
              taskId: readString(query.taskId),
              runId: readString(query.runId),
              status,
              limit: Number(query.limit ?? 100) || 100,
            }),
          };
        }
        const body = (await readBody(event)) as Record<string, unknown>;
        if (parts[0] && parts[1] === "decision" && parts.length === 2) {
          const decision =
            body.decision === "approved" || body.decision === "denied"
              ? body.decision
              : null;
          const actionHash = readString(body.actionHash);
          if (!decision || !actionHash) {
            setResponseStatus(event, 400);
            return { error: "decision and actionHash required" };
          }
          const approval = await decideComputerApproval({
            id: decodeURIComponent(parts[0]),
            ownerEmail: ctx.ownerEmail,
            orgId: ctx.orgId,
            actionHash,
            decision,
            decidedBy: ctx.ownerEmail,
            result: readObject(body.result),
          });
          if (!approval) {
            setResponseStatus(event, 404);
            return { error: "approval not found or no longer pending" };
          }
          return { approval };
        }
        if (parts.length > 0) {
          setResponseStatus(event, 404);
          return { error: "not found" };
        }
        const deviceId = readString(body.deviceId);
        if (!deviceId || !body.envelope) {
          setResponseStatus(event, 400);
          return { error: "deviceId and envelope required" };
        }
        try {
          const approval = await createComputerApprovalRequest({
            ownerEmail: ctx.ownerEmail,
            orgId: ctx.orgId,
            deviceId,
            envelope: body.envelope as ComputerCommandEnvelope,
          });
          return { approval };
        } catch (error) {
          return computerSupervisionRouteError(event, error);
        }
      }),
    );

    h3.use(
      `${P}/remote/computer/commands`,
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "POST") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const ctx = await requireSessionContext(event);
        if (!ctx) return { error: "unauthorized" };
        const body = (await readBody(event)) as Record<string, unknown>;
        const deviceId = readString(body.deviceId);
        if (!deviceId || !body.envelope) {
          setResponseStatus(event, 400);
          return { error: "deviceId and envelope required" };
        }
        try {
          const command = await enqueueComputerCommand({
            deviceId,
            ownerEmail: ctx.ownerEmail,
            orgId: ctx.orgId,
            envelope: body.envelope as ComputerCommandEnvelope,
            platform: readString(body.platform),
          });
          return { command };
        } catch (error) {
          return computerSupervisionRouteError(event, error);
        }
      }),
    );

    h3.use(
      `${P}/remote/enqueue`,
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "POST") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const ctx = await requireSessionContext(event);
        if (!ctx) return { error: "unauthorized" };
        const body = (await readBody(event)) as {
          deviceId?: unknown;
          kind?: unknown;
          params?: unknown;
          platform?: unknown;
          externalThreadId?: unknown;
          operation?: unknown;
          payload?: unknown;
          command?: unknown;
          source?: unknown;
        };
        const highLevel = enqueueBodyToRemoteCodeCommand(body);
        if (highLevel) {
          return enqueueRemoteCommand({
            kind: "code-agent",
            ownerEmail: ctx.ownerEmail,
            orgId: ctx.orgId ?? undefined,
            command: highLevel,
            source: body.source ?? {
              platform:
                typeof body.platform === "string" ? body.platform : "mobile",
              externalThreadId:
                typeof body.externalThreadId === "string"
                  ? body.externalThreadId
                  : "mobile",
            },
          });
        }
        if (typeof body.deviceId !== "string" || !body.deviceId.trim()) {
          setResponseStatus(event, 400);
          return { error: "deviceId required" };
        }
        if (!isRemoteCommandKind(body.kind)) {
          setResponseStatus(event, 400);
          return { error: "invalid command kind" };
        }
        const device = await getRemoteDeviceForOwner({
          id: body.deviceId,
          ownerEmail: ctx.ownerEmail,
          orgId: ctx.orgId,
        });
        if (!device) {
          setResponseStatus(event, 404);
          return { error: "device not found" };
        }
        if (device.status !== "active") {
          setResponseStatus(event, 410);
          return { error: "device revoked" };
        }
        const command = await enqueueRemoteCommandRow({
          deviceId: device.id,
          ownerEmail: ctx.ownerEmail,
          orgId: ctx.orgId,
          kind: body.kind,
          params: body.params ?? {},
          platform: typeof body.platform === "string" ? body.platform : null,
          externalThreadId:
            typeof body.externalThreadId === "string"
              ? body.externalThreadId
              : null,
        });
        return { command };
      }),
    );

    h3.use(
      `${P}/remote/poll`,
      defineEventHandler(async (event) => {
        const method = getMethod(event);
        if (method !== "POST" && method !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const device = await requireRemoteDevice(event);
        if (!device) return { error: "unauthorized" };
        const query = getQuery(event);
        const body =
          method === "POST"
            ? ((await readBody(event)) as {
                waitMs?: unknown;
                computerCapabilities?: unknown;
              })
            : {};
        let pollingDevice = device;
        if (
          method === "POST" &&
          Object.prototype.hasOwnProperty.call(body, "computerCapabilities")
        ) {
          const computerCapabilities = readComputerCapabilities(
            body.computerCapabilities,
          );
          const updated = await updateRemoteDeviceDetails({
            id: device.id,
            metadata: {
              ...(device.metadata ?? {}),
              computerCapabilities,
            },
          });
          if (updated) pollingDevice = updated;
        }
        const requestedWait =
          Number(body.waitMs ?? query.waitMs ?? query.wait_ms ?? 25_000) || 0;
        const waitMs = Math.max(0, Math.min(25_000, requestedWait));
        const deadline = Date.now() + waitMs;

        while (true) {
          const operationClasses =
            advertisedComputerOperationClasses(pollingDevice);
          const computerCommand =
            operationClasses.length > 0
              ? await claimNextComputerCommand({
                  deviceId: pollingDevice.id,
                  ownerEmail: pollingDevice.ownerEmail,
                  orgId: pollingDevice.orgId,
                  operationClasses,
                })
              : null;
          const command =
            computerCommand ?? (await claimNextRemoteCommand(pollingDevice.id));
          if (command) return { command };
          const remaining = deadline - Date.now();
          if (remaining <= 0) return { command: null };
          await sleep(Math.min(1000, remaining));
        }
      }),
    );

    h3.use(
      `${P}/remote/result`,
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "POST") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const device = await requireRemoteDevice(event);
        if (!device) return { error: "unauthorized" };
        const body = (await readBody(event)) as {
          commandId?: unknown;
          status?: unknown;
          result?: unknown;
          errorMessage?: unknown;
        };
        if (typeof body.commandId !== "string" || !body.commandId.trim()) {
          setResponseStatus(event, 400);
          return { error: "commandId required" };
        }
        if (
          body.status !== "running" &&
          body.status !== "completed" &&
          body.status !== "failed"
        ) {
          setResponseStatus(event, 400);
          return { error: "invalid command status" };
        }
        const command = await updateRemoteCommandResult({
          deviceId: device.id,
          commandId: body.commandId,
          status: body.status,
          result: body.result,
          errorMessage:
            typeof body.errorMessage === "string" ? body.errorMessage : null,
        });
        if (!command) {
          setResponseStatus(event, 404);
          return { error: "command not found" };
        }
        if (command.status === "completed" || command.status === "failed") {
          await queueRemotePushNotifications({
            ownerEmail: device.ownerEmail,
            orgId: device.orgId,
            payload: remoteCommandPushPayload(command),
          }).catch((err) => {
            console.error("[integrations] remote push queue failed:", err);
          });
        }
        return { command };
      }),
    );

    h3.use(
      `${P}/remote/run-events`,
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "POST") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const device = await requireRemoteDevice(event);
        if (!device) return { error: "unauthorized" };
        const body = (await readBody(event)) as {
          remoteRunId?: unknown;
          runId?: unknown;
          events?: unknown;
        };
        const remoteRunId =
          typeof body.remoteRunId === "string" && body.remoteRunId.trim()
            ? body.remoteRunId.trim()
            : typeof body.runId === "string" && body.runId.trim()
              ? body.runId.trim()
              : "";
        if (!remoteRunId) {
          setResponseStatus(event, 400);
          return { error: "remoteRunId required" };
        }
        if (!Array.isArray(body.events)) {
          setResponseStatus(event, 400);
          return { error: "events required" };
        }
        const events = body.events
          .slice(0, 1000)
          .map((entry, index) => {
            const value = entry as { seq?: unknown; event?: unknown };
            const rawEvent =
              value && typeof value === "object" && "event" in value
                ? value.event
                : entry;
            return {
              seq:
                value && typeof value === "object" && "seq" in value
                  ? Number(value.seq)
                  : index,
              event: rawEvent ?? null,
            };
          })
          .filter((entry) => Number.isInteger(entry.seq) && entry.seq >= 0);
        if (events.length !== body.events.length) {
          setResponseStatus(event, 400);
          return { error: "invalid event sequence" };
        }
        const result = await insertRemoteRunEvents({
          deviceId: device.id,
          remoteRunId,
          events,
        });
        return { ok: true, ...result };
      }),
    );

    // ─── Process pending task (cross-platform task queue) ────────
    // POST /_agent-native/integrations/process-task
    // Internal endpoint invoked via fire-and-forget self-webhook from the
    // public webhook handler. Auth: HMAC bearer signed with A2A_SECRET.
    // Each invocation runs the agent loop in a fresh function execution.
    h3.use(
      `${P}/process-task`,
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "POST") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }

        const body = (await readBody(event)) as { taskId?: string };
        const taskId = body?.taskId;
        if (!taskId) {
          setResponseStatus(event, 400);
          return { error: "taskId required" };
        }

        // Auth: HMAC token bound to the task id.
        //
        // In production we MUST require A2A_SECRET — a publicly-callable
        // process-task endpoint lets attackers re-trigger any queued task
        // by guessing or sniffing its id (C3 in the webhook security audit).
        // The atomic SQL claim only prevents *double*-processing, not the
        // first attacker-driven processing.
        //
        // In dev we keep the loose posture so contributors don't have to
        // configure A2A_SECRET to play with the integration locally.
        if (!process.env.A2A_SECRET) {
          if (process.env.NODE_ENV === "production") {
            setResponseStatus(event, 503);
            return {
              error:
                "A2A_SECRET not configured — internal token signing is required to process integration tasks in production.",
            };
          }
          // Dev: fall through unsigned (the atomic claim still gates double-processing).
        } else {
          const tok = extractBearerToken(
            getRequestHeader(event, "authorization"),
          );
          if (!tok || !verifyInternalToken(taskId, tok)) {
            setResponseStatus(event, 401);
            return { error: "Invalid or expired internal token" };
          }
        }

        // Atomic claim: only one invocation gets to process this task
        const task = await claimPendingTask(taskId);
        if (!task) {
          setResponseStatus(event, 200);
          return { ok: true, skipped: "already-claimed-or-missing" };
        }

        try {
          const adapter = adapterMap.get(task.platform);
          if (!adapter) {
            await markTaskFailed(taskId, `Unknown platform: ${task.platform}`);
            setResponseStatus(event, 404);
            return { error: "Unknown platform" };
          }
          await runWithRequestContext(
            {
              userEmail: task.ownerEmail,
              ...(task.orgId ? { orgId: task.orgId } : {}),
              isIntegrationCaller: true,
            },
            async () => {
              const resources = await loadResourcesForPrompt(
                task.ownerEmail,
                true,
                options?.appId,
                task.orgId,
              );
              await processIntegrationTask(task, {
                adapter,
                systemPrompt: baseSystemPrompt + resources,
                actions,
                initialToolNames,
                model,
                apiKey: getApiKey(),
                engine: options?.engine,
                ownerEmail: task.ownerEmail,
                appId: options?.appId,
              });
            },
          );
          await markTaskCompleted(taskId);
          const nextTaskId = await getNextPendingTaskIdForThread(
            task.platform,
            task.externalThreadId,
          );
          if (nextTaskId) {
            const nextToken = signInternalToken(nextTaskId);
            void fetch(`${getBaseUrl(event)}${P}/process-task`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(nextToken ? { Authorization: `Bearer ${nextToken}` } : {}),
              },
              body: JSON.stringify({ taskId: nextTaskId }),
            }).catch((err) => {
              console.error(
                "[integrations] Failed to dispatch queued thread turn:",
                err,
              );
            });
          }
          await processDueA2AContinuations({
            adapters: adapterMap,
            limit: 2,
          }).catch((err) => {
            console.error(
              "[integrations] A2A continuation opportunistic sweep failed:",
              err,
            );
          });
          return { ok: true, taskId };
        } catch (err: any) {
          const errorMessage = err?.message
            ? String(err.message).slice(0, 1000)
            : "processor failed";
          if (task.attempts >= MAX_PENDING_TASK_ATTEMPTS) {
            await markTaskFailed(taskId, errorMessage);
          } else {
            await markTaskRetryable(taskId, errorMessage);
          }
          // Log the detail server-side; never return the raw error message
          // to the caller. Raw messages have leaked DB error codes, schema
          // names, and stack hints in the past (L3 in the webhook security
          // audit). Sentry / log providers still see the full error.
          console.error("[integrations] process-task failure:", err);
          setResponseStatus(event, 500);
          return { error: "Internal task failed" };
        }
      }),
    );

    // ─── Process deferred A2A continuation ──────────────────────────
    // POST /_agent-native/integrations/process-a2a-continuation
    // Internal endpoint invoked when call-agent timed out inside an
    // integration processor but the remote A2A task kept running.
    h3.use(
      `${P}/process-a2a-continuation`,
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "POST") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }

        const body = (await readBody(event)) as { continuationId?: string };
        const continuationId = body?.continuationId;
        if (!continuationId) {
          setResponseStatus(event, 400);
          return { error: "continuationId required" };
        }

        if (!process.env.A2A_SECRET) {
          if (process.env.NODE_ENV === "production") {
            setResponseStatus(event, 503);
            return {
              error:
                "A2A_SECRET not configured — internal token signing is required to process A2A continuations in production.",
            };
          }
        } else {
          const tok = extractBearerToken(
            getRequestHeader(event, "authorization"),
          );
          if (!tok || !verifyInternalToken(continuationId, tok)) {
            setResponseStatus(event, 401);
            return { error: "Invalid or expired internal token" };
          }
        }

        try {
          await processA2AContinuationById(continuationId, {
            adapters: adapterMap,
          });
        } catch (err: any) {
          // Mark the continuation failed so it isn't left dangling, and surface
          // a 500 to the caller instead of leaking an unhandled rejection.
          await failA2AContinuation(
            continuationId,
            err?.message?.slice(0, 500) || "continuation processing failed",
          ).catch(() => {});
          console.error(
            "[integrations] process-a2a-continuation failure:",
            err,
          );
          setResponseStatus(event, 500);
          return { error: "Failed to process A2A continuation" };
        }
        return { ok: true, continuationId };
      }),
    );

    // ─── Slack native action controls ─────────────────────────────
    h3.use(
      `${P}/slack/interactions`,
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "POST") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const adapter = adapterMap.get("slack");
        if (!adapter) {
          setResponseStatus(event, 404);
          return "ok";
        }
        // handleVerification caches the exact raw form bytes even though the
        // body is not JSON; verifyWebhook then validates Slack's HMAC before
        // any action value is parsed.
        await adapter.handleVerification(event);
        if (!(await adapter.verifyWebhook(event))) {
          setResponseStatus(event, 401);
          return { error: "Invalid webhook signature" };
        }
        try {
          const raw = String(event.context?.__rawBody ?? "");
          const encoded = new URLSearchParams(raw).get("payload");
          const payload = encoded ? JSON.parse(encoded) : null;
          const action = payload?.actions?.[0];
          const actionKind =
            action?.action_id === "agent_native_approve"
              ? "approve"
              : action?.action_id === "agent_native_deny"
                ? "deny"
                : action?.action_id === "agent_native_cancel"
                  ? "cancel"
                  : null;
          if (!actionKind || typeof action?.value !== "string") return "ok";
          const requesterId = payload?.user?.id;
          const teamId = payload?.team?.id ?? payload?.user?.team_id;
          const channelId =
            payload?.channel?.id ?? payload?.container?.channel_id;
          const messageTs = payload?.container?.message_ts;
          if (!requesterId || !teamId || !channelId || !messageTs) {
            return "ok";
          }
          const control = await claimIntegrationControl({
            id: action.value,
            action: actionKind,
            requesterId,
            teamId,
            apiAppId:
              typeof payload?.api_app_id === "string" ? payload.api_app_id : "",
            channelId,
            messageTs,
          });
          if (!control) return "ok";
          if (actionKind === "cancel") {
            if (control.runId) abortRun(control.runId, "slack_cancel");
            return "ok";
          }
          if (actionKind === "deny") return "ok";
          if (!control.approvalKey) return "ok";

          const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const incoming = {
            ...control.incoming,
            text: "The requester approved the pending action. Continue the task.",
            approvedToolCalls: [control.approvalKey],
            timestamp: Date.now(),
            platformContext: {
              ...control.incoming.platformContext,
              eventId: `control:${control.id}`,
            },
          };
          await insertPendingTask({
            id: taskId,
            platform: incoming.platform,
            externalThreadId: incoming.externalThreadId,
            payload: JSON.stringify({ incoming }),
            ownerEmail: control.ownerEmail,
            orgId: control.orgId,
            externalEventKey: `control:${control.id}`,
          });
          const processUrl = `${getBaseUrl(event)}${P}/process-task`;
          const token = signInternalToken(taskId);
          void fetch(processUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ taskId }),
          }).catch((err) => {
            console.error("[slack] Approval dispatch failed:", err);
          });
        } catch (err) {
          console.error("[slack] Interaction handling failed:", err);
        }
        return "ok";
      }),
    );

    // ─── Managed integration installations ───────────────────────
    h3.use(
      `${P}/installations`,
      defineEventHandler(async (event) => {
        const method = getMethod(event);
        if (method !== "GET" && method !== "POST") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const session = await getSession(event).catch(() => null);
        if (!session?.email) {
          setResponseStatus(event, 401);
          return { error: "unauthorized" };
        }
        const org = await getOrgContext(event).catch(() => null);
        const actor = {
          userEmail: session.email,
          orgId: org?.orgId ?? session.orgId ?? null,
          isOrgAdmin: org?.role === "owner" || org?.role === "admin",
        };
        if (method === "GET") {
          const query = getQuery(event);
          return {
            installations: await listIntegrationInstallations(
              actor,
              typeof query.platform === "string" ? query.platform : undefined,
            ),
          };
        }
        const body = (await readBody(event)) as {
          id?: unknown;
          action?: unknown;
        };
        const id = typeof body.id === "string" ? body.id : "";
        if (!id) {
          setResponseStatus(event, 400);
          return { error: "installation id required" };
        }
        if (body.action === "disconnect") {
          return {
            installation: await disconnectIntegrationInstallation(id, actor),
          };
        }
        if (body.action === "test") {
          const installation = (
            await listIntegrationInstallations(actor, "slack")
          ).find((item) => item.id === id);
          if (!installation) {
            setResponseStatus(event, 404);
            return { error: "installation not found" };
          }
          const bundle = await resolveIntegrationTokenBundle(
            installation.platform,
            installation.installationKey,
          );
          if (!bundle) {
            const updated = await updateIntegrationInstallation(id, actor, {
              health: "revoked",
              status: "revoked",
              lastError: "token_unavailable",
              healthCheckedAt: Date.now(),
            });
            return { installation: updated };
          }
          const health = await testSlackAuth(bundle.accessToken);
          const updated = await updateIntegrationInstallation(id, actor, {
            health: health.health,
            status: health.health === "revoked" ? "revoked" : "connected",
            lastError: health.error,
            healthCheckedAt: health.checkedAt,
            ...(health.ok ? { lastHealthyAt: health.checkedAt } : {}),
          });
          return { installation: updated };
        }
        setResponseStatus(event, 400);
        return { error: "unsupported installation action" };
      }),
    );

    h3.use(
      `${P}/scopes`,
      defineEventHandler(async (event) => {
        const method = getMethod(event);
        if (method !== "GET" && method !== "POST") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const ctx = await requireSessionContext(event);
        if (!ctx) return { error: "unauthorized" };
        const access = { ownerEmail: ctx.ownerEmail, orgId: ctx.orgId };
        if (method === "GET") {
          const query = getQuery(event);
          return {
            scopes: await listIntegrationScopes(access, {
              platform:
                typeof query.platform === "string" ? query.platform : undefined,
              tenantId:
                typeof query.tenantId === "string" ? query.tenantId : undefined,
            }),
          };
        }
        const admin = await checkOrgAdmin(event);
        if (!admin.ok) return { error: admin.error };
        try {
          const body = (await readBody(event)) as Parameters<
            typeof saveIntegrationScope
          >[0];
          return { scope: await saveIntegrationScope(body, access) };
        } catch (err) {
          setResponseStatus(event, 400);
          return {
            error: err instanceof Error ? err.message : "invalid scope",
          };
        }
      }),
    );

    h3.use(
      `${P}/budgets`,
      defineEventHandler(async (event) => {
        const method = getMethod(event);
        if (method !== "GET" && method !== "POST") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const ctx = await requireSessionContext(event);
        if (!ctx) return { error: "unauthorized" };
        const access = { ownerEmail: ctx.ownerEmail, orgId: ctx.orgId };
        if (method === "GET") {
          return { budgets: await listIntegrationUsageBudgets(access) };
        }
        const admin = await checkOrgAdmin(event);
        if (!admin.ok) return { error: admin.error };
        try {
          const body = (await readBody(event)) as Parameters<
            typeof saveIntegrationUsageBudget
          >[0];
          return {
            budget: await saveIntegrationUsageBudget(body, access),
          };
        } catch (err) {
          setResponseStatus(event, 400);
          return {
            error: err instanceof Error ? err.message : "invalid budget",
          };
        }
      }),
    );

    h3.use(
      `${P}/memory`,
      defineEventHandler(async (event) => {
        const method = getMethod(event);
        if (method !== "GET" && method !== "POST") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const ctx = await requireSessionContext(event);
        if (!ctx) return { error: "unauthorized" };
        const access = { ownerEmail: ctx.ownerEmail, orgId: ctx.orgId };
        const query = getQuery(event);
        const body =
          method === "POST"
            ? ((await readBody(event)) as Record<string, unknown>)
            : null;
        const scopeId =
          typeof query.scopeId === "string"
            ? query.scopeId
            : typeof body?.scopeId === "string"
              ? body.scopeId
              : "";
        const scope = (await listIntegrationScopes(access)).find(
          (item) => item.id === scopeId,
        );
        if (!scope) {
          setResponseStatus(event, 404);
          return { error: "integration scope not found" };
        }
        if (method === "GET") {
          return { memories: await listIntegrationMemory(scope.id) };
        }
        const admin = await checkOrgAdmin(event);
        if (!admin.ok) return { error: admin.error };
        if (body?.action === "remember") {
          return {
            memory: await rememberForIntegrationScope(
              {
                name: String(body.name ?? ""),
                description: String(body.description ?? ""),
                content: String(body.content ?? ""),
              },
              scope.id,
            ),
          };
        }
        if (body?.action === "forget") {
          return {
            memory: await forgetIntegrationMemory(
              { name: String(body.name ?? "") },
              scope.id,
            ),
          };
        }
        setResponseStatus(event, 400);
        return { error: "unsupported memory action" };
      }),
    );

    // ─── Managed Slack OAuth ──────────────────────────────────────
    h3.use(
      `${P}/slack/manifest`,
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const oauthRedirectUrl = resolveOAuthRedirectUri(
          event,
          `${P}/slack/oauth/callback`,
        );
        const eventsRequestUrl = resolveOAuthRedirectUri(
          event,
          `${P}/slack/webhook`,
        );
        const interactivityRequestUrl = resolveOAuthRedirectUri(
          event,
          `${P}/slack/interactions`,
        );
        if (
          !oauthRedirectUrl ||
          !eventsRequestUrl ||
          !interactivityRequestUrl
        ) {
          setResponseStatus(event, 400);
          return { error: "Slack manifest URLs are not allowed." };
        }
        setResponseHeader(
          event,
          "content-disposition",
          'attachment; filename="agent-native-slack-manifest.json"',
        );
        return buildSlackAgentManifest({
          oauthRedirectUrl,
          eventsRequestUrl,
          interactivityRequestUrl,
        });
      }),
    );

    h3.use(
      `${P}/slack/oauth/install`,
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const session = await getSession(event).catch(() => null);
        if (!session?.email) {
          setResponseStatus(event, 401);
          return { error: "Sign in before connecting Slack." };
        }
        const org = await getOrgContext(event).catch(() => null);
        try {
          assertSlackInstallAccess({
            email: session.email,
            orgId: org?.orgId ?? session.orgId ?? null,
            orgRole: org?.role ?? null,
          });
        } catch (err) {
          setResponseStatus(event, 403);
          return {
            error: err instanceof Error ? err.message : "Slack access denied",
          };
        }
        const clientId = await resolveSecret("SLACK_CLIENT_ID");
        const clientSecret = await resolveSecret("SLACK_CLIENT_SECRET");
        const signingSecret = await resolveSecret("SLACK_SIGNING_SECRET");
        if (!clientId || !clientSecret || !signingSecret) {
          setResponseStatus(event, 503);
          return {
            error:
              "Slack OAuth is not configured. Add the Slack client id, client secret, and signing secret first.",
          };
        }
        const redirectUri = resolveOAuthRedirectUri(
          event,
          `${P}/slack/oauth/callback`,
        );
        if (!redirectUri) {
          setResponseStatus(event, 400);
          return { error: "Slack OAuth redirect URL is not allowed." };
        }
        const query = getQuery(event);
        const state = encodeOAuthState({
          redirectUri,
          owner: session.email,
          orgId: org?.orgId ?? session.orgId ?? undefined,
          app: "agent-native:slack",
          addAccount: true,
          returnUrl:
            typeof query.return === "string" ? query.return : "/messaging",
        });
        return sendRedirect(
          event,
          buildSlackAuthorizeUrl({ clientId, redirectUri, state }),
          302,
        );
      }),
    );

    h3.use(
      `${P}/slack/oauth/callback`,
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const query = getQuery(event);
        if (typeof query.error === "string") {
          return oauthErrorPage("Slack authorization was canceled or denied.");
        }
        const fallbackRedirect = resolveOAuthRedirectUri(
          event,
          `${P}/slack/oauth/callback`,
        );
        if (!fallbackRedirect) {
          return oauthErrorPage("Slack OAuth redirect URL is not allowed.");
        }
        const state = decodeOAuthState(
          typeof query.state === "string" ? query.state : undefined,
          fallbackRedirect,
        );
        const session = await getSession(event).catch(() => null);
        const org = await getOrgContext(event).catch(() => null);
        if (
          state.app !== "agent-native:slack" ||
          !session?.email ||
          !state.owner ||
          session.email.toLowerCase() !== state.owner.toLowerCase() ||
          (state.orgId ?? null) !== (org?.orgId ?? session.orgId ?? null)
        ) {
          return oauthErrorPage(
            "Your Slack install session expired or changed. Sign in and start again.",
          );
        }
        const code = typeof query.code === "string" ? query.code : null;
        if (!code) return oauthErrorPage("Slack did not return an OAuth code.");
        try {
          const access = assertSlackInstallAccess({
            email: session.email,
            orgId: org?.orgId ?? session.orgId ?? null,
            orgRole: org?.role ?? null,
          });
          const clientId = await resolveSecret("SLACK_CLIENT_ID");
          const clientSecret = await resolveSecret("SLACK_CLIENT_SECRET");
          if (!clientId || !clientSecret) {
            return oauthErrorPage("Slack OAuth is not configured.");
          }
          return await runWithRequestContext(
            {
              userEmail: access.ownerEmail,
              orgId: access.orgId ?? undefined,
            },
            async () => {
              const oauth = await exchangeSlackOAuthCode({
                code,
                clientId,
                clientSecret,
                redirectUri: state.redirectUri,
              });
              const health = await testSlackAuth(oauth.access_token || "");
              if (!health.ok) {
                return oauthErrorPage(
                  "Slack connected, but the bot token could not be verified. Please retry.",
                );
              }
              if (
                oauth.team?.id &&
                health.teamId &&
                oauth.team.id !== health.teamId
              ) {
                return oauthErrorPage(
                  "Slack returned inconsistent workspace details. Please retry.",
                );
              }
              const input = slackOAuthResponseToInstallation(oauth, access);
              const installation = await upsertIntegrationInstallation({
                ...input,
                health: health.health,
                healthCheckedAt: health.checkedAt,
                lastHealthyAt: health.checkedAt,
              });
              await saveIntegrationConfig(
                "slack",
                { enabled: true, managedOAuth: true },
                "default",
                access.ownerEmail,
              );
              return oauthCallbackResponse(
                event,
                installation.teamName || installation.enterpriseName || "Slack",
                {
                  addAccount: true,
                  appName: "Agent Native",
                  returnUrl: state.returnUrl || "/messaging",
                },
              );
            },
          );
        } catch (err) {
          console.error("[slack] OAuth callback failed:", err);
          return oauthErrorPage("Slack connection failed. Please try again.");
        }
      }),
    );

    // ─── Per-platform catch-all ───────────────────────────────────
    // Handles: webhook, status, enable, disable, setup for each platform
    h3.use(
      `${P}`,
      defineEventHandler(async (event) => {
        const method = getMethod(event);
        // event.path is stripped to the remainder after the mount prefix
        const raw = (event.path || "/").split("?")[0].replace(/^\//, "");
        const parts = raw.split("/").filter(Boolean);

        // Already handled by the dedicated /status route above
        if (parts[0] === "status" && parts.length === 1) return;
        // Already handled by the dedicated /task-queue/status route above
        if (parts[0] === "task-queue") return;
        // Already handled by the dedicated /remote/* routes above
        if (parts[0] === "remote") return;
        // Already handled by the dedicated /process-task route above
        if (parts[0] === "process-task") return;
        // Already handled by the dedicated /process-a2a-continuation route above
        if (parts[0] === "process-a2a-continuation") return;
        // These are framework-owned control-plane routes, not integration
        // platforms. The dedicated handlers above normally return a response
        // before this catch-all runs, but keeping them reserved here prevents
        // an unexpected mount fall-through from turning a valid control-plane
        // request into a misleading "Unknown platform" response.
        if (
          parts[0] === "installations" ||
          parts[0] === "scopes" ||
          parts[0] === "budgets" ||
          parts[0] === "memory"
        ) {
          setResponseStatus(event, 404);
          return { error: "Not found" };
        }

        const platform = parts[0];
        const action = parts[1]; // webhook, status, enable, disable, setup

        if (!platform) {
          setResponseStatus(event, 404);
          return { error: "Platform required" };
        }

        const adapter = adapterMap.get(platform);
        if (!adapter) {
          setResponseStatus(event, 404);
          return { error: `Unknown platform: ${platform}` };
        }

        // Set params for handlers that read them
        if (event.context) {
          event.context.params = {
            ...event.context.params,
            platform,
          };
        }

        // ─── GET /:platform/status ─────────────────────────────
        if (action === "status" && method === "GET") {
          const ctx = await requireSessionContext(event);
          if (!ctx) return { error: "unauthorized" };
          const baseUrl = getBaseUrl(event);
          const status = await withCredentialContext(
            toCredentialContext(ctx),
            () => adapter.getStatus(baseUrl),
          );
          const config = await getIntegrationConfig(platform);
          status.enabled = !!config?.configData?.enabled;
          status.webhookUrl = `${baseUrl}${P}/${platform}/webhook`;
          if (!status.requiredEnvKeys) {
            try {
              status.requiredEnvKeys = adapter.getRequiredEnvKeys();
            } catch {
              status.requiredEnvKeys = [];
            }
          }
          return status;
        }

        // ─── POST /:platform/webhook ───────────────────────────
        if (action === "webhook" && method === "POST") {
          // Google Docs push notifications bypass the normal webhook flow —
          // they're opaque "something changed" pings, not message payloads.
          // We MUST verify the Pub/Sub OIDC token here. Without it, anyone
          // could POST any body to this URL and force a Drive changes pull
          // (H7 in the webhook security audit).
          if (platform === "google-docs") {
            const audience = process.env.GOOGLE_DOCS_PUSH_AUDIENCE;
            if (!audience) {
              if (process.env.NODE_ENV === "production") {
                // Fail closed in prod so a misconfigured deployment surfaces
                // in Pub/Sub's delivery metrics rather than silently
                // accepting anonymous requests.
                setResponseStatus(event, 503);
                return {
                  ok: false,
                  error:
                    "google-docs push endpoint disabled (audience not configured)",
                };
              }
              // Dev: keep the loose posture so contributors can play with the
              // integration locally without configuring Pub/Sub.
              handlePushNotification().catch((err) => {
                console.error("[google-docs] Push handler error:", err);
              });
              return "ok";
            }
            const authHeader = getRequestHeader(event, "authorization") || "";
            try {
              await verifyGoogleDocsPushToken(authHeader);
            } catch (err: any) {
              console.warn(
                `[google-docs] OIDC verify failed: ${err?.message ?? String(err)}`,
              );
              setResponseStatus(event, 401);
              return { ok: false, error: "unauthorized" };
            }
            handlePushNotification().catch((err) => {
              console.error("[google-docs] Push handler error:", err);
            });
            return "ok";
          }

          const config = await getIntegrationConfig(platform);
          const credentialContext =
            await credentialContextForIntegrationConfig(config);

          // Let the adapter cache the raw request and identify setup
          // challenges, but never return a challenge response until the
          // provider signature has been verified.
          const verification = await withCredentialContext(
            credentialContext,
            () => adapter.handleVerification(event),
          );

          // Verify the webhook signature BEFORE parsing. We pre-parse the
          // body here (so handleWebhook can skip its second readBody, which
          // hangs on streaming providers), and that means handleWebhook's
          // own verifyWebhook step is bypassed. Without this call anyone
          // could POST a forged Slack/Telegram/email payload.
          const isValid = await withCredentialContext(credentialContext, () =>
            adapter.verifyWebhook(event),
          );
          if (!isValid) {
            setResponseStatus(event, 401);
            return { error: "Invalid webhook signature" };
          }
          if (verification.handled) {
            setResponseStatus(event, 200);
            return verification.response ?? "ok";
          }

          if (!config?.configData?.enabled) {
            setResponseStatus(event, 404);
            return { error: `Integration ${platform} is not enabled` };
          }

          let incoming = await withCredentialContext(credentialContext, () =>
            adapter.parseIncomingMessage(event),
          );
          if (!incoming) {
            setResponseStatus(event, 200);
            return "ok";
          }
          if (adapter.hydrateIncomingIdentity) {
            try {
              incoming = await withCredentialContext(credentialContext, () =>
                adapter.hydrateIncomingIdentity!(incoming!),
              );
            } catch (err) {
              // Identity hydration is best-effort for platforms that have an
              // app-specific resolver. Slack's default DM resolver below will
              // still fail closed when the identity is absent or unverified.
              console.warn(
                `[integrations] Could not hydrate ${platform} sender identity:`,
                err instanceof Error ? err.message : err,
              );
            }
          }
          let defaultExecutionContext: IntegrationExecutionContext | null =
            null;
          if (
            incoming.platform === "slack" &&
            incoming.conversationType === "dm"
          ) {
            try {
              defaultExecutionContext = await withCredentialContext(
                credentialContext,
                () => resolveDefaultIntegrationExecutionContext(incoming!),
              );
            } catch (err) {
              // An app-specific resolver may intentionally support a legacy
              // Slack setup. When no override exists, the branch below fails
              // closed instead of falling back to a service principal.
              if (!options?.resolveExecutionContext && !options?.resolveOwner) {
                console.error(
                  `[integrations] default Slack DM identity denied message:`,
                  err,
                );
                setResponseStatus(event, 200);
                return "ok";
              }
            }
          }
          let executionContext: IntegrationExecutionContext = {
            ownerEmail: `integration@${platform}`,
            orgId: null as string | null,
            principalType: "service" as const,
          };
          if (options?.resolveExecutionContext) {
            try {
              executionContext = await withCredentialContext(
                credentialContext,
                () =>
                  Promise.resolve(options.resolveExecutionContext!(incoming)),
              );
            } catch (err) {
              console.error(
                `[integrations] resolveExecutionContext denied message:`,
                err,
              );
              setResponseStatus(event, 200);
              return "ok";
            }
          } else if (defaultExecutionContext) {
            executionContext = defaultExecutionContext;
          } else if (options?.resolveOwner) {
            try {
              executionContext.ownerEmail = await withCredentialContext(
                credentialContext,
                () => Promise.resolve(options.resolveOwner!(incoming)),
              );
            } catch (err) {
              console.error(
                `[integrations] resolveOwner failed, using default:`,
                err,
              );
            }
          } else {
            try {
              executionContext = await withCredentialContext(
                credentialContext,
                () => resolveDefaultIntegrationExecutionContext(incoming!),
              );
            } catch (err) {
              console.error(
                `[integrations] default execution identity denied message:`,
                err,
              );
              setResponseStatus(event, 200);
              return "ok";
            }
          }
          if (executionContext.scopeId) {
            incoming.integrationScopeId = executionContext.scopeId;
          }
          const result = await handleWebhook(event, {
            adapter,
            // The processor reloads scoped resources immediately before the
            // agent run. Avoid doing that work on the acknowledgement path,
            // where providers such as Discord enforce a 3-second deadline.
            systemPrompt: baseSystemPrompt,
            actions,
            initialToolNames,
            model,
            apiKey: getApiKey(),
            engine: options?.engine,
            appId: options?.appId,
            ownerEmail: executionContext.ownerEmail,
            orgId: executionContext.orgId,
            principalType: executionContext.principalType,
            beforeProcess: options?.beforeProcess,
            incoming,
          });
          setResponseStatus(event, result.status);
          return result.body;
        }

        // ─── POST /:platform/enable ────────────────────────────
        if (action === "enable" && method === "POST") {
          const adminCheck = await checkOrgAdmin(event);
          if (adminCheck.ok === false) return { error: adminCheck.error };
          // Stamp the org-admin who toggled this so downstream code can
          // tell who is responsible — useful for audit logs even though
          // the row itself remains deployment-wide.
          const session = await getSession(event).catch(() => null);
          await saveIntegrationConfig(
            platform,
            { enabled: true },
            "default",
            session?.email,
          );
          return { ok: true, platform, enabled: true };
        }

        // ─── POST /:platform/disable ───────────────────────────
        if (action === "disable" && method === "POST") {
          const adminCheck = await checkOrgAdmin(event);
          if (adminCheck.ok === false) return { error: adminCheck.error };
          const session = await getSession(event).catch(() => null);
          await saveIntegrationConfig(
            platform,
            { enabled: false },
            "default",
            session?.email,
          );
          return { ok: true, platform, enabled: false };
        }

        // ─── POST /:platform/setup ─────────────────────────────
        if (action === "setup" && method === "POST") {
          const adminCheck = await checkOrgAdmin(event);
          if (adminCheck.ok === false) return { error: adminCheck.error };
          if (platform === "telegram") {
            const baseUrl = getBaseUrl(event);
            const webhookUrl = `${baseUrl}${P}/telegram/webhook`;
            const ctx = await requireSessionContext(event);
            if (!ctx) return { error: "unauthorized" };
            const token = await withCredentialContext(
              toCredentialContext(ctx),
              () => resolveSecret("TELEGRAM_BOT_TOKEN"),
            );
            const webhookSecret = await withCredentialContext(
              toCredentialContext(ctx),
              () => resolveSecret("TELEGRAM_WEBHOOK_SECRET"),
            );
            if (!token || !webhookSecret) {
              setResponseStatus(event, 400);
              return {
                error:
                  "TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET must be configured before webhook setup.",
              };
            }
            try {
              const res = await fetch(
                `https://api.telegram.org/bot${token}/setWebhook`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    url: webhookUrl,
                    secret_token: webhookSecret,
                  }),
                },
              );
              const data = await res.json();
              return { ok: true, platform, webhookUrl, result: data };
            } catch (err: any) {
              setResponseStatus(event, 500);
              return { error: err.message };
            }
          }
          return { ok: true, platform, message: "No setup required" };
        }

        setResponseStatus(event, 404);
        return { error: "Not found" };
      }),
    );

    // ─── Start pending-tasks retry sweeper ────────────────────────
    // Sweeps the integration_pending_tasks queue every 60s and re-fires the
    // processor for any tasks that got stuck (initial dispatch lost or
    // processor killed mid-flight). No-ops gracefully if the queue table
    // hasn't been created yet on this deployment.
    startPendingTasksRetryJob({
      webhookBaseUrl: process.env.WEBHOOK_BASE_URL,
    });
    startA2AContinuationRetryJob(adapterMap);
    startRemoteCommandsRetryJob();

    // ─── Start Google Docs poller/push ────────────────────────────
    if (adapterMap.has("google-docs")) {
      // Defer startup slightly so the server is fully ready
      setTimeout(() => {
        // We don't know the base URL at plugin init time — it depends on
        // the incoming request. For push mode, the webhook URL needs to be
        // resolved. We pass it as a special option; the poller will attempt
        // to register a watch when the first request reveals the base URL,
        // or use the WEBHOOK_BASE_URL env var if set.
        const baseUrl = process.env.WEBHOOK_BASE_URL;
        const webhookUrl = baseUrl
          ? `${withConfiguredAppBasePath(baseUrl)}${P}/google-docs/webhook`
          : undefined;

        void startGoogleDocsPoller({
          systemPrompt: baseSystemPrompt,
          actions,
          initialToolNames,
          model: model ?? "",
          apiKey: getApiKey(),
          ownerEmail: "integration@google-docs",
          webhookUrl,
        });
      }, 2000);
    }

    if (process.env.DEBUG)
      console.log(
        `[integrations] Mounted integration routes for: ${adapters.map((a) => a.platform).join(", ")}`,
      );
  };
}

/**
 * Default integrations plugin — auto-mounts all adapters.
 */
export const defaultIntegrationsPlugin = createIntegrationsPlugin();

/** Extract base URL from the request */
function getBaseUrl(event: any): string {
  try {
    const headers = event.node?.req?.headers || event.headers || {};
    const getHeader = (name: string) =>
      typeof headers.get === "function"
        ? headers.get(name)
        : (headers as Record<string, string>)[name];
    const proto = getHeader("x-forwarded-proto") || "http";
    const host = getHeader("host") || "localhost:3000";
    return withConfiguredAppBasePath(`${proto}://${host}`);
  } catch {
    return withConfiguredAppBasePath("http://localhost:3000");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readComputerCapabilities(value: unknown) {
  const input = readObject(value);
  const readSurface = (surface: unknown, desktop = false) => {
    const record = readObject(surface);
    if (!record) return undefined;
    return {
      observe: record.observe === true,
      control: record.control === true,
      ...(desktop
        ? {
            accessibility: record.accessibility === true,
            screenCapture: record.screenCapture === true,
          }
        : {}),
      provider: readString(record.provider) ?? null,
      version: readString(record.version) ?? null,
    };
  };
  return {
    browser: readSurface(input?.browser),
    desktop: readSurface(input?.desktop, true),
  };
}

function advertisedComputerOperationClasses(
  device: Pick<RemoteDevice, "metadata">,
): ComputerOperationClass[] {
  const capabilities = getRemoteComputerCapabilities(device);
  const classes: ComputerOperationClass[] = [];
  if (capabilities?.browser?.observe) classes.push("browser.observe");
  if (capabilities?.browser?.control) classes.push("browser.control");
  if (capabilities?.desktop?.observe) classes.push("desktop.observe");
  if (capabilities?.desktop?.control) classes.push("desktop.control");
  return classes;
}

function readComputerApprovalStatus(value: unknown) {
  return value === "pending" ||
    value === "approved" ||
    value === "denied" ||
    value === "consumed" ||
    value === "expired"
    ? value
    : undefined;
}

function computerSupervisionRouteError(event: any, error: unknown) {
  if (error instanceof ComputerSupervisionError) {
    const status =
      error.code === "expired-lease"
        ? 410
        : error.code === "replay"
          ? 409
          : error.code === "approval-required" ||
              error.code === "approval-denied"
            ? 403
            : 400;
    setResponseStatus(event, status);
    return { error: error.message, code: error.code };
  }
  throw error;
}
