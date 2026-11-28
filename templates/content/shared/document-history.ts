import type { BuilderBodyDiff } from "./builder-body-diff.js";

export type DocumentHistoryGroupKind =
  | "human_session"
  | "agent_run"
  | "operation"
  | "legacy";

export type DocumentHistoryActorKind =
  | "human"
  | "agent"
  | "automation"
  | "source"
  | "system"
  | "unknown";

export type DocumentHistoryCheckpointKind =
  | "before"
  | "after"
  | "recovery"
  | "legacy";

export interface DocumentHistoryGroup {
  id: string;
  kind: DocumentHistoryGroupKind;
  actorEmail: string | null;
  actorKind: DocumentHistoryActorKind;
  origin: string | null;
  operation: string | null;
  /** File name an `import-content` group created this page from. */
  importSourceName?: string | null;
  startedAt: string;
  endedAt: string;
  checkpointCount: number;
  latestCheckpointId: string;
}

export interface DocumentHistoryPage {
  groups: DocumentHistoryGroup[];
  nextCursor: string | null;
  hasMore: boolean;
}

export const DOCUMENT_VERSION_NAME_MAX_LENGTH = 80;

export const NAME_DOCUMENT_VERSION_OPERATION = "name-document-version";

export interface DocumentHistoryCheckpoint {
  id: string;
  documentId: string;
  groupId: string;
  title: string;
  checkpointKind: DocumentHistoryCheckpointKind;
  createdAt: string;
  name: string | null;
  namedBy: string | null;
  namedAt: string | null;
}

export interface DocumentHistoryCheckpointDetail extends DocumentHistoryCheckpoint {
  content: string;
}

export interface DocumentHistoryCheckpointPage {
  checkpoints: DocumentHistoryCheckpoint[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface NamedDocumentVersionResult {
  checkpoint: DocumentHistoryCheckpoint;
  created: boolean;
}

export interface DocumentVersionComparisonSide {
  kind: "checkpoint" | "current";
  id: string | null;
  name: string | null;
  title: string;
  at: string;
}

export interface DocumentVersionComparison {
  from: DocumentVersionComparisonSide;
  to: DocumentVersionComparisonSide;
  identical: boolean;
  title: { before: string; after: string } | null;
  body: BuilderBodyDiff | null;
}
