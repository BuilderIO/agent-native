export type {
  HistoryActorKind,
  HistoryResourceRole,
  ResourceHistoryScope,
  ResourceVersion,
  VersionedResourceAccess,
  VersionedResourceContext,
  VersionedResourceRegistration,
  VersionedResourceRestoreContext,
  VersionedResourceSnapshotContext,
} from "./types.js";
export {
  __resetVersionedResourcesForTests,
  assertVersionedResourceAccess,
  getVersionedResource,
  listVersionedResources,
  registerVersionedResource,
  resolveVersionedResourceAccess,
} from "./registry.js";
export {
  __resetHistoryInitForTests,
  ensureResourceVersionsTable,
  getResourceVersionById,
  getResourceVersionByNumber,
  queryResourceVersions,
} from "./store.js";
