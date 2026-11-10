import type { ActionRunContext } from "@agent-native/core/action";
import { z } from "zod";

import {
  clipsLinkOrigins,
  requestClipsUpload,
} from "../server/lib/clips-peer.js";
import { isClipRecordingId } from "../shared/clip-embed-block.js";
import {
  CLIP_UPLOAD_ERRORS,
  CONTENT_CLIP_UPLOAD_REFUSED,
  type ContentClipStorage,
  type ContentClipUploadMimeType,
  type CreateClipUploadResult,
} from "../shared/clips-peer-contract.js";
import { authorizeClipUploader, failClip } from "./_clip-embed-access.js";

const count = z.number().int().nonnegative();

export const clipStorageSchema: z.ZodType<ContentClipStorage> =
  z.discriminatedUnion("state", [
    z.object({
      state: z.literal("ready"),
      provider: z.enum(["builder", "custom", "local"]),
    }),
    z.object({
      state: z.literal("free"),
      remaining: count,
      limit: count,
      maxClipBytes: z.number().int().positive(),
    }),
    z.object({ state: z.literal("used_up"), limit: count }),
    z.object({ state: z.literal("none"), reason: z.string().max(100) }),
    z.object({ state: z.literal("account_required") }),
  ]);

/**
 * The uploader's address as Content's edge saw it. Clips caps free clips per
 * network, and from Clips every upload would otherwise come from Content.
 */
export function uploaderIp(ctx: ActionRunContext | undefined): string | null {
  const ip = ctx?.requestHeaders?.get("x-nf-client-connection-ip")?.trim();
  return ip && ip.length <= 64 && !/[\s\p{Cc}]/u.test(ip) ? ip : null;
}

/**
 * Whether a chunk or cancel URL Clips sent names this recording's upload on
 * one of Clips' own lanes. The browser posts the file and its ticket there, so
 * it may never point anywhere else.
 */
export function isClipUploadUrl(
  value: string,
  recordingId: string,
  route: "content-chunk" | "content-cancel",
): boolean {
  if (!URL.canParse(value) || !isClipRecordingId(recordingId)) return false;
  const url = new URL(value);
  return (
    clipsLinkOrigins().some(
      (origin) => new URL(origin).origin === url.origin,
    ) &&
    url.pathname.endsWith(
      `/api/uploads/${encodeURIComponent(recordingId)}/${route}`,
    ) &&
    url.searchParams.has("ticket") &&
    !url.username &&
    !url.password
  );
}

const startedSchema = z.object({
  recordingId: z.string(),
  chunkUrl: z.string(),
  cancelUrl: z.string(),
  chunkSizeBytes: z.number().int().positive(),
  totalChunks: z.number().int().positive(),
  expiresAt: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
});

const storageRequiredSchema = z.object({
  code: z.literal(CONTENT_CLIP_UPLOAD_REFUSED.storageRequired),
  storage: clipStorageSchema,
});

const alreadyFinishedSchema = z.object({
  code: z.literal(CONTENT_CLIP_UPLOAD_REFUSED.alreadyFinished),
  recordingId: z.string().refine(isClipRecordingId),
});

const startingSchema = z.object({
  code: z.literal(CONTENT_CLIP_UPLOAD_REFUSED.uploadStarting),
});

const keyUsedSchema = z.object({
  code: z.literal(CONTENT_CLIP_UPLOAD_REFUSED.keyUsed),
});

const tooLargeSchema = z.object({
  code: z.literal(CONTENT_CLIP_UPLOAD_REFUSED.tooLarge),
  maxBytes: z.number().int().positive(),
});

export const clipUploadResultSchema: z.ZodType<CreateClipUploadResult> =
  z.discriminatedUnion("status", [
    startedSchema.extend({ status: z.literal("started") }),
    z.object({
      status: z.literal("already_finished"),
      recordingId: z.string(),
    }),
    z.object({ status: z.literal("starting") }),
    z.object({ status: z.literal("key_used") }),
    z.object({
      status: z.literal("storage_required"),
      storage: clipStorageSchema,
    }),
    z.object({
      status: z.literal("too_large"),
      maxBytes: z.number().int().positive(),
    }),
  ]);

/** Whether a ticket's chunks hold the file exactly, none left over or short. */
function coversFile(
  { chunkSizeBytes, totalChunks }: z.infer<typeof startedSchema>,
  sizeBytes: number,
): boolean {
  return (
    (totalChunks - 1) * chunkSizeBytes < sizeBytes &&
    sizeBytes <= totalChunks * chunkSizeBytes
  );
}

function readAnswer(
  status: number,
  body: unknown,
  sizeBytes: number,
): CreateClipUploadResult {
  if (status === 200) {
    const started = startedSchema.safeParse(body);
    if (
      started.success &&
      coversFile(started.data, sizeBytes) &&
      isClipUploadUrl(
        started.data.chunkUrl,
        started.data.recordingId,
        "content-chunk",
      ) &&
      isClipUploadUrl(
        started.data.cancelUrl,
        started.data.recordingId,
        "content-cancel",
      )
    ) {
      return { status: "started", ...started.data };
    }
  }
  if (status === 409) {
    const refused = storageRequiredSchema.safeParse(body);
    if (refused.success) {
      return { status: "storage_required", storage: refused.data.storage };
    }
    const finished = alreadyFinishedSchema.safeParse(body);
    if (finished.success) {
      return {
        status: "already_finished",
        recordingId: finished.data.recordingId,
      };
    }
    if (startingSchema.safeParse(body).success) return { status: "starting" };
    if (keyUsedSchema.safeParse(body).success) return { status: "key_used" };
  }
  if (status === 413) {
    const refused = tooLargeSchema.safeParse(body);
    if (refused.success) {
      return { status: "too_large", maxBytes: refused.data.maxBytes };
    }
  }
  console.warn("[content-clips] unreadable upload start answer", { status });
  failClip(CLIP_UPLOAD_ERRORS.failed);
}

/**
 * Starts uploading a video into a page as a Clip for one of its editors:
 * Content checks the caller can edit the page, then asks Clips for a private
 * Clip bound to it and a ticketed URL the file is posted to. The file never
 * passes through Content.
 */
export async function startClipUpload(
  start: {
    documentId: string;
    fileName: string;
    sizeBytes: number;
    mimeType: ContentClipUploadMimeType;
    blockId: string;
    uploadKey: string;
  },
  ctx: ActionRunContext | undefined,
): Promise<CreateClipUploadResult> {
  const { documentId, ...file } = start;
  const uploader = await authorizeClipUploader(documentId);
  const answer = await requestClipsUpload({
    uploader,
    documentId,
    clientIp: uploaderIp(ctx),
    start: file,
  });
  if (!answer.ok) failClip(answer.code);
  return readAnswer(answer.status, answer.body, start.sizeBytes);
}
