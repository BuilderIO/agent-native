import {
  createRouter,
  defineEventHandler,
  readBody,
  setResponseStatus,
  getMethod,
} from "h3";
import { FRAMEWORK_ROUTE_PREFIX } from "../server/core-routes-plugin.js";
import type {
  PlatformAdapter,
  IntegrationsPluginOptions,
  IntegrationStatus,
} from "./types.js";
import { handleWebhook } from "./webhook-handler.js";
import {
  getIntegrationConfig,
  saveIntegrationConfig,
  deleteIntegrationConfig,
} from "./config-store.js";
import { slackAdapter } from "./adapters/slack.js";
import { telegramAdapter } from "./adapters/telegram.js";
import { whatsappAdapter } from "./adapters/whatsapp.js";
import {
  resourceList,
  resourceGetByPath,
  SHARED_OWNER,
} from "../resources/store.js";

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

    const router = createRouter();
    const P = `${FRAMEWORK_ROUTE_PREFIX}/integrations`;

    // ─── Webhook endpoint ──────────────────────────────────────────
    router.post(
      `${P}/:platform/webhook`,
      defineEventHandler(async (event) => {
        const platform = (event.context.params as any)?.platform;
        const adapter = adapterMap.get(platform);
        if (!adapter) {
          setResponseStatus(event, 404);
          return { error: `Unknown platform: ${platform}` };
        }

        // Check if integration is enabled
        const config = await getIntegrationConfig(platform);
        if (!config?.configData?.enabled) {
          setResponseStatus(event, 404);
          return { error: `Integration ${platform} is not enabled` };
        }

        // Build system prompt with resources
        const owner = `integration@${platform}`;
        const resources = await loadResourcesForPrompt(owner);
        const systemPrompt = baseSystemPrompt + resources;

        const result = await handleWebhook(event, {
          adapter,
          systemPrompt,
          actions,
          model,
          apiKey: options?.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "",
        });

        setResponseStatus(event, result.status);
        return result.body;
      }),
    );

    // ─── Status endpoints ──────────────────────────────────────────
    router.get(
      `${P}/status`,
      defineEventHandler(async (event) => {
        const baseUrl = getBaseUrl(event);
        const statuses: IntegrationStatus[] = [];
        for (const adapter of adapters) {
          const status = await adapter.getStatus(baseUrl);
          // Check if explicitly enabled in config
          const config = await getIntegrationConfig(adapter.platform);
          status.enabled = !!config?.configData?.enabled;
          status.webhookUrl = `${baseUrl}${P}/${adapter.platform}/webhook`;
          statuses.push(status);
        }
        return statuses;
      }),
    );

    router.get(
      `${P}/:platform/status`,
      defineEventHandler(async (event) => {
        const platform = (event.context.params as any)?.platform;
        const adapter = adapterMap.get(platform);
        if (!adapter) {
          setResponseStatus(event, 404);
          return { error: `Unknown platform: ${platform}` };
        }
        const baseUrl = getBaseUrl(event);
        const status = await adapter.getStatus(baseUrl);
        const config = await getIntegrationConfig(platform);
        status.enabled = !!config?.configData?.enabled;
        status.webhookUrl = `${baseUrl}${P}/${platform}/webhook`;
        return status;
      }),
    );

    // ─── Enable/disable endpoints ──────────────────────────────────
    router.post(
      `${P}/:platform/enable`,
      defineEventHandler(async (event) => {
        const platform = (event.context.params as any)?.platform;
        const adapter = adapterMap.get(platform);
        if (!adapter) {
          setResponseStatus(event, 404);
          return { error: `Unknown platform: ${platform}` };
        }
        await saveIntegrationConfig(platform, { enabled: true });
        return { ok: true, platform, enabled: true };
      }),
    );

    router.post(
      `${P}/:platform/disable`,
      defineEventHandler(async (event) => {
        const platform = (event.context.params as any)?.platform;
        const adapter = adapterMap.get(platform);
        if (!adapter) {
          setResponseStatus(event, 404);
          return { error: `Unknown platform: ${platform}` };
        }
        await saveIntegrationConfig(platform, { enabled: false });
        return { ok: true, platform, enabled: false };
      }),
    );

    // ─── Setup endpoint (platform-specific) ────────────────────────
    router.post(
      `${P}/:platform/setup`,
      defineEventHandler(async (event) => {
        const platform = (event.context.params as any)?.platform;
        const adapter = adapterMap.get(platform);
        if (!adapter) {
          setResponseStatus(event, 404);
          return { error: `Unknown platform: ${platform}` };
        }

        // Platform-specific setup (e.g., register Telegram webhook)
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
      }),
    );

    // Mount the router
    nitroApp.h3App.use(router);

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
    const proto = event.node?.req?.headers?.["x-forwarded-proto"] || "http";
    const host = event.node?.req?.headers?.host || "localhost:3000";
    return `${proto}://${host}`;
  } catch {
    return "http://localhost:3000";
  }
}
