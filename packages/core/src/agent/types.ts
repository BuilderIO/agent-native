import type { AgentSuggestion } from "@agent-native/agentkit/protocol";

import type { A2AAgentActivitySnapshot } from "../a2a/activity.js";
import type { ActionChatUIConfig } from "../action-ui.js";
import type { ArtifactReceipt } from "../artifacts/detect.js";
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
  title?: string;
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

export interface AgentFileMutationProof {
  path: string;
  contentSha256: string;
}

export type AgentActionScopeJsonValue =
  | null
  | boolean
  | number
  | string
  | AgentActionScopeJsonValue[]
  | { [key: string]: AgentActionScopeJsonValue };

export type AgentActionScope = Record<string, AgentActionScopeJsonValue>;

export const AGENT_ACTION_SCOPE_MAX_BYTES = 8 * 1024;
const AGENT_ACTION_SCOPE_MAX_DEPTH = 8;
const AGENT_ACTION_SCOPE_MAX_NODES = 256;

function cloneAgentActionScopeValue(
  value: unknown,
  depth: number,
  state: { nodes: number },
): AgentActionScopeJsonValue {
  state.nodes += 1;
  if (
    depth > AGENT_ACTION_SCOPE_MAX_DEPTH ||
    state.nodes > AGENT_ACTION_SCOPE_MAX_NODES
  ) {
    throw new TypeError("actionScope exceeds its structural limits");
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("actionScope must contain only JSON values");
    }
    return value;
  }
  if (Array.isArray(value)) {
    const keys = Reflect.ownKeys(value);
    if (
      keys.some(
        (key) =>
          typeof key !== "string" ||
          (key !== "length" &&
            (String(Number(key)) !== key || Number(key) >= value.length)),
      ) ||
      Object.keys(value).length !== value.length
    ) {
      throw new TypeError("actionScope must contain only JSON arrays");
    }
    return Array.from(value, (item) =>
      cloneAgentActionScopeValue(item, depth + 1, state),
    );
  }
  if (typeof value !== "object") {
    throw new TypeError("actionScope must contain only JSON values");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("actionScope must contain only JSON objects");
  }
  const object = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(object);
  if (
    keys.some((key) => {
      if (typeof key !== "string") return true;
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      return !descriptor?.enumerable || !("value" in descriptor);
    })
  ) {
    throw new TypeError("actionScope must contain only JSON values");
  }
  return Object.fromEntries(
    Object.entries(object).map(([key, item]) => [
      key,
      cloneAgentActionScopeValue(item, depth + 1, state),
    ]),
  );
}

export function normalizeAgentActionScope(value: unknown): AgentActionScope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("actionScope must be a JSON object");
  }
  const cloned = cloneAgentActionScopeValue(value, 0, {
    nodes: 0,
  }) as AgentActionScope;
  if (
    new TextEncoder().encode(JSON.stringify(cloned)).byteLength >
    AGENT_ACTION_SCOPE_MAX_BYTES
  ) {
    throw new TypeError(
      `actionScope must be at most ${AGENT_ACTION_SCOPE_MAX_BYTES} bytes`,
    );
  }
  return cloned;
}

export function tryNormalizeAgentActionScope(
  value: unknown,
): AgentActionScope | undefined {
  try {
    return normalizeAgentActionScope(value);
  } catch (error) {
    if (error instanceof TypeError) return undefined;
    throw error;
  }
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

export type MentionItemMedia =
  | {
      type: "text";
      text: string;
      backgroundColor?: string;
    }
  | {
      type: "image";
      src: string;
      fit?: "contain" | "cover";
      backgroundColor?: string;
    }
  | { type: "none" };

export interface MentionProviderItem {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  media?: MentionItemMedia;
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
  media?: MentionItemMedia;
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
    event?: any,
  ) => MentionProviderItem[] | Promise<MentionProviderItem[]>;
}

export interface AgentChatAttachment {
  type: string;
  name: string;
  displayOnly?: boolean;
  data?: string;
  url?: string;
  uploadProvider?: string;
  referenceOnly?: boolean;
  securityNote?: string;
  storageRequired?: boolean;
  storageUploadFailed?: boolean;
  contentType?: string;
  text?: string;
}

export interface AgentChatScope {
  type: string;
  id: string;
  label?: string;
}

export interface AgentChatHarnessRequest {
  runtime: "claude-code" | "codex" | "pi" | "opencode";
}

export interface AgentChatRequest {
  message: string;
  actionScope?: AgentActionScope;
  queuedMessageId?: string;
  displayMessage?: string;
  history?: AgentMessage[];
  structuredHistory?: AgentChatStructuredMessage[];
  references?: AgentChatReference[];
  threadId?: string;
  parentId?: string | null;
  attachments?: AgentChatAttachment[];
  internalContinuation?: boolean;
  __backgroundRun?: {
    runId: string;
    turnId?: string;
    continuationReason?:
      | "run_timeout"
      | "loop_limit"
      | "max_tokens"
      | "no_progress"
      | "stream_ended"
      | "gateway_timeout"
      | "network_interrupted"
      | "rate_limited";
    actionPreparationTool?: string;
    continuationCount?: number;
    noProgressErrorCode?: string;
    noProgressCount?: number;
    backgroundFunctionRuntimeExpected?: boolean;
    payloadRef?: boolean;
  };
  /**
   * Server-resolved action authorization carried across authenticated durable
   * background dispatches. Normal client requests must not trust this field;
   * the foreground handler deletes and replaces it before persistence.
   */
  __resolvedActionSurface?:
    | {
        orgId: string | null;
        allowedActionNames: string[];
        actionScope?: AgentActionScope;
      }
    | {
        orgId: string | null;
        mode: "default";
      };
  turnId?: string;
  mode?: "act" | "plan";
  model?: string;
  engine?: string;
  effort?: ReasoningEffort;
  usageLabel?: string;
  browserTabId?: string;
  scope?: AgentChatScope | null;
  harness?: AgentChatHarnessRequest;
  trackInRunsTray?: boolean;
  approvedToolCalls?: string[];
}

export type AgentToolInput = Record<string, unknown>;

export interface AgentChatRichEventReference {
  kind: string;
  id: string;
  label?: string;
  uri?: string;
}

export interface AgentChatRichEventEnvelope {
  namespace: string;
  name: string;
  version?: number;
  data?: unknown;
  references?: AgentChatRichEventReference[];
  metadata?: Record<string, unknown>;
}

export type AgentChatEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "suggestions"; suggestions: AgentSuggestion[] }
  | { type: "rich_event"; event: AgentChatRichEventEnvelope }
  | {
      type: "activity";
      label: string;
      tool?: string;
      id?: string;
      progressBytes?: number;
    }
  /** The model is still assembling an action input; sent before tool_start. */
  | { type: "tool_input_start"; tool?: string; id?: string }
  /** Incremental action-input text, kept separate from the finalized input. */
  | { type: "tool_input_delta"; tool?: string; id?: string; text: string }
  | { type: "stream_keepalive" }
  | {
      type: "model_stream";
      status: "start" | "end";
      reason?:
        | "end_turn"
        | "tool_use"
        | "max_tokens"
        | "stop_sequence"
        | "error";
    }
  | { type: "tool_start"; tool: string; id?: string; input: AgentToolInput }
  | {
      type: "tool_done";
      tool: string;
      id?: string;
      input?: AgentToolInput;
      result: string;
      isError?: boolean;
      completedSideEffect?: boolean;
      fileMutation?: AgentFileMutationProof;
      artifacts?: ArtifactReceipt[];
      mcpApp?: AgentMcpAppPayload;
      chatUI?: ActionChatUIConfig;
    }
  | {
      type: "approval_required";
      tool: string;
      input: Record<string, string>;
      approvalKey: string;
      allowPersistentApproval?: false;
      toolCallId?: string;
      askId?: string;
    }
  | {
      type: "connection_required";
      requestId: string;
      provider: string;
      reason: "connect" | "grant" | "reauthorize" | "admin_required";
      appId?: string;
      detail?: string;
      source?: { id: string; kind?: string; label?: string };
    }
  | {
      type: "agent_call";
      agent: string;
      status: "start" | "done" | "pending" | "error";
      agentCallId?: string;
      taskId?: string;
      durationMs?: number;
      terminalCode?: string;
    }
  | {
      type: "agent_call_progress";
      agent: string;
      state: string;
      elapsedSeconds: number;
      detail?: string;
      agentCallId?: string;
    }
  | {
      type: "agent_call_text";
      agent: string;
      text: string;
      agentCallId?: string;
    }
  | {
      type: "agent_call_activity";
      agent: string;
      snapshot: A2AAgentActivitySnapshot;
      agentCallId?: string;
    }
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
  | {
      type: "done";
      reason?: "user";
    }
  | {
      type: "error";
      error: string;
      errorCode?: string;
      upgradeUrl?: string;
      details?: string;
      recoverable?: boolean;
      providerRetryable?: boolean;
    }
  /**
   * Legacy SSE terminal event. New streams emit
   * `{ type: "error", errorCode: "missing_credentials" }` instead.
   */
  | { type: "missing_api_key" }
  | { type: "loop_limit"; maxIterations?: number }
  | {
      type: "tripwire";
      reason: string;
      processor?: string;
    }
  | {
      type: "auto_continue";
      reason: ContinuationReason;
      maxIterations?: number;
    }
  | { type: "clear" };

export const CONTINUATION_REASONS = [
  "run_timeout",
  "loop_limit",
  "max_tokens",
  "no_progress",
  "stream_ended",
  "gateway_timeout",
  "network_interrupted",
  "rate_limited",
] as const;

export type ContinuationReason = (typeof CONTINUATION_REASONS)[number];

export function isContinuationTerminalReason(reason: unknown): boolean {
  return (
    reason === "auto_continue" ||
    CONTINUATION_REASONS.includes(reason as ContinuationReason)
  );
}

export interface RunEvent {
  seq: number;
  event: AgentChatEvent;
}

export type RunStatus =
  | "running"
  | "completed"
  | "truncated"
  | "errored"
  | "aborted";
