import type { ReactNode } from "react";

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
  result?: string;
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

export interface AgentConversationMessage {
  id: string;
  role: AgentConversationMessageRole;
  text?: string;
  createdAt?: string;
  pending?: boolean;
  tools?: AgentConversationToolCall[];
  notices?: AgentConversationNotice[];
  artifacts?: AgentConversationArtifact[];
}
