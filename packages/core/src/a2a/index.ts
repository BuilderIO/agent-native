// Server (H3/Nitro)
export { mountA2A, verifyA2AToken } from "./server.js";
export type { A2ATokenPayload } from "./server.js";
export { generateAgentCard } from "./agent-card.js";
export {
  A2A_AGENT_ACTIVITY_KIND,
  A2A_AGENT_ACTIVITY_VERSION,
  MAX_A2A_ACTIVITY_REASONING_CHARS,
  MAX_A2A_ACTIVITY_REASONING_SEGMENTS,
  MAX_A2A_ACTIVITY_RESPONSE_CHARS,
  MAX_A2A_ACTIVITY_TOOL_CALLS,
  MAX_A2A_ACTIVITY_TOTAL_CHARS,
  MAX_A2A_ACTIVITY_TOOL_ID_CHARS,
  MAX_A2A_ACTIVITY_TOOL_NAME_CHARS,
  applyA2AAgentActivityEvent,
  buildA2AAgentActivityPart,
  buildA2AAgentActivitySnapshot,
  createA2AAgentActivityState,
  parseA2AAgentActivityPart,
} from "./activity.js";

// Client
export { A2AClient, callAction, callAgent, signA2AToken } from "./client.js";
export {
  AgentInvocationError,
  buildAgentInvocationPrompt,
  invokeAgent,
  invokeAgentAction,
  looksLikeAgentUrl,
  resolveAgentInvocationTarget,
} from "./invoke.js";

// Types
export type {
  A2AConfig,
  A2AHandler,
  A2AHandlerContext,
  A2AHandlerResult,
  A2ASourceContext,
  AgentCard,
  AgentSkill,
  AgentCapabilities,
  Task,
  TaskState,
  TaskStatus,
  Message,
  Part,
  TextPart,
  FilePart,
  DataPart,
  Artifact,
  JsonRpcRequest,
  JsonRpcResponse,
  A2ACorrelationMetadata,
  A2AReadOnlyActionInvocation,
  A2AReadOnlyActionResult,
  A2AAgentActivityPhase,
  A2AAgentActivitySnapshot,
  A2AAgentActivityState,
  A2AAgentActivityToolCall,
  A2AAgentActivityToolStatus,
} from "./types.js";
export type {
  AgentInvocationErrorCode,
  AgentActionInvocationResult,
  AgentInvocationResult,
  AgentInvocationRuntime,
  InvokeAgentActionOptions,
  InvokeAgentOptions,
  ResolveAgentInvocationTargetOptions,
  ResolvedAgentInvocationTarget,
} from "./invoke.js";
