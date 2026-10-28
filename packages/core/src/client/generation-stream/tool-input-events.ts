/**
 * Window events both chat transports dispatch while the agent works. The
 * classic SSE processor and the AgentKit chat bridge emit the same shapes.
 */
export const TOOL_INPUT_EVENT = "agent-native:tool-input";
export const TOOL_DONE_EVENT = "agent-native:tool-done";

export interface ToolInputEventDetail {
  phase?: "start" | "delta";
  tool?: string;
  id?: string;
  /** Every argument character received so far for this call. */
  argsText?: string;
  text?: string;
  tabId?: string;
}

export interface ToolDoneEventDetail {
  tool?: string;
  result?: unknown;
  isError?: boolean;
  completedSideEffect?: boolean;
  tabId?: string;
  /** The tool call id, when the transport has one. */
  eventId?: string;
}
