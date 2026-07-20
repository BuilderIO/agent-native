/**
 * Wire protocol types for the framework's agent chat endpoint
 * (`POST /_agent-native/agent-chat`). The server streams line-delimited JSON
 * events, optionally SSE-framed with `data:` prefixes. This mirrors the web
 * client's SSE event shape in @agent-native/core.
 */

export type WireEventType =
  | "text"
  | "thinking"
  | "reasoning"
  | "activity"
  | "tool_start"
  | "tool_done"
  | "approval_required"
  | "error"
  | "missing_api_key"
  | "done";

export interface WireEvent {
  type: WireEventType | (string & {});
  seq?: number;
  text?: string;
  partId?: string;
  signature?: string;
  label?: string;
  tool?: string;
  id?: string;
  input?: unknown;
  result?: unknown;
  error?: string;
  errorCode?: string;
  recoverable?: boolean;
  approvalKey?: string;
}

export type ChatContentPart =
  | { type: "text"; text: string; partId?: string }
  | { type: "reasoning"; text: string; partId?: string }
  | { type: "image"; dataUrl: string; name?: string }
  | {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      inputText: string;
      status:
        | "running"
        | "completed"
        | "failed"
        | "cancelled"
        | "awaiting-approval";
      resultText?: string;
      error?: string;
      approvalKey?: string;
    };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  parts: ChatContentPart[];
  createdAt: number;
}

export interface ChatTurnState {
  messages: ChatMessage[];
  /** Transient status line from `activity` events ("Reading file…"). */
  activity: string | null;
  isStreaming: boolean;
  error: string | null;
  errorCode: string | null;
  runId: string | null;
}

export interface ChatThreadSummary {
  id: string;
  title: string;
  updatedAt: number;
  preview?: string;
}

/** Matches the server's AgentChatAttachment; `data` is a base64 data URL. */
export interface ChatAttachment {
  type: string;
  name: string;
  data?: string;
  contentType?: string;
  text?: string;
}

export interface ChatSendOptions {
  threadId?: string;
  model?: string;
  engine?: string;
  effort?: string;
  mode?: "act" | "plan";
  attachments?: ChatAttachment[];
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface ChatModelGroup {
  engine: string;
  label: string;
  models: string[];
}

export interface ChatModelCatalog {
  groups: ChatModelGroup[];
  currentEngine?: string;
  currentModel?: string;
}

export interface ActiveRunInfo {
  active: boolean;
  runId?: string;
  status?: string;
}

export function messageText(message: ChatMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}
