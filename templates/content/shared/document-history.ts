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

export interface DocumentHistoryCheckpoint {
  id: string;
  documentId: string;
  groupId: string;
  title: string;
  checkpointKind: DocumentHistoryCheckpointKind;
  createdAt: string;
}

export interface DocumentHistoryCheckpointDetail extends DocumentHistoryCheckpoint {
  content: string;
}

/** A page state one History checkpoint holds. */
export interface DocumentHistoryPageState {
  checkpointId: string;
  title: string;
  content: string;
  createdAt: string;
}

/** One change a History entry recorded: the page before it, and after. */
export interface DocumentHistoryChange {
  before: DocumentHistoryPageState;
  after: DocumentHistoryPageState;
}

export interface DocumentHistoryChanges {
  groupId: string;
  changes: DocumentHistoryChange[];
  hasMore: boolean;
}

export interface DocumentHistoryCheckpointPage {
  checkpoints: DocumentHistoryCheckpoint[];
  nextCursor: string | null;
  hasMore: boolean;
}
