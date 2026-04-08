// A2A Protocol types (spec v0.3) + framework config types

// --- Parts (content atoms) ---

export interface TextPart {
  type: "text";
  text: string;
}

export interface FilePart {
  type: "file";
  file: {
    name?: string;
    mimeType?: string;
    bytes?: string;
    uri?: string;
  };
}

export interface DataPart {
  type: "data";
  data: Record<string, unknown>;
}

export type Part = TextPart | FilePart | DataPart;

// --- Messages and Tasks ---

export interface Message {
  role: "user" | "agent";
  parts: Part[];
  metadata?: Record<string, unknown>;
}

export type TaskState =
  | "submitted"
  | "working"
  | "completed"
  | "failed"
  | "canceled"
  | "input-required";

export interface TaskStatus {
  state: TaskState;
  message?: Message;
  timestamp: string;
}

export interface Artifact {
  name?: string;
  description?: string;
  parts: Part[];
  metadata?: Record<string, unknown>;
}

export interface Task {
  id: string;
  contextId?: string;
  status: TaskStatus;
  history?: Message[];
  artifacts?: Artifact[];
  metadata?: Record<string, unknown>;
}

// --- Agent Card ---

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  examples?: string[];
}

export interface AgentCapabilities {
  streaming?: boolean;
  pushNotifications?: boolean;
  stateTransitionHistory?: boolean;
}

export interface AgentSecurityScheme {
  type: string;
  scheme?: string;
  bearerFormat?: string;
  in?: string;
  name?: string;
}

export interface AgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  protocolVersion: "0.3";
  capabilities: AgentCapabilities;
  skills: AgentSkill[];
  securitySchemes?: Record<string, AgentSecurityScheme>;
  security?: Record<string, string[]>[];
}

// --- JSON-RPC ---

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: JsonRpcError;
}

// --- Framework config ---

export interface A2AHandlerContext {
  taskId: string;
  contextId?: string;
  /** Metadata from the caller (e.g., userEmail for identity forwarding) */
  metadata?: Record<string, unknown>;
  writeArtifact: (name: string, content: string, mimeType?: string) => string;
}

export interface A2AHandlerResult {
  message: Message;
  artifacts?: Artifact[];
}

export type A2AHandler = (
  message: Message,
  context: A2AHandlerContext,
) => Promise<A2AHandlerResult> | AsyncGenerator<Message>;

export interface A2AConfig {
  name: string;
  description: string;
  version?: string;
  skills: AgentSkill[];
  handler?: A2AHandler;
  apiKeyEnv?: string;
  streaming?: boolean;
}
