import type { Visibility } from "../sharing/schema.js";

export type ReviewResourceRole = "viewer" | "editor" | "admin" | "owner";
export type ReviewCommentKind =
  | "comment"
  | "annotation"
  | "correction"
  | "question"
  | "decision"
  | "review";
export type ReviewCommentStatus = "open" | "resolved" | "deleted";
export type ReviewResolutionTarget = "agent" | "human";
export type ReviewStatus =
  | "draft"
  | "in_review"
  | "approved"
  | "changes_requested";
export type ReviewActorKind = "human" | "agent" | "import" | "system";

export interface ReviewResourceAccess {
  role: ReviewResourceRole;
  ownerEmail?: string | null;
  orgId?: string | null;
  visibility?: Visibility | null;
  resource?: unknown;
}

export interface ReviewResourceContext {
  userEmail?: string | null;
  orgId?: string | null;
  caller?: string | null;
  request?: unknown;
  [key: string]: unknown;
}

export interface ReviewableResourceRegistration {
  type: string;
  displayName?: string;
  resolveAccess?: (
    resourceId: string,
    ctx?: ReviewResourceContext,
  ) => Promise<ReviewResourceAccess | null> | ReviewResourceAccess | null;
}

export interface ReviewMention {
  label: string;
  email?: string | null;
  id?: string | null;
}

export interface ReviewComment {
  id: string;
  resourceType: string;
  resourceId: string;
  threadId: string;
  parentCommentId: string | null;
  targetId: string | null;
  kind: ReviewCommentKind;
  status: ReviewCommentStatus;
  anchor: unknown | null;
  body: string;
  authorEmail: string | null;
  authorName: string | null;
  createdBy: ReviewActorKind;
  resolutionTarget: ReviewResolutionTarget | null;
  mentions: ReviewMention[];
  ownerEmail: string | null;
  orgId: string | null;
  visibility: Visibility;
  resolvedBy: string | null;
  resolvedAt: string | null;
  consumedAt: string | null;
  deletedBy: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown> | null;
}

export interface ReviewStatusEntry {
  id: string;
  resourceType: string;
  resourceId: string;
  status: ReviewStatus;
  note: string | null;
  updatedBy: string | null;
  updatedAt: string;
  ownerEmail: string | null;
  orgId: string | null;
  visibility: Visibility;
  metadata: Record<string, unknown> | null;
}

export interface ReviewScope {
  userEmail?: string | null;
  orgId?: string | null;
}
