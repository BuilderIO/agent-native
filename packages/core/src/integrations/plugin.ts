import { defineEventHandler, setResponseStatus, getMethod, getQuery } from "h3";
import { getRequestHeader } from "h3";
import { createRemoteJWKSet, jwtVerify } from "jose";

import { getOrgContext } from "../org/context.js";
import { loadResourcesForPrompt } from "../server/agent-chat-plugin.js";
import { withConfiguredAppBasePath } from "../server/app-base-path.js";
import { getSession } from "../server/auth.js";
import { FRAMEWORK_ROUTE_PREFIX } from "../server/core-routes-plugin.js";
import {
  getH3App,
  markDefaultPluginProvided,
} from "../server/framework-request-handler.js";
import { readBody } from "../server/h3-helpers.js";
import {
  processA2AContinuationById,
  processDueA2AContinuations,
} from "./a2a-continuation-processor.js";
import { failA2AContinuation } from "./a2a-continuations-store.js";
import { emailAdapter } from "./adapters/email.js";
import { googleDocsAdapter } from "./adapters/google-docs.js";
import { slackAdapter } from "./adapters/slack.js";
import { telegramAdapter } from "./adapters/telegram.js";
import { whatsappAdapter } from "./adapters/whatsapp.js";
import { getIntegrationConfig, saveIntegrationConfig } from "./config-store.js";
import {
  startGoogleDocsPoller,
  handlePushNotification,
} from "./google-docs-poller.js";
import { extractBearerToken, verifyInternalToken } from "./internal-token.js";
import { startPendingTasksRetryJob } from "./pending-tasks-retry-job.js";
import {
  claimPendingTask,
  markTaskCompleted,
  markTaskFailed,
} from "./pending-tasks-store.js";
import {
  claimNextRemoteCommand,
  enqueueRemoteCommand as enqueueRemoteCommandRow,
  isRemoteCommandKind,
  listRemoteCommandsForOwner,
  updateRemoteCommandResult,
} from "./remote-commands-store.js";
import {
  authenticateRemoteDeviceToken,
  createRemoteDevice,
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
  RemoteCommand,
  RemoteCommandKind,
  RemoteDevice,
} from "./remote-types.js";
import { getTaskQueueStats } from "./task-queue-stats.js";
import type {
  PlatformAdapter,
  IntegrationsPluginOptions,
  IntegrationStatus,
} from "./types.js";
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
    googleDocsAdapter(),
    emailAdapter(),
  ];
}

const INTEGRATION_SYSTEM_PROMPT = `You are an AI agent responding via a messaging platform integration (Slack, Telegram, WhatsApp, etc.).

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
    const getApiKey = () =>
      options?.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";

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
      ...localActions,
      ...callAgentEntry,
    } as typeof localActions;

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
        if (!(await requireSession(event))) return { error: "unauthorized" };
        const baseUrl = getBaseUrl(event);
        const statuses: IntegrationStatus[] = [];
        for (const adapter of adapters) {
          const status = await adapter.getStatus(baseUrl);
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
            ? ((await readBody(event)) as { waitMs?: unknown })
            : {};
        const requestedWait =
          Number(body.waitMs ?? query.waitMs ?? query.wait_ms ?? 25_000) || 0;
        const waitMs = Math.max(0, Math.min(25_000, requestedWait));
        const deadline = Date.now() + waitMs;

        while (true) {
          const command = await claimNextRemoteCommand(device.id);
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
          const resources = await loadResourcesForPrompt(
            task.ownerEmail,
            true,
            options?.appId,
          );
          await processIntegrationTask(task, {
            adapter,
            systemPrompt: baseSystemPrompt + resources,
            actions,
            model,
            apiKey: getApiKey(),
            engine: options?.engine,
            ownerEmail: task.ownerEmail,
          });
          await markTaskCompleted(taskId);
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
          await markTaskFailed(
            taskId,
            err?.message
              ? String(err.message).slice(0, 1000)
              : "processor failed",
          );
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
          if (!(await requireSession(event))) return { error: "unauthorized" };
          const baseUrl = getBaseUrl(event);
          const status = await adapter.getStatus(baseUrl);
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

          // Handle platform verification challenges (e.g. Slack url_verification)
          // before checking enable state or parsing the message.
          const verification = await adapter.handleVerification(event);
          if (verification.handled) {
            return verification.response ?? "ok";
          }

          const config = await getIntegrationConfig(platform);
          if (!config?.configData?.enabled) {
            setResponseStatus(event, 404);
            return { error: `Integration ${platform} is not enabled` };
          }

          // Verify the webhook signature BEFORE parsing. We pre-parse the
          // body here (so handleWebhook can skip its second readBody, which
          // hangs on streaming providers), and that means handleWebhook's
          // own verifyWebhook step is bypassed. Without this call anyone
          // could POST a forged Slack/Telegram/email payload.
          const isValid = await adapter.verifyWebhook(event);
          if (!isValid) {
            setResponseStatus(event, 401);
            return { error: "Invalid webhook signature" };
          }

          const incoming = await adapter.parseIncomingMessage(event);
          if (!incoming) {
            setResponseStatus(event, 200);
            return "ok";
          }
          let owner = `integration@${platform}`;
          if (options?.resolveOwner) {
            try {
              owner = await options.resolveOwner(incoming);
            } catch (err) {
              console.error(
                `[integrations] resolveOwner failed, using default:`,
                err,
              );
            }
          }
          const resources = await loadResourcesForPrompt(
            owner,
            true,
            options?.appId,
          );
          const systemPrompt = baseSystemPrompt + resources;
          const result = await handleWebhook(event, {
            adapter,
            systemPrompt,
            actions,
            model,
            apiKey: getApiKey(),
            engine: options?.engine,
            appId: options?.appId,
            ownerEmail: owner,
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
            const token = process.env.TELEGRAM_BOT_TOKEN;
            if (!token) {
              setResponseStatus(event, 400);
              return { error: "TELEGRAM_BOT_TOKEN not configured" };
            }
            try {
              const res = await fetch(
                `https://api.telegram.org/bot${token}/setWebhook`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ url: webhookUrl }),
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

        startGoogleDocsPoller({
          systemPrompt: baseSystemPrompt,
          actions,
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
