// Server (H3/Nitro)
export { mountA2A } from "./server.js";

// Client
export { A2AClient, callAgent, signA2AToken } from "./client.js";

// Types
export type {
  A2AConfig,
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
