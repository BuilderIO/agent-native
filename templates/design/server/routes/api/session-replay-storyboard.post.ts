import { inflateSync } from "node:zlib";

import { verifyA2AToken } from "@agent-native/core/a2a";
import {
  isActionContractError,
  type ActionRunContext,
} from "@agent-native/core/action";
import {
  deleteAttachment,
  mintAttachmentRef,
} from "@agent-native/core/private-blob";
import { runWithRequestContext } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import {
  createError,
  defineEventHandler,
  getHeader,
  readMultipartFormData,
} from "h3";

import addSessionReplayScreenshotsToBoard from "../../../actions/add-session-replay-screenshots-to-board.js";

const MAX_SCREENSHOTS = 9;
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const MAX_SCREENSHOT_DIMENSION = 8_192;
const MAX_SCREENSHOT_PIXELS = 16_000_000;
const MAX_BATCH_PIXELS = 32_000_000;
const MAX_BATCH_BYTES = 20 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 32_000;
const MAX_REQUEST_BYTES = MAX_BATCH_BYTES + MAX_MANIFEST_BYTES + 64_000;
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const PNG_CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < PNG_CRC_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  PNG_CRC_TABLE[index] = value >>> 0;
}

type ReplayScreenshot = {
  replayId: string;
  app: string;
  capturedAt: string;
  route: string;
  offsetMs: number;
  viewportWidth: number;
  viewportHeight: number;
  eventCount: number;
};

type Manifest = {
  designId?: string;
  title?: string;
  cohortTotal: number;
  selectedReplayCount: number;
  screenshots: ReplayScreenshot[];
};

function badRequest(message: string, statusCode = 400): never {
  throw createError({ statusCode, statusMessage: message });
}

async function readBoundedMultipartFormData(
  event: Parameters<typeof readMultipartFormData>[0],
) {
  const declaredLength = event.req.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      badRequest("Screenshot export request size is invalid");
    }
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0) {
      badRequest("Screenshot export request size is invalid");
    }
    if (length > MAX_REQUEST_BYTES) {
      badRequest("Screenshot export request is too large", 413);
    }
  }

  const reader = event.req.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_REQUEST_BYTES) {
        const error = createError({
          statusCode: 413,
          statusMessage: "Screenshot export request is too large",
        });
        try {
          await reader.cancel(error);
        } catch (cancelError) {
          throw createError({
            statusCode: 413,
            statusMessage: "Screenshot export request is too large",
            cause: cancelError,
          });
        }
        throw error;
      }
      chunks.push(value);
    }
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "statusCode" in error &&
      error.statusCode === 413
    ) {
      throw error;
    }
    throw createError({
      statusCode: 400,
      statusMessage: "Screenshot export request body could not be read",
      cause: error,
    });
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
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
      body: body.byteLength > 0 ? body : undefined,
    }),
  });
  return readMultipartFormData(boundedEvent);
}

function parseManifest(value: unknown): Manifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return badRequest("Screenshot export manifest is invalid");
  }
  const raw = value as Record<string, unknown>;
  if (
    !Array.isArray(raw.screenshots) ||
    raw.screenshots.length < 1 ||
    raw.screenshots.length > MAX_SCREENSHOTS
  ) {
    return badRequest(`Export must contain 1–${MAX_SCREENSHOTS} screenshots`);
  }
  const screenshots = raw.screenshots.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return badRequest("Screenshot metadata is invalid");
    }
    const item = entry as Record<string, unknown>;
    const replayId =
      typeof item.replayId === "string" ? item.replayId.trim() : "";
    const app = typeof item.app === "string" ? item.app.trim() : "";
    const route = typeof item.route === "string" ? item.route.trim() : "";
    const capturedAt =
      typeof item.capturedAt === "string" ? item.capturedAt.trim() : "";
    const date = new Date(capturedAt);
    if (
      !replayId ||
      replayId.length > 256 ||
      !app ||
      app.length > 128 ||
      !route.startsWith("/") ||
      route.startsWith("//") ||
      route.length > 2_048 ||
      /[\u0000-\u001f\u007f]/.test(route) ||
      !Number.isFinite(date.getTime()) ||
      !Number.isSafeInteger(item.offsetMs) ||
      Number(item.offsetMs) < 0 ||
      !Number.isSafeInteger(item.viewportWidth) ||
      !Number.isSafeInteger(item.viewportHeight) ||
      Number(item.viewportWidth) <= 0 ||
      Number(item.viewportHeight) <= 0 ||
      Number(item.viewportWidth) > MAX_SCREENSHOT_DIMENSION ||
      Number(item.viewportHeight) > MAX_SCREENSHOT_DIMENSION ||
      Number(item.viewportWidth) * Number(item.viewportHeight) >
        MAX_SCREENSHOT_PIXELS ||
      !Number.isSafeInteger(item.eventCount) ||
      Number(item.eventCount) < 1
    ) {
      return badRequest("Screenshot metadata is invalid");
    }
    return {
      replayId,
      app,
      route,
      capturedAt: date.toISOString(),
      offsetMs: Number(item.offsetMs),
      viewportWidth: Number(item.viewportWidth),
      viewportHeight: Number(item.viewportHeight),
      eventCount: Number(item.eventCount),
    };
  });
  if (
    screenshots.reduce(
      (total, screenshot) =>
        total + screenshot.viewportWidth * screenshot.viewportHeight,
      0,
    ) > MAX_BATCH_PIXELS
  ) {
    return badRequest("Screenshot batch exceeds the decoded pixel limit", 413);
  }
  const designId =
    typeof raw.designId === "string" && raw.designId.trim()
      ? raw.designId.trim()
      : undefined;
  const title =
    typeof raw.title === "string" && raw.title.trim()
      ? raw.title.trim()
      : undefined;
  const cohortTotal = Number(raw.cohortTotal);
  const selectedReplayCount = Number(raw.selectedReplayCount);
  if (
    !Number.isSafeInteger(cohortTotal) ||
    cohortTotal < 0 ||
    !Number.isSafeInteger(selectedReplayCount) ||
    selectedReplayCount < 1 ||
    cohortTotal < selectedReplayCount ||
    selectedReplayCount >
      new Set(screenshots.map(({ replayId }) => replayId)).size ||
    (designId && designId.length > 128) ||
    (title && title.length > 200)
  ) {
    return badRequest("Screenshot export cohort metadata is invalid");
  }
  return {
    ...(designId ? { designId } : {}),
    ...(title ? { title } : {}),
    cohortTotal,
    selectedReplayCount,
    screenshots,
  };
}

function pngCrc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = PNG_CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngPaethPredictor(left: number, above: number, upperLeft: number) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function isInvalidPngDeflateError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    [
      "ERR_BUFFER_TOO_LARGE",
      "Z_BUF_ERROR",
      "Z_DATA_ERROR",
      "Z_NEED_DICT",
    ].includes(error.code)
  );
}

function pngDimensions(
  source: Uint8Array,
): { width: number; height: number } | null {
  const data = Buffer.from(source);
  if (
    data.length < PNG_SIGNATURE.length ||
    !data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    return null;
  }

  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let paletteEntryCount = 0;
  let seenHeader = false;
  let seenPalette = false;
  let seenData = false;
  let dataEnded = false;
  let seenEnd = false;
  const compressedChunks: Buffer[] = [];

  while (offset < data.length) {
    if (offset + 12 > data.length) return null;
    const chunkLength = data.readUInt32BE(offset);
    const chunkEnd = offset + 12 + chunkLength;
    if (chunkEnd > data.length) return null;
    const chunkType = data.toString("ascii", offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(chunkType)) return null;
    const checksumOffset = offset + 8 + chunkLength;
    if (
      pngCrc32(data.subarray(offset + 4, checksumOffset)) !==
      data.readUInt32BE(checksumOffset)
    ) {
      return null;
    }
    const chunk = data.subarray(offset + 8, checksumOffset);

    if (
      !seenHeader &&
      (chunkType !== "IHDR" || offset !== PNG_SIGNATURE.length)
    )
      return null;
    if (chunkType === "IHDR") {
      if (seenHeader || chunkLength !== 13) return null;
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      const bitDepth = chunk[8];
      colorType = chunk[9]!;
      if (
        width < 1 ||
        height < 1 ||
        width > MAX_SCREENSHOT_DIMENSION ||
        height > MAX_SCREENSHOT_DIMENSION ||
        width * height > MAX_SCREENSHOT_PIXELS ||
        bitDepth !== 8 ||
        ![0, 2, 3, 4, 6].includes(colorType) ||
        chunk[10] !== 0 ||
        chunk[11] !== 0 ||
        chunk[12] !== 0
      ) {
        return null;
      }
      seenHeader = true;
    } else if (chunkType === "PLTE") {
      if (
        seenPalette ||
        seenData ||
        (colorType !== 2 && colorType !== 3 && colorType !== 6) ||
        chunkLength < 3 ||
        chunkLength > 768 ||
        chunkLength % 3 !== 0
      ) {
        return null;
      }
      seenPalette = true;
      paletteEntryCount = chunkLength / 3;
    } else if (chunkType === "IDAT") {
      if (dataEnded || (colorType === 3 && !seenPalette)) return null;
      seenData = true;
      compressedChunks.push(chunk);
    } else if (chunkType === "IEND") {
      if (chunkLength !== 0 || !seenData || chunkEnd !== data.length)
        return null;
      seenEnd = true;
      break;
    } else {
      if (seenData) dataEnded = true;
      if (chunkType[0] === chunkType[0]?.toUpperCase()) return null;
      if (chunkType[2] !== chunkType[2]?.toUpperCase()) return null;
    }

    if (seenData && chunkType !== "IDAT") dataEnded = true;
    offset = chunkEnd;
  }

  if (!seenEnd || !seenData) return null;
  const channels =
    colorType === 0 || colorType === 3
      ? 1
      : colorType === 2
        ? 3
        : colorType === 4
          ? 2
          : 4;
  const rowBytes = width * channels;
  const expectedDecodedBytes = (rowBytes + 1) * height;
  if (
    expectedDecodedBytes >
    MAX_SCREENSHOT_PIXELS * 4 + MAX_SCREENSHOT_DIMENSION
  ) {
    return null;
  }

  let decoded: Buffer;
  try {
    decoded = inflateSync(Buffer.concat(compressedChunks), {
      maxOutputLength: expectedDecodedBytes,
    });
  } catch (error) {
    if (!isInvalidPngDeflateError(error)) throw error;
    return null;
  }
  if (decoded.byteLength !== expectedDecodedBytes) return null;
  const rowStride = rowBytes + 1;
  for (let row = 0; row < height; row += 1) {
    const rowOffset = row * rowStride;
    const filter = decoded[rowOffset]!;
    if (filter > 4) return null;
    if (colorType !== 3) continue;

    const pixels = decoded.subarray(rowOffset + 1, rowOffset + rowStride);
    const previousPixels =
      row === 0 ? null : decoded.subarray(rowOffset - rowStride + 1, rowOffset);
    for (let column = 0; column < pixels.byteLength; column += 1) {
      const left = column === 0 ? 0 : pixels[column - 1]!;
      const above = previousPixels?.[column] ?? 0;
      const upperLeft = column === 0 ? 0 : (previousPixels?.[column - 1] ?? 0);
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? above
              : filter === 3
                ? Math.floor((left + above) / 2)
                : pngPaethPredictor(left, above, upperLeft);
      const paletteIndex = (pixels[column]! + predictor) & 0xff;
      if (paletteIndex >= paletteEntryCount) return null;
      pixels[column] = paletteIndex;
    }
  }

  return { width, height };
}

export default defineEventHandler(async (event) => {
  const authorization = getHeader(event, "authorization") ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(authorization)?.[1];
  if (!token) badRequest("A signed Analytics user is required", 401);

  const caller = await verifyA2AToken(token, event);
  if (!caller.email) badRequest("A signed Analytics user is required", 401);

  const parts = await readBoundedMultipartFormData(event);
  if (!parts) badRequest("Screenshot export payload is missing");
  const manifests = parts.filter((part) => part.name === "manifest");
  if (manifests.length !== 1 || !manifests[0]?.data) {
    badRequest("Screenshot export manifest is missing");
  }
  if (manifests[0].data.byteLength > MAX_MANIFEST_BYTES) {
    badRequest("Screenshot export manifest is too large", 413);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(manifests[0].data).toString("utf8"));
  } catch {
    badRequest("Screenshot export manifest is invalid");
  }
  const manifest = parseManifest(parsed);
  const expectedParts = new Set([
    "manifest",
    ...manifest.screenshots.map((_, index) => `screenshot-${index}`),
  ]);
  if (
    parts.length !== expectedParts.size ||
    parts.some((part) => !part.name || !expectedParts.has(part.name))
  ) {
    badRequest("Screenshot export parts do not match the manifest");
  }

  let totalBytes = 0;
  const screenshotBytes = manifest.screenshots.map((screenshot, index) => {
    const matches = parts.filter((part) => part.name === `screenshot-${index}`);
    if (matches.length !== 1 || !matches[0]?.data) {
      return badRequest(`Screenshot file ${index} is missing`);
    }
    const data = matches[0].data;
    totalBytes += data.byteLength;
    if (data.byteLength === 0 || data.byteLength > MAX_SCREENSHOT_BYTES) {
      return badRequest("Each screenshot must be 5 MB or smaller", 413);
    }
    if (totalBytes > MAX_BATCH_BYTES) {
      return badRequest("Screenshot batch must be 20 MB or smaller", 413);
    }
    const dimensions = pngDimensions(data);
    if (
      !dimensions ||
      dimensions.width !== screenshot.viewportWidth ||
      dimensions.height !== screenshot.viewportHeight
    ) {
      return badRequest("Screenshot pixels do not match the replay viewport");
    }
    return data;
  });

  return runWithRequestContext(
    {
      userEmail: caller.email,
      ...(caller.orgId ? { orgId: caller.orgId } : {}),
    },
    async () => {
      if (manifest.designId) {
        await assertAccess("design", manifest.designId, "editor");
      }

      const refs: string[] = [];
      let cleanupPending = false;
      let response:
        | {
            response: string;
            boardUrl: string;
            designId: string;
            screenshotCount: number;
            selectedReplayCount: number;
            cohortTotal: number;
          }
        | undefined;
      let actionFailed = false;
      let actionFailure: unknown;
      try {
        const screenshots = [];
        for (let index = 0; index < manifest.screenshots.length; index += 1) {
          const screenshot = manifest.screenshots[index]!;
          const minted = await mintAttachmentRef({
            data: screenshotBytes[index]!,
            filename: `${screenshot.replayId}-${String(screenshot.offsetMs).padStart(8, "0")}.png`,
            mimeType: "image/png",
            ownerEmail: caller.email!,
            orgId: null,
            metadata: {
              appId: "analytics",
              resourceType: "session-replay-screenshot-handoff",
              resourceId: screenshot.replayId,
              replayId: screenshot.replayId,
              offsetMs: screenshot.offsetMs,
            },
          });
          if (minted.status !== "ok") {
            badRequest("Design private screenshot storage is unavailable", 503);
          }
          refs.push(minted.ref);
          screenshots.push({ ...screenshot, attachmentRef: minted.ref });
        }

        const result = await addSessionReplayScreenshotsToBoard.run(
          {
            ...(manifest.designId ? { designId: manifest.designId } : {}),
            ...(manifest.title ? { title: manifest.title } : {}),
            cohortTotal: manifest.cohortTotal,
            selectedReplayCount: manifest.selectedReplayCount,
            screenshots,
          },
          {
            caller: "frontend",
            actionName: "add-session-replay-screenshots-to-board",
            userEmail: caller.email!,
            orgId: caller.orgId ?? null,
          } satisfies ActionRunContext,
        );
        if (!result.boardUrl || !result.designId) {
          badRequest("Design did not confirm a storyboard", 502);
        }
        response = {
          response: `Added ${screenshots.length} session replay screenshots to Design.`,
          boardUrl: result.boardUrl,
          designId: result.designId,
          screenshotCount: screenshots.length,
          selectedReplayCount: manifest.selectedReplayCount,
          cohortTotal: manifest.cohortTotal,
        };
      } catch (error) {
        actionFailed = true;
        actionFailure = error;
      } finally {
        for (const ref of refs) {
          try {
            const deleted = await deleteAttachment(ref, {
              ownerEmail: caller.email!,
              orgId: null,
            });
            if (deleted.status === "ok" && deleted.deleted) continue;
            cleanupPending = true;
          } catch {
            cleanupPending = true;
          }
        }
      }
      if (actionFailed) {
        if (isActionContractError(actionFailure)) {
          const actionDetails = actionFailure.details ?? {};
          const actionState =
            typeof actionDetails === "object" && actionDetails !== null
              ? (actionDetails as Record<string, unknown>)
              : {};
          throw createError({
            statusCode: actionFailure.statusCode,
            statusMessage: actionFailure.message,
            data: {
              error: actionFailure.message,
              errorCode: actionFailure.errorCode,
              ...(actionFailure.details === undefined
                ? {}
                : { details: actionFailure.details }),
              ...(cleanupPending || actionState.cleanupPending === true
                ? { cleanupPending: true }
                : {}),
              ...(actionState.cleanupFailed === true
                ? { cleanupFailed: true }
                : {}),
              ...(actionState.cleanupUnknown === true
                ? { cleanupUnknown: true }
                : {}),
              ...(actionState.saveOutcomeUnknown === true
                ? { saveOutcomeUnknown: true }
                : {}),
            },
            cause: actionFailure,
          });
        }
        const failure =
          actionFailure && typeof actionFailure === "object"
            ? (actionFailure as {
                data?: unknown;
                message?: unknown;
                statusCode?: unknown;
                statusMessage?: unknown;
              })
            : {};
        const existingData =
          failure.data && typeof failure.data === "object" ? failure.data : {};
        const failureData = existingData as Record<string, unknown>;
        if (
          !cleanupPending &&
          failureData.cleanupPending !== true &&
          failureData.saveOutcomeUnknown !== true
        ) {
          throw actionFailure;
        }
        throw createError({
          statusCode:
            typeof failure.statusCode === "number" ? failure.statusCode : 500,
          statusMessage:
            typeof failure.statusMessage === "string"
              ? failure.statusMessage
              : typeof failure.message === "string"
                ? failure.message
                : "Design screenshot action failed",
          data: {
            ...failureData,
            ...(cleanupPending || failureData.cleanupPending === true
              ? { cleanupPending: true }
              : {}),
            ...(failureData.saveOutcomeUnknown === true
              ? { saveOutcomeUnknown: true }
              : {}),
          },
          cause: actionFailure,
        });
      }
      if (!response) badRequest("Design did not confirm a storyboard", 502);
      return { ...response, cleanupPending };
    },
  );
});
