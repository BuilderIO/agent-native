import type { AgentMcpAppPayload } from "../../mcp-client/app-result.js";

export type AgentHarnessPermissionMode =
  | "allow-all"
  | "allow-edits"
  | "allow-reads";

export interface AgentHarnessCapabilities {
  sandbox: boolean;
  resumable: boolean;
  approvals: boolean;
  hostTools: boolean;
  fileEvents: boolean;
}

export interface AgentHarnessAdapter {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly installPackage?: string;
  readonly capabilities: AgentHarnessCapabilities;
  createSession(
    opts: AgentHarnessCreateSessionOptions,
  ): Promise<AgentHarnessSession>;
}

export interface AgentHarnessCreateSessionOptions {
  sessionId?: string;
  threadId?: string;
  runId?: string;
  cwd?: string;
  instructions?: string;
  skills?: unknown[];
  tools?: Record<string, unknown>;
  permissionMode?: AgentHarnessPermissionMode;
  sandbox?: unknown;
  resumeState?: unknown;
  metadata?: Record<string, unknown>;
  ownerEmail?: string | null;
  orgId?: string | null;
  signal?: AbortSignal;
}

export interface AgentHarnessMessage {
  role: "system" | "user" | "assistant";
  content: string | unknown[];
}

export interface AgentHarnessTurnInput {
  prompt?: string;
  messages?: AgentHarnessMessage[];
  metadata?: Record<string, unknown>;
  abortSignal?: AbortSignal;
}

export interface AgentHarnessContinueInput {
  approval?: AgentHarnessApproval;
  metadata?: Record<string, unknown>;
  abortSignal?: AbortSignal;
}

export interface AgentHarnessApproval {
  id: string;
  approved: boolean;
  message?: string;
}

export interface AgentHarnessSession {
  readonly id: string;
  streamTurn(input: AgentHarnessTurnInput): AsyncIterable<AgentHarnessEvent>;
  continueTurn?(
    input?: AgentHarnessContinueInput,
  ): AsyncIterable<AgentHarnessEvent>;
  approve?(approval: AgentHarnessApproval): Promise<void>;
  detach?(): Promise<unknown>;
  stop?(): Promise<unknown>;
  destroy?(): Promise<void>;
}

export type AgentHarnessEvent =
  | { type: "text-delta"; text: string }
  | { type: "thinking-delta"; text: string }
  | { type: "activity"; label: string; tool?: string }
  | { type: "tool-start"; id?: string; name: string; input?: unknown }
  | {
      type: "tool-done";
      id?: string;
      name: string;
      input?: unknown;
      result?: unknown;
      mcpApp?: AgentMcpAppPayload;
    }
  | {
      type: "approval-request";
      id: string;
      tool?: string;
      message: string;
      input?: unknown;
    }
  | {
      type: "file-change";
      path: string;
      operation?: "create" | "update" | "delete" | "rename" | "unknown";
      summary?: string;
    }
  | { type: "compaction"; summary?: string }
  | {
      type: "usage";
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      costCents?: number;
    }
  | { type: "error"; error: string; code?: string; recoverable?: boolean }
  | { type: "done"; reason?: string };
