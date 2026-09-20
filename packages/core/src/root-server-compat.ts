import type { AgentChatPluginOptions } from "./server/agent-chat-plugin.js";
import { createServer } from "./server/create-server.js";
import type { AgentNativeEmbeddedPluginOptions } from "./server/embedded.js";
import { createSSEHandler } from "./server/sse.js";

export type { AgentChatPluginOptions } from "./server/agent-chat-plugin.js";
export type { AgentNativeEmbeddedPluginOptions } from "./server/embedded.js";
export type { AuthOptions, AuthSession } from "./server/auth.js";
export type { CreateServerOptions } from "./server/create-server.js";
export type { SSEHandlerOptions } from "./server/sse.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

// The historical root exports remain available, but loading them must not
// pull the React auth document into a headless Node process.
export function createAgentChatPlugin(
  options?: AgentChatPluginOptions,
): NitroPluginDef {
  return (nitroApp) =>
    import("./server/agent-chat-plugin.js").then(({ createAgentChatPlugin }) =>
      createAgentChatPlugin(options)(nitroApp),
    );
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
  return (nitroApp) => mountAgentNativeEmbedded(nitroApp, options);
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
