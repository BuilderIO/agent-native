
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
  | "loop_limit"
  | "auto_continue"
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
  toolCallId?: string;
  input?: unknown;
  result?: unknown;
  error?: string;
  errorCode?: string;
  recoverable?: boolean;
  approvalKey?: string;
  isError?: boolean;
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
  workDurationMs?: number;
}

export interface ChatTurnState {
  messages: ChatMessage[];
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
  appId?: string;
  appName?: string;
  appIcon?: string;
  baseUrl?: string;
}

export interface ChatAttachment {
  type: string;
  name: string;
  data?: string;
  contentType?: string;
  text?: string;
}

export interface MentionItem {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  source: string;
  refType: string;
  refPath?: string;
  refId?: string;
}

export interface ChatReference {
  type: "file" | "skill" | "mention" | "agent" | "custom-agent";
  path: string;
  name: string;
  source: string;
  refType?: string;
  refId?: string;
}

export interface ChatSendOptions {
  threadId?: string;
  turnId?: string;
  model?: string;
  engine?: string;
  effort?: string;
  mode?: "act" | "plan";
  attachments?: ChatAttachment[];
  references?: ChatReference[];
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
  configurableProviders?: string[];
}

export interface ActiveRunInfo {
  active: boolean;
  runId?: string;
  turnId?: string;
  status?: string;
}

const TERMINAL_WIRE_EVENT_TYPES: ReadonlySet<string> = new Set([
  "done",
  "error",
  "missing_api_key",
  "loop_limit",
  "auto_continue",
]);

export function isTerminalWireEvent(event: WireEvent): boolean {
  return TERMINAL_WIRE_EVENT_TYPES.has(event.type);
}

export function messageText(message: ChatMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}
