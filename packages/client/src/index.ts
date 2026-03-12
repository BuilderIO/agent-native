// Browser-side utilities for agent-native apps.
// Import everything from "@agent-native/client".

// Chat bridge
export { sendToAgentChat, type AgentChatMessage } from "./agent-chat.js";
export { agentChat } from "./shared-agent-chat.js";

// React hooks
export { useAgentChatGenerating } from "./use-agent-chat.js";
export { useFileWatcher } from "./use-file-watcher.js";

// Utilities
export { cn } from "./utils.js";
