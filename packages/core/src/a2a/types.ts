// A2A Protocol types (spec v0.3) + framework config types
import type { PublicAgentActionConfig } from "../action.js";

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
  public?: boolean;
  readOnly?: boolean;
  requiresAuth?: boolean;
  isConsequential?: boolean;
  publicAgent?: PublicAgentActionConfig;
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

/** One exact downstream action explicitly authorized in the caller's chat. */
export interface A2AApprovedAction {
  tool: string;
  input: unknown;
}

/** Structured provenance accepted only from an authenticated A2A caller. */
export interface A2ASourceContext {
  platform: "slack";
  sourceUrl: string;
}

/**
 * Telemetry-only cross-app correlation. Receivers must never use these
 * caller-supplied values for identity, ownership, org scoping, access, or
 * approval decisions.
 */
export interface A2ACorrelationMetadata {
  callerApp?: string;
  callerThreadId?: string;
  parentRunId?: string;
  parentTurnId?: string;
  invocationId?: string;
}

// --- Framework config ---

export interface A2AHandlerContext {
  taskId: string;
  contextId?: string;
  /** Metadata from the caller (e.g., userEmail for identity forwarding) */
  metadata?: Record<string, unknown>;
  /** Current H3 event when the handler is running inside an HTTP request. */
  event?: unknown;
  /** Exact one-time action grants from a JWT-authenticated caller. */
  approvedActions?: A2AApprovedAction[];
  /** Receiver-validated provenance from a JWT-authenticated caller. */
  sourceContext?: A2ASourceContext;
  writeArtifact: (name: string, content: string, mimeType?: string) => string;
}

export interface A2AHandlerResult {
  message: Message;
  artifacts?: Artifact[];
  /** Optional non-terminal state requested by the handler. */
  taskState?: Extract<TaskState, "input-required">;
}

export interface A2AApprovalExecution {
  id: string;
  taskId: string;
  ownerEmail: string;
  orgId?: string | null;
  tool: string;
  input: unknown;
  approvalKey: string;
  callId: string;
}

/** One explicitly exposed read-only app action invoked without an agent loop. */
export interface A2AReadOnlyActionInvocation {
  action: string;
  input: Record<string, unknown>;
  invocationId: string;
}

export interface A2AReadOnlyActionResult {
  action: string;
  status: "completed" | "failed";
  output: string;
}

export type A2AHandler = (
  message: Message,
  context: A2AHandlerContext,
) => Promise<A2AHandlerResult> | AsyncGenerator<Message>;

export interface A2AConfig {
  name: string;
  /** Canonical receiver app id used only for telemetry attribution. */
  appId?: string;
  description: string;
  version?: string;
  skills: AgentSkill[];
  /** If true, public agent-card discovery includes only explicit public-safe skills. */
  publicSkillsOnly?: boolean;
  handler?: A2AHandler;
  apiKeyEnv?: string;
  streaming?: boolean;
  /** Route async A2A work through the app's durable background worker when available. */
  durableBackgroundRuns?: boolean;
  /** Execute a persisted, human-approved A2A tool call. */
  executeApproval?: (approval: A2AApprovalExecution) => Promise<{
    status: "completed" | "failed";
    output: string;
  }>;
  /** Execute an explicitly exposed read-only action without starting a model. */
  executeReadOnlyAction?: (
    invocation: A2AReadOnlyActionInvocation,
  ) => Promise<Pick<A2AReadOnlyActionResult, "status" | "output">>;
}
