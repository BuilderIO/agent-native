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

export const PLAN_SECTION_TYPES = [
  "summary",
  "diagram",
  "wireframe",
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
export type PlanSectionType = (typeof PLAN_SECTION_TYPES)[number];
export type PlanCommentKind = (typeof PLAN_COMMENT_KINDS)[number];
export type PlanCommentStatus = (typeof PLAN_COMMENT_STATUSES)[number];
export type PlanAuthor = (typeof PLAN_AUTHORS)[number];

export interface PlanSummary {
  id: string;
  title: string;
  brief: string;
  status: PlanStatus;
  source: PlanSource;
  repoPath?: string | null;
  currentFocus?: string | null;
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
  status: PlanStatus;
  source: PlanSource;
  repoPath?: string | null;
  currentFocus?: string | null;
  html?: string | null;
  markdown?: string | null;
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
  sectionId?: string | null;
  kind: PlanCommentKind;
  status: PlanCommentStatus;
  anchor?: string | null;
  message: string;
  createdBy: PlanAuthor;
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
  sections: PlanSection[];
  comments: PlanComment[];
  events: PlanEvent[];
  summary: {
    sectionCounts: Record<string, number>;
    commentCount: number;
    openCommentCount: number;
  };
}
