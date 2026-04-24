import {
  defineEventHandler,
  setResponseHeader,
  setResponseStatus,
  getMethod,
} from "h3";
import type { EventHandler as H3EventHandler } from "h3";
import type {
  ActionTool,
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
import { getRequestUserEmail } from "../server/request-context.js";
import { isMcpToolAllowedForRequest } from "../mcp-client/visibility.js";

// Register built-in engines on first import
registerBuiltinEngines();

export { PROVIDER_TO_ENV };

/**
 * Look up a user's persisted API key for the given provider. Returns
 * `undefined` for unauthenticated/local callers so the shared platform key
 * is never keyed off `local@localhost` in multi-tenant deployments.
 */
export async function getOwnerApiKey(
  provider: string,
  ownerEmail: string | null | undefined,
): Promise<string | undefined> {
  if (!ownerEmail || ownerEmail === "local@localhost") return undefined;
  try {
    const { getSetting } = await import("../settings/store.js");
    const stored = await getSetting(`user-api-key:${provider}:${ownerEmail}`);
    const key =
      stored && typeof stored.key === "string" ? stored.key.trim() : "";
    if (key) return key;
    // Backward compat: check legacy Anthropic key format
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
 * Resolve the active engine's provider and look up the user's API key for it.
 * Falls back to the provider's env var if no per-user key is stored.
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
    const envVar = PROVIDER_TO_ENV[provider];
    return envVar ? process.env[envVar] || undefined : undefined;
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
}

/** @deprecated Use `ActionEntry` instead */
export type ScriptEntry = ActionEntry;

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
  /** Provider-specific options passed through to the engine */
  providerOptions?: EngineMessage extends never ? never : any;
  /** Called when a run completes (for server-side thread persistence) */
  onRunComplete?: (run: ActiveRun, threadId: string | undefined) => void;
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
  /** Enable per-user usage limit checking and token tracking */
  trackUsage?: boolean;
  /** Usage limit in cents (default: 100 = $1.00) */
  usageLimitCents?: number;
  /**
   * Skip auto-injecting the workspace files/skills/agents inventory on the
   * first message of a conversation. Useful for minimal/voice apps where
   * the ~2KB inventory of unrelated resources is noise, not signal.
   * Default: false (inventory is injected).
   */
  skipFilesContext?: boolean;
}

const MAX_ITERATIONS = 40;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;

function generateRunId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Check if an error is transient and should be retried */
function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("overloaded") ||
    msg.includes("rate_limit") ||
    msg.includes("529") ||
    msg.includes("503") ||
    msg.includes("too many requests")
  );
}

/** Wait with exponential backoff, respecting abort signal */
function retryDelay(attempt: number, signal: AbortSignal): Promise<void> {
  const ms = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
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

/**
 * Convert ActionEntry registry to EngineTool array.
 */
export function actionsToEngineTools(
  actions: Record<string, ActionEntry>,
): EngineTool[] {
  return Object.entries(actions).map(([name, entry]) => ({
    name,
    description: entry.tool.description,
    inputSchema: (entry.tool.parameters ?? {
      type: "object",
      properties: {},
    }) as EngineTool["inputSchema"],
  }));
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
  providerOptions?: any;
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

  let iterations = 0;
  while (true) {
    if (signal.aborted) break;
    if (++iterations > MAX_ITERATIONS) {
      send({ type: "loop_limit" });
      break;
    }

    let assistantContent: EngineContentPart[] | undefined;
    let hasToolCalls = false;

    for (let retry = 0; ; retry++) {
      try {
        const streamOpts = {
          model,
          systemPrompt,
          messages,
          tools,
          abortSignal: signal,
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
            hasToolCalls = true;
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
        if (retry < MAX_RETRIES && isRetryableError(err)) {
          // Clear partial text from the failed attempt so the retry
          // doesn't produce garbled duplicate output
          send({ type: "clear" });
          send({
            type: "text",
            text: `*Retrying in ${(RETRY_BASE_DELAY_MS * Math.pow(2, retry)) / 1000}s...*\n\n`,
          });
          await retryDelay(retry, signal);
          continue;
        }
        throw err;
      }
    }

    if (!assistantContent) {
      // No content — done
      break;
    }

    messages.push({ role: "assistant", content: assistantContent });

    const toolCallParts = assistantContent.filter(
      (p): p is import("./engine/types.js").EngineToolCallPart =>
        p.type === "tool-call",
    );

    if (toolCallParts.length === 0) break;

    // Run all tool calls in parallel — engines often return multiple tool-call
    // blocks in one turn. Running them concurrently saves wall-clock time.
    const toolResultParts: EngineContentPart[] = await Promise.all(
      toolCallParts.map(async (toolCall) => {
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

        let result: string;
        let isError = false;
        try {
          const raw = await actionEntry.run(
            toolCall.input as Record<string, string>,
            { send },
          );
          result = typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
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
            recordChange({
              source: "action",
              type: "change",
              key: toolCall.name,
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
      }),
    );

    messages.push({ role: "user", content: toolResultParts });
  }

  send({ type: "done" });
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
  const getEngineTools = () => {
    const filtered: Record<string, ActionEntry> = {};
    for (const [name, entry] of Object.entries(resolvedActions)) {
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
    } = body;
    if (!message) {
      setResponseStatus(event, 400);
      return { error: "message is required" };
    }

    // Resolve owner first so we can look up a per-owner API key. Users
    // who bring their own key bypass the platform's free-tier usage limit
    // and use their key for this request (which is also durable across
    // serverless cold starts via the settings table).
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
      if (!userApiKey) {
        const envVar = PROVIDER_TO_ENV[provider];
        userApiKey = envVar ? process.env[envVar] || undefined : undefined;
      }
    } else {
      userApiKey = await getOwnerActiveApiKey(ownerEmail);
    }

    const effectiveApiKey =
      userApiKey ?? options.apiKey ?? process.env.ANTHROPIC_API_KEY;

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
    // `set-agent-engine`), but only when the caller hasn't overridden it for
    // this request or at plugin construction time. Read per-request so a
    // dropdown change in the UI takes effect without a server restart. Skip
    // the DB read entirely when a higher-precedence value is set.
    const model =
      requestModel ??
      configuredModel ??
      (await getStoredModelForEngine(engine)) ??
      engine.defaultModel;

    options.onEngineResolved?.(engine, model);

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

    // Check usage limit before starting a run (production hosted mode).
    // Skip when the user has provided their own key — they're paying
    // Anthropic directly, so the platform's free tier doesn't apply.
    if (
      !userApiKey &&
      options.trackUsage &&
      options.resolveOwnerEmail &&
      ownerEmail &&
      ownerEmail !== "local@localhost"
    ) {
      try {
        const { checkUsageLimit } = await import("../usage/store.js");
        const result = await checkUsageLimit(
          ownerEmail,
          options.usageLimitCents,
        );
        if (!result.allowed) {
          setResponseHeader(event, "Content-Type", "text/event-stream");
          setResponseHeader(event, "Cache-Control", "no-cache");
          setResponseHeader(event, "Connection", "keep-alive");
          const encoder = new TextEncoder();
          return new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "usage_limit_reached", usageCents: result.usageCents, limitCents: result.limitCents })}\n\n`,
                ),
              );
              controller.close();
            },
          });
        }
      } catch {
        // Usage check failed — allow the request to proceed
      }
    }

    // Run all independent pre-send steps in parallel. Each of these hits
    // the DB or invokes an action; running them sequentially was the
    // single biggest contributor to pre-LLM latency.
    const enrichedMessage = enrichMessage(message, references);

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
          const ownerEmail = getRequestUserEmail() || "local@localhost";
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
                `<available-agents>\nCustom and connected agents in the workspace:\n${agentLines.join("\n")}\n\nCustom agents under agents/*.md can be mentioned or used via spawn-task with the agent parameter.\n</available-agents>`,
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

    const [systemPrompt, screenBlock, urlBlock, filesContext] =
      await Promise.all([
        systemPromptPromise,
        screenContextPromise,
        urlContextPromise,
        filesContextPromise,
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
    const screenContext = screenBlock + urlBlock;

    // Pre-compute agent references for A2A resolution inside the run
    const agentRefs = references.filter((r) => r.type === "agent");
    const customAgentRefs = references.filter((r) => r.type === "custom-agent");

    // Build user content: text + any image attachments
    const userContent: EngineContentPart[] = [];
    if (attachments?.length) {
      for (const att of attachments) {
        if (att.type === "image" && att.data) {
          const match = att.data.match(/^data:(image\/[^;]+);base64,(.+)$/);
          if (match) {
            userContent.push({
              type: "image",
              data: match[2],
              mediaType: match[1] as
                | "image/jpeg"
                | "image/png"
                | "image/gif"
                | "image/webp",
            });
          }
        }
      }
    }
    userContent.push({
      type: "text",
      text: enrichedMessage + screenContext + filesContext,
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
          const ownerEmail = getRequestUserEmail() || "local@localhost";
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
                  `${systemPrompt}\n\n<custom-agent-profile name="${profile.name}" path="${profile.path}">\n` +
                  (profile.description ? `${profile.description}\n\n` : "") +
                  `${profile.instructions}\n</custom-agent-profile>`;

                let responseText = "";
                const subUsage = await runAgentLoop({
                  engine,
                  model: profile.model ?? model,
                  systemPrompt: profilePrompt,
                  tools: getEngineTools(),
                  messages: [
                    {
                      role: "user",
                      content: [
                        { type: "text", text: enrichedMessage + screenContext },
                      ],
                    },
                  ],
                  actions: resolvedActions,
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
                  providerOptions: options.providerOptions,
                });

                // Attribute custom-agent sub-calls under their own label
                // so the Usage panel separates them from the main chat.
                try {
                  const ownerEmail = options.resolveOwnerEmail
                    ? await options.resolveOwnerEmail(event)
                    : getRequestUserEmail() || "local@localhost";
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
                return `<agent-response name="${ref.name}" id="${ref.refId}" type="custom-agent" error="true">\nFailed to run ${ref.name}: ${err?.message}\n</agent-response>`;
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
        if (agentRefs.length > 0) {
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
                return `<agent-response name="${ref.name}" id="${ref.refId}" error="true">\nFailed to reach ${ref.name}: ${err?.message}\n</agent-response>`;
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

        const loopUsage = await runAgentLoop({
          engine,
          model,
          systemPrompt,
          tools: getEngineTools(),
          messages,
          actions: resolvedActions,
          send,
          signal,
          providerOptions: options.providerOptions,
        });

        // Record token usage for cost monitoring. Always on (not gated by
        // trackUsage) so the Usage panel in settings works in every mode,
        // including local dev. `trackUsage` only controls the pre-request
        // *limit check*; recording happens unconditionally.
        try {
          const ownerEmail = options.resolveOwnerEmail
            ? await options.resolveOwnerEmail(event)
            : getRequestUserEmail() || "local@localhost";
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
