import type { PlanContent } from "./plan-content.js";
import {
  PLAN_COMMENT_RESOLUTION_TARGETS,
  type PlanCommentMention,
  type PlanCommentResolutionTarget,
} from "./comment-context.js";

export {
  PLAN_COMMENT_RESOLUTION_TARGETS,
  type PlanCommentMention,
  type PlanCommentResolutionTarget,
};

export const PLAN_STATUSES = [
  "draft",
  "review",
  "approved",
  "in_progress",
  "complete",
  "archived",
] as const;

export const PLAN_SOURCES = [
  "claude-code",
  "codex",
  "cursor",
  "pi",
  "manual",
  "imported",
] as const;

// A plan is either a forward-looking `plan` (the default) or a read-only
// `recap` — a reverse plan that recaps a code change/PR diff for review. Recaps
// render as "Visual Recap", live at `/recaps/:id`, use `recap-` ids, and are
// not text-editable in the browser (highlight + comment still work).
export const PLAN_KINDS = ["plan", "recap"] as const;

export const PLAN_SECTION_TYPES = [
  "summary",
  "diagram",
  "wireframe",
  "mockup",
  "prototype",
  "steps",
  "implementation",
  "decisions",
  "questions",
  "risks",
  "notes",
  "custom",
] as const;

export const PLAN_COMMENT_KINDS = [
  "comment",
  "correction",
  "question",
  "decision",
  "annotation",
] as const;

export const PLAN_COMMENT_STATUSES = ["open", "resolved"] as const;

export const PLAN_AUTHORS = ["agent", "human", "import"] as const;

export type PlanStatus = (typeof PLAN_STATUSES)[number];
export type PlanSource = (typeof PLAN_SOURCES)[number];
export type PlanKind = (typeof PLAN_KINDS)[number];
export type PlanSectionType = (typeof PLAN_SECTION_TYPES)[number];
export type PlanCommentKind = (typeof PLAN_COMMENT_KINDS)[number];
export type PlanCommentStatus = (typeof PLAN_COMMENT_STATUSES)[number];
export type PlanAuthor = (typeof PLAN_AUTHORS)[number];

export interface PlanSummary {
  id: string;
  title: string;
  brief: string;
  kind: PlanKind;
  status: PlanStatus;
  source: PlanSource;
  repoPath?: string | null;
  currentFocus?: string | null;
  hostedPlanId?: string | null;
  hostedPlanUrl?: string | null;
  sourceUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string | null;
  sectionCounts: Record<string, number>;
  commentCount: number;
  openCommentCount: number;
}

export interface Plan {
  id: string;
  title: string;
  brief: string;
  kind: PlanKind;
  status: PlanStatus;
  source: PlanSource;
  repoPath?: string | null;
  currentFocus?: string | null;
  hostedPlanId?: string | null;
  hostedPlanUrl?: string | null;
  sourceUrl?: string | null;
  html?: string | null;
  markdown?: string | null;
  content?: PlanContent | null;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string | null;
}

export interface PlanSection {
  id: string;
  planId: string;
  type: PlanSectionType;
  title: string;
  body: string;
  html?: string | null;
  order: number;
  createdBy: PlanAuthor;
  createdAt: string;
  updatedAt: string;
}

export interface PlanComment {
  id: string;
  planId: string;
  parentCommentId?: string | null;
  sectionId?: string | null;
  kind: PlanCommentKind;
  status: PlanCommentStatus;
  anchor?: string | null;
  message: string;
  createdBy: PlanAuthor;
  authorEmail?: string | null;
  authorName?: string | null;
  resolutionTarget?: PlanCommentResolutionTarget;
  mentions?: PlanCommentMention[];
  mentionsJson?: string | null;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  consumedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlanEvent {
  id: string;
  planId: string;
  type: string;
  message: string;
  payload?: Record<string, unknown> | null;
  createdBy: PlanAuthor;
  createdAt: string;
}

export interface PlanBundle {
  plan: Plan;
  access?: {
    role: "owner" | "viewer" | "editor" | "admin";
    ownerEmail?: string | null;
    orgId?: string | null;
    visibility?: "private" | "org" | "public" | null;
  };
  sections: PlanSection[];
  comments: PlanComment[];
  events: PlanEvent[];
  summary: {
    sectionCounts: Record<string, number>;
    commentCount: number;
    openCommentCount: number;
  };
}

export interface PlanVersionSnapshot {
  plan: Pick<
    Plan,
    | "title"
    | "brief"
    | "status"
    | "source"
    | "repoPath"
    | "currentFocus"
    | "html"
    | "markdown"
    | "content"
    | "approvedAt"
  >;
  sections: PlanSection[];
}

export interface PlanVersionSummary {
  id: string;
  planId: string;
  title: string;
  label?: string | null;
  createdBy: PlanAuthor;
  createdAt: string;
  status: PlanStatus;
  source: PlanSource;
  blockCount: number;
  sectionCount: number;
  hasCanvas: boolean;
  hasPrototype: boolean;
  preview: string;
}

export interface PlanVersionDetail extends PlanVersionSummary {
  snapshot: PlanVersionSnapshot;
  plan: Plan;
  sections: PlanSection[];
  html: string;
  markdown?: string | null;
}

export interface PlanVersionListResponse {
  planId: string;
  count: number;
  versions: PlanVersionSummary[];
}
