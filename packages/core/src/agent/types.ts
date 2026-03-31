export interface ScriptTool {
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

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentChatReference {
  type: "file" | "skill" | "mention";
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
  ) => MentionProviderItem[] | Promise<MentionProviderItem[]>;
}

export interface AgentChatRequest {
  message: string;
  history?: AgentMessage[];
  references?: AgentChatReference[];
  threadId?: string;
}

export type AgentChatEvent =
  | { type: "text"; text: string }
  | { type: "tool_start"; tool: string; input: Record<string, string> }
  | { type: "tool_done"; tool: string; result: string }
  | { type: "done" }
  | { type: "error"; error: string }
  | { type: "missing_api_key" }
  | { type: "loop_limit" };

export interface RunEvent {
  seq: number;
  event: AgentChatEvent;
}

export type RunStatus = "running" | "completed" | "errored";
