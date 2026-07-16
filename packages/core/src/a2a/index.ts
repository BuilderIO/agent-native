// Server (H3/Nitro)
export { mountA2A, verifyA2AToken } from "./server.js";
export type { A2ATokenPayload } from "./server.js";
export { generateAgentCard } from "./agent-card.js";

// Client
export { A2AClient, callAgent, signA2AToken } from "./client.js";
export {
  A2A_APPROVE_ACTIONS_SCOPE,
  A2A_INVOKE_SCOPE,
  hasUsableA2APeerTrust,
  signA2APeerToken,
  summarizeA2ATrustedPeers,
  trustedA2APeersFromEnv,
  verifyTrustedA2APeerToken,
} from "./peer-trust.js";
export type {
  A2APeerTrustSummary,
  VerifiedA2APeerIdentity,
} from "./peer-trust.js";
export {
  AgentInvocationError,
  buildAgentInvocationPrompt,
  invokeAgent,
  looksLikeAgentUrl,
  resolveAgentInvocationTarget,
} from "./invoke.js";

// Types
export type {
  A2AConfig,
  A2ATrustedPeer,
  A2ATrustedPeerCredential,
  A2AHandler,
  A2AHandlerContext,
  A2AHandlerResult,
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
} from "./types.js";
export type {
  AgentInvocationErrorCode,
  AgentInvocationResult,
  AgentInvocationRuntime,
  InvokeAgentOptions,
  ResolveAgentInvocationTargetOptions,
  ResolvedAgentInvocationTarget,
} from "./invoke.js";
