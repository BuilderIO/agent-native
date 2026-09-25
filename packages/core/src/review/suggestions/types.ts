import type { Visibility } from "../../sharing/schema.js";
export type SuggestionStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "stale"
  | "superseded";
export type SuggestionDecision = "accepted" | "rejected";
export interface SuggestionOperation {
  id?: string;
  ordinal: number;
  kind: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  anchor?: unknown;
  dependencies?: unknown;
  schemaVersion: number;
}
export interface ResourceSuggestion {
  id: string;
  proposalId?: string | null;
  proposalSummary?: string | null;
  revision: number;
  resourceType: string;
  resourceId: string;
  adapterKind: string;
  adapterVersion: number;
  threadId: string;
  authorEmail: string | null;
  actorKind: "human" | "agent" | "system";
  baseRevision: string;
  status: SuggestionStatus;
  summary: string;
  ownerEmail: string | null;
  orgId: string | null;
  visibility: Visibility;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown> | null;
  operations: SuggestionOperation[];
}
export interface ResourceSuggestionProposal {
  id: string;
  resourceType: string;
  resourceId: string;
  adapterKind: string;
  summary: string;
  authorEmail: string | null;
  actorKind: "human" | "agent" | "system";
  createdAt: string;
}
export interface SuggestionAccess {
  role: "viewer" | "commenter" | "editor" | "admin" | "owner";
  ownerEmail?: string | null;
  orgId?: string | null;
  visibility?: Visibility | null;
}
export interface SuggestionContext {
  resourceType: string;
  resourceId: string;
  suggestion: ResourceSuggestion;
  operations: SuggestionOperation[];
  access: SuggestionAccess;
  ctx?: Record<string, unknown>;
  transaction: unknown;
  coordination?: unknown;
}
export interface SuggestionDecisionContext {
  resourceType: string;
  resourceId: string;
  suggestion: ResourceSuggestion;
  operations: SuggestionOperation[];
  decision: SuggestionDecision;
  proposalDecision?: boolean;
  access: SuggestionAccess;
  ctx?: Record<string, unknown>;
}
export interface SuggestionAdapter {
  kind: string;
  version: number;
  validateProposal(input: {
    resourceType: string;
    resourceId: string;
    baseRevision: string;
    operations: SuggestionOperation[];
    metadata?: Record<string, unknown> | null;
    ctx?: Record<string, unknown>;
  }): Promise<void | SuggestionOperation[]> | void | SuggestionOperation[];
  preview?(context: SuggestionContext): Promise<unknown> | unknown;
  coordinateDecision?<T>(
    context: SuggestionDecisionContext,
    run: (coordination?: unknown) => Promise<T>,
  ): Promise<T>;
  finalizeProposalDecision?(context: {
    resourceType: string;
    resourceId: string;
    transaction: unknown;
    coordination?: unknown;
  }): Promise<void> | void;
  apply(context: SuggestionContext): Promise<unknown> | unknown;
  describeOperation?(operation: SuggestionOperation): string;
  buildUrl?(resourceId: string, suggestionId: string): string;
}
