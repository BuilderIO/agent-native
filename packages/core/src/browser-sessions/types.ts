export type AgentNativeBrowserSessionRequestType =
  | "get-context"
  | "list-actions"
  | "run-action"
  | "command";

export type AgentNativeBrowserSessionRequestStatus =
  | "pending"
  | "claimed"
  | "completed"
  | "failed"
  | "expired";

export type AgentNativeBrowserSessionJsonObject = Record<string, unknown>;

export interface AgentNativeBrowserSessionAction {
  name: string;
  description: string;
  schema?: AgentNativeBrowserSessionJsonObject;
  parameters?: AgentNativeBrowserSessionJsonObject;
  source?: string;
  availability?: string;
  destructive?: boolean;
  requiresApproval?: boolean | AgentNativeBrowserSessionJsonObject;
  approval?: AgentNativeBrowserSessionJsonObject;
  [key: string]: unknown;
}

export interface AgentNativeBrowserSession {
  id: string;
  label?: string;
  connectedAt?: string;
  url?: string;
  [key: string]: unknown;
}

export interface AgentNativeBrowserSessionRecord {
  sessionId: string;
  session: AgentNativeBrowserSession;
  label?: string;
  url?: string;
  context?: AgentNativeBrowserSessionJsonObject;
  actions: AgentNativeBrowserSessionAction[];
  connectedAt: number;
  lastSeenAt: number;
  expiresAt: number;
  active: boolean;
}

export interface AgentNativeBrowserSessionRequest {
  id: string;
  sessionId: string;
  type: AgentNativeBrowserSessionRequestType;
  name?: string;
  command?: string;
  args?: unknown;
  payload?: unknown;
  status: AgentNativeBrowserSessionRequestStatus;
  createdAt: number;
  claimedAt?: number;
  completedAt?: number;
  expiresAt: number;
  result?: unknown;
  error?: string;
}

export interface RegisterAgentNativeBrowserSessionInput {
  session?: AgentNativeBrowserSession;
  sessionId?: string;
  label?: string;
  url?: string;
  context?: AgentNativeBrowserSessionJsonObject;
  actions?: AgentNativeBrowserSessionAction[];
  ttlMs?: number;
}

export interface CreateAgentNativeBrowserSessionRequestInput {
  type: AgentNativeBrowserSessionRequestType;
  name?: string;
  command?: string;
  args?: unknown;
  payload?: unknown;
  timeoutMs?: number;
}
