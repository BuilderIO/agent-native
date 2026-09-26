import type {
  ActionEntry,
  AgentLoopFinalResponseGuard,
  ProductionAgentOptions,
} from "../../agent/production-agent.js";
import type { ActiveRun } from "../../agent/run-manager.js";
import type { AgentChatScope, MentionProvider } from "../../agent/types.js";
import type { FrameworkToolsConfig } from "../../framework-tools.js";
import type { McpActionEntryOptions } from "../../mcp-client/index.js";
import type { ExternalAgentPolicy } from "../../mcp/external-agent-policy.js";
import type { DatabaseToolsOption } from "../../scripts/db/tool-mode.js";
import type { PromptExamples } from "../prompts/index.js";
import type { AgentChatMcpIcon, AgentChatMcpOptions } from "./mcp-options.js";

export type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

export interface AgentChatPluginOptions {
  onAgentTurnStart?: (
    scope: AgentChatScope,
    run: Pick<ActiveRun, "threadId" | "runId">,
  ) => void | Promise<void>;
  onAgentTurnComplete?: (
    scope: AgentChatScope,
    run: ActiveRun,
  ) => void | Promise<void>;
  onAgentRunComplete?: (
    scope: AgentChatScope | null | undefined,
    run: ActiveRun,
  ) => void | Promise<void>;
  actions?:
    | Record<string, ActionEntry>
    | (() =>
        | Record<string, ActionEntry>
        | Promise<Record<string, ActionEntry>>);
  /** @deprecated Use `actions` instead */
  scripts?:
    | Record<string, ActionEntry>
    | (() =>
        | Record<string, ActionEntry>
        | Promise<Record<string, ActionEntry>>);
  systemPrompt?: string;
  devSystemPrompt?: string;
  /**
   * Model to use. Defaults to the resolved engine's default model.
   *
   * @deprecated Set `agent.model` in `defineAppConfig()` (env alias
   * `AGENT_MODEL`) instead. This option stays the top layer of that field, so
   * passing it still wins; it exists only for mounts that need a different
   * model from the rest of the process, which no first-party app does.
   */
  model?: string;
  runSoftTimeoutMs?: number;
  runNoProgressTimeoutMs?: number;
  /**
   * Opt this app into Netlify durable background-function agent-chat runs. This
   * gives hosted agent turns the 15-minute async-function budget when the app's
   * Netlify build also emits the background function. Set this to `false` to
   * explicitly disable a stale deploy-wide `AGENT_CHAT_DURABLE_BACKGROUND`
   * flag for this app.
   *
   * @deprecated Passing `true` is redundant on Netlify, where
   * `isAgentChatDurableBackgroundEnabled` already defaults on unless
   * `AGENT_CHAT_DURABLE_BACKGROUND` is explicitly falsy. It still matters in
   * two cases, so it is not inert: `false` is a hard veto over a stale
   * deploy-wide flag, and `true` is the only way a non-Netlify hosted runtime
   * with a workspace background-function path opts in. Prefer setting
   * `AGENT_CHAT_DURABLE_BACKGROUND`, which the deploy-time emit gate in
   * `deploy/build.ts` can also see — this option is invisible to it.
   */
  durableBackgroundRuns?: boolean;
  apiKey?: string;
  engine?:
    | import("../../agent/engine/types.js").AgentEngine
    | string
    | { name: string; config: Record<string, unknown> };
  path?: string;
  mentionProviders?:
    | Record<string, MentionProvider>
    | (() =>
        | Record<string, MentionProvider>
        | Promise<Record<string, MentionProvider>>);
  appId?: string;
  connectApps?: boolean;
  backgroundMcpTools?: "requested" | "all";
  resolveMcpActionEntry?: McpActionEntryOptions["resolveActionEntry"];
  mcp?: AgentChatMcpOptions;

  /** @deprecated Use `mcp.title` / `mcp.description` / `mcp.websiteUrl` / `mcp.icons`. */
  mcpServerInfo?: {
    title?: string;
    description?: string;
    websiteUrl?: string;
    icons?: AgentChatMcpIcon[];
  };
  resolveOrgId?: (event: any) => string | null | Promise<string | null>;
  anonymousOwner?: (event: any) => string | null | Promise<string | null>;
  anonymousReadOnly?: boolean;
  /**
   * Optional auth adapter for the HTTP action route
   * (`/_agent-native/actions/*`). Its `resolveCaller` runs before the
   * cookie/bearer `getSession` chain, letting an app accept caller identities
   * `getSession` doesn't understand (e.g. an A2A JWT verified with
   * `verifyA2AToken`) declaratively, instead of pre-seeding request context
   * from a Nitro `request` hook.
   *
   * Returning `null` defers to the normal chain; THROWING hard-rejects with a
   * 401 (an invalid/forged credential must not fall through to a same-origin
   * session cookie). A resolved caller's org comes exclusively from the
   * verified credential — the returned `orgId` or the owner-email membership
   * lookup — never from the request's session cookie.
   * See {@link import("../action-routes.js").ActionRouteAuthAdapter}.
   */
  actionRouteAuth?: import("../action-routes.js").ActionRouteAuthAdapter;
  actionRoutePublicPaths?: string[];
  extraContext?: (
    event: any,
    owner: string,
  ) => string | null | Promise<string | null>;
  finalResponseGuard?: AgentLoopFinalResponseGuard;
  prepareRequest?: ProductionAgentOptions["prepareRequest"];
  resolveActionSurface?: ProductionAgentOptions["resolveActionSurface"];
  leanPrompt?: boolean;
  skipFilesContext?: boolean;
  initialToolNames?: string[];
  corpusTools?: "initial" | "lazy";
  lazyContext?: boolean;
  nativeActionsInDev?: boolean;
  frameworkTools?: FrameworkToolsConfig;
  /**
   * Expose raw SQL/native database tools to the app agent.
   *
   * Defaults to `"read"`: `db-schema`/`db-query` are available for inspection,
   * while writes route through typed app actions. Set to `"write"` (also
   * `true`) to expose `db-exec`/`db-patch` for scoped raw SQL maintenance.
   * Set to `"off"` (also `false`) for chat-first apps that want agents to use
   * typed actions only.
   *
   * @deprecated Use `frameworkTools: { database: … }`. Still honored for one
   * minor; setting both to conflicting values throws at plugin init.
   */
  databaseTools?: DatabaseToolsOption;
  /**
   * Expose framework extension management actions (`create-extension`,
   * `update-extension`, `list-extensions`, etc.) to the app agent. Defaults to
   * false. Set to true for apps that intentionally let the LLM create or
   * manage sandboxed extension mini-apps. Core extension routes may still be
   * mounted for compatibility and app-owned surfaces.
   *
   * @deprecated Use `frameworkTools: { extensions: … }`. Still honored for one
   * minor; setting both to conflicting values throws at plugin init.
   */
  extensionTools?: boolean;
  a2aMessageFallback?: (details: {
    message: import("../../a2a/types.js").Message;
    text: string;
    context: import("../../a2a/types.js").A2AHandlerContext;
    userEmail: string | undefined;
  }) =>
    | import("../../a2a/types.js").Message
    | string
    | null
    | undefined
    | Promise<import("../../a2a/types.js").Message | string | null | undefined>;
  promptExamples?: PromptExamples;
  /**
   * Curated allow-list of action names to serve external **connector** clients
   * on a hosted multi-tenant deployment.
   *
   * Whenever this list is non-empty it is active by default for **every**
   * caller (hosted connectors, code/stdio clients, and the local CLI): external
   * MCP clients see (and can call) only these actions plus the builtin
   * cross-app tools (`list_apps`, `open_app`, `ask_app`, `create_embed_session`).
   * Calls to any tool outside the list are rejected with "Unknown tool".
   * This prevents the full ~105-tool catalog from bloating external-agent
   * context windows and removes footguns (db-exec, seed-*, extension suite,
   * browser-session tools) from connectors. It is no longer gated behind an
   * environment variable, and the catalog is never inferred from the client.
   *
   * `tool-search` stays available for discovery; a trimmed action still needs
   * the connector catalog, authenticated-read policy, or full-catalog opt-in
   * before an external caller can execute it.
   * Callers who need the full surface up front opt in explicitly with
   * `agent-native connect --full-catalog` (embeds a `catalog_scope: "full"`
   * claim in their connect-minted JWT) or the deployment-wide
   * `AGENT_NATIVE_MCP_FULL_CATALOG=1` env override.
   *
   * @deprecated Use `mcp.connectorCatalog`.
   */
  connectorCatalog?: string[];

  /** @deprecated Use `mcp.externalAgents`. */
  externalAgents?: ExternalAgentPolicy;

  a2aAgentDelegation?: boolean;

  /**
   * @deprecated This rollout option is retained only for source compatibility
   * and has no runtime effect. Use `selectedA2AReceiverOwnsObjective` to opt an
   * app into stable selected-receiver behavior.
   */
  a2aReceiverOwnershipFlag?: string;

  selectedA2AReceiverOwnsObjective?: boolean;

  delegatedRunPolicy?: {
    maxIterations?: number;
    maxRunInputTokens?: number;
    maxToolResultChars?: number;
  };

  /** @deprecated Use `mcp: { enabled: false }`. */
  disableMcp?: boolean;

  codeExecution?: {
    production?: "off" | "sandboxed" | "trusted";
    bridgeTools?: string[];
  };

  toolLimits?: {
    timeoutMs?: number;
    maxResultChars?: number;
    hardMaxResultChars?: number;
  };
}

export function resolveA2AAgentDelegationEnabled(
  options?: Pick<AgentChatPluginOptions, "a2aAgentDelegation">,
): boolean {
  return options?.a2aAgentDelegation !== false;
}
