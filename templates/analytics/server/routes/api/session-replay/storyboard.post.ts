import { inflateSync } from "node:zlib";

import {
  assertCredentialedA2AUrl,
  canonicalA2AAudience,
  invokeAgentAction,
  resolveA2ACallerAuth,
  resolveAgentInvocationTarget,
  workspacePrivateOrigins,
} from "@agent-native/core/a2a";
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import { resolveVercelDeploymentProtectionHeaders } from "@agent-native/core/server";
import { createError, defineEventHandler, readMultipartFormData } from "h3";

import { runApiHandlerWithContext } from "../../../lib/credentials";
import { getSessionReplaySummary } from "../../../lib/session-replay";

const MAX_SCREENSHOTS = 9;
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const MAX_BATCH_PIXELS = 32_000_000;
const MAX_BATCH_BYTES = 20 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 32_000;
const MAX_DESIGN_UPLOAD_RESPONSE_BYTES = 64_000;
const MAX_MULTIPART_OVERHEAD_BYTES = 64_000;
const MAX_REQUEST_BYTES =
  MAX_BATCH_BYTES + MAX_MANIFEST_BYTES + MAX_MULTIPART_OVERHEAD_BYTES;
const MAX_SCREENSHOT_PIXELS = 16_000_000;
const MAX_SCREENSHOT_DIMENSION = 8_192;
// Leave headroom under Analytics' 75-second Netlify function limit.
const DESIGN_REQUEST_DEADLINE_MS = 60_000;
const DESIGN_ACTION_TIMEOUT_MS = 30_000;
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

type ScreenshotInput = {
  recordingId: string;
  offsetMs: number;
  route: string;
  viewportWidth: number;
  viewportHeight: number;
  eventCount: number;
  capturedAt: string;
};

type ManifestInput = {
  designId?: string;
  title?: string;
  cohortTotal: number;
  selectedReplayCount: number;
  screenshots: ScreenshotInput[];
};

type HandoffScreenshot = Omit<ScreenshotInput, "recordingId"> & {
  app: string;
  replayId: string;
};

type DesignUploadResult = {
  response?: string;
  boardUrl?: string;
  designId?: string;
  screenshotCount?: number;
  cleanupFailed?: boolean;
  cleanupPending?: boolean;
  cleanupUnknown?: boolean;
  message?: string;
  statusMessage?: string;
  data?: Record<string, unknown>;
};

function badRequest(message: string, statusCode = 400): never {
  throw createError({ statusCode, statusMessage: message });
}

function unknownSaveOutcomeError(message: string, cause?: unknown) {
  return createError({
    statusCode: 502,
    statusMessage: message,
    data: { saveOutcomeUnknown: true },
    ...(cause === undefined ? {} : { cause }),
  });
}

function requestDeadlineError(statusMessage: string) {
  return createError({ statusCode: 504, statusMessage });
}

function remainingRequestDeadlineMs(
  deadlineAt: number,
  statusMessage: string,
): number {
  const remaining = Math.ceil(deadlineAt - Date.now());
  if (remaining <= 0) throw requestDeadlineError(statusMessage);
  return remaining;
}

async function beforeRequestDeadline<T>(
  operation: () => Promise<T>,
  deadlineAt: number,
  statusMessage: string,
  onTimeout?: (error: Error) => void,
): Promise<T> {
  const timeoutMs = remainingRequestDeadlineMs(deadlineAt, statusMessage);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutFailure = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      const error = requestDeadlineError(statusMessage);
      onTimeout?.(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      timeoutFailure,
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function remainingDesignRequestTimeout(deadlineAt: number): number {
  return Math.min(
    DESIGN_ACTION_TIMEOUT_MS,
    remainingRequestDeadlineMs(
      deadlineAt,
      "Design screenshot export exceeded its request deadline",
    ),
  );
}

function isDesignUploadResult(value: unknown): value is DesignUploadResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  const stringFields = [
    "response",
    "boardUrl",
    "designId",
    "message",
    "statusMessage",
  ];
  return (
    stringFields.every(
      (field) =>
        result[field] === undefined || typeof result[field] === "string",
    ) &&
    (result.screenshotCount === undefined ||
      (typeof result.screenshotCount === "number" &&
        Number.isSafeInteger(result.screenshotCount))) &&
    (result.cleanupFailed === undefined ||
      typeof result.cleanupFailed === "boolean") &&
    (result.cleanupPending === undefined ||
      typeof result.cleanupPending === "boolean") &&
    (result.cleanupUnknown === undefined ||
      typeof result.cleanupUnknown === "boolean") &&
    (result.data === undefined ||
      (result.data !== null &&
        typeof result.data === "object" &&
        !Array.isArray(result.data)))
  );
}

async function readDesignUploadResponseText(
  response: Response,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytesRead = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return chunks.join("") + decoder.decode();
      bytesRead += value.byteLength;
      if (bytesRead > MAX_DESIGN_UPLOAD_RESPONSE_BYTES) {
        const error = createError({
          statusCode: 502,
          statusMessage: "Design screenshot upload response was too large",
        });
        void reader.cancel(error).catch(() => {});
        throw error;
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
  }
}

function parseManifest(value: unknown): ManifestInput {
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
    const recordingId =
      typeof item.recordingId === "string" ? item.recordingId.trim() : "";
    const route = typeof item.route === "string" ? item.route.trim() : "";
    const capturedAt =
      typeof item.capturedAt === "string" ? item.capturedAt.trim() : "";
    const date = new Date(capturedAt);
    if (
      !recordingId ||
      recordingId.length > 128 ||
      !Number.isSafeInteger(item.offsetMs) ||
      Number(item.offsetMs) < 0 ||
      !route.startsWith("/") ||
      route.startsWith("//") ||
      route.length > 2_048 ||
      /[\u0000-\u001f\u007f]/.test(route) ||
      !Number.isFinite(date.getTime()) ||
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
      recordingId,
      offsetMs: Number(item.offsetMs),
      route,
      viewportWidth: Number(item.viewportWidth),
      viewportHeight: Number(item.viewportHeight),
      eventCount: Number(item.eventCount),
      capturedAt: date.toISOString(),
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
  const recordingIds = new Set(
    screenshots.map((screenshot) => screenshot.recordingId),
  );
  const cohortTotal = Number(raw.cohortTotal);
  const selectedReplayCount = Number(raw.selectedReplayCount);
  const designId =
    typeof raw.designId === "string" && raw.designId.trim()
      ? raw.designId.trim()
      : undefined;
  const title =
    typeof raw.title === "string" && raw.title.trim()
      ? raw.title.trim()
      : undefined;
  if (
    !Number.isSafeInteger(cohortTotal) ||
    cohortTotal < recordingIds.size ||
    !Number.isSafeInteger(selectedReplayCount) ||
    selectedReplayCount !== recordingIds.size ||
    (designId && designId.length > 128) ||
    (title && title.length > 140)
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

function pngDimensions(data: Buffer): { width: number; height: number } | null {
  if (
    data.length < PNG_SIGNATURE.length ||
    !data.subarray(0, 8).equals(PNG_SIGNATURE)
  ) {
    return null;
  }

  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let colorType = -1;
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

    if (!seenHeader && (chunkType !== "IHDR" || offset !== 8)) return null;
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
    } else if (chunkType === "IDAT") {
      if (dataEnded || (colorType === 3 && !seenPalette)) {
        return null;
      }
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
  } catch {
    return null;
  }
  if (decoded.byteLength !== expectedDecodedBytes) return null;
  for (let row = 0; row < height; row += 1) {
    if (decoded[row * (rowBytes + 1)]! > 4) return null;
  }

  return { width, height };
}

function multipartFile(
  parts: NonNullable<Awaited<ReturnType<typeof readMultipartFormData>>>,
  name: string,
) {
  const matches = parts.filter((part) => part.name === name);
  if (matches.length !== 1 || !matches[0]?.data) {
    return badRequest(`Screenshot file ${name} is missing`);
  }
  return matches[0];
}

async function readBoundedMultipartBody(
  event: Parameters<typeof readMultipartFormData>[0],
  deadlineAt: number,
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
  if (!reader) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await beforeRequestDeadline(
        () => reader.read(),
        deadlineAt,
        "Screenshot export request exceeded its request deadline",
        (error) => {
          void reader.cancel(error).catch(() => {});
        },
      );
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_REQUEST_BYTES) {
        const error = createError({
          statusCode: 413,
          statusMessage: "Screenshot export request is too large",
        });
        void reader.cancel(error).catch(() => {});
        throw error;
      }
      chunks.push(value);
    }
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "statusCode" in error &&
      (error.statusCode === 413 || error.statusCode === 504)
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
  return body;
}

async function readBoundedMultipartFormData(
  event: Parameters<typeof readMultipartFormData>[0],
  deadlineAt: number,
) {
  const body = await readBoundedMultipartBody(event, deadlineAt);
  const headers = new Headers(event.req.headers);
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  const request = new Request(event.req.url, {
    method: event.req.method,
    headers,
    body: body.byteLength > 0 ? body : undefined,
  });
  const boundedEvent = Object.create(event) as typeof event;
  Object.defineProperty(boundedEvent, "req", { value: request });
  return beforeRequestDeadline(
    () => readMultipartFormData(boundedEvent),
    deadlineAt,
    "Screenshot export request exceeded its request deadline",
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function designReadFiles(
  output: string,
  designId: string,
): Array<{ id: string; filename: string; content?: string }> | null {
  const result: unknown = JSON.parse(output);
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return null;
  }
  const design = result as { id?: unknown; files?: unknown };
  if (design.id !== designId || !Array.isArray(design.files)) return null;
  const files = design.files.flatMap((file) => {
    if (!file || typeof file !== "object" || Array.isArray(file)) return [];
    const candidate = file as {
      id?: unknown;
      filename?: unknown;
      content?: unknown;
    };
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.filename !== "string"
    ) {
      return [];
    }
    return [
      {
        id: candidate.id,
        filename: candidate.filename,
        ...(typeof candidate.content === "string"
          ? { content: candidate.content }
          : {}),
      },
    ];
  });
  return files;
}

async function readDesignStoryboard(
  target: string,
  designId: string,
  userEmail: string,
  apiKey: string,
  deadlineAt: number,
): Promise<{ targetUrl: string; content: string } | null> {
  const invokeRead = (target: string, input: Record<string, unknown>) => {
    const requestTimeoutMs = remainingDesignRequestTimeout(deadlineAt);
    return invokeAgentAction({
      target,
      selfAppId: "analytics",
      userEmail,
      apiKey,
      requestTimeoutMs,
      action: "get-design",
      input,
    });
  };

  const metadata = await invokeRead(target, {
    id: designId,
    includeFileContent: false,
  });
  if (metadata.result.status !== "completed") return null;
  const metadataFiles = designReadFiles(metadata.result.output, designId);
  if (!metadataFiles) return null;
  const boardFile = metadataFiles.find(
    (file) => file.filename === "__board__.html",
  );
  if (!boardFile) {
    return { targetUrl: metadata.target.url, content: "" };
  }

  const board = await invokeRead(metadata.target.url, {
    id: designId,
    fileId: boardFile.id,
  });
  if (board.result.status !== "completed") return null;
  const boardFiles = designReadFiles(board.result.output, designId);
  const confirmedBoard = boardFiles?.find(
    (file) => file.id === boardFile.id && file.filename === "__board__.html",
  );
  if (typeof confirmedBoard?.content !== "string") return null;
  return { targetUrl: board.target.url, content: confirmedBoard.content };
}

function screenshotAttributes(screenshot: HandoffScreenshot): string[] {
  return [
    `data-session-replay-id="${escapeHtml(screenshot.replayId)}"`,
    `data-session-replay-captured-at="${escapeHtml(screenshot.capturedAt)}"`,
    `data-session-replay-app="${escapeHtml(screenshot.app)}"`,
    `data-session-replay-route="${escapeHtml(screenshot.route)}"`,
    `data-session-replay-offset-ms="${screenshot.offsetMs}"`,
    `data-session-replay-event-count="${screenshot.eventCount}"`,
    `data-session-replay-viewport-width="${screenshot.viewportWidth}"`,
    `data-session-replay-viewport-height="${screenshot.viewportHeight}"`,
  ];
}

function matchingScreenshotCount(
  boardContent: string,
  screenshot: HandoffScreenshot,
): number {
  const attributes = screenshotAttributes(screenshot);
  const imageTags = boardContent.match(/<img\b[^>]*>/gi) ?? [];
  return imageTags.filter(
    (tag) =>
      attributes.every((attribute) => tag.includes(attribute)) &&
      /src="\/api\/design-board-replay-screenshots\/[A-Za-z0-9_-]+"/.test(tag),
  ).length;
}

function designStoryboardContainsNewScreenshots(
  boardContent: string,
  screenshots: HandoffScreenshot[],
  previousBoardContent: string,
): boolean {
  const expectedCounts = new Map<string, HandoffScreenshot>();
  for (const screenshot of screenshots) {
    expectedCounts.set(
      JSON.stringify(screenshotAttributes(screenshot)),
      screenshot,
    );
  }
  for (const [signature, screenshot] of expectedCounts) {
    const expectedCount = screenshots.filter(
      (candidate) =>
        JSON.stringify(screenshotAttributes(candidate)) === signature,
    ).length;
    const previousCount = matchingScreenshotCount(
      previousBoardContent,
      screenshot,
    );
    const currentCount = matchingScreenshotCount(boardContent, screenshot);
    if (currentCount - previousCount < expectedCount) return false;
  }
  return true;
}

function designBoardUrl(baseUrl: string, designId: string): string {
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}/_agent-native/open`;
  url.hash = "";
  const params = new URLSearchParams({
    app: "design",
    view: "editor",
    to: `/design/${encodeURIComponent(designId)}`,
    designId,
  });
  url.search = params.toString();
  return url.toString();
}

function designScreenshotUploadUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}/api/session-replay-storyboard`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function createDesignUploadForm(
  manifest: Record<string, unknown>,
  screenshotBytes: readonly Uint8Array[],
): FormData {
  const form = new FormData();
  form.set("manifest", JSON.stringify(manifest));
  screenshotBytes.forEach((bytes, index) => {
    form.append(
      `screenshot-${index}`,
      new Blob([Buffer.from(bytes)], { type: "image/png" }),
      `replay-${index}.png`,
    );
  });
  return form;
}

export default defineEventHandler(async (event) =>
  runApiHandlerWithContext(event, async (ctx) => {
    const designRequestDeadlineAt = Date.now() + DESIGN_REQUEST_DEADLINE_MS;
    let responseBody:
      | {
          response: string;
          boardUrl: string;
          screenshotCount: number;
          selectedReplayCount: number;
          cohortTotal: number;
          cleanupPending?: boolean;
        }
      | undefined;
    let cleanupPending = false;
    let cleanupFailed = false;
    let cleanupUnknown = false;
    try {
      const parts = await readBoundedMultipartFormData(
        event,
        designRequestDeadlineAt,
      );
      if (!parts) {
        badRequest("Screenshot export payload is missing");
      }
      const manifestParts = parts.filter((part) => part.name === "manifest");
      if (manifestParts.length !== 1 || !manifestParts[0]?.data) {
        badRequest("Screenshot export manifest is missing");
      }
      if (manifestParts[0].data.byteLength > MAX_MANIFEST_BYTES) {
        badRequest("Screenshot export manifest is too large", 413);
      }

      let rawManifest: unknown;
      try {
        rawManifest = JSON.parse(
          Buffer.from(manifestParts[0].data).toString("utf8"),
        );
      } catch {
        badRequest("Screenshot export manifest is invalid");
      }
      const manifest = parseManifest(rawManifest);
      const expectedNames = new Set([
        "manifest",
        ...manifest.screenshots.map((_, index) => `screenshot-${index}`),
      ]);
      if (
        parts.length !== expectedNames.size ||
        parts.some((part) => !part.name || !expectedNames.has(part.name))
      ) {
        badRequest("Screenshot export parts do not match the manifest");
      }

      const recordings = new Map<
        string,
        Awaited<ReturnType<typeof getSessionReplaySummary>>
      >();
      for (const recordingId of new Set(
        manifest.screenshots.map((screenshot) => screenshot.recordingId),
      )) {
        recordings.set(
          recordingId,
          await beforeRequestDeadline(
            () =>
              getSessionReplaySummary(recordingId, {
                userEmail: ctx.userEmail,
                orgId: ctx.orgId ?? null,
              }),
            designRequestDeadlineAt,
            "Screenshot export request exceeded its request deadline",
          ),
        );
      }

      let totalBytes = 0;
      const handoffScreenshots: HandoffScreenshot[] = [];
      const screenshotBytes: Uint8Array[] = [];
      for (let index = 0; index < manifest.screenshots.length; index += 1) {
        const screenshot = manifest.screenshots[index]!;
        const recording = recordings.get(screenshot.recordingId);
        if (!recording) badRequest("Session replay is unavailable", 404);
        if (
          screenshot.offsetMs >
            (recording.durationMs ?? Number.POSITIVE_INFINITY) ||
          screenshot.eventCount !== recording.eventCount
        ) {
          badRequest("Screenshot metadata no longer matches the replay", 409);
        }
        const part = multipartFile(parts, `screenshot-${index}`);
        const bytes = Buffer.from(part.data);
        totalBytes += bytes.byteLength;
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_SCREENSHOT_BYTES) {
          badRequest("Each screenshot must be 5 MB or smaller", 413);
        }
        if (totalBytes > MAX_BATCH_BYTES) {
          badRequest("Screenshot batch must be 20 MB or smaller", 413);
        }
        const dimensions = pngDimensions(bytes);
        if (
          !dimensions ||
          dimensions.width !== screenshot.viewportWidth ||
          dimensions.height !== screenshot.viewportHeight
        ) {
          badRequest("Screenshot pixels do not match the replay viewport");
        }

        const app = recording.app ?? recording.template ?? "unknown";
        screenshotBytes.push(bytes);
        handoffScreenshots.push({
          replayId: recording.id,
          capturedAt: screenshot.capturedAt,
          app,
          route: screenshot.route,
          offsetMs: screenshot.offsetMs,
          viewportWidth: screenshot.viewportWidth,
          viewportHeight: screenshot.viewportHeight,
          eventCount: recording.eventCount,
        });
      }

      const designTarget = await resolveAgentInvocationTarget("design", {
        selfAppId: "analytics",
      });
      const caller = await resolveA2ACallerAuth({
        audience: canonicalA2AAudience(designTarget.url),
        userIdentityOnly: true,
      });
      const uploadToken = caller.apiKey;
      if (!caller.userEmail || !uploadToken) {
        badRequest("Analytics could not authenticate the Design upload", 503);
      }
      let previousBoardContent = "";
      let designTargetUrl = designTarget.url;
      if (manifest.designId) {
        const previous = await readDesignStoryboard(
          designTarget.url,
          manifest.designId,
          ctx.userEmail,
          uploadToken,
          designRequestDeadlineAt,
        );
        if (!previous) {
          badRequest(
            "Analytics could not read the target Design before writing the storyboard",
            502,
          );
        }
        designTargetUrl = previous.targetUrl;
        previousBoardContent = previous.content;
      }
      const designManifest = {
        ...(manifest.designId ? { designId: manifest.designId } : {}),
        ...(manifest.title ? { title: manifest.title } : {}),
        cohortTotal: manifest.cohortTotal,
        selectedReplayCount: manifest.selectedReplayCount,
        screenshots: handoffScreenshots,
      };
      const uploadUrl = designScreenshotUploadUrl(designTargetUrl);
      assertCredentialedA2AUrl(uploadUrl, true);
      const allowedPrivateOrigins = workspacePrivateOrigins();
      const uploadHeaders = {
        ...resolveVercelDeploymentProtectionHeaders(uploadUrl),
        Authorization: `Bearer ${uploadToken}`,
      };
      const uploadBody = createDesignUploadForm(
        designManifest,
        screenshotBytes,
      );
      const uploadTimeoutMs = remainingDesignRequestTimeout(
        designRequestDeadlineAt,
      );
      let uploadResponse: Response | undefined;
      let uploadResponseBody: string | undefined;
      const controller = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const timeoutFailure = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(
            createError({
              statusCode: 504,
              statusMessage: "Design screenshot upload timed out",
            }),
          );
        }, uploadTimeoutMs);
      });
      try {
        const upload = await Promise.race([
          (async () => {
            const response = await ssrfSafeFetch(
              uploadUrl,
              {
                method: "POST",
                headers: uploadHeaders,
                body: uploadBody,
                signal: controller.signal,
              },
              {
                allowedPrivateOrigins,
                followRedirects: false,
                maxRedirects: 0,
                requireDispatcher: true,
              },
            );
            uploadResponse = response;
            try {
              return {
                response,
                body: await readDesignUploadResponseText(response),
              };
            } catch (error) {
              if (!response.ok) throw error;
              throw unknownSaveOutcomeError(
                "Design may have saved the storyboard, but Analytics could not read its response. Check Design before retrying.",
                error,
              );
            }
          })(),
          timeoutFailure,
        ]);
        uploadResponse = upload.response;
        uploadResponseBody = upload.body;
      } catch (error) {
        if (controller.signal.aborted) {
          throw createError({
            statusCode: 504,
            statusMessage:
              "Design screenshot upload timed out. It may have saved the storyboard; check Design before retrying.",
            data: { saveOutcomeUnknown: true },
          });
        }
        if (uploadResponse && !uploadResponse.ok) {
          throw createError({
            statusCode: uploadResponse.status,
            statusMessage: `Design returned HTTP ${uploadResponse.status}, but Analytics could not read its response.`,
            ...(uploadResponse.status >= 500
              ? { data: { saveOutcomeUnknown: true } }
              : {}),
            cause: error,
          });
        }
        if (
          error instanceof Error &&
          (error.message.startsWith("SSRF blocked:") ||
            error.message.startsWith("SSRF protection is unavailable"))
        ) {
          throw error;
        }
        throw unknownSaveOutcomeError(
          "Design may have received the screenshot upload, but Analytics lost the connection. Check Design before retrying.",
          error,
        );
      } finally {
        if (timeout) clearTimeout(timeout);
      }
      if (!uploadResponse) {
        badRequest("Design screenshot upload did not return a response", 502);
      }
      let uploadResult: DesignUploadResult;
      try {
        const parsed: unknown = JSON.parse(uploadResponseBody ?? "");
        if (!isDesignUploadResult(parsed)) {
          throw new Error("Design screenshot upload response was invalid");
        }
        uploadResult = parsed;
      } catch (error) {
        if (uploadResponse.ok) {
          throw unknownSaveOutcomeError(
            "Design may have saved the storyboard, but Analytics could not read its response. Check Design before retrying.",
            error,
          );
        }
        badRequest(
          "Design returned an unexpected screenshot upload response",
          502,
        );
      }
      cleanupPending =
        uploadResult.cleanupPending === true ||
        uploadResult.data?.cleanupPending === true;
      cleanupFailed =
        uploadResult.cleanupFailed === true ||
        uploadResult.data?.cleanupFailed === true;
      cleanupUnknown =
        uploadResult.cleanupUnknown === true ||
        uploadResult.data?.cleanupUnknown === true;
      if (!uploadResponse.ok) {
        const data = {
          ...uploadResult.data,
          ...(uploadResult.cleanupFailed || uploadResult.data?.cleanupFailed
            ? { cleanupFailed: true }
            : {}),
          ...(uploadResult.cleanupPending || uploadResult.data?.cleanupPending
            ? { cleanupPending: true }
            : {}),
          ...(uploadResult.cleanupUnknown || uploadResult.data?.cleanupUnknown
            ? { cleanupUnknown: true }
            : {}),
        };
        throw createError({
          statusCode: uploadResponse.status,
          statusMessage:
            uploadResult.message ??
            uploadResult.statusMessage ??
            "Design screenshot upload failed",
          ...(Object.keys(data).length > 0 ? { data } : {}),
        });
      }
      const designId = uploadResult.designId ?? manifest.designId;
      if (!designId) {
        throw unknownSaveOutcomeError(
          "Design may have saved the storyboard, but its ID could not be recovered. Check Design before retrying.",
        );
      }
      let confirmation: Awaited<ReturnType<typeof readDesignStoryboard>>;
      try {
        confirmation = await readDesignStoryboard(
          designTargetUrl,
          designId,
          ctx.userEmail,
          uploadToken,
          designRequestDeadlineAt,
        );
      } catch {
        throw unknownSaveOutcomeError(
          "Design may have saved the storyboard, but Analytics could not read it back. Check Design before retrying.",
        );
      }
      if (
        !confirmation ||
        !designStoryboardContainsNewScreenshots(
          confirmation.content,
          handoffScreenshots,
          previousBoardContent,
        )
      ) {
        throw unknownSaveOutcomeError(
          "Design did not confirm the saved storyboard. It may have been saved; check Design before retrying.",
        );
      }
      responseBody = {
        response:
          uploadResult.response?.trim() ||
          `Added ${handoffScreenshots.length} session replay screenshots to Design.`,
        boardUrl: designBoardUrl(confirmation.targetUrl, designId),
        screenshotCount: handoffScreenshots.length,
        selectedReplayCount: manifest.selectedReplayCount,
        cohortTotal: manifest.cohortTotal,
        cleanupPending: uploadResult.cleanupPending ?? false,
      };
    } catch (error) {
      const errorDetails =
        error && typeof error === "object"
          ? (error as {
              data?: unknown;
              message?: unknown;
              statusCode?: unknown;
              statusMessage?: unknown;
            })
          : {};
      const knownStatus =
        typeof errorDetails.statusCode === "number"
          ? errorDetails.statusCode
          : 0;
      const existingData =
        errorDetails.data && typeof errorDetails.data === "object"
          ? (errorDetails.data as Record<string, unknown>)
          : {};
      if (knownStatus) {
        if (
          (!cleanupPending && !cleanupFailed && !cleanupUnknown) ||
          existingData.cleanupPending === true ||
          existingData.cleanupFailed === true ||
          existingData.cleanupUnknown === true
        )
          throw error;
        throw createError({
          statusCode: knownStatus,
          statusMessage:
            typeof errorDetails.statusMessage === "string"
              ? errorDetails.statusMessage
              : error instanceof Error
                ? error.message
                : "Design screenshot upload failed",
          data: {
            ...existingData,
            ...(cleanupPending ? { cleanupPending: true } : {}),
            ...(cleanupFailed ? { cleanupFailed: true } : {}),
            ...(cleanupUnknown ? { cleanupUnknown: true } : {}),
          },
          cause: error,
        });
      }
      throw createError({
        statusCode: 502,
        statusMessage:
          error instanceof Error
            ? `Design screenshot upload failed: ${error.message}`
            : "Design screenshot upload failed",
        ...(cleanupPending || cleanupFailed || cleanupUnknown
          ? {
              data: {
                ...existingData,
                ...(cleanupPending ? { cleanupPending: true } : {}),
                ...(cleanupFailed ? { cleanupFailed: true } : {}),
                ...(cleanupUnknown ? { cleanupUnknown: true } : {}),
              },
            }
          : {}),
        cause: error,
      });
    }
    if (!responseBody) {
      badRequest("Design did not confirm a storyboard", 502);
    }
    return responseBody;
  }),
);
