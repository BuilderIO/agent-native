import { defineEventHandler, setResponseStatus, getMethod } from "h3";
import { FRAMEWORK_ROUTE_PREFIX } from "../server/core-routes-plugin.js";
import { getH3App } from "../server/framework-request-handler.js";
import type {
  PlatformAdapter,
  IntegrationsPluginOptions,
  IntegrationStatus,
} from "./types.js";
import { handleWebhook } from "./webhook-handler.js";
import { getIntegrationConfig, saveIntegrationConfig } from "./config-store.js";
import { slackAdapter } from "./adapters/slack.js";
import { telegramAdapter } from "./adapters/telegram.js";
import { whatsappAdapter } from "./adapters/whatsapp.js";
import { resourceGetByPath, SHARED_OWNER } from "../resources/store.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

/** Built-in adapters, instantiated lazily */
function getDefaultAdapters(): PlatformAdapter[] {
  return [slackAdapter(), telegramAdapter(), whatsappAdapter()];
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

    const model = options?.model ?? "claude-sonnet-4-6";
    const apiKey = options?.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";

    // Build the system prompt
    const baseSystemPrompt = options?.systemPrompt ?? INTEGRATION_SYSTEM_PROMPT;

    // Resolve actions
    const actions = options?.actions ?? {};

    const h3 = getH3App(nitroApp);
    const P = `${FRAMEWORK_ROUTE_PREFIX}/integrations`;

    // ─── Status endpoint (all integrations) ───────────────────────
    h3.use(
      `${P}/status`,
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const baseUrl = getBaseUrl(event);
        const statuses: IntegrationStatus[] = [];
        for (const adapter of adapters) {
          const status = await adapter.getStatus(baseUrl);
          const config = await getIntegrationConfig(adapter.platform);
          status.enabled = !!config?.configData?.enabled;
          status.webhookUrl = `${baseUrl}${P}/${adapter.platform}/webhook`;
          statuses.push(status);
        }
        return statuses;
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
          const baseUrl = getBaseUrl(event);
          const status = await adapter.getStatus(baseUrl);
          const config = await getIntegrationConfig(platform);
          status.enabled = !!config?.configData?.enabled;
          status.webhookUrl = `${baseUrl}${P}/${platform}/webhook`;
          return status;
        }

        // ─── POST /:platform/webhook ───────────────────────────
        if (action === "webhook" && method === "POST") {
          const config = await getIntegrationConfig(platform);
          if (!config?.configData?.enabled) {
            setResponseStatus(event, 404);
            return { error: `Integration ${platform} is not enabled` };
          }
          const incoming = await adapter.parseIncomingMessage(event);
          if (!incoming) {
            setResponseStatus(event, 200);
            return "ok";
          }
          const owner = options?.resolveOwner
            ? await options.resolveOwner(incoming)
            : `integration@${platform}`;
          const resources = await loadResourcesForPrompt(owner);
          const systemPrompt = baseSystemPrompt + resources;
          const result = await handleWebhook(event, {
            adapter,
            systemPrompt,
            actions,
            model,
            apiKey: options?.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "",
            ownerEmail: owner,
            beforeProcess: options?.beforeProcess,
          });
          setResponseStatus(event, result.status);
          return result.body;
        }

        // ─── POST /:platform/enable ────────────────────────────
        if (action === "enable" && method === "POST") {
          await saveIntegrationConfig(platform, { enabled: true });
          return { ok: true, platform, enabled: true };
        }

        // ─── POST /:platform/disable ───────────────────────────
        if (action === "disable" && method === "POST") {
          await saveIntegrationConfig(platform, { enabled: false });
          return { ok: true, platform, enabled: false };
        }

        // ─── POST /:platform/setup ─────────────────────────────
        if (action === "setup" && method === "POST") {
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
    return `${proto}://${host}`;
  } catch {
    return "http://localhost:3000";
  }
}
