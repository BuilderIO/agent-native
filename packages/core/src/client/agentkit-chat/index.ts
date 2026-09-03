/**
 * Narrow Core bridge for applications that render AgentKit as their primary
 * Chat surface. The legacy `client/agent-chat` entry remains the complete
 * compatibility API; importing it from an AgentKit route would also evaluate
 * unrelated panels, settings, editors, and observability UI on cold start.
 */
export { CoreComposerRuntimeProvider } from "./core-composer-runtime.js";
export { GuidedQuestionFlow, useGuidedQuestionFlow } from "./questions.js";
export { useChatThreads, type ChatThreadSummary } from "../use-chat-threads.js";
export {
  isAgentChatHomeHandoffActive,
  markAgentChatHomeHandoff,
  navigateWithAgentChatViewTransition,
} from "../chat-view-transition.js";
export {
  useAgentChatHomeHandoff,
  useAgentChatHomeHandoffLinks,
} from "../use-agent-chat-home-handoff.js";
export { createAgentNativeAgentKitTransport } from "./transport.js";
export {
  findMcpConnectionSuggestionIntegration,
  McpConnectionSuggestion,
} from "./suggestions.js";
export {
  McpAgentKitConnectionRequestCard,
  McpAgentKitConnectionResume,
} from "./connections.js";
export { useAgentChatRunningThreads } from "../use-agent-chat-running-threads.js";
