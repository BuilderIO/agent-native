import type { AgentChatPluginOptions } from "./server/agent-chat-plugin.js";
import { createServer } from "./server/create-server.js";
import type { AgentNativeEmbeddedPluginOptions } from "./server/embedded.js";
import {
  markDefaultPluginProvided,
  trackPluginInit,
} from "./server/framework-request-handler.js";
import { createSSEHandler } from "./server/sse.js";

export type { AgentChatPluginOptions } from "./server/agent-chat-plugin.js";
export type { AgentNativeEmbeddedPluginOptions } from "./server/embedded.js";
export type { AuthOptions, AuthSession } from "./server/auth.js";
export type { CreateServerOptions } from "./server/create-server.js";
export type { SSEHandlerOptions } from "./server/sse.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

const AGENT_CHAT_PLUGIN_PATHS = [
  "/_agent-native/agent-chat",
  "/_agent-native/actions",
  "/_agent-native/agent-model-defaults",
  "/_agent-native/mcp",
  "/mcp",
  "/.well-known/agent-card.json",
  "/_agent-native/a2a",
];

const EMBEDDED_PLUGIN_STEMS = [
  "auth",
  "sentry",
  "org",
  "core-routes",
  "resources",
  "onboarding",
  "integrations",
  "terminal",
  "agent-chat",
] as const;

export function createAgentChatPlugin(
  options?: AgentChatPluginOptions,
): NitroPluginDef {
  return (nitroApp) => {
    markDefaultPluginProvided(nitroApp, "agent-chat");
    const initPromise = import("./server/agent-chat-plugin.js").then(
      ({ createAgentChatPlugin }) => createAgentChatPlugin(options)(nitroApp),
    );
    trackPluginInit(nitroApp, initPromise, {
      paths: AGENT_CHAT_PLUGIN_PATHS,
    });
  };
}

export const defaultAgentChatPlugin: NitroPluginDef = createAgentChatPlugin();

export async function mountAgentNativeEmbedded(
  nitroApp: any,
  options: AgentNativeEmbeddedPluginOptions = {},
): Promise<void> {
  const { mountAgentNativeEmbedded } = await import("./server/embedded.js");
  await mountAgentNativeEmbedded(nitroApp, options);
}

export function createAgentNativeEmbeddedPlugin(
  options: AgentNativeEmbeddedPluginOptions = {},
): NitroPluginDef {
  return (nitroApp) => {
    for (const stem of EMBEDDED_PLUGIN_STEMS) {
      markDefaultPluginProvided(nitroApp, stem);
    }
    const initPromise = mountAgentNativeEmbedded(nitroApp, options);
    trackPluginInit(nitroApp, initPromise);
    return initPromise;
  };
}

export { createServer, createSSEHandler };

export function defineNitroPlugin(def: NitroPluginDef): NitroPluginDef {
  return def;
}

export const autoMountAuth: (typeof import("./server/auth.js"))["autoMountAuth"] =
  (...args) =>
    import("./server/auth.js").then(({ autoMountAuth }) =>
      autoMountAuth(...args),
    );

export const getSession: (typeof import("./server/auth.js"))["getSession"] = (
  ...args
) => import("./server/auth.js").then(({ getSession }) => getSession(...args));
