import {
  agentNativePath,
  appBasePath,
} from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import {
  chunkUploadParallelism,
  chunkUploadUrl,
  UPLOAD_SLICE_BYTES,
} from "@shared/recording-core";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { MAX_UPLOAD_BYTES, formatMb } from "@/lib/compress";
import { defaultRecordingTitle } from "@/lib/recording-title";
import { uploadVideoBlobThumbnail } from "@/lib/thumbnail-capture";
import { uploadChunkRequest } from "@/lib/upload-request";
import {
  probeVideoMetadata,
  resolveVideoMimeType,
} from "@/lib/video-metadata";

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

function fileTooLargeMessage(size: number): string {
  return `This file is too large to upload (${formatMb(
    size,
  )}, limit is ${formatMb(MAX_UPLOAD_BYTES)}). Trim it or export a shorter copy and try again.`;
}

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
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

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
    async (file: File) => {
      const key = `${file.name}-${file.size}-${Date.now()}-${Math.random()}`;
      setUploads((prev) => [...prev, { key, fileName: file.name, progress: 0 }]);
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
        toast.error(t("recordRoute.videoTooLarge"), {
          description: fileTooLargeMessage(file.size),
        });
        remove();
        return;
      }

      let createdId: string | null = null;
      const abort = new AbortController();
      try {
        const meta = await probeVideoMetadata(file);
        const { spaceId, folderId } = scopeRef.current;

        const res = await fetch(
          agentNativePath("/_agent-native/actions/create-recording"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: abort.signal,
            body: JSON.stringify({
              title: defaultTitleFor(file),
              titleSource: "upload",
              hasCamera: false,
              hasAudio: true,
              width: meta.width,
              height: meta.height,
              spaceIds: spaceId ? [spaceId] : undefined,
              folderId: folderId ?? undefined,
              mimeType,
              requestStreaming: true,
            }),
          },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(
            body?.error ?? `create-recording failed (${res.status})`,
          );
        }
        type CreateRecordingInfo = {
          id: string;
          uploadChunkUrl: string;
          uploadMode?: "streaming" | "buffered";
        };
        const created = (await res.json()) as {
          result?: CreateRecordingInfo;
        } & Partial<CreateRecordingInfo>;
        // The action route wraps the payload in `result` for some callers but
        // returns it at the top level for others — accept either shape.
        const info = created.result ?? (created as CreateRecordingInfo);
        if (!info?.id) throw new Error("create-recording did not return an id");
        createdId = info.id;
        // Tie the placeholder to the real row so the grid hides that row's
        // card while this placeholder (with its progress bar) is on screen.
        setRecordingId(createdId);

        void uploadVideoBlobThumbnail(createdId, file, {
          signal: abort.signal,
        }).catch(() => {});

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
              uploadError =
                err instanceof Error ? err : new Error(String(err));
              abort.abort();
              return;
            }
            if (!chunkRes.ok) {
              uploadError = new Error(
                `Upload failed at chunk ${item.index + 1}/${totalChunks} (${chunkRes.status})`,
              );
              abort.abort();
              return;
            }
            setProgress((item.index + 1) / totalChunks);
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

        const finalRes = await uploadChunkRequest({
          url: finalChunkDesc.url,
          contentType: mimeType,
          body: await finalChunkDesc.slice.arrayBuffer(),
        });
        if (!finalRes.ok) {
          throw new Error(
            `Upload failed at the final chunk (${finalRes.status})`,
          );
        }
        const finalResult = (await finalRes.json().catch(() => null)) as {
          status?: string;
          waitingForStorage?: boolean;
        } | null;

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
        await invalidateRecordings().catch(() => {});
      } catch (err) {
        const message =
          err instanceof Error ? err.message : t("recordRoute.uploadFailed");
        if (createdId) {
          fetch(`${appBasePath()}/api/uploads/${createdId}/abort`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason: message }),
          }).catch(() => {});
        }
        toast.error(t("recordRoute.uploadFailed"), { description: message });
        await invalidateRecordings().catch(() => {});
      } finally {
        remove();
      }
    },
    [invalidateRecordings, t],
  );

  const uploadFiles = useCallback(
    (files: Iterable<File>) => {
      for (const file of files) void uploadOne(file);
    },
    [uploadOne],
  );

  return { uploads, uploadFiles };
}
