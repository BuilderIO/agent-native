/**
 * Public exports for the pluggable agent engine system.
 */

export type {
  AgentEngine,
  EngineCapabilities,
  EngineTool,
  EngineMessage,
  EngineContentPart,
  EngineTextPart,
  EngineImagePart,
  EngineToolCallPart,
  EngineToolResultPart,
  EngineThinkingPart,
  EngineEvent,
  EngineStreamOptions,
} from "./types.js";

export {
  registerAgentEngine,
  getAgentEngineEntry,
  listAgentEngines,
  resolveEngine,
  getStoredModelForEngine,
  detectEngineFromEnv,
  isAgentEngineSettingConfigured,
  isStoredEngineUsable,
  type AgentEngineEntry,
  type ResolveEngineConfig,
} from "./registry.js";

export {
  createAnthropicEngine,
  ANTHROPIC_DEFAULT_MODEL,
  ANTHROPIC_SUPPORTED_MODELS,
  ANTHROPIC_CAPABILITIES,
} from "./anthropic-engine.js";
export { createAISDKEngine, type AISDKProvider } from "./ai-sdk-engine.js";
export { registerBuiltinEngines } from "./builtin.js";
