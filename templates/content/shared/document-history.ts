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

export type DocumentHistoryCheckpointKind = "before" | "after" | "legacy";

export interface DocumentHistoryGroup {
  id: string;
  kind: DocumentHistoryGroupKind;
  actorEmail: string | null;
  actorKind: DocumentHistoryActorKind;
  origin: string | null;
  operation: string | null;
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

export interface DocumentHistoryCheckpointPage {
  checkpoints: DocumentHistoryCheckpoint[];
  nextCursor: string | null;
  hasMore: boolean;
}
