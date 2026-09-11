import type { ReactNode } from "react";

import type { ActionChatUIConfig } from "../../action-ui.js";
import type { AgentMcpAppPayload } from "../../mcp-client/app-result.js";

export interface AgentConversationAttachment {
  name: string;
  type?: string;
  size?: number;
  /** Base64 data URL for image attachments (e.g. "data:image/png;base64,..."). */
  dataUrl?: string;
}

export type AgentConversationMessageRole = "user" | "assistant" | "system";

export type AgentConversationToolState =
  | "running"
  | "completed"
  | "errored"
  | "activity";

export interface AgentConversationToolCall {
  id: string;
  name: string;
  state: AgentConversationToolState;
  input?: string;
  args?: Record<string, unknown>;
  result?: string;
  resultJson?: unknown;
  mcpApp?: AgentMcpAppPayload;
  chatUI?: ActionChatUIConfig;
  summary?: string;
}

export type AgentConversationNoticeTone = "info" | "warning" | "error";

export interface AgentConversationNotice {
  id: string;
  tone: AgentConversationNoticeTone;
  title?: string;
  text: string;
  action?: ReactNode;
}

export interface AgentConversationArtifact {
  id: string;
  label: string;
  path?: string;
  url?: string;
}

export type AgentConversationMessagePart =
  | {
      id: string;
      type: "text";
      text: string;
    }
  | {
      id: string;
      type: "tool";
      tool: AgentConversationToolCall;
    }
  | {
      id: string;
      type: "notice";
      notice: AgentConversationNotice;
    }
  | {
      id: string;
      type: "artifact";
      artifact: AgentConversationArtifact;
    };

export interface AgentConversationMessage {
  id: string;
  role: AgentConversationMessageRole;
  text?: string;
  createdAt?: string;
  pending?: boolean;
  parts?: AgentConversationMessagePart[];
  tools?: AgentConversationToolCall[];
  notices?: AgentConversationNotice[];
  artifacts?: AgentConversationArtifact[];
  attachments?: AgentConversationAttachment[];
}
