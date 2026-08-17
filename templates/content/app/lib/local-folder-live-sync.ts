import { callAction } from "@agent-native/core/client/hooks";

import type { DesktopContentFilesFolder } from "./desktop-content-files";
import { getDesktopContentFiles } from "./desktop-content-files";

const REGISTRY_KEY = "content-local-folder-live-sources-v1";

interface LiveLocalFolderSource {
  folderId: string;
  sourceId: string;
  databaseId?: string;
  repositoryId?: string;
}

function readRegistry(): LiveLocalFolderSource[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(REGISTRY_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter(
      (entry): entry is LiveLocalFolderSource =>
        typeof entry?.folderId === "string" &&
        typeof entry?.sourceId === "string" &&
        (entry.databaseId === undefined ||
          typeof entry.databaseId === "string") &&
        (entry.repositoryId === undefined ||
          typeof entry.repositoryId === "string"),
    );
  } catch {
    // coercion-ok: corrupt device-local cache is treated as an absent optional registry
    return [];
  }
}

export function rememberLiveLocalFolderSource(
  folder: DesktopContentFilesFolder,
  sourceId: string,
  databaseId?: string | null,
) {
  if (!folder.id || typeof window === "undefined") return;
  const next = [
    ...readRegistry().filter((entry) => entry.folderId !== folder.id),
    {
      folderId: folder.id,
      sourceId,
      ...(databaseId ? { databaseId } : {}),
      ...(folder.repository?.localId
        ? { repositoryId: folder.repository.localId }
        : {}),
    },
  ];
  window.localStorage.setItem(REGISTRY_KEY, JSON.stringify(next));
}

export function forgetLiveLocalFolderSource(folderId: string) {
  if (typeof window === "undefined") return;
  const next = readRegistry().filter((entry) => entry.folderId !== folderId);
  window.localStorage.setItem(REGISTRY_KEY, JSON.stringify(next));
}

export function liveLocalFolderSourceId(folderId: string) {
  return readRegistry().find((entry) => entry.folderId === folderId)?.sourceId;
}

export async function connectTemporaryLocalFolder(
  folder: DesktopContentFilesFolder,
) {
  if (!folder.id || folder.kind !== "temporary") return null;
  const existing = readRegistry().find((entry) => entry.folderId === folder.id);
  if (existing) return existing.sourceId;
  const persistent = readRegistry().find(
    (entry) =>
      entry.databaseId &&
      entry.repositoryId &&
      entry.repositoryId === folder.repository?.localId,
  );
  if (!persistent?.databaseId) return null;
  const connection = await callAction<{
    sourceId: string | null;
    filesDatabaseId: string | null;
  }>(
    "connect-local-folder-source" as never,
    {
      connectionId: folder.id,
      label: folder.name,
      databaseId: persistent.databaseId,
      truthPolicy: "source_primary",
      connectionMetadata: {
        liveBridgeEnabled: true,
        repository: folder.repository
          ? { localId: folder.repository.localId }
          : undefined,
        workingCopy: {
          id: folder.id,
          repositoryId: folder.repository?.localId,
          kind: "temporary",
          name: folder.name,
          branch: folder.repository?.branch,
          commit: folder.repository?.commit,
          deviceId: "agent-native-desktop",
        },
      },
      dryRun: false,
    } as never,
  );
  if (!connection.sourceId) return null;
  rememberLiveLocalFolderSource(
    folder,
    connection.sourceId,
    connection.filesDatabaseId,
  );
  return connection.sourceId;
}

export async function syncLiveLocalFolder(folderId: string) {
  const sourceId = liveLocalFolderSourceId(folderId);
  if (!sourceId) return { synced: false as const, reason: "unregistered" };

  const desktop = getDesktopContentFiles();
  if (!desktop) return { synced: false as const, reason: "unavailable" };
  const read = await desktop.readFiles({ folderId });
  if (!read.ok) throw new Error(read.error);
  const result = await callAction(
    "sync-local-folder-source" as never,
    {
      sourceId,
      files: read.sources ?? {},
      observedRevisions: read.revisions,
      dryRun: false,
    } as never,
  );
  return { synced: true as const, result };
}
