import { defineEventHandler, setResponseStatus, getMethod } from "h3";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { FRAMEWORK_ROUTE_PREFIX } from "../server/core-routes-plugin.js";
import { getH3App } from "../server/framework-request-handler.js";
import type {
  PlatformAdapter,
  IntegrationsPluginOptions,
  IntegrationStatus,
} from "./types.js";
import { handleWebhook, processIntegrationTask } from "./webhook-handler.js";
import { DEFAULT_MODEL } from "../agent/default-model.js";
import {
  claimPendingTask,
  getPendingTask,
  markTaskCompleted,
  markTaskFailed,
} from "./pending-tasks-store.js";
import { extractBearerToken, verifyInternalToken } from "./internal-token.js";
import { readBody } from "../server/h3-helpers.js";
import { getRequestHeader } from "h3";
import { getIntegrationConfig, saveIntegrationConfig } from "./config-store.js";
import { slackAdapter } from "./adapters/slack.js";
import { telegramAdapter } from "./adapters/telegram.js";
import { whatsappAdapter } from "./adapters/whatsapp.js";
import { googleDocsAdapter } from "./adapters/google-docs.js";
import { emailAdapter } from "./adapters/email.js";
import {
  startGoogleDocsPoller,
  handlePushNotification,
} from "./google-docs-poller.js";
import { startPendingTasksRetryJob } from "./pending-tasks-retry-job.js";
import { resourceGetByPath, SHARED_OWNER } from "../resources/store.js";
import { getTaskQueueStats } from "./task-queue-stats.js";
import { getSession } from "../server/auth.js";
import { getOrgContext } from "../org/context.js";
import { withConfiguredAppBasePath } from "../server/app-base-path.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

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

/**
 * Load resources for the integration agent's system prompt.
 * Mirrors the pattern from agent-chat-plugin.ts.
 */
async function loadResourcesForPrompt(owner: string): Promise<string> {
  const resourceNames = ["AGENTS.md", "LEARNINGS.md"];
  const sections: string[] = [];

  for (const name of resourceNames) {
    try {
      const shared = await resourceGetByPath(SHARED_OWNER, name);
      if (shared?.content?.trim()) {
        sections.push(
          `<resource name="${name}" scope="shared">\n${shared.content.trim()}\n</resource>`,
        );
      }
    } catch {}

    if (owner !== SHARED_OWNER) {
      try {
        const personal = await resourceGetByPath(owner, name);
        if (personal?.content?.trim()) {
          sections.push(
            `<resource name="${name}" scope="personal">\n${personal.content.trim()}\n</resource>`,
          );
        }
      } catch {}
    }
  }

  if (sections.length === 0) return "";
  return (
    "\n\nThe following resources contain template-specific instructions and user context.\n\n" +
    sections.join("\n\n")
  );
}

const INTEGRATION_SYSTEM_PROMPT = `You are an AI agent responding via a messaging platform integration (Slack, Telegram, WhatsApp, etc.).

You have the same capabilities as the web chat agent. Use your tools to help the user.

Keep responses concise — messaging platforms have character limits and users expect shorter replies than in a web interface. Use markdown sparingly (bold and lists are fine, but avoid complex formatting that may not render well on all platforms).

If a task requires many steps, summarize what you did rather than streaming every detail.`;

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
    const adapters = options?.adapters ?? getDefaultAdapters();
    const adapterMap = new Map<string, PlatformAdapter>();
    for (const adapter of adapters) {
      adapterMap.set(adapter.platform, adapter);
    }

    const model = options?.model ?? DEFAULT_MODEL;
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
          await processIntegrationTask(task, {
            adapter,
            systemPrompt: baseSystemPrompt,
            actions,
            model,
            apiKey: getApiKey(),
            ownerEmail: task.ownerEmail,
          });
          await markTaskCompleted(taskId);
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
        // Already handled by the dedicated /process-task route above
        if (parts[0] === "process-task") return;

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
          const resources = await loadResourcesForPrompt(owner);
          const systemPrompt = baseSystemPrompt + resources;
          const result = await handleWebhook(event, {
            adapter,
            systemPrompt,
            actions,
            model,
            apiKey: getApiKey(),
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
          model,
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
