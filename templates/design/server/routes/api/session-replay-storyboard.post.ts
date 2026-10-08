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
const MAX_BATCH_PIXELS = 32_000_000;
const MAX_BATCH_BYTES = 20 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 32_000;
const MAX_REQUEST_BYTES = MAX_BATCH_BYTES + MAX_MANIFEST_BYTES + 64_000;

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
      Number(item.viewportWidth) > 8_192 ||
      Number(item.viewportHeight) > 8_192 ||
      Number(item.viewportWidth) * Number(item.viewportHeight) > 16_000_000 ||
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

function pngDimensions(
  data: Uint8Array,
): { width: number; height: number } | null {
  if (
    data.byteLength < 24 ||
    data[0] !== 0x89 ||
    data[1] !== 0x50 ||
    data[2] !== 0x4e ||
    data[3] !== 0x47 ||
    data[4] !== 0x0d ||
    data[5] !== 0x0a ||
    data[6] !== 0x1a ||
    data[7] !== 0x0a ||
    Buffer.from(data).toString("ascii", 12, 16) !== "IHDR"
  ) {
    return null;
  }
  const bytes = Buffer.from(data);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
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
