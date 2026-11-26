import type { DbExec } from "../db/client.js";
import type { ActivityNotificationResult } from "../server/activity-notifications.js";
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
  /** Where a comment email links: the resource, or the comment's place on it. */
  resolveUrl?: (
    resourceId: string,
    comment?: ReviewComment,
  ) => Promise<string | null | undefined> | string | null | undefined;
  /**
   * The resource's title. Comment emails name it, as in `Ada commented on
   * "Q3 plan"`, and say "review" without it.
   */
  resolveTitle?: (
    resourceId: string,
  ) => Promise<string | null | undefined> | string | null | undefined;
  /** How this resource's comment emails can be turned off. */
  email?: {
    /**
     * The user setting whose `emailNotifications: false` turns them off,
     * when the app keeps its own. Defaults to the kit's.
     */
    preferenceKey?: string;
    /** Where people change it, named in each email, such as "Slides settings". */
    settingsName?: string;
    /**
     * Sends a new comment's emails in place of the kit's, for an app that
     * keeps its own. What it returns is the comment's `notified`; return null
     * when the emails go out after the write answers. A keyed comment calls
     * it once: the kit marks the comment's emails sent before it calls, so a
     * retried or duplicate write never sends them again, even when some
     * failed.
     */
    send?: (
      comment: ReviewComment,
    ) => Promise<ActivityNotificationResult | null>;
  };
  resolveAccess?: (
    resourceId: string,
    ctx?: ReviewResourceContext,
  ) => Promise<ReviewResourceAccess | null> | ReviewResourceAccess | null;
  /** Who may comment, and where a new thread goes. */
  comments?: ReviewCommentPolicy;
  /**
   * Set while the app's own actions still write this resource's comments,
   * mirroring each into the kit with `mirrorReviewComments`. Through the kit
   * everyone then only reads them: its actions refuse every comment write on
   * the resource with this message, which should name the app's own actions.
   * Each person's own state, such as muting a thread or marking it read,
   * still works, since it isn't part of the comments.
   */
  commentsWrittenByApp?: string;
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
  /** The lowest role that may resolve and reopen threads. Defaults to `editor`. */
  resolveRole?: ReviewResourceRole;
  /**
   * Whether an agent needs its person's approval to delete anyone else's
   * comment, as an editor may. Without that approval the kit's delete keeps
   * an agent to its own comments, checked again as the thread locks.
   * Defaults to false.
   */
  agentDeleteApproval?: boolean;
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
  /**
   * The part of the resource the thread sits on, such as a slide. The kit
   * always returns this and the anchor and revision fields below; they're
   * optional so comments built elsewhere, such as optimistic ones, needn't.
   */
  surfaceId?: string | null;
  kind: ReviewCommentKind;
  status: ReviewCommentStatus;
  anchor: unknown;
  /** The anchor's kind and the version it was written at, when typed. */
  anchorKind?: string | null;
  anchorVersion?: number | null;
  /**
   * Goes up whenever this comment changes: its text, anchor, status or
   * deletion, and on a thread's first comment, which holds the thread's
   * routing, its routing and agent pickup. So a write can check nothing
   * changed under it. Notification bookkeeping leaves it alone, so a new
   * comment's author can edit it at the revision they got back.
   */
  revision?: number;
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
