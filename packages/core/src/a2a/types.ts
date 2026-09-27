import type { PublicAgentActionConfig } from "../action.js";

export type {
  A2AAgentActivityPhase,
  A2AAgentActivitySnapshot,
  A2AAgentActivityState,
  A2AAgentActivityToolCall,
  A2AAgentActivityToolStatus,
} from "./activity.js";

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

export interface Message {
  role: "user" | "agent";
  parts: Part[];
  metadata?: Record<string, unknown>;
}

export type TaskState =
  | "submitted"
  | "working"
  | "processing"
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

export interface A2AConnectionRequestMetadata {
  version: 1;
  provider: string;
  reason: "connect" | "grant" | "reauthorize" | "admin_required";
  appId?: string;
  detail?: string;
}

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
  inputSchema?: Record<string, unknown>;
}

export interface AgentCapabilities {
  streaming?: boolean;
  pushNotifications?: boolean;
  stateTransitionHistory?: boolean;
  connect?: boolean;
  extendedAgentCard?: boolean;
}

export interface AgentSecurityScheme {
  type: string;
  scheme?: string;
  bearerFormat?: string;
  in?: string;
  name?: string;
}

export type A2AProtocolVersion = "0.3" | "1.0" | (string & {});

export interface AgentInterface {
  url: string;
  protocolBinding: string;
  protocolVersion: A2AProtocolVersion;
  tenant?: string;
}

export interface AgentAdditionalInterface {
  url: string;
  transport?: string;
  protocolBinding?: string;
  protocolVersion?: A2AProtocolVersion;
  tenant?: string;
}

export interface AgentCard {
  name: string;
  description: string;
  url?: string;
  version: string;
  protocolVersion?: A2AProtocolVersion;
  preferredTransport?: string;
  additionalInterfaces?: AgentAdditionalInterface[];
  supportedInterfaces?: AgentInterface[];
  capabilities: AgentCapabilities;
  skills: AgentSkill[];
  securitySchemes?: Record<string, AgentSecurityScheme>;
  security?: Record<string, string[]>[];
}

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

export interface A2AApprovedAction {
  tool: string;
  input: unknown;
}

export interface A2ASourceContext {
  platform: "slack";
  sourceUrl: string;
}

export interface A2ASourceContextReference {
  platform: "slack";
  integrationTaskId: string;
}

export interface A2ACorrelationMetadata {
  callerApp?: string;
  selectedReceiverApp?: string;
  callerThreadId?: string;
  parentRunId?: string;
  parentTurnId?: string;
  invocationId?: string;
  delegationDepth?: number;
  visitedApps?: string[];
  callerModel?: string;
}

export interface A2AHandlerContext {
  taskId: string;
  contextId?: string;
  metadata?: Record<string, unknown>;
  event?: unknown;
  approvedActions?: A2AApprovedAction[];
  sourceContext?: A2ASourceContext;
  writeArtifact: (name: string, content: string, mimeType?: string) => string;
}

export interface A2AHandlerResult {
  message: Message;
  artifacts?: Artifact[];
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
  appId?: string;
  description: string;
  version?: string;
  skills: AgentSkill[];
  authenticatedSkills?: AgentSkill[];
  publicSkillsOnly?: boolean;
  handler?: A2AHandler;
  apiKeyEnv?: string;
  streaming?: boolean;
  connect?: boolean;
  durableBackgroundRuns?: boolean;
  executeApproval?: (approval: A2AApprovalExecution) => Promise<{
    status: "completed" | "failed";
    output: string;
  }>;
  executeReadOnlyAction?: (
    invocation: A2AReadOnlyActionInvocation,
  ) => Promise<Pick<A2AReadOnlyActionResult, "status" | "output">>;
}
