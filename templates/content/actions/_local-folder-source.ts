import { createHash } from "node:crypto";

import type {
  ContentDatabaseSourceCapabilities,
  ContentDatabaseSourceTruthPolicy,
} from "../shared/api.js";

export const LOCAL_FOLDER_SOURCE_TYPE = "local-folder" as const;

export function localFolderSourceId(databaseId: string, connectionId: string) {
  return `content_database_source_local_folder_${createHash("sha256")
    .update(`${databaseId}:${connectionId}`)
    .digest("hex")
    .slice(0, 32)}`;
}

export function localFolderSourceCapabilities(): ContentDatabaseSourceCapabilities {
  return {
    canRefresh: true,
    canCreateChangeSets: true,
    canWriteFields: true,
    canWriteBody: true,
    canPush: true,
    canPull: true,
    canPublish: false,
    canDelete: true,
    canStageLocalRevision: true,
    liveWritesEnabled: false,
    readOnlyRefresh: false,
    canRename: true,
    canReveal: true,
    canUseLocalComponents: true,
  };
}

export function localFolderSourceMetadata(input: {
  connectionId: string;
  label: string;
  truthPolicy: ContentDatabaseSourceTruthPolicy;
}) {
  return {
    primaryKey: "relative_path",
    naturalKeyField: "relative_path",
    titleField: "title",
    readMode: "trusted-local-bridge",
    connectionId: input.connectionId,
    connectionLabel: input.label,
    truthPolicy: input.truthPolicy,
    writeMode: "stage_only" as const,
    notes:
      "The trusted local bridge owns the folder handle or path; SQL stores only this opaque connection identity.",
  };
}
