export type AuditStatus = "success" | "error" | "denied";

export type AuditActorKind = "agent" | "human" | "system";

export type AuditVisibility = "private" | "org" | "public";

export interface AuditTarget {
  type?: string;
  id?: string;
  ownerEmail?: string | null;
  orgId?: string | null;
  visibility?: AuditVisibility;
}

export interface AuditCallMeta {
  status: AuditStatus;
  caller: string;
  userEmail?: string;
  orgId?: string | null;
}

export interface ActionAuditConfig {
  enabled?: boolean;
  onRead?: boolean;
  recordInputs?: boolean;
  target?: (
    args: any,
    result: unknown,
    meta: AuditCallMeta,
  ) => AuditTarget | null | undefined;
  summary?: (args: any, result: unknown, meta: AuditCallMeta) => string;
}

export interface AuditEvent {
  id: string;
  createdAt: number;
  action: string;
  caller: string;
  actorKind: AuditActorKind;
  actorEmail: string | null;
  orgId: string | null;
  threadId: string | null;
  turnId: string | null;
  targetType: string | null;
  targetId: string | null;
  status: AuditStatus;
  summary: string | null;
  input: string | null;
  errorCode: string | null;
  ownerEmail: string | null;
  visibility: AuditVisibility;
  runId?: string | null;
  taskId?: string | null;
  parentTaskId?: string | null;
  sourceKind?: string | null;
  sourcePlatform?: string | null;
  sourceId?: string | null;
  sourceUrl?: string | null;
  networkProtocol?: string | null;
  networkId?: string | null;
  networkPeer?: string | null;
}

export interface AuditQueryFilters {
  targetType?: string;
  targetId?: string;
  actorKind?: AuditActorKind;
  actorEmail?: string;
  status?: AuditStatus;
  threadId?: string;
  turnId?: string;
  action?: string;
  taskId?: string;
  runId?: string;
  sourcePlatform?: string;
  sinceMs?: number;
  limit?: number;
  offset?: number;
}
