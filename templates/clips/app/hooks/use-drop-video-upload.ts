import { appBasePath } from "@agent-native/core/client/api-path";
import { callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { waitForAcceptedRecordingAfterFinalizeError } from "@shared/finalize-recovery";
import {
  classifyUploadResponseError,
  chunkUploadParallelism,
  chunkUploadUrl,
  UPLOAD_SLICE_BYTES,
} from "@shared/recording-core";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { MAX_UPLOAD_BYTES } from "@/lib/compress";
import { defaultRecordingTitle } from "@/lib/recording-title";
import { isMobileRecorderRuntime } from "@/lib/recording-visibility";
import { uploadVideoBlobThumbnail } from "@/lib/thumbnail-capture";
import { uploadChunkRequest } from "@/lib/upload-request";
import { probeVideoMetadata, resolveVideoMimeType } from "@/lib/video-metadata";

const CHUNK_PARALLELISM = 4;

export interface DropUploadItem {
  key: string;
  fileName: string;
  progress: number;
  /** The created recording id, once `create-recording` returns. The grid
   * hides the real card for this id while its placeholder is on screen so a
   * file never appears twice mid-upload. */
  recordingId?: string;
}

type QueuedDropUpload = {
  file: File;
  scope: { spaceId?: string | null; folderId?: string | null };
};

function defaultTitleFor(file: File): string {
  return file.name.replace(/\.[^/.]+$/, "") || defaultRecordingTitle();
}

/** Uploads dropped video files straight from the library grid — creates the
 * recording row via `create-recording`, then streams it to
 * `/api/uploads/:id/chunk` the same way the recorder's file picker does, so
 * `finalize-recording` treats it identically. Skips the recorder route's
 * bug-report/intake and re-encode paths (not applicable to a plain drop) and
 * never navigates away — the grid's own polling and the shared refresh
 * signal pick up the new "uploading" card as soon as the row exists. */
export function useDropVideoUpload(scope: {
  spaceId?: string | null;
  folderId?: string | null;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [uploads, setUploads] = useState<DropUploadItem[]>([]);

  const invalidateRecordings = useCallback(
    () =>
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === "action" &&
          query.queryKey[1] === "list-recordings",
      }),
    [queryClient],
  );

  const uploadOne = useCallback(
    async (
      file: File,
      scope: { spaceId?: string | null; folderId?: string | null },
    ) => {
      const key = `${file.name}-${file.size}-${Date.now()}-${Math.random()}`;
      setUploads((prev) => [
        ...prev,
        { key, fileName: file.name, progress: 0 },
      ]);
      const setProgress = (progress: number) => {
        setUploads((prev) =>
          prev.map((u) => (u.key === key ? { ...u, progress } : u)),
        );
      };
      const setRecordingId = (recordingId: string) => {
        setUploads((prev) =>
          prev.map((u) => (u.key === key ? { ...u, recordingId } : u)),
        );
      };
      const remove = () => {
        setUploads((prev) => prev.filter((u) => u.key !== key));
      };

      const mimeType = resolveVideoMimeType(file);
      if (!mimeType) {
        toast.error(t("recordRoute.uploadFailed"));
        remove();
        return;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        toast.error(t("recordRoute.videoTooLarge"));
        remove();
        return;
      }

      let createdId: string | null = null;
      const abort = new AbortController();
      try {
        const meta = await probeVideoMetadata(file);
        const { spaceId, folderId } = scope;

        const created = (await callAction(
          "create-recording" as any,
          {
            title: defaultTitleFor(file),
            titleSource: "upload",
            hasCamera: false,
            hasAudio: true,
            recordingPlatform: isMobileRecorderRuntime(navigator)
              ? "mobile"
              : "web",
            width: meta.width,
            height: meta.height,
            spaceIds: spaceId ? [spaceId] : undefined,
            folderId: folderId ?? undefined,
            mimeType,
            requestStreaming: true,
          } as any,
          { signal: abort.signal },
        )) as {
          result?: CreateRecordingInfo;
          id?: string;
          uploadChunkUrl?: string;
          uploadMode?: "streaming" | "buffered";
        };
        type CreateRecordingInfo = {
          id: string;
          uploadChunkUrl: string;
          uploadMode?: "streaming" | "buffered";
        };
        const info = created.result ?? (created as CreateRecordingInfo);
        if (!info?.id || !info.uploadChunkUrl) {
          throw new Error(
            "create-recording returned an incomplete upload target.",
          );
        }
        createdId = info.id;
        // Tie the placeholder to the real row so the grid hides that row's
        // card while this placeholder (with its progress bar) is on screen.
        setRecordingId(createdId);

        void uploadVideoBlobThumbnail(createdId, file, {
          signal: abort.signal,
        }).catch((error) => {
          console.warn(
            "[clips] dropped-upload thumbnail capture failed",
            error,
          );
        });

        const uploadBase = `${appBasePath()}${info.uploadChunkUrl}`;
        const totalChunks = Math.max(
          1,
          Math.ceil(file.size / UPLOAD_SLICE_BYTES),
        );
        const chunkDescs = Array.from({ length: totalChunks }, (_, i) => {
          const start = i * UPLOAD_SLICE_BYTES;
          const end = Math.min(start + UPLOAD_SLICE_BYTES, file.size);
          const isFinal = i === totalChunks - 1;
          return {
            index: i,
            slice: file.slice(start, end, mimeType),
            isFinal,
            url: chunkUploadUrl(uploadBase, {
              index: i,
              total: totalChunks,
              isFinal,
              mimeType,
              durationMs: isFinal ? meta.durationMs : undefined,
              width: isFinal ? meta.width : undefined,
              height: isFinal ? meta.height : undefined,
              hasAudio: isFinal ? true : undefined,
              hasCamera: isFinal ? false : undefined,
            }),
          };
        });
        const finalChunkDesc = chunkDescs[chunkDescs.length - 1];
        const queue = chunkDescs.slice(0, -1);
        let uploadError: Error | null = null;
        let completedChunks = 0;

        const worker = async () => {
          while (queue.length > 0) {
            if (abort.signal.aborted) return;
            const item = queue.shift();
            if (!item) break;
            let chunkRes: Response;
            try {
              chunkRes = await uploadChunkRequest({
                url: item.url,
                contentType: mimeType,
                body: await item.slice.arrayBuffer(),
                signal: abort.signal,
              });
            } catch (err) {
              if (abort.signal.aborted) return;
              uploadError = err instanceof Error ? err : new Error(String(err));
              abort.abort();
              return;
            }
            const chunkBody = await chunkRes.text();
            const responseError = classifyUploadResponseError({
              contentType: chunkRes.headers.get("content-type"),
              body: chunkBody,
              status: chunkRes.status,
              stage: "chunk_upload",
            });
            if (!chunkRes.ok || responseError.isHtml) {
              uploadError = Object.assign(
                new Error(
                  responseError.isHtml
                    ? `Upload failed at chunk ${item.index + 1}/${totalChunks}: HTML error response (${chunkRes.status})`
                    : `Upload failed at chunk ${item.index + 1}/${totalChunks} (${chunkRes.status})`,
                ),
                {
                  status: responseError.status,
                  failureCode: responseError.failureCode,
                  failureStage: responseError.failureStage,
                },
              );
              abort.abort();
              return;
            }
            completedChunks += 1;
            setProgress(completedChunks / totalChunks);
          }
        };

        await Promise.all(
          Array.from(
            {
              length: Math.min(
                chunkUploadParallelism(info.uploadMode, CHUNK_PARALLELISM),
                queue.length,
              ),
            },
            worker,
          ),
        );
        if (uploadError) throw uploadError;

        const recoverFinalization = () =>
          waitForAcceptedRecordingAfterFinalizeError({
            uploadUrl: uploadBase,
            recordingId: info.id,
            preferAuthenticated: true,
            signal: abort.signal,
          });
        let finalResult: {
          ok?: boolean;
          status?: string;
          waitingForStorage?: boolean;
        } | null = null;
        let finalRes: Response | null = null;
        let finalResponseText = "";
        try {
          finalRes = await uploadChunkRequest({
            url: finalChunkDesc.url,
            contentType: mimeType,
            body: await finalChunkDesc.slice.arrayBuffer(),
            signal: abort.signal,
          });
        } catch (error) {
          finalResult = await recoverFinalization();
          if (!finalResult) throw error;
        }
        if (finalRes) {
          finalResponseText = await finalRes.text();
          const responseError = classifyUploadResponseError({
            contentType: finalRes.headers.get("content-type"),
            body: finalResponseText,
            status: finalRes.status,
            stage: "chunk_upload",
          });
          if (!finalRes.ok || responseError.isHtml) {
            const error = Object.assign(
              new Error(
                responseError.isHtml
                  ? `Upload failed at the final chunk: HTML error response (${finalRes.status})`
                  : `Upload failed at the final chunk (${finalRes.status})`,
              ),
              {
                status: responseError.status,
                failureCode: responseError.failureCode,
                failureStage: responseError.failureStage,
              },
            );
            if (finalRes.status === 413) throw error;
            finalResult = await recoverFinalization();
            if (!finalResult) throw error;
          } else {
            finalResult = JSON.parse(finalResponseText) as NonNullable<
              typeof finalResult
            >;
          }
        }
        if (finalResult?.ok !== true) {
          throw new Error("Upload finalization returned no success result.");
        }
        setProgress(1);

        // The bytes are in, but with no storage connected the clip can't be
        // served yet — say so rather than claiming a finished upload. The row
        // persists in a "waiting for storage" state the card surfaces.
        if (
          finalResult?.waitingForStorage === true ||
          finalResult?.status === "waiting_storage"
        ) {
          toast.info(t("recordRoute.videoReadyToUpload"), {
            description: t("recordRoute.connectStorageToFinish"),
            duration: 12_000,
          });
        } else {
          toast.success(t("recordRoute.videoUploaded"));
        }
        // Refetch so the real card is present before the placeholder leaves,
        // making the hand-off seamless (the finally block clears it).
        await invalidateRecordings().catch((error) => {
          console.warn("[clips] dropped-upload list refresh failed", error);
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : t("recordRoute.uploadFailed");
        console.warn("[clips] dropped video upload failed", err);
        if (createdId) {
          const details =
            err && typeof err === "object"
              ? (err as Record<string, unknown>)
              : {};
          const httpStatus =
            Number.isInteger(details.status) &&
            Number(details.status) >= 100 &&
            Number(details.status) <= 599
              ? Number(details.status)
              : undefined;
          fetch(`${appBasePath()}/api/uploads/${createdId}/abort`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              reason: message,
              failureCode:
                details.failureCode === "chunk_html_error"
                  ? "chunk_html_error"
                  : "upload_failed",
              ...(details.failureStage === "chunk_upload"
                ? { failureStage: "chunk_upload" }
                : {}),
              ...(httpStatus ? { httpStatus } : {}),
            }),
          }).catch((abortError) => {
            console.warn("[clips] dropped-upload cleanup failed", abortError);
          });
        }
        toast.error(t("recordRoute.uploadFailed"), {
          description: t("recordRoute.tryAgain"),
        });
        void invalidateRecordings().catch((refreshError) => {
          console.warn(
            "[clips] dropped-upload list refresh failed",
            refreshError,
          );
        });
      } finally {
        remove();
      }
    },
    [invalidateRecordings, t],
  );

  const fileQueueRef = useRef<QueuedDropUpload[]>([]);
  const drainingQueueRef = useRef(false);
  // ponytail: one file at a time bounds upload pressure; allow multiple files when measured throughput needs it.
  const drainFileQueue = useCallback(async () => {
    if (drainingQueueRef.current) return;
    drainingQueueRef.current = true;
    try {
      while (fileQueueRef.current.length > 0) {
        const item = fileQueueRef.current.shift();
        if (item) await uploadOne(item.file, item.scope);
      }
    } catch (error) {
      console.warn("[clips] dropped video upload queue failed", error);
      toast.error(t("recordRoute.uploadFailed"), {
        description: t("recordRoute.tryAgain"),
      });
    } finally {
      drainingQueueRef.current = false;
      if (fileQueueRef.current.length > 0) void drainFileQueue();
    }
  }, [t, uploadOne]);
  const uploadFiles = useCallback(
    (files: Iterable<File>) => {
      const uploadScope = {
        spaceId: scope.spaceId,
        folderId: scope.folderId,
      };
      fileQueueRef.current.push(
        ...Array.from(files, (file) => ({ file, scope: uploadScope })),
      );
      void drainFileQueue();
    },
    [drainFileQueue, scope.folderId, scope.spaceId],
  );

  return { uploads, uploadFiles };
}
