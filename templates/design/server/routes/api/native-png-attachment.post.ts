import { compareAndSetAppState } from "@agent-native/core/application-state";
import {
  deleteAttachment,
  getActivePrivateBlobProviderForRequest,
  mintAttachmentRef,
} from "@agent-native/core/private-blob";
import { getSession, runWithRequestContext } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { createError, defineEventHandler, readMultipartFormData } from "h3";

import {
  readNativeLocalExportState,
  readNativeLocalExportVersion,
} from "../../../actions/_native-local-export-server.js";
import { resolveNativeRenderContextTarget } from "../../../actions/_native-render-contexts.js";
import { nativeLocalExportStateKey } from "../../../shared/native-local-export.js";
import { pngDimensions } from "../../lib/png-dimensions.js";

const MAX_PNG_BYTES = 40 * 1024 * 1024;
const MAX_BODY_BYTES = MAX_PNG_BYTES + 64 * 1024;

function reject(statusCode: number, statusMessage: string): never {
  throw createError({ statusCode, statusMessage });
}

async function boundedMultipart(
  event: Parameters<typeof readMultipartFormData>[0],
) {
  const declared = event.req.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)
  )
    reject(413, "Native PNG upload exceeds its body limit");
  const reader = event.req.body?.getReader();
  if (!reader) reject(400, "Native PNG upload has no body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        try {
          await reader.cancel();
        } catch (error) {
          throw createError({
            statusCode: 413,
            statusMessage: "Native PNG upload exceeds its body limit",
            cause: error,
          });
        }
        reject(413, "Native PNG upload exceeds its body limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const headers = new Headers(event.req.headers);
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  const boundedEvent = Object.create(event) as typeof event;
  Object.defineProperty(boundedEvent, "req", {
    value: new Request(event.req.url, {
      method: event.req.method,
      headers,
      body,
    }),
  });
  return readMultipartFormData(boundedEvent);
}

function field(
  parts: NonNullable<Awaited<ReturnType<typeof readMultipartFormData>>>,
  name: string,
): string {
  const matches = parts.filter((part) => part.name === name);
  if (
    matches.length !== 1 ||
    matches[0]?.filename ||
    matches[0]!.data.byteLength > 256
  )
    reject(400, `Invalid native PNG ${name} field`);
  return Buffer.from(matches[0]!.data).toString("utf8");
}

export default defineEventHandler(async (event) => {
  const session = await getSession(event);
  if (!session?.email) reject(401, "Native PNG upload requires a session");
  return runWithRequestContext(
    { userEmail: session.email, orgId: session.orgId },
    async () => {
      const parts = await boundedMultipart(event);
      if (!parts || parts.length !== 5)
        reject(400, "Native PNG upload fields are invalid");
      const designId = field(parts, "designId");
      const requestId = field(parts, "requestId");
      const documentId = field(parts, "documentId");
      const tabId = field(parts, "tabId");
      if (
        !designId ||
        !/^[0-9a-f-]{36}$/i.test(requestId) ||
        !/^[0-9a-f-]{36}$/i.test(documentId)
      )
        reject(400, "Native PNG upload identifiers are invalid");
      await assertAccess("design", designId, "viewer");
      await resolveNativeRenderContextTarget(designId, tabId);
      const state = await readNativeLocalExportState(designId, tabId);
      if (
        !state ||
        state.requestId !== requestId ||
        state.ownerDocumentId !== documentId ||
        state.status !== "running"
      )
        reject(
          409,
          "Native PNG request is not claimed by this editor document",
        );
      const live = await readNativeLocalExportVersion(designId, state.fileId);
      if (live.versionHash !== state.expectedVersionHash)
        reject(409, "Design source changed before native PNG upload");
      const files = parts.filter((part) => part.name === "file");
      if (files.length !== 1 || files[0]?.type !== "image/png")
        reject(400, "Native PNG file is missing");
      const bytes = files[0]!.data;
      if (bytes.byteLength < 1 || bytes.byteLength > MAX_PNG_BYTES)
        reject(413, "Native PNG file exceeds its byte limit");
      const dimensions = pngDimensions(bytes, {
        maxDimension: 4096,
        maxPixels: 8_388_608,
      });
      if (
        !dimensions ||
        dimensions.width !==
          Math.ceil(state.export.viewport.width * state.export.pixelRatio) ||
        dimensions.height !==
          Math.ceil(state.export.viewport.height * state.export.pixelRatio)
      )
        reject(422, "Native PNG dimensions do not match the claimed viewport");
      const provider = await getActivePrivateBlobProviderForRequest();
      if (!provider) reject(503, "Private PNG storage is not configured");
      if (state.attachmentRef)
        reject(409, "This native PNG request already has an attachment");
      const key = nativeLocalExportStateKey(designId, tabId);
      const uploading = { ...state, status: "uploading" as const };
      if (!(await compareAndSetAppState(key, state, uploading)))
        reject(409, "Native PNG upload was claimed concurrently");
      const minted = await mintAttachmentRef({
        data: bytes,
        filename: `native-export-${requestId}.png`,
        mimeType: "image/png",
        ownerEmail: session.email,
        orgId: null,
        metadata: {
          appId: "design",
          resourceType: "native-png-export",
          resourceId: requestId,
          designId,
          fileId: state.fileId,
        },
      });
      if (minted.status !== "ok") {
        await compareAndSetAppState(key, uploading, state);
        reject(503, "Private PNG storage is unavailable");
      }
      const uploaded = {
        ...state,
        attachmentRef: minted.ref,
        attachmentBytes: bytes.byteLength,
      };
      if (!(await compareAndSetAppState(key, uploading, uploaded))) {
        const removed = await deleteAttachment(minted.ref, {
          ownerEmail: session.email,
          orgId: null,
        });
        if (removed.status !== "ok")
          reject(503, "Native PNG upload changed and orphan cleanup failed");
        reject(
          409,
          "Native PNG request changed before attachment was recorded",
        );
      }
      return { attachmentRef: minted.ref, bytes: bytes.byteLength };
    },
  );
});
