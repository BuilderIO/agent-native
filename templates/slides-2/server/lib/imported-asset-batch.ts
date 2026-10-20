import { deleteUploadedFile } from "@agent-native/core/file-upload";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import {
  finishOwnedUploadedAssetCleanup,
  retryOwnedUploadedAssetCleanup,
  scheduleUploadedAssetDeletion,
  type SlidesTransaction,
} from "./uploaded-asset-cleanup-outbox.js";
import { deleteUploadedAssetObject } from "./uploaded-asset-object-lifecycle.js";

export interface ImportedAssetUpload {
  assetId: string;
  filename: string;
  url: string;
  mimeType: string;
  size: number;
  provider: string;
  providerObjectId: string | null;
}

export interface ImportedAssetBatchScope {
  ownerEmail: string;
  orgId: string | null;
}

interface CleanupRecord extends ImportedAssetUpload, ImportedAssetBatchScope {
  token: string;
  assetIds: string[];
}

function sameStoredObject(
  left: ImportedAssetUpload,
  right: ImportedAssetUpload,
): boolean {
  return (
    left.url === right.url ||
    (left.providerObjectId !== null &&
      left.provider === right.provider &&
      left.providerObjectId === right.providerObjectId)
  );
}

function storedObjectGroups(
  assets: ImportedAssetUpload[],
): ImportedAssetUpload[][] {
  const remaining = [...assets];
  const groups: ImportedAssetUpload[][] = [];
  while (remaining.length > 0) {
    const group = [remaining.shift()!];
    for (let index = 0; index < group.length; index += 1) {
      for (
        let candidateIndex = remaining.length - 1;
        candidateIndex >= 0;
        candidateIndex -= 1
      ) {
        const candidate = remaining[candidateIndex]!;
        if (!sameStoredObject(group[index]!, candidate)) continue;
        group.push(candidate);
        remaining.splice(candidateIndex, 1);
      }
    }
    groups.push(group);
  }
  return groups;
}

export class ImportedAssetBatch {
  private readonly uploads = new Map<string, ImportedAssetUpload>();
  private committed = false;

  constructor(private readonly scope: ImportedAssetBatchScope) {}

  track(upload: ImportedAssetUpload): void {
    this.uploads.set(upload.assetId, upload);
  }

  markCommitted(): void {
    this.committed = true;
  }

  async cleanupIfUncommitted(): Promise<void> {
    if (this.committed || this.uploads.size === 0) return;

    const cleanupRecords = await getDb().transaction(async (tx) => {
      const records: CleanupRecord[] = [];
      for (const group of storedObjectGroups([...this.uploads.values()])) {
        const [asset, ...duplicates] = group;
        const assetIds = group.map((item) => item.assetId);
        const token = await scheduleUploadedAssetDeletion(tx, {
          assetId: asset.assetId,
          ownerEmail: this.scope.ownerEmail,
          orgId: this.scope.orgId,
          provider: asset.provider,
          providerObjectId: asset.providerObjectId,
          url: asset.url,
        });
        await tx
          .delete(schema.uploadedAssets)
          .where(
            and(
              inArray(schema.uploadedAssets.id, assetIds),
              eq(schema.uploadedAssets.ownerEmail, this.scope.ownerEmail),
              this.scope.orgId
                ? eq(schema.uploadedAssets.orgId, this.scope.orgId)
                : isNull(schema.uploadedAssets.orgId),
            ),
          );
        records.push({
          ...asset,
          ...this.scope,
          token,
          assetIds: [asset.assetId, ...duplicates.map((item) => item.assetId)],
        });
      }
      return records;
    });

    await Promise.all(
      cleanupRecords.map(async (record) => {
        const cleanupScope = {
          assetId: record.assetId,
          ownerEmail: record.ownerEmail,
          orgId: record.orgId,
        };
        const requestContext = {
          userEmail: record.ownerEmail,
          ...(record.orgId ? { orgId: record.orgId } : {}),
        };
        const finishCleanup = async (tx: SlidesTransaction) => {
          await tx
            .delete(schema.uploadedAssets)
            .where(
              and(
                inArray(schema.uploadedAssets.id, record.assetIds),
                eq(schema.uploadedAssets.ownerEmail, record.ownerEmail),
                record.orgId
                  ? eq(schema.uploadedAssets.orgId, record.orgId)
                  : isNull(schema.uploadedAssets.orgId),
              ),
            );
          const removed = await finishOwnedUploadedAssetCleanup(
            tx,
            cleanupScope,
            record.token,
          );
          if (!removed) {
            throw new Error(
              "Imported asset cleanup lease was no longer current.",
            );
          }
        };

        try {
          const deletion = await runWithRequestContext(requestContext, () =>
            deleteUploadedAssetObject({
              identity: {
                url: record.url,
                provider: record.provider,
                providerObjectId: record.providerObjectId,
              },
              excludeAssetId: record.assetId,
              lease: { ...cleanupScope, token: record.token },
              deleteObject: () =>
                deleteUploadedFile(record.provider, {
                  id: record.providerObjectId ?? undefined,
                  url: record.url,
                }),
              onShared: finishCleanup,
              onAlreadyDeleted: finishCleanup,
              onDeleted: finishCleanup,
            }),
          );
          if (deletion.status === "failed") {
            await runWithRequestContext(requestContext, () =>
              retryOwnedUploadedAssetCleanup(cleanupScope, record.token, 1),
            );
            console.warn(
              "[slides-import] uploaded asset cleanup remains queued",
              {
                assetId: record.assetId,
              },
            );
          }
        } catch (error) {
          await runWithRequestContext(requestContext, () =>
            retryOwnedUploadedAssetCleanup(cleanupScope, record.token, 1),
          );
          console.warn("[slides-import] could not clean up imported asset", {
            assetId: record.assetId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }),
    );
  }
}

export async function withImportedAssetCleanup<T>(
  batch: ImportedAssetBatch,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    try {
      await batch.cleanupIfUncommitted();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Import failed and uploaded asset cleanup could not be scheduled.",
      );
    }
    throw error;
  }
}
