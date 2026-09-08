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
    ctx?: Record<string, unknown>;
  }): Promise<void | SuggestionOperation[]> | void | SuggestionOperation[];
  preview?(context: SuggestionContext): Promise<unknown> | unknown;
  coordinateDecision?<T>(
    context: SuggestionDecisionContext,
    run: (coordination?: unknown) => Promise<T>,
  ): Promise<T>;
  apply(context: SuggestionContext): Promise<unknown> | unknown;
  describeOperation?(operation: SuggestionOperation): string;
  buildUrl?(resourceId: string, suggestionId: string): string;
}
