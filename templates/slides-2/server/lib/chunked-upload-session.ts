import {
  compareAndSetAppState,
  deleteAppState,
  listAppState,
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import type { PrivateBlobHandle } from "@agent-native/core/private-blob";
import { appStateListKeysByKeySuffixPrefix } from "@agent-native/core/server";
import { nanoid } from "nanoid";

import { appStorageKey } from "../../shared/app-storage.js";

export interface ChunkedUploadSession {
  uploadType?: "reference" | "video";
  finalizingAt?: string;
  finalizationLeaseExpiresAt?: string;
  cleanupState?: "aborting";
  ownerEmail?: string;
  orgId?: string | null;
  deckId?: string;
  filename: string;
  mimeType: string;
  declaredSize: number;
  chunks: Record<string, PrivateBlobHandle>;
  chunkSizes: Record<string, number>;
  createdAt: string;
  expiresAt: string;
}

const PREFIX = appStorageKey("slides-upload-chunks-");
const ORPHAN_PREFIX = appStorageKey("slides-upload-orphan-chunk-");
const ORPHAN_VIDEO_ASSET_SUFFIX = "slides-upload-orphan-video-asset-";
const ORPHAN_VIDEO_ASSET_PREFIX = appStorageKey(ORPHAN_VIDEO_ASSET_SUFFIX);
const key = (sessionId: string) => `${PREFIX}${sessionId}`;

export interface OrphanedChunkCleanup {
  version: 1;
  ownerEmail: string;
  orgId: string | null;
  uploadSessionId: string;
  chunkIndex: number;
  handle: PrivateBlobHandle;
  createdAt: string;
  uncertain?: boolean;
}

export interface OrphanedUploadedAssetCleanup {
  version: 1;
  ownerEmail: string;
  orgId: string | null;
  assetId?: string;
  preserveIfAssetExists?: boolean;
  waitForAssetDeletion?: boolean;
  attemptCount?: number;
  lastAttemptAt?: string;
  leaseExpiresAt?: string;
  nextAttemptAt?: string;
  provider: string;
  providerObjectId: string | null;
  url: string;
  uploadSessionId: string | null;
  createdAt: string;
}

export type OrphanedVideoAssetCleanup = OrphanedUploadedAssetCleanup;

export async function createChunkedUploadSession(
  sessionId: string,
  session: ChunkedUploadSession,
): Promise<void> {
  await writeAppState(
    key(sessionId),
    session as unknown as Record<string, unknown>,
  );
}

export async function getChunkedUploadSession(
  sessionId: string,
): Promise<ChunkedUploadSession | null> {
  const raw = await readAppState(key(sessionId));
  if (!raw || typeof raw !== "object") return null;
  return raw as unknown as ChunkedUploadSession;
}

export async function compareAndSetChunkedUploadSession(
  sessionId: string,
  expectedSession: ChunkedUploadSession,
  nextSession: ChunkedUploadSession,
): Promise<boolean> {
  return compareAndSetAppState(
    key(sessionId),
    expectedSession as unknown as Record<string, unknown>,
    nextSession as unknown as Record<string, unknown>,
  );
}

export async function listChunkedUploadSessions(): Promise<
  Array<{ sessionId: string; session: ChunkedUploadSession }>
> {
  const entries = await listAppState(PREFIX);
  return entries.map(({ key: entryKey, value }) => ({
    sessionId: entryKey.slice(PREFIX.length),
    session: value as unknown as ChunkedUploadSession,
  }));
}

export async function deleteChunkedUploadSession(
  sessionId: string,
): Promise<void> {
  await deleteAppState(key(sessionId));
}

export async function recordOrphanedChunkCleanup(
  cleanup: OrphanedChunkCleanup,
): Promise<string> {
  const cleanupKey = `${ORPHAN_PREFIX}${nanoid()}`;
  await writeAppState(
    cleanupKey,
    cleanup as unknown as Record<string, unknown>,
  );
  return cleanupKey;
}

export async function listOrphanedChunkCleanups(): Promise<
  Array<{ key: string; cleanup: OrphanedChunkCleanup }>
> {
  const entries = await listAppState(ORPHAN_PREFIX);
  return entries.map(({ key: entryKey, value }) => ({
    key: entryKey,
    cleanup: value as unknown as OrphanedChunkCleanup,
  }));
}

export async function deleteOrphanedChunkCleanup(key: string): Promise<void> {
  await deleteAppState(appStorageKey(key));
}

export async function recordOrphanedUploadedAssetCleanup(
  cleanup: OrphanedUploadedAssetCleanup,
): Promise<string> {
  const cleanupKey = `${ORPHAN_VIDEO_ASSET_PREFIX}${nanoid()}`;
  await writeAppState(
    cleanupKey,
    cleanup as unknown as Record<string, unknown>,
  );
  return cleanupKey;
}

export async function listOrphanedUploadedAssetCleanups(
  keys?: readonly string[],
): Promise<Array<{ key: string; cleanup: OrphanedUploadedAssetCleanup }>> {
  const entries = keys
    ? await Promise.all(
        [...new Set(keys)]
          .filter((entryKey) => entryKey.startsWith(ORPHAN_VIDEO_ASSET_PREFIX))
          .map(async (entryKey) => ({
            key: entryKey,
            value: await readAppState(entryKey),
          })),
      )
    : await listAppState(ORPHAN_VIDEO_ASSET_PREFIX);
  return entries
    .map(({ key: entryKey, value }) => ({
      key: entryKey,
      cleanup: value as unknown as OrphanedUploadedAssetCleanup,
    }))
    .filter(({ cleanup }) => cleanup !== null);
}

export async function listOrphanedUploadedAssetCleanupKeys(
  limit = 50,
): Promise<Array<{ sessionId: string; key: string }>> {
  return appStateListKeysByKeySuffixPrefix(ORPHAN_VIDEO_ASSET_SUFFIX, limit);
}

export async function deleteOrphanedUploadedAssetCleanup(
  key: string,
  expected?: OrphanedUploadedAssetCleanup,
): Promise<boolean> {
  if (expected) {
    return compareAndSetAppState(
      appStorageKey(key),
      expected as unknown as Record<string, unknown>,
      null,
    );
  }
  return deleteAppState(appStorageKey(key));
}

export const recordOrphanedVideoAssetCleanup =
  recordOrphanedUploadedAssetCleanup;
export const listOrphanedVideoAssetCleanups = listOrphanedUploadedAssetCleanups;
export const deleteOrphanedVideoAssetCleanup =
  deleteOrphanedUploadedAssetCleanup;
