import type { DbExec } from "../db/client.js";
import type { Visibility } from "../sharing/schema.js";

export type ReviewResourceRole =
  | "viewer"
  | "commenter"
  | "editor"
  | "admin"
  | "owner";
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
  resolveUrl?: (
    resourceId: string,
  ) => Promise<string | null | undefined> | string | null | undefined;
  resolveAccess?: (
    resourceId: string,
    ctx?: ReviewResourceContext,
  ) => Promise<ReviewResourceAccess | null> | ReviewResourceAccess | null;
  /** Who may comment, and where a new thread goes. */
  comments?: ReviewCommentPolicy;
  /**
   * What a comment can attach to, by anchor kind. Once a resource declares
   * any, every anchored comment on it names one, and its anchor must pass that
   * kind's check before anything is written.
   */
  anchorKinds?: Record<string, ReviewAnchorKind>;
  /**
   * Runs inside the same database transaction as each comment write, with
   * that transaction's handle. Throwing refuses the write. Use the handle for
   * any database work here: `getDbExec()` would run on another connection.
   */
  onCommentWrite?: (
    event: ReviewCommentWriteEvent,
    tx: DbExec,
  ) => Promise<void> | void;
}

export interface ReviewCommentPolicy {
  /**
   * The lowest role that may comment, reply and react, and edit or delete
   * their own comments. Defaults to `commenter`.
   */
  minimumRole?: ReviewResourceRole;
  /**
   * Where a new thread that mentions no one goes: the agent (the default) or
   * people. A thread with a mention always goes to people.
   */
  unmentionedRoute?: ReviewResolutionTarget;
}

export interface ReviewAnchorKind {
  /** The version new anchors of this kind are written at. */
  version: number;
  /**
   * Checks an anchor written at `version` and returns it as it's stored.
   * Throw to refuse a malformed anchor; nothing is written.
   */
  parse: (anchor: unknown, version: number) => unknown;
}

/** A comment write, as a resource's `onCommentWrite` hook sees it. */
export type ReviewCommentWriteEvent =
  | { type: "created"; comment: ReviewComment }
  | {
      type: "edited" | "anchor-moved";
      comment: ReviewComment;
      /** Who changed it, which for an editor moving a pin isn't the author. */
      actorEmail: string | null;
    }
  | {
      type: "resolved" | "reopened";
      resourceType: string;
      resourceId: string;
      threadId: string;
      actorEmail: string | null;
    }
  | {
      type: "deleted";
      resourceType: string;
      resourceId: string;
      threadId: string;
      /** The comment deleted and, for a thread's first comment, the rest. */
      commentIds: string[];
      actorEmail: string | null;
    };

/** A comment's link to the same comment or thread in another system. */
export interface ReviewCommentLink {
  /** The other system, such as `notion`. */
  provider: string;
  /** What the outside ID names there, such as `comment` or `discussion`. */
  externalKind: string;
  externalId: string;
  commentId: string;
  resourceType: string;
  resourceId: string;
  createdAt: string;
}

export interface ReviewMention {
  label: string;
  email?: string | null;
  id?: string | null;
}

export interface ReviewCommentReaction {
  reaction: string;
  count: number;
  reactedByMe: boolean;
}

export interface ReviewThreadPreference {
  muted: boolean;
  unread: boolean;
}

export interface ReviewDiscussionState {
  reactions: Record<string, ReviewCommentReaction[]>;
  threadPreferences: Record<string, ReviewThreadPreference>;
  canReact: boolean;
  canSetThreadPreferences: boolean;
}

export interface ReviewComment {
  id: string;
  resourceType: string;
  resourceId: string;
  threadId: string;
  parentCommentId: string | null;
  targetId: string | null;
  /** The part of the resource the thread sits on, such as a slide. */
  surfaceId: string | null;
  kind: ReviewCommentKind;
  status: ReviewCommentStatus;
  anchor: unknown;
  /** The anchor's kind and the version it was written at, when typed. */
  anchorKind: string | null;
  anchorVersion: number | null;
  /**
   * Goes up whenever the comment or its thread changes (its text, anchor,
   * status, routing, agent pickup or deletion), so a write can check nothing
   * changed under it. Notification bookkeeping leaves it alone, so a new
   * comment's author can edit it at the revision they got back.
   */
  revision: number;
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
  resolutionNote?: string | null;
  canDelete?: boolean;
  /**
   * On a thread's first comment: whether the viewer may delete the whole
   * thread, replies included. Deleting a reply needs only `canDelete`.
   */
  canDeleteThread?: boolean;
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
