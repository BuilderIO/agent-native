export interface ActionTool {
  description: string;
  parameters?: {
    type: "object";
    properties: Record<
      string,
      {
        type: string;
        description?: string;
        enum?: string[];
      }
    >;
    required?: string[];
  };
}

/** @deprecated Use `ActionTool` instead */
export type ScriptTool = ActionTool;

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentChatReference {
  type: "file" | "skill" | "mention" | "agent" | "custom-agent";
  path: string;
  name: string;
  source: string;
  refType?: string;
  refId?: string;
}

export interface MentionProviderItem {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  refType: string;
  refId?: string;
  refPath?: string;
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

export interface AgentChatRequest {
  message: string;
  history?: AgentMessage[];
  references?: AgentChatReference[];
  threadId?: string;
  attachments?: AgentChatAttachment[];
  /** Usage-tracking label for this call (e.g. "chat", "summarize"). Default: "chat". */
  usageLabel?: string;
}

export type AgentChatEvent =
  | { type: "text"; text: string }
  | { type: "tool_start"; tool: string; input: Record<string, string> }
  | { type: "tool_done"; tool: string; result: string }
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
  | { type: "error"; error: string }
  | { type: "missing_api_key" }
  | { type: "usage_limit_reached"; usageCents: number; limitCents: number }
  | { type: "loop_limit" }
  | { type: "clear" };

export interface RunEvent {
  seq: number;
  event: AgentChatEvent;
}

export type RunStatus = "running" | "completed" | "errored";
