import type { ReactNode } from "react";

/**
 * Home surface types. Home section data supplied by the workspace.
 * Every value here is supplied by the parent; Home never fetches or invents data.
 */

export type HomeUser = {
  id: string;
  name: string;
  email: string;
};

export type HomeWorkspace = {
  id: string;
  name: string;
};

/** Source top-level context setup steps (GroupedContextSteps). */
export type HomeStepKey =
  | "connect"
  | "endorse"
  | "improve"
  | "reference"
  | "extend"
  | "govern";

export type HomeContextProgress = {
  enabled: boolean;
  /** 0..100. */
  progressPercent: number;

  completedSteps: readonly HomeStepKey[];

  steps?: readonly HomeStepKey[];

  canDismiss: boolean;
};

export type HomeRowKind = "project" | "thread" | "exploration" | "data";

export type HomeRecentRow = {
  id: string;
  title: string;
  /** Real, parent-owned route. */
  href: string;
  kind: HomeRowKind;
  favorited?: boolean;
  notebookHref?: string;
  canEdit?: boolean;
  /** "You" or the owner name. */
  ownerLabel?: string;
  /** Source relative-time label, e.g. "2 hrs ago". */
  metaLabel?: string;
  /** Explorations only: source app/table label. */
  sourceLabel?: string;
};

export type HomeRecentsTab = {
  kind: HomeRowKind;
  /** Whether this tab is available. */
  enabled: boolean;
  status: "ready" | "loading" | "error";
  rows: readonly HomeRecentRow[];
  /** Destination for the "View all" control. */
  viewAllHref?: string;
  errorMessage?: string;
};

export type HomeRecents = {
  projects: HomeRecentsTab;
  threads: HomeRecentsTab;
  explorations: HomeRecentsTab;
  data: HomeRecentsTab;
};

export type HomeProjectCard = {
  id: string;
  title: string;
  href: string;
  /** Source Edit control; omit while unbound. */
  editHref?: string;
  description?: string;
  /** Actual count, already formatted by the parent. */
  viewCountLabel?: string;
  viewCountTooltip?: string;
  ownerLabel?: string;
  allowEmbedding?: boolean;
  information?: {
    ownerName: string | null;
    creatorName: string | null;
    createdAt: string;
    lastEditedAt: string;
    namesUnavailable: boolean;
  };
};

export type HomeFavoriteCollection = {
  id: string;
  title: string;
  href: string;
  description?: string;
};

export type HomeFavorites = {
  /** Source feature gate. */
  collectionsEnabled: boolean;
  status: "ready" | "loading" | "error";
  projects: readonly HomeProjectCard[];
  collections: readonly HomeFavoriteCollection[];
  errorMessage?: string;
};

export type HomePopular = {
  status: "ready" | "loading" | "error";
  projects: readonly HomeProjectCard[];
  viewAllHref?: string;
  errorMessage?: string;
  onRetry?: () => void;
};

export type HomeSuggestion = {
  id: string;
  title: string;
  description?: string;
  href?: string;
  sourceCount?: number;
  userCount?: number;
};

export type HomeSuggestions = {
  status: "ready" | "loading" | "error" | "unavailable";

  issues: readonly HomeSuggestion[];
  viewAllHref?: string;
  errorMessage?: string;
};

export type HomeCallbacks = {
  onToggleFavoriteProject?: (
    projectId: string,
    favorited: boolean,
  ) => Promise<void>;
  onArchiveProject?: (projectId: string) => Promise<void>;
  onTrashProject?: (projectId: string) => Promise<void>;
  /** Source "Open Context Studio" (empty Context management). */
  onOpenContextStudio: () => void;
  /** Source "Browse projects" (empty Your favorites). */
  onBrowseProjects: () => void;
  /** Source per-step context setup link. Missing renders the step disabled. */
  onSelectContextStep?: (step: HomeStepKey) => void;
  /** Source "Dismiss" / "Remind me later" on the Curate banner. */
  onDismissContextBanner?: () => void;
  /** Source "Browse collections". */
  onBrowseCollections?: () => void;
  /** Source "Browse data" (empty Data recents). */
  onBrowseData?: () => void;
  canAnalyzeInNotebook?: boolean;
  canGenerateApp?: boolean;
  onSelectIntent?: (intent: "notebook" | "app" | null) => void;
  /** Source "New project". */
  onCreateProject?: () => void;
  /** Source "New thread". */
  onCreateThread?: () => void;
  /** Source "New exploration". */
  onCreateExploration?: () => void;
};

export interface HomePageProps {
  user: HomeUser;
  workspace: HomeWorkspace;
  contextProgress: HomeContextProgress | null;
  contextProgressPending?: boolean;
  recents: HomeRecents;
  favorites: HomeFavorites | null;
  popular: HomePopular | null;
  /** Render Context management when its data is bound. */
  suggestions?: HomeSuggestions | null;
  /** Optional onboarding content. */
  getStarted?: ReactNode;
  /** Core toolkit public composer entry; parent binds dictation/voice. */
  agentComposer: ReactNode;
  callbacks: HomeCallbacks;
  activeIntent?: "notebook" | "app" | null | undefined;
  /** Ask-mode heading. */
  promptTitle?: string;
}
