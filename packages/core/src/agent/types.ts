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

export interface AgentChatRequest {
  message: string;
  history?: AgentMessage[];
}

export type AgentChatEvent =
  | { type: "text"; text: string }
  | { type: "tool_start"; tool: string; input: Record<string, string> }
  | { type: "tool_done"; tool: string; result: string }
  | { type: "done" }
  | { type: "error"; error: string };
