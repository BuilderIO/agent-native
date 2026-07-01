import type { AgentMcpAppPayload } from "../../mcp-client/app-result.js";

export type AgentHarnessPermissionMode =
  | "allow-all"
  | "allow-edits"
  | "allow-reads";

export interface AgentHarnessCapabilities {
  /** Runtime needs an isolated workspace/sandbox to operate safely. */
  sandbox: boolean;
  /** Native session state can be detached and resumed later. */
  resumable: boolean;
  /** Runtime can pause for human approval before continuing. */
  approvals: boolean;
  /** Runtime can execute host-defined tools supplied by Agent Native. */
  hostTools: boolean;
  /** Runtime emits file mutation or artifact events. */
  fileEvents: boolean;
}

export interface AgentHarnessAdapter {
  /** Unique identifier, e.g. "ai-sdk-harness:codex". */
  readonly name: string;
  /** Human-readable label for UI display. */
  readonly label: string;
  /** Short description for pickers and diagnostics. */
  readonly description: string;
  /** Optional install hint when the adapter's runtime packages are missing. */
  readonly installPackage?: string;
  readonly capabilities: AgentHarnessCapabilities;
  createSession(
    opts: AgentHarnessCreateSessionOptions,
  ): Promise<AgentHarnessSession>;
}

export interface AgentHarnessCreateSessionOptions {
  /** Agent Native session id. Adapters may map this to a native runtime id. */
  sessionId?: string;
  threadId?: string;
  runId?: string;
  cwd?: string;
  instructions?: string;
  skills?: unknown[];
  tools?: Record<string, unknown>;
  permissionMode?: AgentHarnessPermissionMode;
  sandbox?: unknown;
  /**
   * Opaque value previously returned by detach()/stop(). Agent Native stores it
   * but does not interpret it.
   */
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
