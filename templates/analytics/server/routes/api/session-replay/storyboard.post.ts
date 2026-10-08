import { invokeAgent, resolveA2ACallerAuth } from "@agent-native/core/a2a";
import {
  ATTACHMENT_REF_MAX_CHARS,
  deleteAttachment,
  getActivePrivateBlobProviderForRequest,
  isPrivateBlobError,
  mintAttachmentRef,
} from "@agent-native/core/private-blob";
import { createError, defineEventHandler, readMultipartFormData } from "h3";

import { runApiHandlerWithContext } from "../../../lib/credentials";
import { getSessionReplaySummary } from "../../../lib/session-replay";

const MAX_SCREENSHOTS = 9;
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const MAX_BATCH_BYTES = 20 * 1024 * 1024;

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

function badRequest(message: string, statusCode = 400): never {
  throw createError({ statusCode, statusMessage: message });
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
      Number(item.viewportWidth) > 8_192 ||
      Number(item.viewportHeight) > 8_192 ||
      Number(item.viewportWidth) * Number(item.viewportHeight) > 16_000_000 ||
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

function pngDimensions(data: Buffer): { width: number; height: number } | null {
  if (
    data.length < 24 ||
    data[0] !== 0x89 ||
    data[1] !== 0x50 ||
    data[2] !== 0x4e ||
    data[3] !== 0x47 ||
    data[4] !== 0x0d ||
    data[5] !== 0x0a ||
    data[6] !== 0x1a ||
    data[7] !== 0x0a ||
    data.toString("ascii", 12, 16) !== "IHDR"
  ) {
    return null;
  }
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
  };
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

function requireDesignBoardUrl(responseText: string): string {
  const candidate = responseText
    .match(/https?:\/\/[^\s<>"')]+/i)?.[0]
    ?.replace(/[.,!?;]+$/, "");
  if (!candidate) {
    badRequest("Design did not confirm a storyboard URL", 502);
  }
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    badRequest("Design returned an invalid storyboard URL", 502);
  }
  const route = url.searchParams.get("to");
  const designId = url.searchParams.get("designId");
  const routeDesignId = route?.match(/^\/design\/([^/?#]+)$/)?.[1];
  if (
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      )) ||
    !url.pathname.endsWith("/_agent-native/open") ||
    url.searchParams.get("app") !== "design" ||
    url.searchParams.get("view") !== "editor" ||
    !designId ||
    !routeDesignId ||
    decodeURIComponent(routeDesignId) !== designId
  ) {
    badRequest("Design did not confirm a storyboard URL", 502);
  }
  return url.toString();
}

export default defineEventHandler(async (event) =>
  runApiHandlerWithContext(event, async (ctx) => {
    const mintedRefs: string[] = [];
    let cleanupPending = false;
    let responseBody:
      | {
          response: string;
          boardUrl: string;
          screenshotCount: number;
          selectedReplayCount: number;
          cohortTotal: number;
        }
      | undefined;
    try {
      const provider = await getActivePrivateBlobProviderForRequest();
      if (!provider) {
        badRequest(
          "Private screenshot storage is not configured for Analytics",
          503,
        );
      }

      const parts = await readMultipartFormData(event);
      if (!parts) {
        badRequest("Screenshot export payload is missing");
      }
      const manifestParts = parts.filter((part) => part.name === "manifest");
      if (manifestParts.length !== 1 || !manifestParts[0]?.data) {
        badRequest("Screenshot export manifest is missing");
      }
      if (manifestParts[0].data.byteLength > 32_000) {
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
          await getSessionReplaySummary(recordingId, {
            userEmail: ctx.userEmail,
            orgId: ctx.orgId ?? null,
          }),
        );
      }

      let totalBytes = 0;
      const handoffScreenshots: Array<Record<string, unknown>> = [];
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
        const minted = await mintAttachmentRef({
          data: bytes,
          filename: `${recording.id}-${String(screenshot.offsetMs).padStart(8, "0")}.png`,
          mimeType: "image/png",
          ownerEmail: ctx.userEmail,
          orgId: null,
          metadata: {
            appId: "analytics",
            resourceType: "session-replay-screenshot-handoff",
            resourceId: recording.id,
            replayId: recording.id,
            offsetMs: screenshot.offsetMs,
          },
        });
        if (minted.status !== "ok") {
          badRequest(
            "Private screenshot storage could not save this batch",
            503,
          );
        }
        mintedRefs.push(minted.ref);
        if (minted.ref.length > ATTACHMENT_REF_MAX_CHARS) {
          badRequest("Screenshot handoff reference is too large", 413);
        }
        if (
          minted.handle.provider !== provider.id ||
          minted.handle.opaque !== true
        ) {
          badRequest("Private screenshot storage provider changed", 503);
        }
        handoffScreenshots.push({
          attachmentRef: minted.ref,
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

      const caller = await resolveA2ACallerAuth();
      const actionInput = {
        ...(manifest.designId ? { designId: manifest.designId } : {}),
        ...(manifest.title ? { title: manifest.title } : {}),
        cohortTotal: manifest.cohortTotal,
        selectedReplayCount: manifest.selectedReplayCount,
        screenshots: handoffScreenshots,
      };
      const result = await invokeAgent({
        target: "design",
        selfAppId: "analytics",
        userEmail: ctx.userEmail,
        ...(caller.apiKey ? { apiKey: caller.apiKey } : {}),
        ...(caller.orgDomain ? { orgDomain: caller.orgDomain } : {}),
        ...(caller.orgSecret ? { orgSecret: caller.orgSecret } : {}),
        timeoutMs: 240_000,
        prompt:
          "Add these Analytics session replay screenshots to a Design storyboard. Call the Design action `add-session-replay-screenshots-to-board` exactly once with the complete JSON input below. Preserve every exact timestamp, route, replay ID, app, and viewport dimension. Use the supplied attachment refs as the image source. Do not put screenshot bytes or refs into board HTML. If the action fails, report the failure and do not claim success. On success, include the exact full `boardUrl` returned by the action and its screenshot count in your reply.\n\n" +
          JSON.stringify(actionInput),
      });
      responseBody = {
        response: result.responseText,
        boardUrl: requireDesignBoardUrl(result.responseText),
        screenshotCount: handoffScreenshots.length,
        selectedReplayCount: manifest.selectedReplayCount,
        cohortTotal: manifest.cohortTotal,
      };
    } catch (error) {
      const knownStatus =
        error &&
        typeof error === "object" &&
        "statusCode" in error &&
        typeof error.statusCode === "number"
          ? error.statusCode
          : 0;
      if (knownStatus) throw error;
      if (isPrivateBlobError(error)) {
        throw createError({
          statusCode: 503,
          statusMessage: "Private screenshot storage is unavailable",
        });
      }
      throw createError({
        statusCode: 502,
        statusMessage:
          error instanceof Error
            ? `Design handoff failed: ${error.message}`
            : "Design handoff failed",
      });
    } finally {
      for (const ref of mintedRefs) {
        try {
          const deleted = await deleteAttachment(ref, {
            ownerEmail: ctx.userEmail,
            orgId: null,
          });
          if (deleted.status === "ok") continue;
          cleanupPending = true;
          console.error(
            "[session-replay/storyboard] Failed to remove temporary private screenshot attachment",
            { status: deleted.status },
          );
        } catch {
          cleanupPending = true;
          console.error(
            "[session-replay/storyboard] Failed to remove temporary private screenshot attachment",
          );
        }
      }
    }
    if (!responseBody) {
      badRequest("Design did not confirm a storyboard", 502);
    }
    return { ...responseBody, cleanupPending };
  }),
);
