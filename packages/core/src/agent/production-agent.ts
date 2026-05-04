import {
  defineEventHandler,
  setResponseHeader,
  setResponseStatus,
  getMethod,
} from "h3";
import { isLocalDatabase } from "../db/client.js";
import { readDeployCredentialEnv } from "../server/credential-provider.js";
import type { EventHandler as H3EventHandler } from "h3";
import type {
  ActionTool,
  AgentChatAttachment,
  AgentChatRequest,
  AgentChatEvent,
  AgentChatReference,
} from "./types.js";
import type {
  AgentEngine,
  EngineTool,
  EngineMessage,
  EngineContentPart,
} from "./engine/types.js";
import { EngineError } from "./engine/types.js";
import {
  resolveEngine,
  registerBuiltinEngines,
  getStoredModelForEngine,
} from "./engine/index.js";
import { userFacingLlmCredentialError } from "./engine/credential-errors.js";
import { PROVIDER_TO_ENV } from "./engine/provider-env-vars.js";
import { readAppState } from "../application-state/script-helpers.js";
import {
  startRun,
  subscribeToRun,
  getActiveRunForThread,
  getActiveRunForThreadAsync,
  getRun,
  abortRun,
} from "./run-manager.js";
import type { ActiveRun } from "./run-manager.js";
import { readBody } from "../server/h3-helpers.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../server/request-context.js";
import { isMcpToolAllowedForRequest } from "../mcp-client/visibility.js";
import {
  createToolSearchEntry,
  TOOL_SEARCH_ACTION_NAME,
} from "./tool-search.js";
import {
  getDefaultMaxIterations,
  normalizeMaxIterations,
  readAgentLoopSettings,
} from "./loop-settings.js";
import {
  isReasoningEffort,
  normalizeReasoningEffortForModel,
  type ReasoningEffort,
} from "../shared/reasoning-effort.js";

// Register built-in engines on first import
registerBuiltinEngines();

export { PROVIDER_TO_ENV };

/**
 * Look up a user's persisted API key for the given provider. Returns
 * `undefined` for unauthenticated callers.
 *
 * Read order:
 *   1. `app_secrets` — encrypted, scope=user, current source of truth.
 *   2. Legacy `user-api-key:<provider>:<email>` settings row — pre-migration
 *      data that hasn't been backfilled yet. Surfaced for compat only;
 *      writes always go to app_secrets now.
 */
export async function getOwnerApiKey(
  provider: string,
  ownerEmail: string | null | undefined,
): Promise<string | undefined> {
  if (!ownerEmail) return undefined;
  const secretKey =
    PROVIDER_TO_ENV[provider] ?? `${provider.toUpperCase()}_API_KEY`;
  try {
    const { readAppSecret } = await import("../secrets/storage.js");
    const fromSecrets = await readAppSecret({
      key: secretKey,
      scope: "user",
      scopeId: ownerEmail,
    });
    if (fromSecrets?.value) return fromSecrets.value;
  } catch {
    // app_secrets table not ready — fall through to legacy lookup.
  }
  try {
    const { getSetting } = await import("../settings/store.js");
    const stored = await getSetting(`user-api-key:${provider}:${ownerEmail}`);
    const key =
      stored && typeof stored.key === "string" ? stored.key.trim() : "";
    if (key) return key;
    if (provider === "anthropic") {
      const legacy = await getSetting(`user-anthropic-api-key:${ownerEmail}`);
      const legacyKey =
        legacy && typeof legacy.key === "string" ? legacy.key.trim() : "";
      return legacyKey || undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Derive the provider name from the active engine setting.
 * "ai-sdk:openai" → "openai", "anthropic" → "anthropic"
 */
export function engineToProvider(engineName: string): string {
  return engineName.startsWith("ai-sdk:") ? engineName.slice(7) : engineName;
}

/**
 * Returns true when this process is acting as a multi-tenant deployment —
 * i.e. a hosted shared-DB environment where one user's identity must NOT be
 * silently substituted with the deploy-level API key.
 *
 * Mirrors the gate in `resolveBuilderCredential` (server/credential-provider.ts).
 *
 * Heuristic:
 *   - `NODE_ENV === "production"`, AND
 *   - The DB is not a local file (i.e. it's Neon/Postgres/Turso/D1 — any
 *     backend that could be shared across multiple users).
 *
 * Self-hosted single-tenant deployments (a local sqlite file, or NODE_ENV
 * unset/development) keep the env-var fallback so the original BYO-server
 * UX continues to work without a per-user key.
 */
function isMultiTenantDeploy(): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  return !isLocalDatabase();
}

/**
 * Resolve the active engine's provider and look up the user's API key for it.
 *
 * In multi-tenant deploys we deliberately refuse the deploy-level
 * deploy-level fallback for authenticated users. Without that gate any
 * signed-in user who hasn't configured their own provider key would silently
 * inherit the deployment's key (uncapped billing on the owner's account,
 * prompt logging tied to the deployment owner) — exactly the prior-incident
 * pattern we hit on 2026-04-29.
 *
 * Single-tenant (local-dev, self-hosted SQLite) keeps the env fallback.
 *
 * Callers in `agent-chat-plugin.ts`, `triggers/dispatcher.ts`,
 * `jobs/scheduler.ts`, and `integrations/plugin.ts` historically layer
 * another deployment-key fallback after this must keep the same gate.
 */
export async function getOwnerActiveApiKey(
  ownerEmail: string | null | undefined,
): Promise<string | undefined> {
  try {
    const { getSetting } = await import("../settings/store.js");
    const engineSetting = await getSetting("agent-engine");
    const activeEngine =
      (engineSetting?.engine as string | undefined) ?? "anthropic";
    const provider = engineToProvider(activeEngine);
    const userKey = await getOwnerApiKey(provider, ownerEmail);
    if (userKey) return userKey;
    if (isMultiTenantDeploy()) {
      // Multi-tenant: refuse the env fallback. A null user (unauthenticated /
      // background context with no owner) gets undefined here too — there's
      // no user to bill, and the call site must surface a "configure a key"
      // error to the requester rather than silently using the deploy key.
      return undefined;
    }
    const envVar = PROVIDER_TO_ENV[provider];
    return envVar ? readDeployCredentialEnv(envVar) : undefined;
  } catch {
    return undefined;
  }
}

/** @deprecated Use getOwnerApiKey("anthropic", ownerEmail) instead */
export async function getOwnerAnthropicApiKey(
  ownerEmail: string | null | undefined,
): Promise<string | undefined> {
  return getOwnerApiKey("anthropic", ownerEmail);
}

/** Context passed to action run() for emitting intermediate events */
export interface ActionRunContext {
  /** Emit an SSE event to the client (e.g., agent_call_text for streaming) */
  send: (event: AgentChatEvent) => void;
}

export interface ActionEntry {
  tool: ActionTool;
  run: (
    args: Record<string, string>,
    context?: ActionRunContext,
  ) => Promise<any>;
  /** HTTP exposure config. `false` = agent-only. Omitted = auto-inferred from name. */
  http?: import("../action.js").ActionHttpConfig | false;
  /** If true, completion does NOT trigger a screen-refresh poll event.
   *  Set automatically by `defineAction` when `http.method === "GET"`. */
  readOnly?: boolean;
  /** If true, this action can run concurrently with other same-turn
   *  read-only/parallel-safe tool calls. Only use for actions that handle
   *  their own write ordering and idempotency. */
  parallelSafe?: boolean;
  /** Whether this action may be invoked from the tools-iframe bridge.
   *  **Default-allow opt-out**: only an explicit `false` returns 403.
   *  - `true` / `undefined` — allow.
   *  - `false` — explicit deny; the tools bridge returns 403.
   *  See `defineAction` (`packages/core/src/action.ts`) and audit H5 in
   *  `security-audit/05-tools-sandbox.md`. */
  toolCallable?: boolean;
}

/** @deprecated Use `ActionEntry` instead */
export type ScriptEntry = ActionEntry;

export type AgentExecutionMode = "act" | "plan";

export const PLAN_MODE_SYSTEM_PROMPT = `## Plan Mode Active

You are in Plan mode. This turn is for research, clarification, and a proposed approach only.

Hard rules:
- Use only read-only tools. Do not edit files, write resources, run shell commands, mutate SQL rows, navigate the UI, send notifications, create jobs, create tools, call external agents, or change external systems.
- If a needed detail is unclear, ask a concise clarifying question before proposing a plan.
- When ready, present a concrete plan with the files/tools you expect to touch, the intended changes, validation steps, and notable risks.
- Do not treat approval as implicit while Plan mode is still active. Tell the user to switch to Act mode with the mode selector, Shift+Tab, or /act before implementation.`;

const PLAN_MODE_BLOCKED_READONLY_TOOLS = new Set([
  "refresh-screen",
  "set-search-params",
  "set-url-path",
]);

const PLAN_MODE_ALLOWED_ACTIONS: Record<string, readonly string[]> = {
  resources: ["list", "read"],
  "chat-history": ["search"],
  "agent-teams": ["status", "read-result", "list"],
  "manage-jobs": ["list"],
  "manage-automations": ["list-events", "list"],
  "manage-notifications": ["list"],
  "manage-progress": ["list"],
  "manage-agent-engine": ["list"],
};

const PLAN_MODE_WEB_REQUEST_METHODS = new Set(["GET", "HEAD"]);

function getToolAction(name: string, args: unknown): string {
  const raw =
    args && typeof args === "object" && "action" in args
      ? (args as Record<string, unknown>).action
      : undefined;
  if (raw == null && name === "chat-history") return "search";
  return String(raw ?? "").toLowerCase();
}

function getWebRequestMethod(args: unknown): string {
  const raw =
    args && typeof args === "object" && "method" in args
      ? (args as Record<string, unknown>).method
      : undefined;
  return String(raw ?? "GET").toUpperCase();
}

function restrictActionEnum(
  parameters: ActionTool["parameters"] | undefined,
  allowedActions: readonly string[],
): ActionTool["parameters"] | undefined {
  if (!parameters) return parameters;
  const actionParam = parameters.properties.action;
  if (!actionParam) return parameters;
  return {
    ...parameters,
    properties: {
      ...parameters.properties,
      action: {
        ...actionParam,
        enum: [...allowedActions],
      },
    },
  };
}

function restrictWebRequestMethods(
  parameters: ActionTool["parameters"] | undefined,
): ActionTool["parameters"] | undefined {
  if (!parameters) return parameters;
  const methodParam = parameters.properties.method;
  if (!methodParam) return parameters;
  return {
    ...parameters,
    properties: {
      ...parameters.properties,
      method: {
        ...methodParam,
        enum: [...PLAN_MODE_WEB_REQUEST_METHODS],
      },
    },
  };
}

function planModeBlockedMessage(toolName: string, reason?: string): string {
  return (
    `Plan mode blocked \`${toolName}\`` +
    (reason ? ` (${reason})` : "") +
    ". Switch to Act mode after the user approves the plan, then retry the action."
  );
}

export function isPlanModeToolCallAllowed(
  name: string,
  input: unknown,
  entry: ActionEntry,
): boolean {
  if (PLAN_MODE_BLOCKED_READONLY_TOOLS.has(name)) return false;

  if (name === "web-request") {
    return PLAN_MODE_WEB_REQUEST_METHODS.has(getWebRequestMethod(input));
  }

  const allowedActions = PLAN_MODE_ALLOWED_ACTIONS[name];
  if (allowedActions) {
    return allowedActions.includes(getToolAction(name, input));
  }

  return entry.readOnly === true;
}

function createPlanModeGuardedAction(
  name: string,
  entry: ActionEntry,
  allowedActions: readonly string[],
): ActionEntry {
  return {
    ...entry,
    readOnly: true,
    tool: {
      ...entry.tool,
      description:
        `${entry.tool.description}\n\nPlan mode: only these read-only actions are available: ` +
        allowedActions.map((action) => `"${action}"`).join(", ") +
        ".",
      parameters: restrictActionEnum(entry.tool.parameters, allowedActions),
    },
    run: async (args, context) => {
      const action = getToolAction(name, args);
      if (!allowedActions.includes(action)) {
        return planModeBlockedMessage(
          name,
          `action="${action || "(missing)"}"`,
        );
      }
      return entry.run(args, context);
    },
  };
}

function createPlanModeWebRequestAction(entry: ActionEntry): ActionEntry {
  return {
    ...entry,
    readOnly: true,
    tool: {
      ...entry.tool,
      description: `${entry.tool.description}\n\nPlan mode: only GET and HEAD requests are allowed.`,
      parameters: restrictWebRequestMethods(entry.tool.parameters),
    },
    run: async (args, context) => {
      const method = getWebRequestMethod(args);
      if (!PLAN_MODE_WEB_REQUEST_METHODS.has(method)) {
        return planModeBlockedMessage("web-request", `method="${method}"`);
      }
      return entry.run(args, context);
    },
  };
}

export function createPlanModeActionRegistry(
  actions: Record<string, ActionEntry>,
): Record<string, ActionEntry> {
  const filtered: Record<string, ActionEntry> = {};

  for (const [name, entry] of Object.entries(actions)) {
    if (name === TOOL_SEARCH_ACTION_NAME) continue;
    if (PLAN_MODE_BLOCKED_READONLY_TOOLS.has(name)) continue;

    const allowedActions = PLAN_MODE_ALLOWED_ACTIONS[name];
    if (allowedActions) {
      filtered[name] = createPlanModeGuardedAction(name, entry, allowedActions);
      continue;
    }

    if (name === "web-request") {
      filtered[name] = createPlanModeWebRequestAction(entry);
      continue;
    }

    if (entry.readOnly === true) {
      filtered[name] = entry;
    }
  }

  if (actions[TOOL_SEARCH_ACTION_NAME]) {
    filtered[TOOL_SEARCH_ACTION_NAME] = createToolSearchEntry(() => filtered);
  }

  return filtered;
}

export interface ProductionAgentOptions {
  /** Action entries for the agent. Use `actions` (preferred) or `scripts` (deprecated alias). */
  actions?: Record<string, ActionEntry>;
  /** @deprecated Use `actions` instead */
  scripts?: Record<string, ActionEntry>;
  /** Static system prompt string, or async function called per-request with the H3 event */
  systemPrompt: string | ((event: any) => string | Promise<string>);
  /** Falls back to ANTHROPIC_API_KEY env var. Ignored when `engine` is provided. */
  apiKey?: string;
  /** Agent engine to use. Defaults to the "anthropic" engine. */
  engine?:
    | AgentEngine
    | string
    | { name: string; config: Record<string, unknown> };
  /** Model to use. Default: claude-sonnet-4-6 */
  model?: string;
  /** Default reasoning effort for requests that do not supply an override. */
  reasoningEffort?: ReasoningEffort;
  /** Provider-specific options passed through to the engine */
  providerOptions?: EngineMessage extends never ? never : any;
  /** Called when a run completes (for server-side thread persistence) */
  onRunComplete?: (run: ActiveRun, threadId: string | undefined) => void;
  /** Optional per-app agent run chunk budget in milliseconds. Defaults to
   *  AGENT_RUN_SOFT_TIMEOUT_MS when set, otherwise no framework-imposed
   *  timeout. When reached, the client receives an internal auto-continuation
   *  signal instead of a user-facing warning. */
  runSoftTimeoutMs?: number;
  /** Called when a run starts, with the send function for emitting events and the threadId */
  onRunStart?: (
    send: (event: AgentChatEvent) => void,
    threadId: string,
  ) => void;
  /**
   * Called after the engine + model are resolved for this request. Used by
   * the plugin layer to thread the parent's choices into sub-agents so
   * delegated tasks don't default back to Anthropic + Claude.
   */
  onEngineResolved?: (engine: AgentEngine, model: string) => void;
  /** Resolve the owner email from the H3 event (for usage tracking) */
  resolveOwnerEmail?: (event: any) => string | Promise<string>;
  /**
   * Skip auto-injecting the workspace files/skills/agents inventory on the
   * first message of a conversation. Useful for minimal/voice apps where
   * the ~2KB inventory of unrelated resources is noise, not signal.
   * Default: false (inventory is injected).
   */
  skipFilesContext?: boolean;
}

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;

function generateRunId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Check if an error is transient and should be retried */
function isContextTooLongError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  if (
    msg.includes("context_length_exceeded") ||
    msg.includes("input_too_long") ||
    msg.includes("too many tokens") ||
    msg.includes("prompt is too long") ||
    msg.includes("reduce the length")
  )
    return true;
  if (err instanceof EngineError) {
    const code = (err.errorCode ?? "").toLowerCase();
    if (code.includes("context_length") || code.includes("input_too_long"))
      return true;
  }
  return false;
}

function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  const code =
    err instanceof EngineError ? (err.errorCode ?? "").toLowerCase() : "";
  if (code === "builder_gateway_timeout") return false;
  return (
    code === "http_502" ||
    code === "http_503" ||
    code === "http_504" ||
    code === "timeout" ||
    msg.includes("overloaded") ||
    msg.includes("rate_limit") ||
    msg.includes("529") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504") ||
    msg.includes("too many requests") ||
    msg.includes("timeout") ||
    msg.includes("gateway timeout") ||
    msg.includes("inactivity timeout") ||
    msg.includes("too much time has passed without sending any data")
  );
}

/** Wait with exponential backoff, respecting abort signal */
function retryDelay(attempt: number, signal: AbortSignal): Promise<void> {
  const baseMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = baseMs * 0.1;
  const ms = Math.max(0, baseMs + (Math.random() * 2 - 1) * jitter);
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("aborted"));
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}

type SupportedImageMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp";

function isSupportedImageMediaType(
  mediaType: string,
): mediaType is SupportedImageMediaType {
  return (
    mediaType === "image/jpeg" ||
    mediaType === "image/png" ||
    mediaType === "image/gif" ||
    mediaType === "image/webp"
  );
}

function escapeAttachmentAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatTextAttachment(att: AgentChatAttachment): string | null {
  if (typeof att.text !== "string" || att.text.length === 0) return null;

  const attrs = [
    `name="${escapeAttachmentAttribute(att.name || "attachment")}"`,
    att.contentType
      ? `contentType="${escapeAttachmentAttribute(att.contentType)}"`
      : null,
    att.type ? `type="${escapeAttachmentAttribute(att.type)}"` : null,
  ].filter(Boolean);

  return `<attachment ${attrs.join(" ")}>\n${att.text}\n</attachment>`;
}

function dataUrlToFilePart(
  att: AgentChatAttachment,
): { type: "file"; data: string; mediaType: string; filename?: string } | null {
  if (att.type !== "file" || typeof att.data !== "string") return null;
  const match = att.data.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return {
    type: "file",
    data: match[2],
    mediaType: att.contentType || match[1],
    filename: att.name || undefined,
  };
}

export function buildUserContentWithAttachments(opts: {
  text: string;
  attachments?: AgentChatAttachment[];
}): EngineContentPart[] {
  const userContent: EngineContentPart[] = [];
  const textAttachments: string[] = [];

  for (const att of opts.attachments ?? []) {
    if (att.type === "image" && att.data) {
      const match = att.data.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (match && isSupportedImageMediaType(match[1])) {
        userContent.push({
          type: "image",
          data: match[2],
          mediaType: match[1],
        });
      }
      continue;
    }

    const filePart = dataUrlToFilePart(att);
    if (filePart) {
      userContent.push(filePart);
      continue;
    }

    const textAttachment = formatTextAttachment(att);
    if (textAttachment) {
      textAttachments.push(textAttachment);
    }
  }

  userContent.push({
    type: "text",
    text:
      textAttachments.length > 0
        ? `${textAttachments.join("\n\n")}\n\n${opts.text}`
        : opts.text,
  });

  return userContent;
}

/** Build enriched message with file/skill/mention references */
function enrichMessage(
  message: string,
  references: AgentChatReference[],
): string {
  if (references.length === 0) return message;

  const fileRefs = references.filter((r) => r.type === "file");
  const skillRefs = references.filter((r) => r.type === "skill");
  const customAgentRefs = references.filter((r) => r.type === "custom-agent");
  const mentionRefs = references.filter((r) => r.type === "mention");

  const parts: string[] = [];
  if (fileRefs.length > 0) {
    parts.push(
      "Referenced files:\n" +
        fileRefs
          .map(
            (r) => `- ${r.path}${r.source === "resource" ? " (resource)" : ""}`,
          )
          .join("\n"),
    );
  }
  if (skillRefs.length > 0) {
    parts.push(
      "Applied skills:\n" +
        skillRefs
          .map(
            (r) =>
              `- ${r.name} (${r.path})${r.source === "resource" ? " — read with resource-read" : " — read with read-file"}`,
          )
          .join("\n"),
    );
  }
  if (customAgentRefs.length > 0) {
    parts.push(
      "Requested custom agents:\n" +
        customAgentRefs
          .map(
            (r) =>
              `- ${r.name}${r.refId ? ` (id: ${r.refId})` : ""}${r.path ? ` (path: ${r.path})` : ""}`,
          )
          .join("\n"),
    );
  }
  if (mentionRefs.length > 0) {
    parts.push(
      "Referenced items:\n" +
        mentionRefs
          .map(
            (r) =>
              `- [${r.refType || "item"}] ${r.name}${r.refId ? ` (id: ${r.refId})` : ""}${r.path ? ` (path: ${r.path})` : ""}`,
          )
          .join("\n"),
    );
  }

  return `${parts.join("\n\n")}\n\n${message}`;
}

/** Accumulated token usage from an agent loop run */
export interface AgentLoopUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  model: string;
}

export const AGENT_INTERNAL_CONTINUE_PROMPT =
  "Continue from where you left off and finish the user's original request. Do not repeat completed work, do not mention internal reconnects, time limits, or step limits, and continue as if this is the same uninterrupted run.";

export function appendAgentLoopContinuation(
  messages: EngineMessage[],
  reason: "run_timeout" | "loop_limit" | "stream_ended",
) {
  const note =
    reason === "loop_limit"
      ? "The previous run reached an internal step budget."
      : reason === "stream_ended"
        ? "The previous stream ended before the agent sent a final completion signal."
        : "The previous run reached an internal execution budget.";
  messages.push({
    role: "user",
    content: [
      {
        type: "text",
        text: `${AGENT_INTERNAL_CONTINUE_PROMPT}\n\nInternal note: ${note}`,
      },
    ],
  });
}

/**
 * Convert ActionEntry registry to EngineTool array.
 */
export function actionsToEngineTools(
  actions: Record<string, ActionEntry>,
): EngineTool[] {
  const tools: EngineTool[] = [];
  for (const [name, entry] of Object.entries(actions)) {
    const inputSchema = normalizeToolInputSchema(entry.tool.parameters);
    if (!inputSchema) {
      console.warn(
        `[agent] Skipping tool "${name}" because its input schema is not an object.`,
      );
      continue;
    }
    tools.push({
      name,
      description: entry.tool.description,
      inputSchema,
    });
  }
  return tools;
}

function normalizeToolInputSchema(
  schema: ActionTool["parameters"] | undefined,
): EngineTool["inputSchema"] | null {
  if (!schema) return { type: "object", properties: {} };
  if (schema.type !== "object") return null;
  return {
    ...schema,
    type: "object",
    properties:
      schema.properties && typeof schema.properties === "object"
        ? schema.properties
        : {},
    required: Array.isArray(schema.required) ? schema.required : [],
  };
}

function stringifyToolInput(input: unknown): string {
  try {
    const str = JSON.stringify(input);
    if (!str) return String(input);
    return str.length > 500 ? `${str.slice(0, 500)}…` : str;
  } catch {
    return String(input);
  }
}

function normalizeToolCallInputForHistory(
  input: unknown,
): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return { rawInput: input };
}

function toolInputSchemaErrorResult(
  toolName: string,
  input: unknown,
  error: string,
): string {
  return (
    `Invalid action parameters for ${toolName}: ${error}. ` +
    `Received: ${stringifyToolInput(input)}. ` +
    "The tool was not executed; retry with arguments that match the tool schema."
  );
}

/**
 * The core agent loop — calls the engine iteratively until no more tool calls.
 * Decoupled from HTTP transport so it can run in the background.
 * Returns accumulated token usage for cost tracking.
 */
export async function runAgentLoop(opts: {
  engine: AgentEngine;
  model: string;
  systemPrompt: string;
  tools: EngineTool[];
  messages: EngineMessage[];
  actions: Record<string, ActionEntry>;
  send: (event: AgentChatEvent) => void;
  signal: AbortSignal;
  ownerEmail?: string | null;
  orgId?: string | null;
  reasoningEffort?: ReasoningEffort;
  providerOptions?: any;
  executionMode?: AgentExecutionMode;
  maxIterations?: number;
}): Promise<AgentLoopUsage> {
  const {
    engine,
    model,
    systemPrompt,
    tools,
    messages,
    actions,
    send,
    signal,
  } = opts;

  const usage: AgentLoopUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    model,
  };

  const maxIterations = normalizeMaxIterations(
    opts.maxIterations,
    getDefaultMaxIterations(),
  );
  let iterations = 0;
  while (true) {
    if (signal.aborted) break;
    if (++iterations > maxIterations) {
      appendAgentLoopContinuation(messages, "loop_limit");
      iterations = 1;
    }

    let assistantContent: EngineContentPart[] | undefined;
    const toolCallErrors = new Map<
      string,
      { name: string; input: unknown; error: string }
    >();

    for (let retry = 0; ; retry++) {
      assistantContent = undefined;
      toolCallErrors.clear();
      try {
        const streamOpts = {
          model,
          systemPrompt,
          messages,
          tools,
          abortSignal: signal,
          reasoningEffort: opts.reasoningEffort,
          providerOptions: opts.providerOptions,
        };

        const eventStream = engine.stream(streamOpts);
        let thinkingBuffer = "";

        for await (const event of eventStream) {
          if (event.type === "text-delta") {
            send({ type: "text", text: event.text });
          } else if (event.type === "thinking-delta") {
            thinkingBuffer += event.text;
            // Thinking deltas are not forwarded to the SSE client yet —
            // we accumulate them. In a future iteration, we can surface
            // them as a collapsible "reasoning" section in the UI.
          } else if (event.type === "tool-call") {
            // The authoritative tool-call blocks arrive in assistant-content.
          } else if (event.type === "tool-call-error") {
            toolCallErrors.set(event.id, {
              name: event.name,
              input: event.input,
              error: event.error,
            });
          } else if (event.type === "assistant-content") {
            assistantContent = event.parts;
          } else if (event.type === "usage") {
            usage.inputTokens += event.inputTokens;
            usage.outputTokens += event.outputTokens;
            usage.cacheReadTokens += event.cacheReadTokens ?? 0;
            usage.cacheWriteTokens += event.cacheWriteTokens ?? 0;
          } else if (event.type === "stop" && event.reason === "error") {
            throw new EngineError(event.error ?? "Engine stream error", {
              errorCode: event.errorCode,
              upgradeUrl: event.upgradeUrl,
            });
          }
        }

        break;
      } catch (err: unknown) {
        if (signal.aborted) throw err;
        if (isContextTooLongError(err)) {
          throw new EngineError(
            "Conversation has grown too long. Start a new conversation to continue.",
            { errorCode: "context_length_exceeded" },
          );
        }
        if (retry < MAX_RETRIES && isRetryableError(err)) {
          // Clear partial text from the failed attempt so the retry
          // doesn't produce garbled duplicate output. Keep the retry itself
          // silent so transient provider/backend failures do not leak into
          // the assistant's final answer.
          send({ type: "clear" });
          await retryDelay(retry, signal);
          continue;
        }
        throw err;
      }
    }

    if (!assistantContent && toolCallErrors.size > 0) {
      assistantContent = [];
    }

    if (!assistantContent) {
      // No content — done
      break;
    }

    if (toolCallErrors.size > 0) {
      const existingToolCallIds = new Set(
        assistantContent
          .filter(
            (part): part is import("./engine/types.js").EngineToolCallPart =>
              part.type === "tool-call",
          )
          .map((part) => part.id),
      );
      for (const [id, info] of toolCallErrors) {
        if (!existingToolCallIds.has(id)) {
          assistantContent.push({
            type: "tool-call",
            id,
            name: info.name,
            input: info.input,
          });
        }
      }
    }

    const assistantContentForHistory = assistantContent.map((part) =>
      part.type === "tool-call"
        ? {
            ...part,
            input: normalizeToolCallInputForHistory(part.input),
          }
        : part,
    );

    messages.push({ role: "assistant", content: assistantContentForHistory });

    const toolCallParts = assistantContent.filter(
      (p): p is import("./engine/types.js").EngineToolCallPart =>
        p.type === "tool-call",
    );

    if (toolCallParts.length === 0) break;

    const runToolCall = async (
      toolCall: import("./engine/types.js").EngineToolCallPart,
    ): Promise<EngineContentPart> => {
      const actionEntry = actions[toolCall.name];
      if (!actionEntry) {
        const result = `Error: Unknown tool "${toolCall.name}"`;
        send({
          type: "tool_start",
          tool: toolCall.name,
          input: toolCall.input as Record<string, string>,
        });
        send({ type: "tool_done", tool: toolCall.name, result });
        return {
          type: "tool-result" as const,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: result,
          isError: true,
        };
      }

      send({
        type: "tool_start",
        tool: toolCall.name,
        input: toolCall.input as Record<string, string>,
      });

      const toolCallSchemaError = toolCallErrors.get(toolCall.id);
      if (toolCallSchemaError) {
        const result = toolInputSchemaErrorResult(
          toolCall.name,
          toolCallSchemaError.input,
          toolCallSchemaError.error,
        );
        send({ type: "tool_done", tool: toolCall.name, result });
        return {
          type: "tool-result" as const,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: result,
          isError: true,
        };
      }

      if (
        opts.executionMode === "plan" &&
        !isPlanModeToolCallAllowed(toolCall.name, toolCall.input, actionEntry)
      ) {
        const result = planModeBlockedMessage(toolCall.name);
        send({ type: "tool_done", tool: toolCall.name, result });
        return {
          type: "tool-result" as const,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: result,
          isError: true,
        };
      }

      const MAX_TOOL_RESULT_CHARS = 50_000;
      const TOOL_TIMEOUT_MS = 60_000;
      let result: string;
      let isError = false;
      try {
        const timeoutSignal = AbortSignal.timeout(TOOL_TIMEOUT_MS);
        const raw = await Promise.race([
          actionEntry.run(toolCall.input as Record<string, string>, { send }),
          new Promise<never>((_, reject) => {
            timeoutSignal.addEventListener("abort", () =>
              reject(new Error("Tool call timed out after 60 seconds")),
            );
          }),
        ]);
        let resultStr =
          typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
        if (resultStr.length > MAX_TOOL_RESULT_CHARS) {
          const truncated = resultStr.slice(0, MAX_TOOL_RESULT_CHARS);
          resultStr = `${truncated}\n\n...[truncated — full result was ${resultStr.length.toLocaleString()} chars; only first ${MAX_TOOL_RESULT_CHARS.toLocaleString()} shown]`;
        }
        result = resultStr;
      } catch (err: any) {
        result = `Error running ${toolCall.name}: ${err?.message ?? String(err)}`;
        isError = true;
      }

      // Auto-refresh the UI after a successful mutating tool call. Any action
      // that isn't explicitly read-only is assumed to mutate. The client's
      // useDbSync listener sees a poll event with source:"action" and
      // invalidates ["action"] queries so list-* / get-* refetch. This makes
      // refresh after agent writes reliable without the model needing to
      // remember to call `refresh-screen` itself.
      if (!isError && actionEntry.readOnly !== true) {
        try {
          const { recordChange } = await import("../server/poll.js");
          const owner = opts.ownerEmail ?? getRequestUserEmail() ?? undefined;
          const orgId = opts.orgId ?? getRequestOrgId() ?? undefined;
          recordChange({
            source: "action",
            type: "change",
            key: toolCall.name,
            ...(owner ? { owner } : {}),
            ...(orgId ? { orgId } : {}),
          });
        } catch {
          // poll module may be unavailable in non-server contexts — ignore
        }
      }

      send({ type: "tool_done", tool: toolCall.name, result });
      return {
        type: "tool-result" as const,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: result,
        ...(isError ? { isError } : {}),
      };
    };

    type ParallelBatchKind = "read" | "parallel-write";
    const getParallelBatchKind = (
      toolCall: import("./engine/types.js").EngineToolCallPart,
    ): ParallelBatchKind | null => {
      const entry = actions[toolCall.name];
      if (!entry || entry.readOnly === true) return "read";
      if (entry.parallelSafe === true) return "parallel-write";
      return null;
    };

    // Engines can emit several tool-call blocks in one turn. Read-only calls
    // are always parallel. Mutating calls remain serialized by default, but
    // consecutive actions that explicitly declare `parallelSafe` can run in a
    // write batch. Reads and writes are separate batches so the model's stated
    // order still controls what data a same-turn read can observe.
    const toolResultParts: EngineContentPart[] = [];
    let parallelBatch: import("./engine/types.js").EngineToolCallPart[] = [];
    let parallelBatchKind: ParallelBatchKind | null = null;
    const flushParallelBatch = async () => {
      if (parallelBatch.length === 0) return;
      const batch = parallelBatch;
      parallelBatch = [];
      parallelBatchKind = null;
      toolResultParts.push(...(await Promise.all(batch.map(runToolCall))));
    };

    for (const toolCall of toolCallParts) {
      const batchKind = getParallelBatchKind(toolCall);
      if (batchKind) {
        if (parallelBatchKind && parallelBatchKind !== batchKind) {
          await flushParallelBatch();
        }
        parallelBatchKind = batchKind;
        parallelBatch.push(toolCall);
      } else {
        await flushParallelBatch();
        toolResultParts.push(await runToolCall(toolCall));
      }
    }
    await flushParallelBatch();

    messages.push({ role: "user", content: toolResultParts });
  }

  if (!signal.aborted) send({ type: "done" });
  return usage;
}

export function createProductionAgentHandler(
  options: ProductionAgentOptions,
): H3EventHandler {
  // Undefined = let each engine pick its own defaultModel at request time.
  const configuredModel = options.model;

  // Resolve actions — prefer `actions`, fall back to deprecated `scripts`
  const resolvedActions = options.actions ?? options.scripts ?? {};

  // Engine tools are derived from the action registry at request time so that
  // registries which mutate after handler creation (e.g. MCP servers added via
  // the settings UI) show up to the LLM without a process restart. MCP tools
  // are also scope-filtered per request — a user-scope server added by Alice
  // must not appear in Bob's tool list in a shared-process deployment.
  const getEngineTools = (
    actions: Record<string, ActionEntry> = resolvedActions,
  ) => {
    const filtered: Record<string, ActionEntry> = {};
    for (const [name, entry] of Object.entries(actions)) {
      if (name.startsWith("mcp__") && !isMcpToolAllowedForRequest(name)) {
        continue;
      }
      filtered[name] = entry;
    }
    return actionsToEngineTools(filtered);
  };

  return defineEventHandler(async (event) => {
    if (getMethod(event) !== "POST") {
      setResponseStatus(event, 405);
      return { error: "Method not allowed" };
    }

    let body: AgentChatRequest;
    try {
      body = await readBody(event);
    } catch {
      setResponseStatus(event, 400);
      return { error: "Invalid request body" };
    }

    const {
      message,
      history = [],
      references = [],
      threadId,
      attachments,
      model: requestModel,
      engine: requestEngine,
      effort: requestEffort,
    } = body;
    const requestMode: AgentExecutionMode =
      body.mode === "plan" ? "plan" : "act";
    if (!message) {
      setResponseStatus(event, 400);
      return { error: "message is required" };
    }

    // Resolve owner first so we can look up a per-owner API key. Users
    // who bring their own key use their key for this request (durable
    // across serverless cold starts via the settings table).
    let ownerEmail: string | null = null;
    if (options.resolveOwnerEmail) {
      try {
        ownerEmail = await options.resolveOwnerEmail(event);
      } catch {
        ownerEmail = null;
      }
    }

    // When a per-request engine override is specified, resolve the API key
    // for that provider instead of the global active engine's provider.
    let userApiKey: string | undefined;
    if (requestEngine) {
      const provider = engineToProvider(requestEngine);
      userApiKey = await getOwnerApiKey(provider, ownerEmail);
      if (!userApiKey && !isMultiTenantDeploy()) {
        // Single-tenant only: env fallback for the requested provider.
        // Multi-tenant deploys never silently substitute the deploy-level
        // key for an authenticated user (see getOwnerActiveApiKey for the
        // full rationale).
        const envVar = PROVIDER_TO_ENV[provider];
        userApiKey = envVar ? readDeployCredentialEnv(envVar) : undefined;
      }
    } else {
      userApiKey = await getOwnerActiveApiKey(ownerEmail);
    }

    // `options.apiKey` is the value the template constructed the plugin with
    // (e.g. wired from a deployment env var). On a multi-tenant deploy this
    // is the same cross-tenant hazard as any deploy-level provider key:
    // accepting it as the final fallback would silently bill every key-less
    // user to the deployment's account. Only honour it in single-tenant mode.
    const effectiveApiKey = isMultiTenantDeploy()
      ? userApiKey
      : (userApiKey ??
        options.apiKey ??
        readDeployCredentialEnv("ANTHROPIC_API_KEY"));

    // Resolve engine — per-request engine override takes priority
    let engine: AgentEngine;
    try {
      engine = await resolveEngine({
        engineOption: requestEngine ?? options.engine,
        apiKey: effectiveApiKey,
        model: configuredModel,
      });
    } catch {
      engine = await resolveEngine({
        apiKey: effectiveApiKey,
      });
    }

    // Honor the model the user picked in the settings UI (written via
    // `manage-agent-engine` action="set"), but only when the caller hasn't overridden it for
    // this request or at plugin construction time. Read per-request so a
    // dropdown change in the UI takes effect without a server restart. Skip
    // the DB read entirely when a higher-precedence value is set.
    const model =
      requestModel ??
      configuredModel ??
      (await getStoredModelForEngine(engine)) ??
      engine.defaultModel;
    const reasoningEffort = normalizeReasoningEffortForModel(
      model,
      isReasoningEffort(requestEffort)
        ? requestEffort
        : options.reasoningEffort,
    );

    options.onEngineResolved?.(engine, model);

    // One-line per-turn resolution log so it's obvious in dev which engine
    // is actually handling the request. `requestEngine` is what the client
    // sent from the model picker; `engine.name` is what resolveEngine picked.
    // Divergence between them is the usual cause of "status says builder but
    // no [builder-engine] log lines appear" confusion.
    console.log(
      `[agent-chat] resolved engine=${engine.name} model=${model} requestEngine=${requestEngine ?? "(none)"}`,
    );

    // Check for API key before starting a run (only for anthropic engine)
    if (engine.name === "anthropic" && !effectiveApiKey) {
      setResponseHeader(event, "Content-Type", "text/event-stream");
      setResponseHeader(event, "Cache-Control", "no-cache");
      setResponseHeader(event, "Connection", "keep-alive");
      const encoder = new TextEncoder();
      return new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "missing_api_key" })}\n\n`,
            ),
          );
          controller.close();
        },
      });
    }

    // Run all independent pre-send steps in parallel. Each of these hits
    // the DB or invokes an action; running them sequentially was the
    // single biggest contributor to pre-LLM latency.
    const enrichedMessage = enrichMessage(message, references);
    const loopSettingsPromise = readAgentLoopSettings({
      userEmail: ownerEmail ?? getRequestUserEmail() ?? null,
      orgId: getRequestOrgId() ?? null,
    }).catch(() => readAgentLoopSettings({}));

    let systemPromptError: any = null;
    const systemPromptPromise = (async (): Promise<string> => {
      try {
        return typeof options.systemPrompt === "function"
          ? await options.systemPrompt(event)
          : options.systemPrompt;
      } catch (error) {
        systemPromptError = error;
        return "";
      }
    })();

    const screenContextPromise = (async (): Promise<string> => {
      try {
        const viewScreenAction = resolvedActions["view-screen"];
        if (viewScreenAction) {
          const result = await viewScreenAction.run({});
          if (result && result !== "(no output)") {
            return `\n\n<current-screen>\n${result}\n</current-screen>`;
          }
        } else {
          const navigation = await readAppState("navigation");
          if (navigation) {
            return `\n\n<current-screen>\n${JSON.stringify(navigation, null, 2)}\n</current-screen>`;
          }
        }
      } catch {
        // DB not ready or no navigation state — skip silently
      }
      return "";
    })();

    const urlContextPromise = (async (): Promise<string> => {
      try {
        const url = (await readAppState("__url__")) as {
          pathname?: string;
          search?: string;
          hash?: string;
          searchParams?: Record<string, string>;
        } | null;
        if (url && (url.pathname || url.search || url.hash)) {
          const lines: string[] = [];
          if (url.pathname) lines.push(`pathname: ${url.pathname}`);
          if (url.search) lines.push(`search: ${url.search}`);
          if (url.hash) lines.push(`hash: ${url.hash}`);
          if (url.searchParams && Object.keys(url.searchParams).length > 0) {
            lines.push("searchParams:");
            for (const [k, v] of Object.entries(url.searchParams)) {
              lines.push(`  ${k}: ${v}`);
            }
          }
          return `\n\n<current-url>\n${lines.join("\n")}\n</current-url>`;
        }
      } catch {
        // DB not ready — skip silently
      }
      return "";
    })();

    // Selection context: written by the client when the user presses Cmd+I
    // with text selected on the page. Treat anything older than 5 minutes
    // as stale and ignore it.
    const SELECTION_TTL_MS = 5 * 60 * 1000;
    const selectionContextPromise = (async (): Promise<string> => {
      try {
        const sel = (await readAppState("pending-selection-context")) as {
          text?: string;
          capturedAt?: number;
        } | null;
        if (!sel?.text) return "";
        const capturedAt =
          typeof sel.capturedAt === "number" ? sel.capturedAt : 0;
        if (Date.now() - capturedAt > SELECTION_TTL_MS) return "";
        return (
          `\n\nThe user has selected the following text and pressed Cmd+I to focus the agent. ` +
          `Treat this as the immediate context to act on:\n` +
          `<selection>\n${sel.text}\n</selection>`
        );
      } catch {
        // DB not ready — skip silently
      }
      return "";
    })();

    // On the first message of a conversation, inject workspace inventory
    // so the agent knows what files, skills, jobs, and custom agents exist.
    // Templates can opt out via `skipFilesContext: true` when the inventory
    // is unrelated to the app's job (e.g. a voice-first macro tracker).
    const filesContextPromise = (async (): Promise<string> => {
      let filesContext = "";
      if (options.skipFilesContext) return filesContext;
      if (history.length === 0) {
        try {
          const { resourceListAccessible, SHARED_OWNER, resourceGet } =
            await import("../resources/store.js");
          const {
            getResourceKind,
            parseCustomAgentProfile,
            parseRemoteAgentManifest,
            parseSkillMetadata,
          } = await import("../resources/metadata.js");
          const ownerEmail = getRequestUserEmail();
          if (!ownerEmail) throw new Error("no authenticated user");
          const allResources = await resourceListAccessible(ownerEmail);

          if (allResources.length > 0) {
            const fileLines: string[] = [];
            const skillLines: string[] = [];
            const agentLines: string[] = [];
            const jobLines: string[] = [];
            for (const r of allResources) {
              const scope = r.owner === SHARED_OWNER ? "shared" : "personal";
              const kind = getResourceKind(r.path);
              if (kind === "file") {
                fileLines.push(`  ${r.path} (${scope})`);
                continue;
              }

              if (kind === "job") {
                jobLines.push(`  ${r.path} (${scope})`);
                continue;
              }

              if (
                kind === "skill" ||
                kind === "agent" ||
                kind === "remote-agent"
              ) {
                const full = await resourceGet(r.id);
                if (!full) continue;
                if (kind === "skill") {
                  const skill = parseSkillMetadata(full.content, r.path);
                  skillLines.push(
                    `  ${skill?.name || r.path} — ${skill?.description || r.path} (${scope}, ${r.path})`,
                  );
                } else if (kind === "agent") {
                  const agent = parseCustomAgentProfile(full.content, r.path);
                  agentLines.push(
                    `  ${agent?.name || r.path} — ${agent?.description || "Custom workspace agent"} (${scope}, ${r.path}${agent?.model ? `, model: ${agent.model}` : ""})`,
                  );
                } else {
                  const agent = parseRemoteAgentManifest(full.content, r.path);
                  agentLines.push(
                    `  ${agent?.name || r.path} — ${agent?.description || "Connected A2A agent"} (${scope}, remote via ${r.path})`,
                  );
                }
              }
            }
            const blocks: string[] = [];
            if (fileLines.length > 0) {
              blocks.push(
                `<available-files>\nFiles in the workspace:\n${fileLines.join("\n")}\n\nTo read a file's contents, use the resource-read action with the file path.\n</available-files>`,
              );
            }
            if (skillLines.length > 0) {
              blocks.push(
                `<available-skills>\nSkills in the workspace:\n${skillLines.join("\n")}\n</available-skills>`,
              );
            }
            if (agentLines.length > 0) {
              blocks.push(
                `<available-agents>\nCustom and connected agents in the workspace:\n${agentLines.join("\n")}\n\nCustom agents under agents/*.md can be mentioned or used via agent-teams (action: "spawn") with the agent parameter.\n</available-agents>`,
              );
            }
            if (jobLines.length > 0) {
              blocks.push(
                `<available-jobs>\nScheduled tasks in the workspace:\n${jobLines.join("\n")}\n</available-jobs>`,
              );
            }
            filesContext =
              blocks.length > 0 ? `\n\n${blocks.join("\n\n")}` : "";
          }
        } catch {
          // Resources not available — skip silently
        }
      }
      return filesContext;
    })();

    const [
      systemPrompt,
      screenBlock,
      urlBlock,
      selectionBlock,
      filesContext,
      loopSettings,
    ] = await Promise.all([
      systemPromptPromise,
      screenContextPromise,
      urlContextPromise,
      selectionContextPromise,
      filesContextPromise,
      loopSettingsPromise,
    ]);

    if (systemPromptError) {
      setResponseHeader(event, "Content-Type", "text/event-stream");
      setResponseHeader(event, "Cache-Control", "no-cache");
      const encoder = new TextEncoder();
      const err = systemPromptError;
      return new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", error: `Failed to load system prompt: ${err?.message ?? String(err)}` })}\n\n`,
            ),
          );
          controller.close();
        },
      });
    }
    const screenContext = screenBlock + urlBlock + selectionBlock;
    const requestActions =
      requestMode === "plan"
        ? createPlanModeActionRegistry(resolvedActions)
        : resolvedActions;
    const requestTools = getEngineTools(requestActions);
    const requestSystemPrompt =
      requestMode === "plan"
        ? `${systemPrompt}\n\n${PLAN_MODE_SYSTEM_PROMPT}`
        : systemPrompt;

    // Pre-compute agent references for A2A resolution inside the run
    const agentRefs = references.filter((r) => r.type === "agent");
    const customAgentRefs = references.filter((r) => r.type === "custom-agent");
    const planModeAgentNote =
      requestMode === "plan" && agentRefs.length > 0
        ? "\n\n<plan-mode-note>Connected external agent mentions were not called because Plan mode is read-only. Mention that they can be called after the user switches to Act mode if the plan needs them.</plan-mode-note>"
        : "";

    const userContent = buildUserContentWithAttachments({
      text: enrichedMessage + screenContext + filesContext + planModeAgentNote,
      attachments,
    });

    const messages: EngineMessage[] = [
      ...history
        .filter((m) => m.content.trim())
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: [{ type: "text" as const, text: m.content }],
        })),
      { role: "user" as const, content: userContent },
    ];

    // If there's already an active run for this thread, reject with 409 so
    // the client can queue or wait rather than silently aborting the existing run.
    if (threadId) {
      const existingRun = await getActiveRunForThreadAsync(threadId);
      if (existingRun?.status === "running") {
        setResponseStatus(event, 409);
        return {
          error: "Run already in progress for this thread",
          activeRunId: existingRun.runId,
        };
      }
    }

    // Start agent loop in background via run-manager
    const runId = generateRunId();
    startRun(
      runId,
      threadId ?? runId,
      async (send, signal) => {
        // Notify listeners that a run has started (used by agent teams)
        if (options.onRunStart) {
          options.onRunStart(send, threadId ?? runId);
        }

        // Resolve custom workspace agent mentions first.
        if (customAgentRefs.length > 0) {
          const ownerEmail = getRequestUserEmail();
          if (!ownerEmail) throw new Error("no authenticated user");
          const { findAccessibleCustomAgent } =
            await import("../resources/agents.js");
          const customResults = await Promise.allSettled(
            customAgentRefs.map(async (ref) => {
              send({
                type: "agent_call",
                agent: ref.name,
                status: "start",
              });
              try {
                const profile = await findAccessibleCustomAgent(
                  ownerEmail,
                  ref.refId || ref.path || ref.name,
                );
                if (!profile) {
                  throw new Error("Profile not found");
                }

                const profilePrompt =
                  `${requestSystemPrompt}\n\n<custom-agent-profile name="${profile.name}" path="${profile.path}">\n` +
                  (profile.description ? `${profile.description}\n\n` : "") +
                  `${profile.instructions}\n</custom-agent-profile>`;

                let responseText = "";
                const subUsage = await runAgentLoop({
                  engine,
                  model: profile.model ?? model,
                  systemPrompt: profilePrompt,
                  tools: requestTools,
                  messages: [
                    {
                      role: "user",
                      content: [
                        { type: "text", text: enrichedMessage + screenContext },
                      ],
                    },
                  ],
                  actions: requestActions,
                  send: (event) => {
                    if (event.type === "text") {
                      responseText += event.text;
                      send({
                        type: "agent_call_text",
                        agent: ref.name,
                        text: event.text,
                      });
                    }
                  },
                  signal,
                  reasoningEffort,
                  providerOptions: options.providerOptions,
                  executionMode: requestMode,
                  maxIterations: loopSettings.maxIterations,
                });

                // Attribute custom-agent sub-calls under their own label
                // so the Usage panel separates them from the main chat.
                try {
                  const ownerEmail = options.resolveOwnerEmail
                    ? await options.resolveOwnerEmail(event)
                    : getRequestUserEmail();
                  if (!ownerEmail) {
                    // Skip usage recording for unauthenticated runs.
                    return;
                  }
                  const { recordUsage } = await import("../usage/store.js");
                  await recordUsage({
                    ownerEmail,
                    inputTokens: subUsage.inputTokens,
                    outputTokens: subUsage.outputTokens,
                    cacheReadTokens: subUsage.cacheReadTokens,
                    cacheWriteTokens: subUsage.cacheWriteTokens,
                    model: subUsage.model,
                    label: `custom-agent:${ref.name}`,
                  });
                } catch {}

                send({
                  type: "agent_call",
                  agent: ref.name,
                  status: "done",
                });
                return `<agent-response name="${ref.name}" id="${ref.refId}" type="custom-agent">\n${responseText}\n</agent-response>`;
              } catch (err: any) {
                send({
                  type: "agent_call",
                  agent: ref.name,
                  status: "error",
                });
                const message =
                  userFacingLlmCredentialError(err, {
                    agentName: ref.name,
                  }) ?? `Failed to run ${ref.name}: ${err?.message}`;
                return `<agent-response name="${ref.name}" id="${ref.refId}" type="custom-agent" error="true">\n${message}\n</agent-response>`;
              }
            }),
          );

          const customResponses = customResults
            .filter(
              (result): result is PromiseFulfilledResult<string> =>
                result.status === "fulfilled",
            )
            .map((result) => result.value);

          if (customResponses.length > 0) {
            const agentContext =
              "Responses from custom workspace agents:\n\n" +
              customResponses.join("\n\n");
            const lastMsg = messages[messages.length - 1];
            if (lastMsg?.role === "user" && Array.isArray(lastMsg.content)) {
              const textPart = lastMsg.content.find(
                (p): p is import("./engine/types.js").EngineTextPart =>
                  p.type === "text",
              );
              if (textPart) {
                textPart.text = agentContext + "\n\n" + textPart.text;
              }
            }
          }
        }

        // Resolve connected agent @-mentions via A2A calls.
        if (agentRefs.length > 0 && requestMode !== "plan") {
          const { A2AClient, callAgent } = await import("../a2a/client.js");
          const results = await Promise.allSettled(
            agentRefs.map(async (ref) => {
              send({
                type: "agent_call",
                agent: ref.name,
                status: "start",
              });
              try {
                const a2aClient = new A2AClient(ref.path);
                const callerEmail = getRequestUserEmail();

                const a2aMetadata: Record<string, unknown> = {};
                if (callerEmail) a2aMetadata.userEmail = callerEmail;
                if (process.env.NODE_ENV === "production" && callerEmail) {
                  try {
                    const { listOAuthAccountsByOwner } =
                      await import("../oauth-tokens/store.js");
                    const accounts = await listOAuthAccountsByOwner(
                      "google",
                      callerEmail,
                    );
                    const tokens = accounts[0]?.tokens;
                    if (tokens?.access_token) {
                      a2aMetadata.googleToken = tokens.access_token;
                    }
                  } catch {}
                }

                let responseText = "";
                let lastSentLength = 0;

                try {
                  for await (const task of a2aClient.stream(
                    {
                      role: "user",
                      parts: [
                        {
                          type: "text",
                          text: enrichedMessage + screenContext,
                        },
                      ],
                    },
                    Object.keys(a2aMetadata).length > 0
                      ? { metadata: a2aMetadata }
                      : undefined,
                  )) {
                    const newText =
                      task.status?.message?.parts
                        ?.filter(
                          (p): p is { type: "text"; text: string } =>
                            p.type === "text",
                        )
                        ?.map((p) => p.text)
                        ?.join("") ?? "";

                    if (newText.length > lastSentLength) {
                      send({
                        type: "agent_call_text",
                        agent: ref.name,
                        text: newText.slice(lastSentLength),
                      });
                      lastSentLength = newText.length;
                    }
                    responseText = newText;
                  }
                } catch {
                  if (!responseText) {
                    responseText = await callAgent(
                      ref.path,
                      enrichedMessage + screenContext,
                    );
                  }
                }
                responseText =
                  userFacingLlmCredentialError(responseText, {
                    agentName: ref.name,
                  }) ?? responseText;

                send({
                  type: "agent_call",
                  agent: ref.name,
                  status: "done",
                });
                return `<agent-response name="${ref.name}" id="${ref.refId}">\n${responseText}\n</agent-response>`;
              } catch (err: any) {
                send({
                  type: "agent_call",
                  agent: ref.name,
                  status: "error",
                });
                const message =
                  userFacingLlmCredentialError(err, {
                    agentName: ref.name,
                  }) ?? `Failed to reach ${ref.name}: ${err?.message}`;
                return `<agent-response name="${ref.name}" id="${ref.refId}" error="true">\n${message}\n</agent-response>`;
              }
            }),
          );

          const agentResponses_local: string[] = [];
          for (const result of results) {
            if (result.status === "fulfilled") {
              agentResponses_local.push(result.value);
            }
          }

          if (agentResponses_local.length > 0) {
            const agentContext =
              "Responses from other agents:\n\n" +
              agentResponses_local.join("\n\n");
            const lastMsg = messages[messages.length - 1];
            if (lastMsg?.role === "user" && Array.isArray(lastMsg.content)) {
              const textPart = lastMsg.content.find(
                (p): p is import("./engine/types.js").EngineTextPart =>
                  p.type === "text",
              );
              if (textPart) {
                textPart.text = agentContext + "\n\n" + textPart.text;
              }
            }
          }
        }

        // Apply experiment variant overrides (A/B testing)
        let effectiveModel = model;
        try {
          const { resolveActiveExperimentConfig } =
            await import("../observability/experiments.js");
          if (!ownerEmail) {
            // Without an authenticated owner we can't resolve user-scoped experiments.
            throw new Error("no authenticated user");
          }
          const expConfig = await resolveActiveExperimentConfig(ownerEmail);
          if (expConfig) {
            if (typeof expConfig.configs.model === "string") {
              effectiveModel = expConfig.configs.model;
            }
          }
        } catch {
          // Experiments module unavailable — use default model
        }

        const agentLoopOpts = {
          engine,
          model: effectiveModel,
          systemPrompt: requestSystemPrompt,
          tools: requestTools,
          messages,
          actions: requestActions,
          send,
          signal,
          ownerEmail,
          orgId: getRequestOrgId() ?? null,
          reasoningEffort,
          providerOptions: options.providerOptions,
          executionMode: requestMode,
          maxIterations: loopSettings.maxIterations,
        };

        let loopUsage: AgentLoopUsage;
        let instrumented = false;
        try {
          const { getObservabilityConfig, instrumentAgentLoop } =
            await import("../observability/traces.js");
          const obsConfig = await getObservabilityConfig();
          if (obsConfig.enabled) {
            instrumented = true;
            loopUsage = await instrumentAgentLoop({
              runAgentLoop,
              loopOpts: agentLoopOpts,
              runId,
              threadId: threadId ?? null,
              userId: ownerEmail,
              config: obsConfig,
            });
          }
        } catch (err) {
          // If instrumentation setup failed, fall through to uninstrumented.
          // If the agent loop itself failed (via instrumentAgentLoop), re-throw.
          if (instrumented) throw err;
        }
        if (!instrumented) {
          loopUsage = await runAgentLoop(agentLoopOpts);
        }

        // Record token usage for cost monitoring so the Usage panel in
        // settings works in every mode, including local dev.
        try {
          const ownerEmail = options.resolveOwnerEmail
            ? await options.resolveOwnerEmail(event)
            : getRequestUserEmail();
          if (
            ownerEmail &&
            (loopUsage.inputTokens > 0 ||
              loopUsage.outputTokens > 0 ||
              loopUsage.cacheReadTokens > 0 ||
              loopUsage.cacheWriteTokens > 0)
          ) {
            const { recordUsage } = await import("../usage/store.js");
            await recordUsage({
              ownerEmail,
              inputTokens: loopUsage.inputTokens,
              outputTokens: loopUsage.outputTokens,
              cacheReadTokens: loopUsage.cacheReadTokens,
              cacheWriteTokens: loopUsage.cacheWriteTokens,
              model: loopUsage.model,
              label: body.usageLabel || "chat",
            });
          }
        } catch {
          // Usage recording failed — don't break the run
        }
      },
      options.onRunComplete
        ? (run) => options.onRunComplete!(run, threadId)
        : undefined,
      { softTimeoutMs: options.runSoftTimeoutMs },
    );

    // Subscribe to the run and stream events to the client
    const stream = subscribeToRun(runId, 0);
    if (!stream) {
      setResponseStatus(event, 500);
      return { error: "Failed to start agent run" };
    }

    setResponseHeader(event, "Content-Type", "text/event-stream");
    setResponseHeader(event, "Cache-Control", "no-cache");
    setResponseHeader(event, "Connection", "keep-alive");
    setResponseHeader(event, "X-Run-Id", runId);

    return stream;
  });
}

export {
  getActiveRunForThread,
  getActiveRunForThreadAsync,
  getRun,
  abortRun,
  subscribeToRun,
};
