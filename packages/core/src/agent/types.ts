import type { ActionChatUIConfig } from "../action-ui.js";
import type { AgentMcpAppPayload } from "../mcp-client/app-result.js";
import type { ReasoningEffort } from "../shared/reasoning-effort.js";

export interface AgentNativeJsonSchema {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, AgentNativeJsonSchema>;
  required?: string[];
  additionalProperties?: boolean | AgentNativeJsonSchema;
  items?: AgentNativeJsonSchema;
  oneOf?: AgentNativeJsonSchema[];
  anyOf?: AgentNativeJsonSchema[];
  allOf?: AgentNativeJsonSchema[];
  not?: AgentNativeJsonSchema;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
}

export interface ActionTool {
  description: string;
  parameters?: AgentNativeJsonSchema & {
    type: "object";
    properties: Record<string, AgentNativeJsonSchema>;
    required?: string[];
  };
}

/** @deprecated Use `ActionTool` instead */
export type ScriptTool = ActionTool;

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

export type AgentChatStructuredContentPart =
  | { type: "text"; text: string }
  | {
      type: "tool-call";
      id?: string;
      toolCallId?: string;
      name?: string;
      toolName?: string;
      input?: unknown;
      args?: unknown;
    }
  | {
      type: "tool-result";
      toolCallId: string;
      /** Persisted for replay; omitted in older rows is backfilled server-side. */
      toolName?: string;
      toolInput?: string;
      content: string;
      isError?: boolean;
    };

export interface AgentChatStructuredMessage {
  role: "user" | "assistant";
  content: AgentChatStructuredContentPart[];
}

export interface AgentChatReference {
  type: "file" | "skill" | "mention" | "agent" | "custom-agent";
  path: string;
  name: string;
  source: string;
  refType?: string;
  refId?: string;
  slotKey?: string;
  slotLabel?: string;
  metadata?: Record<string, unknown>;
}

export interface MentionProviderItem {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  refType: string;
  refId?: string;
  refPath?: string;
  slotKey?: string;
  slotLabel?: string;
  metadata?: Record<string, unknown>;
  clearsSlots?: string[];
  relatedReferences?: MentionProviderReference[];
}

export interface MentionProviderReference {
  label: string;
  icon?: string;
  source?: string;
  refType: string;
  refId?: string | null;
  refPath?: string | null;
  slotKey?: string;
  slotLabel?: string;
  metadata?: Record<string, unknown>;
  clearsSlots?: string[];
  relatedReferences?: MentionProviderReference[];
}

export interface MentionProvider {
  label: string;
  icon?: string;
  search: (
    query: string,
    /** The H3 event for the current request — use to make internal API calls */
    event?: any,
  ) => MentionProviderItem[] | Promise<MentionProviderItem[]>;
}

export interface AgentChatAttachment {
  type: string;
  name: string;
  data?: string;
  contentType?: string;
  text?: string;
}

export interface AgentChatScope {
  type: string;
  id: string;
  label?: string;
}

export interface AgentChatRequest {
  message: string;
  /**
   * User-visible text to persist in chat history. `message` may be normalized
   * for the model (for example mention markup or internal continuation text).
   */
  displayMessage?: string;
  history?: AgentMessage[];
  /**
   * Provider-neutral transcript used for run recovery. Unlike `history`,
   * this preserves assistant tool calls and matching tool results so
   * continuation turns do not re-run completed read-only tools.
   */
  structuredHistory?: AgentChatStructuredMessage[];
  references?: AgentChatReference[];
  threadId?: string;
  attachments?: AgentChatAttachment[];
  /** Internal retry/continuation requests should not create visible user turns. */
  internalContinuation?: boolean;
  /**
   * Internal marker set ONLY by the durable-background self-dispatch (see
   * `AGENT_CHAT_BACKGROUND_RUN_FIELD`). Present when the agent-chat handler is
   * re-entered as the background worker: it carries the pre-claimed `runId` and
   * logical `turnId` so the worker runs the loop inline with the background
   * soft-timeout instead of re-claiming the slot or re-dispatching. Untrusted
   * on its own — the `_process-run` route HMAC-verifies the dispatch before
   * invoking the handler. Absent on every normal client request.
   */
  __backgroundRun?: {
    runId: string;
    turnId?: string;
    /**
     * Number of server-driven background→background continuations already
     * chained into this logical turn (0 on the first chunk). The worker
     * increments this when it re-fires `_process-run` at a soft-timeout
     * boundary and refuses to chain past `MAX_BACKGROUND_RUN_CONTINUATIONS`.
     */
    continuationCount?: number;
  };
  /**
   * Stable identity for the logical assistant turn this request belongs to.
   * The client sends the SAME turnId for the initial POST and every
   * auto-continuation re-POST of one turn, so the server can fold each
   * continuation run's output onto a single durable assistant message instead
   * of dropping the earlier chunks. Defaults to the run id when absent.
   */
  turnId?: string;
  /** Execution mode for this turn. Plan mode is read-only and proposes before acting. */
  mode?: "act" | "plan";
  /** Per-request model override (ephemeral, from the composer model picker). */
  model?: string;
  /** Per-request engine override (sent alongside model for cross-provider switches). */
  engine?: string;
  /** Per-request reasoning effort override (ephemeral, from the composer picker). */
  effort?: ReasoningEffort;
  /** Usage-tracking label for this call (e.g. "chat", "summarize"). Default: "chat". */
  usageLabel?: string;
  /** Stable browser tab id so screen/url context and navigation commands are tab-scoped. */
  browserTabId?: string;
  /** Resource scope for this chat thread, e.g. the deck currently bound to the tab. */
  scope?: AgentChatScope | null;
  /** When true, expose this chat turn as a user-visible run in RunsTray. */
  trackInRunsTray?: boolean;
  /**
   * Approval grants for human-in-the-loop actions. Each entry is a stable
   * approval key (see the `approval_required` event's `approvalKey`). When the
   * agent calls an action declared `needsApproval`, the loop pauses and emits
   * `approval_required`; the client re-issues the turn (typically an empty
   * continuation) with the approved call's key here so the gate lets it run.
   * Keys not present here keep the action paused. The model never sees or sets
   * this — it is supplied by the human's approve affordance.
   */
  approvedToolCalls?: string[];
}

export type AgentToolInput = Record<string, unknown>;

export type AgentChatEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | {
      type: "activity";
      label: string;
      tool?: string;
      id?: string;
      progressBytes?: number;
    }
  | { type: "stream_keepalive" }
  | { type: "tool_start"; tool: string; id?: string; input: AgentToolInput }
  | {
      type: "tool_done";
      tool: string;
      id?: string;
      input?: AgentToolInput;
      result: string;
      isError?: boolean;
      completedSideEffect?: boolean;
      mcpApp?: AgentMcpAppPayload;
      chatUI?: ActionChatUIConfig;
    }
  | {
      /**
       * The agent tried to call an action declared `needsApproval` and the loop
       * paused instead of executing it. The client should surface an
       * approve/deny affordance; on approve, re-issue the turn with
       * `approvedToolCalls: [approvalKey]` so the gate lets this call run.
       */
      type: "approval_required";
      tool: string;
      input: Record<string, string>;
      /** Stable key the client echoes back in `approvedToolCalls` to approve. */
      approvalKey: string;
      /** The model-side tool-call id for this paused call, when available. */
      toolCallId?: string;
    }
  | {
      type: "agent_call";
      agent: string;
      status: "start" | "done" | "error";
    }
  | { type: "agent_call_text"; agent: string; text: string }
  | {
      type: "agent_task";
      taskId: string;
      threadId: string;
      description: string;
      status: "running" | "completed" | "errored";
    }
  | {
      type: "agent_task_update";
      taskId: string;
      preview: string;
      currentStep?: string;
    }
  | {
      type: "agent_task_complete";
      taskId: string;
      summary: string;
    }
  | { type: "done" }
  | {
      type: "error";
      error: string;
      /**
       * Optional machine-readable error code. Builder gateway uses codes
       * like "credits-limit-monthly" / "unauthorized" / "gateway_not_enabled"
       * so the chat UI can render a structured CTA (e.g. upgrade button).
       */
      errorCode?: string;
      /** Optional link paired with errorCode — e.g. Builder billing page. */
      upgradeUrl?: string;
      /** Optional details for expandable UI/debugging. */
      details?: string;
      /** True when the user can reasonably continue/retry from partial work. */
      recoverable?: boolean;
    }
  /**
   * Legacy SSE terminal event. New streams emit
   * `{ type: "error", errorCode: "missing_credentials" }` instead.
   */
  | { type: "missing_api_key" }
  | { type: "loop_limit"; maxIterations?: number }
  | {
      /**
       * An in-loop `Processor` aborted the run via `abort()` (which throws a
       * `TripWire`). The loop catches it, emits this event, stops cleanly, and
       * surfaces the reason as a final assistant message. Structural hook for
       * real-time guardrails and a proof-of-done / coverage gate.
       */
      type: "tripwire";
      reason: string;
      /** Name of the processor that aborted, when it declared one. */
      processor?: string;
    }
  | {
      type: "auto_continue";
      reason:
        | "run_timeout"
        | "loop_limit"
        | "no_progress"
        | "stream_ended"
        | "gateway_timeout"
        | "network_interrupted";
      maxIterations?: number;
    }
  | { type: "clear" };

export interface RunEvent {
  seq: number;
  event: AgentChatEvent;
}

export type RunStatus = "running" | "completed" | "errored" | "aborted";
