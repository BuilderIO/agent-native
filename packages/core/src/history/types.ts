import type { Visibility } from "../sharing/schema.js";

export type HistoryActorKind = "human" | "agent" | "system";
export type HistoryResourceRole = "viewer" | "editor" | "admin" | "owner";

export interface VersionedResourceAccess {
  role: HistoryResourceRole;
  ownerEmail?: string | null;
  orgId?: string | null;
  visibility?: Visibility | null;
  resource?: unknown;
}

export interface VersionedResourceContext {
  userEmail?: string | null;
  orgId?: string | null;
  caller?: string | null;
  request?: unknown;
  [key: string]: unknown;
}

export interface VersionedResourceSnapshotContext {
  resourceType: string;
  resourceId: string;
  ctx?: VersionedResourceContext;
  access?: VersionedResourceAccess;
}

export interface VersionedResourceRestoreContext extends VersionedResourceSnapshotContext {
  version: ResourceVersion;
  snapshot: unknown;
}

export interface VersionedResourceRegistration {
  type: string;
  displayName?: string;
  resolveAccess?: (
    resourceId: string,
    ctx?: VersionedResourceContext,
  ) => Promise<VersionedResourceAccess | null> | VersionedResourceAccess | null;
  getSnapshot?: (
    context: VersionedResourceSnapshotContext,
  ) => Promise<unknown> | unknown;
  restoreSnapshot?: (
    context: VersionedResourceRestoreContext,
  ) => Promise<unknown> | unknown;
}

export interface ResourceVersion {
  id: string;
  resourceType: string;
  resourceId: string;
  versionNumber: number;
  createdAt: string;
  createdBy: string | null;
  actorKind: HistoryActorKind;
  ownerEmail: string | null;
  orgId: string | null;
  visibility: Visibility;
  title: string | null;
  summary: string | null;
  snapshot?: unknown;
  metadata: Record<string, unknown> | null;
}

export interface ResourceHistoryScope {
  userEmail?: string | null;
  orgId?: string | null;
}
