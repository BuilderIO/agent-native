import type { ActionEntry } from "../../agent/production-agent.js";
import type { AgentLoopFinalResponseGuard } from "../../agent/production-agent.js";
import type {
  AgentChatAttachment,
  AgentChatReference,
  MentionProvider,
} from "../../agent/types.js";
import type { ExternalAgentPolicy } from "../../mcp/external-agent-policy.js";
import type { DatabaseToolsOption } from "../../scripts/db/tool-mode.js";
import type { PromptExamples } from "../prompts/index.js";

/** Shape of a Nitro plugin function: receives the Nitro app instance at
 * startup and may register routes/hooks synchronously or asynchronously. */
export type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

export interface AgentChatPluginOptions {
  /** Template-specific actions (email ops, booking ops, etc.) */
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
  /** System prompt for the agent. A sensible default is provided. */
  systemPrompt?: string;
  /** Additional system prompt prepended in dev mode */
  devSystemPrompt?: string;
  /** Model to use. Defaults to the resolved engine's default model. */
  model?: string;
  /** Optional per-app agent run chunk budget in milliseconds. Defaults to
   * AGENT_RUN_SOFT_TIMEOUT_MS when set, otherwise no framework-imposed
   * timeout. When reached, long runs continue through the hidden continuation
   * path instead of surfacing a timeout warning. */
  runSoftTimeoutMs?: number;
  /** Optional per-app run-manager no-progress watchdog in milliseconds. */
  runNoProgressTimeoutMs?: number;
  /**
   * Opt this app into Netlify durable background-function agent-chat runs. This
   * gives hosted agent turns the 15-minute async-function budget when the app's
   * Netlify build also emits the background function.
   */
  durableBackgroundRuns?: boolean;
  /** Anthropic API key. Falls back to ANTHROPIC_API_KEY env var */
  apiKey?: string;
  /**
   * Agent engine to use. Can be a pre-constructed AgentEngine, a registered
   * engine name (e.g. "anthropic", "ai-sdk:openai"), or an object with name
   * and config. Defaults to the "anthropic" engine using ANTHROPIC_API_KEY.
   */
  engine?:
    | import("../../agent/engine/types.js").AgentEngine
    | string
    | { name: string; config: Record<string, unknown> };
  /** Route path. Default: /_agent-native/agent-chat */
  path?: string;
  /** Custom mention providers for @-tagging template entities */
  mentionProviders?:
    | Record<string, MentionProvider>
    | (() =>
        | Record<string, MentionProvider>
        | Promise<Record<string, MentionProvider>>);
  /** App ID used to exclude self from agent discovery (e.g., "mail", "calendar") */
  appId?: string;
  /** Optional MCP server branding surfaced during the initialize handshake. */
  mcpServerInfo?: {
    /** Human-facing title. Defaults to the capitalized app id/name. */
    title?: string;
    /** Host-facing description. Defaults to "Agent-native <app> agent". */
    description?: string;
    /** Canonical app URL. Relative URLs are resolved against the request origin. */
    websiteUrl?: string;
    /** App icons. Relative `src` values are resolved against the request origin. */
    icons?: Array<{
      src: string;
      mimeType?: string;
      sizes?: string[];
      theme?: "light" | "dark";
    }>;
  };
  /**
   * Optional callback to resolve the org ID for the current request.
   * When provided, the resolved value is set as AGENT_ORG_ID env var so
   * that db-query/db-exec automatically scope by org_id in addition to
   * owner_email.
   *
   * If not provided, the framework automatically uses `session.orgId` from
   * Better Auth's active organization. Only provide this callback when you
   * need custom org resolution logic (e.g., Atlassian org mapping).
   */
  resolveOrgId?: (event: any) => string | null | Promise<string | null>;
  /**
   * Optional owner resolver for public/anonymous chat surfaces. When the
   * normal app session is missing, this callback may return a synthetic
   * owner id for a narrowly-scoped public request (for example, a public
   * shared document page). Anonymous requests use a read-only tool set by
   * default so public viewers cannot mutate app data through the agent.
   */
  anonymousOwner?: (event: any) => string | null | Promise<string | null>;
  /**
   * Keep anonymous-owner requests on read-only template actions. Defaults to
   * true. Only disable for single-tenant apps that intentionally allow public
   * agent mutations.
   */
  anonymousReadOnly?: boolean;
  /**
   * Optional callback to append template-specific context to the system
   * prompt on each request. Runs after AGENTS.md / skills / memory are
   * loaded and before the schema block — use it to inject dynamic SQL
   * context like a data dictionary, active feature flags, or whatever
   * the agent should know about *right now* for this user/org.
   *
   * Return `null` or an empty string to skip. The string you return is
   * appended verbatim, so wrap it in your own XML tags (e.g.
   * `<data-dictionary>…</data-dictionary>`) to keep the prompt scannable.
   *
   * Called on every request in every prompt variant (lean, lazy, full).
   * Templates that want to suppress it in a particular mode should return
   * `null` from the callback based on their own logic.
   */
  extraContext?: (
    event: any,
    owner: string,
  ) => string | null | Promise<string | null>;
  /**
   * Optional final-answer guard. Templates can use this to require a
   * corrective retry before accepting a text-only final answer, e.g. forcing
   * real data-source tool calls for analytics requests.
   */
  finalResponseGuard?: AgentLoopFinalResponseGuard;
  /**
   * Optional per-template request normalizer. Runs after authentication and
   * before the model sees the message, so apps can translate chat attachments
   * into template-native file handles while preserving the user's visible text.
   */
  prepareRequest?: (details: {
    event: any;
    ownerEmail: string | null;
    message: string;
    displayMessage?: string;
    attachments: AgentChatAttachment[];
    references: AgentChatReference[];
    threadId?: string;
    internalContinuation?: boolean;
    mode: "act" | "plan";
  }) =>
    | void
    | {
        message?: string;
        displayMessage?: string;
        attachments?: AgentChatAttachment[];
      }
    | Promise<void | {
        message?: string;
        displayMessage?: string;
        attachments?: AgentChatAttachment[];
      }>;
  /**
   * Use ONLY the template's `systemPrompt` and the actions list — skip the
   * framework prompt wrapper, resource loading (AGENTS.md/LEARNINGS.md/
   * memory), the SQL schema block, and the workspace files/skills/agents
   * inventory. Intended for minimal or voice-first apps where a long,
   * generic preamble adds latency and iteration noise without adding value.
   *
   * When set, the same lean prompt is used in both dev and prod modes. In
   * dev mode the tool registry is ALSO swapped to the template's actions
   * (same set as prod) — the dev-only bash/db-exec/file-system tools
   * and the resource/docs/chat/team/job/browser scripts are dropped. The
   * lean system prompt has no bash-usage guidance, so routing actions
   * through bash would break. If you need the full dev tool surface,
   * leave this off.
   */
  leanPrompt?: boolean;
  /**
   * Skip auto-injecting the workspace files/skills/agents inventory on the
   * first message of a conversation while keeping the normal prompt, resources,
   * and tool surface. Use this for domain-focused apps where broad workspace
   * inventory is mostly latency/noise unless the user explicitly references it.
   *
   * `leanPrompt: true` and the default `lazyContext` mode imply this because
   * those catalogs are already discoverable through resources, docs-search,
   * tool-search, and the compact resource indexes. Set `false` explicitly only
   * when a workspace-wide inventory is central to the app's first-turn job.
   */
  skipFilesContext?: boolean;
  /**
   * Initial native tool schemas to send to the LLM provider. When set, the
   * agent starts with only these tools plus `tool-search`; the live registry
   * remains searchable, and matching schemas from `tool-search` results are
   * loaded into the next model request. Use this for domain-focused apps that
   * have a few common actions and many rare framework utilities. Common
   * discovery and resource-reading tools are promoted automatically when
   * present. Provider, MCP, extension, and code-execution schemas stay behind
   * tool-search unless the app explicitly includes them in this list.
   */
  initialToolNames?: string[];
  /**
   * Use a compact system prompt with on-demand context loading. The system
   * prompt includes essential behavioral rules and action signatures, but
   * defers verbose framework details, SQL schema, skills, learnings, and
   * memory behind tools (`get-framework-context`, `db-schema`,
   * `resources` (action: read)). The agent fetches these on-demand when needed.
   *
   * This reduces the system prompt by ~60-70%, significantly improving
   * time-to-first-token and reducing "thinking" time. The agent retains
   * all capabilities — it just loads context lazily instead of upfront.
   *
   * Defaults to `true`. Set to `false` to use the original full prompt.
   * Ignored when `leanPrompt` is set (lean mode is even more minimal).
   */
  lazyContext?: boolean;
  /**
   * In dev mode, register the template's actions as native tools the agent
   * can call directly with structured JSON args — skipping the default
   * `bash(command="pnpm action <name> ...")` indirection.
   *
   * The default dev behavior shells out because it "mirrors how Claude Code
   * works locally" and reduces empty-object tool calls for templates with
   * simple string args. But templates whose actions take structured data
   * (objects, arrays, nested JSON) can't round-trip those cleanly through
   * the CLI parser — stringified JSON on the way in, loss of type fidelity
   * on the way out.
   *
   * Set to `true` to get the same tool surface in dev that production uses.
   * `leanPrompt: true` implies this already (lean mode has no bash-usage
   * guidance, so actions must be native). Set this flag without
   * `leanPrompt` when you want native actions AND the full system prompt.
   *
   * Defaults to `false`.
   */
  nativeActionsInDev?: boolean;
  /**
   * Expose raw SQL/native database tools to the app agent.
   *
   * Defaults to `"read"`: `db-schema`/`db-query` are available for inspection,
   * while writes route through typed app actions. Set to `"write"` (also
   * `true`) to expose `db-exec`/`db-patch` for scoped raw SQL maintenance.
   * Set to `"off"` (also `false`) for chat-first apps that want agents to use
   * typed actions only.
   */
  databaseTools?: DatabaseToolsOption;
  /**
   * Expose framework extension management actions (`create-extension`,
   * `update-extension`, `list-extensions`, etc.) to the app agent. Defaults to
   * true. Set to false for apps that do not want the LLM to create or manage
   * sandboxed extension mini-apps, even though the core extension routes may
   * still be mounted for other surfaces.
   */
  extensionTools?: boolean;
  /**
   * Optional A2A-only deterministic response path. Runs after inbound A2A text
   * and user context are resolved, but before an agent engine/model is loaded.
   * Return a message to complete the A2A task without invoking the LLM, or
   * null/undefined to continue through the normal agent loop.
   */
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
  /**
   * Optional injectable prompt examples for core rules (rule 5 auto-refresh
   * examples and rule 8 external provider names). When absent, generic
   * placeholders are used so no template-specific names appear in the core
   * prompt by default.
   *
   * - `providerActions`: external provider action names this template exposes
   *   (e.g. `["warehouse-query", "crm-records"]` for a template).
   * - `appActions`: representative template action names for rule 5's refresh
   *   examples (e.g. `["log-meal", "update-form"]` for a forms template).
   */
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
   * Declare here rather than in MCPConfig directly; the plugin copies it through.
   */
  connectorCatalog?: string[];

  /**
   * Default authenticated external-agent policy. In `auto` read mode, every
   * action explicitly marked as GET + readOnly + publicAgent.requiresAuth is
   * added to the connector surface automatically. Writes remain ask_app-only
   * unless `writes: "allowlisted"` is explicitly selected.
   */
  externalAgents?: ExternalAgentPolicy;

  /**
   * Skip mounting the remote MCP protocol route.
   *
   * Most apps should leave this off so agent chat, A2A, and MCP share one
   * runtime. Hosted apps with a dedicated early MCP plugin can set this to
   * true so their external connector does not depend on the heavier chat
   * plugin initialization path.
   */
  disableMcp?: boolean;

  /**
   * Code-execution capability for the production agent.
   *
   * - `"off"` (default) — no code-execution tools in production.
   * - `"sandboxed"` — registers the `run-code` tool (isolated Node.js sandbox
   *   with a bridge to allowlisted registered tools). Safe for shared or
   *   hosted deployments.
   * - `"trusted"` — registers both the full coding tool registry
   *   (bash / read / edit / write) and the `run-code` sandbox. Only use in
   *   single-tenant or operator-controlled deployments where full shell access
   *   to the host machine is intentional.
   *
   * The `AGENT_PROD_CODE_EXECUTION` environment variable (`"trusted"`,
   * `"sandboxed"`, or `"off"`) takes precedence over this option, allowing
   * per-deployment overrides without code changes.
   *
   * Dev-mode behavior is unchanged — both the coding tools and `run-code` are
   * always available when the environment allows toggling.
   */
  codeExecution?: {
    production?: "off" | "sandboxed" | "trusted";
    /**
     * Extra registered-tool names the sandbox bridge may forward (beyond the
     * default allowlist: provider-api-request, provider-api-docs,
     * provider-api-catalog, web-request).
     */
    bridgeTools?: string[];
  };

  /**
   * App-level default tool-call limits. Individual actions override these with
   * their own `timeoutMs` / `maxResultChars` declarations.
   */
  toolLimits?: { timeoutMs?: number; maxResultChars?: number };
}
