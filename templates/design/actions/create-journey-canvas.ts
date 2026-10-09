import { createHash } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import {
  applyText,
  hasCollabState,
  seedFromText,
} from "@agent-native/core/collab";
import type { PrivateBlobHandle } from "@agent-native/core/private-blob";
import { buildDeepLink } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray, like } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "../server/db/index.js";
import { designChangeResource } from "../server/lib/design-change-resource.js";
import { mutateDesignData } from "../server/lib/design-data-mutation.js";
import {
  discardPrivateBlobs,
  MAX_REPLAY_SCREENSHOT_BYTES,
  resolveReplayScreenshotStorage,
  resolveAttachmentScreenshotBytes,
  storeReplayScreenshotBytesAsPrivateBlob,
  type StoredReplayScreenshotBlob,
} from "../server/lib/replay-screenshot-blobs.js";
import { isValidReplayScreenshotBlobHandle } from "../server/lib/replay-screenshot-private-blob.js";
import {
  deleteVisualEditSnapshotBlobs,
  queueVisualEditSnapshotBlobCleanupInTransaction,
} from "../server/lib/visual-edit-snapshot-blobs.js";
import {
  readLiveSourceFile,
  type SourceWorkspaceFile,
} from "../server/source-workspace.js";
import { BOARD_FILENAME } from "../shared/board-file.js";
import { nextFreeCanvasRowY } from "../shared/canvas-frames.js";
import {
  enUSJourneyCanvasMessages,
  type JourneyCanvasMessages,
} from "../shared/journey-canvas-messages.js";
import {
  JOURNEY_FILE_ID_PREFIX,
  JOURNEY_FILENAME_PREFIX,
  JOURNEY_REPLAY_ROW_PREFIX,
  JOURNEY_STAGED_REPLAY_MAX_AGE_MS,
  JOURNEY_STAGED_REPLAY_ROW_PREFIX,
  type CreateJourneyCanvasInput,
  createJourneyCanvasInputSchema,
  journeyFrameSourceApp,
  planJourneyCanvas,
  replaceJourneyBoardObjects,
} from "../shared/journey-canvas.js";
import createDesign from "./create-design.js";
import deleteDesign from "./delete-design.js";
import migrateBoardObjectsToFile from "./migrate-board-objects-to-file.js";

const MAX_TOTAL_IMAGE_BYTES = 256 * 1024 * 1024;
const UPLOAD_CONCURRENCY = 6;
const INSERT_CHUNK = 100;
/** Distance between the journey canvas and any content already on the design's canvas. */
const EXISTING_CONTENT_GAP = 160;
const STAGE_APP_PREFIX = "journey-canvas-stage:v2:";

const journeyCanvasMessageLoaders: Record<
  CreateJourneyCanvasInput["locale"],
  () => Promise<JourneyCanvasMessages>
> = {
  "en-US": async () => enUSJourneyCanvasMessages,
  "zh-CN": async () =>
    (await import("../app/i18n/zh-CN.js")).default.journeyCanvas,
  "zh-TW": async () =>
    (await import("../app/i18n/zh-TW.js")).default.journeyCanvas,
  "es-ES": async () =>
    (await import("../app/i18n/es-ES.js")).default.journeyCanvas,
  "fr-FR": async () =>
    (await import("../app/i18n/fr-FR.js")).default.journeyCanvas,
  "de-DE": async () =>
    (await import("../app/i18n/de-DE.js")).default.journeyCanvas,
  "ja-JP": async () =>
    (await import("../app/i18n/ja-JP.js")).default.journeyCanvas,
  "ko-KR": async () =>
    (await import("../app/i18n/ko-KR.js")).default.journeyCanvas,
  "pt-BR": async () =>
    (await import("../app/i18n/pt-BR.js")).default.journeyCanvas,
  "hi-IN": async () =>
    (await import("../app/i18n/hi-IN.js")).default.journeyCanvas,
  "ar-SA": async () =>
    (await import("../app/i18n/ar-SA.js")).default.journeyCanvas,
};

const likePrefix = (prefix: string) => `${prefix.replace(/[\\%_]/g, "\\$&")}%`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function withoutJourneyEntries(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([id]) => !id.startsWith(JOURNEY_FILE_ID_PREFIX),
    ),
  );
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

function parseStagedBlobHandle(value: string): PrivateBlobHandle | null {
  let handle: unknown;
  try {
    handle = JSON.parse(value) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  return isValidReplayScreenshotBlobHandle(handle) ? handle : null;
}

function digest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function stageRowId(designId: string, importId: string, frameKey: string) {
  return `${JOURNEY_STAGED_REPLAY_ROW_PREFIX}${digest(`${designId}\u0000${importId}\u0000${frameKey}`).slice(0, 40)}`;
}

function parseStageMarker(value: string): {
  importId: string;
  frameKeyHash: string;
  imageSha256: string;
  app: string;
} | null {
  if (!value.startsWith(STAGE_APP_PREFIX)) return null;
  const encoded = value.slice(STAGE_APP_PREFIX.length);
  try {
    if (Buffer.from(encoded, "base64url").toString("base64url") !== encoded) {
      return null;
    }
    const marker = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    if (
      typeof marker.importId !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(marker.importId) ||
      typeof marker.frameKeyHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(marker.frameKeyHash) ||
      typeof marker.imageSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(marker.imageSha256) ||
      typeof marker.app !== "string" ||
      !/^[a-z][a-z0-9-]{0,127}$/.test(marker.app)
    ) {
      return null;
    }
    return {
      importId: marker.importId,
      frameKeyHash: marker.frameKeyHash,
      imageSha256: marker.imageSha256,
      app: marker.app,
    };
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function designDeepLink(designId: string): string {
  return buildDeepLink({
    app: "design",
    view: "editor",
    params: { designId, editorView: "overview" },
    to: `/design/${encodeURIComponent(designId)}`,
  });
}

export default defineAction({
  description:
    "Create or refresh an onboarding-journey storyboard on a Design canvas in one call: a left-to-right tree of step cards with real session screenshots, arrows between them, cohort percentage labels on forks, and a 'No later step observed' stub for sessions whose last observed step was a node. These counts do not prove that a session exited. Each call accepts up to 1,000 journey nodes and 900 frame entries, subject to a 256 MiB total screenshot-byte limit. " +
    "For a separately observed visual-reference chain, mark each step node `referenceOnly: true` and omit cohort fields (`n`, `pctOfRoot`, `pctOfParent`, `dropoffN`, `dropoffPct`). Its card is labeled 'Observed session reference'; cohort counts, percentages and drop-off stubs are not shown for those nodes, and incoming edge percentages are suppressed. Set `observedContinuations` only for direct parent edges whose destination is reference-only. The source may be a canonical node only when `fromExampleIndex` selects that node's exact example; this anchors observed replay order without changing cohort counts or creating a cohort transition. Both private frames must map to their selected examples from the same session and recording, with the same recording start and increasing actual screenshot offsets. Those edges are dashed and labeled 'Same recording', without cohort percentages. This is observed replay order, not a claim that the child action caused the next screen. Keep each frame's `exampleIndex` matched to its example so event, recording, replay-offset, and screenshot-capture provenance stays attached. " +
    "For evidence from distinct recordings in the same session and app, use the separate `observedRecordingGaps` input with `type: \"recording-gap\"`, exact `fromNodeKey`/`fromExampleIndex` and `toNodeKey`/`toExampleIndex` bindings, and a direct parent edge to a `referenceOnly` destination. Both examples need different recording IDs and the same session ID; both frames need private screenshots, exact `recordingStartedAt` values, and actual `screenshotOffsetMs` seeks in chronological order. The source frame also needs the exact `recordingEndedAt`, before the target recording start, so the gap is supported even when its duration is omitted. When anonymous identity hashes are present, pass the same SHA-256 `anonymousIdHash` on both examples. Optionally pass `gapDurationMs` only when it exactly equals target recording start minus source recording end and is at most 30 days. The edge is dashed and visibly labeled 'Recording gap' (with the duration when supplied); it means the replay is discontinuous. It adds no cohort edge, count, percentage, conversion, signup success, or authentication-completion claim. Unknown authentication completion stays unknown. Unsupported or mismatched provenance fails validation. " +
    "Pass the journey tree from Analytics `get-onboarding-journey` as `tree` and one captured frame per example as `frames` ({ nodeKey, exampleIndex, width, height, capturedAt } plus exactly one of `imageUrl` (https only; data: URLs are rejected), `attachmentRef` (a personal private attachment), or `stagedFrameId` (a PNG staged in this Design with `stage-journey-canvas-frames`; consumed without copying its blob)). A staged frame must pass its current route or explicit null when unverified, its actual screenshot seek, and its capture-source fingerprint or null when unavailable. Never pass a stale initial Meta href as the current route. When `tree.app` is `all`, set each private frame's `sourceApp` to the source template; app-prefixed node keys can supply it. Private blob providers are used by default; set `allowEncryptedPublicUploadFallback: true` only when this call is approved to use the configured encrypted public-upload fallback. " +
    'Set `layoutMode: "appBands"` to place independent app trees side by side. This requires `tree.app: "all"`, app-prefixed node keys, and `tree.appRootN` with each app\'s root denominator; `pctOfRoot` must use that app-specific denominator. Components with a role, setup-choice, or signup checkpoint are placed first, then independent roots are ordered by cohort size. This changes placement only: it does not add cross-app edges or combine app populations. The default `layoutMode: "tree"` keeps the single-tree layout. ' +
    "Each card keeps the UTC date, recorded actor, observed state and prompt preview compactly visible. Replay IDs, source app/route, recording start, seek offsets, screenshot export time, actor source and evidence details are available in an expandable disclosure. An unknown current route and unavailable capture-source fingerprint are shown explicitly. For staged frames, pass `route` as the verified current route or null if unknown, plus actual `screenshotOffsetMs`; pass `captureSourceFingerprint` or null if the source fingerprint was not captured. Pass `recordingStartedAt` with `screenshotOffsetMs` to show the exact replay observation time. The Analytics example offset is only a nominal checkpoint target because it includes settling time. A frame may include `caption` metadata (`observedState`, `outputTitle`, recorded `actor` and `actorSource`, `dateLabel`, `evidenceStatus`, optional `evidenceAt` for a distinct source event timestamp, `prompt`, optional `promptTranslation`/`promptSource`, or `promptUnavailableReason`); it is displayed with that frame, and the full prompt opens in place. Use the actor identity from the recording, never the storage owner. " +
    "Pass `locale` to translate the standalone card labels; it defaults to `en-US`. " +
    "When a node has multiple frames, the card includes accessible numbered controls to switch examples in place; all example screenshots remain private attachments. " +
    "Cards are sized from each frame's real aspect ratio; ordinary examples (up to `maxExamplesPerNode`, default 3) stack behind the front card. Any screenshot example selected by `observedContinuations` or `observedRecordingGaps` is kept even when its index is higher than that display limit. A step with no frame is left off and listed in `skippedNodes` unless `includeScreenshotless` is true. " +
    "Omit `designId` to create a new design; pass one to replace the storyboard this action drew earlier in that design (only its own screens and board objects are replaced, everything else on the canvas is left alone). " +
    "Returns { designId, url, nodeCount, frameCount, skippedNodes, collabSyncPending }; `collabSyncPending` lists file ids that are saved but whose open editors could not be updated live (empty when all synced). When it is not empty, call again with the same `designId` to retry the live sync; until then an open editor can still show the previous version.",
  requiresAuth: true,
  maxBodyBytes: 4 * 1024 * 1024,
  schema: createJourneyCanvasInputSchema,
  mcpTool: true,
  mcpAnnotations: {
    readOnlyHint: false,
    // With designId, the screens and screenshot rows drawn earlier are deleted and replaced.
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async (input, context) => {
    const requesterEmail = getRequestUserEmail();
    if (!requesterEmail) {
      fail("A signed-in user is required.", { statusCode: 401 });
    }

    const existingAccess = input.designId
      ? await assertAccess("design", input.designId, "editor")
      : undefined;
    const designId = input.designId ?? nanoid();

    const messages = await journeyCanvasMessageLoaders[input.locale]();
    const plan = planJourneyCanvas(input, designId, messages);
    if (plan.screens.length === 0) {
      fail(
        "No node has a screenshot, so there is nothing to draw. Pass frames, or set includeScreenshotless to draw labelled placeholder cards.",
        {
          errorCode: "journey_canvas_empty",
          statusCode: 400,
          details: { skippedNodes: plan.skippedNodes },
        },
      );
    }

    const attachmentScreens = plan.screens.filter(
      (screen) => screen.attachment,
    );
    const sourceAttachmentScreens = attachmentScreens.filter(
      ({ attachment }) => attachment?.ref,
    );
    const stagedScreens = attachmentScreens.filter(
      ({ attachment }) => attachment?.stagedFrameId,
    );
    const storage = sourceAttachmentScreens.length
      ? await resolveReplayScreenshotStorage(
          input.allowEncryptedPublicUploadFallback,
        )
      : null;

    const stored = new Map<string, StoredReplayScreenshotBlob>();
    const newlyStored = new Map<string, StoredReplayScreenshotBlob>();
    const stagedSourceAppByRowId = new Map<string, string>();
    let createdDesignId: string | undefined;
    let mutationStarted = false;
    let mutationUpdatedAt: string | undefined;
    let boardFileId: string | undefined;
    let previousBoardContent: string | undefined;
    let nextBoardContent: string | undefined;
    let removedBlobHandles: string[] = [];
    const blobOwnerEmail =
      existingAccess?.resource.ownerEmail ?? requesterEmail;
    try {
      const db = getDb();
      let stagedImageBytes = 0;
      if (stagedScreens.length > 0) {
        const stagedFrameIds = stagedScreens.map(
          ({ attachment }) => attachment!.stagedFrameId!,
        );
        const finalFrameIds = stagedScreens.map(
          ({ attachment }) => attachment!.rowId,
        );
        const [stagedRows, promotedRows] = await Promise.all([
          db
            .select({
              id: schema.designBoardReplayScreenshots.id,
              sizeBytes: schema.designBoardReplayScreenshots.sizeBytes,
            })
            .from(schema.designBoardReplayScreenshots)
            .where(
              and(
                eq(schema.designBoardReplayScreenshots.designId, designId),
                inArray(schema.designBoardReplayScreenshots.id, stagedFrameIds),
                like(
                  schema.designBoardReplayScreenshots.id,
                  likePrefix(JOURNEY_STAGED_REPLAY_ROW_PREFIX),
                ),
              ),
            ),
          db
            .select({
              id: schema.designBoardReplayScreenshots.id,
              sizeBytes: schema.designBoardReplayScreenshots.sizeBytes,
              sourceStageId: schema.designBoardReplayScreenshots.sourceStageId,
            })
            .from(schema.designBoardReplayScreenshots)
            .where(
              and(
                eq(schema.designBoardReplayScreenshots.designId, designId),
                inArray(schema.designBoardReplayScreenshots.id, finalFrameIds),
                like(
                  schema.designBoardReplayScreenshots.id,
                  likePrefix(JOURNEY_REPLAY_ROW_PREFIX),
                ),
              ),
            ),
        ]);
        const stagedById = new Map(stagedRows.map((row) => [row.id, row]));
        const promotedById = new Map(promotedRows.map((row) => [row.id, row]));
        for (const { attachment } of stagedScreens) {
          const stagedFrameId = attachment!.stagedFrameId!;
          const staged = stagedById.get(stagedFrameId);
          const promoted = promotedById.get(attachment!.rowId);
          const reusable =
            staged ??
            (promoted?.sourceStageId === stagedFrameId ? promoted : undefined);
          if (
            !reusable ||
            !Number.isInteger(reusable.sizeBytes) ||
            reusable.sizeBytes < 1 ||
            reusable.sizeBytes > MAX_REPLAY_SCREENSHOT_BYTES
          ) {
            fail(
              "A staged screenshot is missing or its stored size is invalid. Restage the frame in this Design and retry.",
              {
                errorCode: "journey_staged_frame_not_found",
                statusCode: 404,
              },
            );
          }
          stagedImageBytes += reusable.sizeBytes;
        }
      }
      if (stagedImageBytes > MAX_TOTAL_IMAGE_BYTES) {
        fail("The journey screenshots exceed 256 MiB in total.", {
          errorCode: "journey_screenshots_too_large",
          statusCode: 413,
        });
      }
      const preflightedSourceAttachments = new Map<
        string,
        { sizeBytes: number; sha256: string }
      >();
      let preflightedSourceImageBytes = 0;
      for (let index = 0; index < sourceAttachmentScreens.length; ) {
        const remainingImageBytes =
          MAX_TOTAL_IMAGE_BYTES -
          stagedImageBytes -
          preflightedSourceImageBytes;
        const batchSize = Math.max(
          1,
          Math.min(
            UPLOAD_CONCURRENCY,
            Math.floor(remainingImageBytes / MAX_REPLAY_SCREENSHOT_BYTES),
          ),
        );
        const batch = sourceAttachmentScreens.slice(index, index + batchSize);
        const resolved = await Promise.all(
          batch.map(async ({ attachment }) => ({
            rowId: attachment!.rowId,
            data: await resolveAttachmentScreenshotBytes({
              attachmentRef: attachment!.ref!,
              requesterEmail,
            }),
          })),
        );
        const batchBytes = resolved.reduce(
          (total, frame) => total + frame.data.byteLength,
          0,
        );
        if (
          stagedImageBytes + preflightedSourceImageBytes + batchBytes >
          MAX_TOTAL_IMAGE_BYTES
        ) {
          fail("The journey screenshots exceed 256 MiB in total.", {
            errorCode: "journey_screenshots_too_large",
            statusCode: 413,
          });
        }
        for (const frame of resolved) {
          preflightedSourceAttachments.set(frame.rowId, {
            sizeBytes: frame.data.byteLength,
            sha256: digest(frame.data),
          });
        }
        preflightedSourceImageBytes += batchBytes;
        index += batch.length;
      }
      let uploadedImageBytes = 0;
      for (const batch of chunks(sourceAttachmentScreens, UPLOAD_CONCURRENCY)) {
        const resolved = await Promise.all(
          batch.map(async ({ attachment }) => ({
            attachment: attachment!,
            data: await resolveAttachmentScreenshotBytes({
              attachmentRef: attachment!.ref!,
              requesterEmail,
            }),
          })),
        );
        const batchBytes = resolved.reduce(
          (total, frame) => total + frame.data.byteLength,
          0,
        );
        const changedAttachment = resolved.find(({ attachment, data }) => {
          const preflight = preflightedSourceAttachments.get(attachment.rowId);
          return (
            !preflight ||
            preflight.sizeBytes !== data.byteLength ||
            preflight.sha256 !== digest(data)
          );
        });
        if (
          changedAttachment ||
          stagedImageBytes + uploadedImageBytes + batchBytes >
            MAX_TOTAL_IMAGE_BYTES
        ) {
          fail(
            changedAttachment
              ? "A screenshot attachment changed after preflight. Retry with a stable private attachment."
              : "The journey screenshots exceed 256 MiB in total.",
            {
              errorCode: changedAttachment
                ? "journey_attachment_changed_after_preflight"
                : "journey_screenshots_too_large",
              statusCode: changedAttachment ? 409 : 413,
            },
          );
        }
        const results = await Promise.allSettled(
          resolved.map(async ({ attachment, data }) => {
            const blob = await storeReplayScreenshotBytesAsPrivateBlob({
              data,
              blobOwnerEmail,
              providerId:
                storage?.kind === "private-provider"
                  ? storage.providerId
                  : undefined,
              rowId: attachment!.rowId,
              designId,
              replayId: attachment!.replayId,
            });
            stored.set(attachment!.rowId, blob);
            newlyStored.set(attachment!.rowId, blob);
          }),
        );
        const rejected = results.find((result) => result.status === "rejected");
        if (rejected) throw rejected.reason;
        uploadedImageBytes += batchBytes;
      }

      if (!input.designId) {
        const created = await createDesign.run(
          {
            id: designId,
            title: input.title,
            description: `Onboarding journey for ${input.tree.app}, ${input.tree.window.from} to ${input.tree.window.to}.`,
            projectType: "prototype",
            designSystemId: null,
          },
          context,
        );
        if (created.id !== designId) {
          // guard:allow-bare-error — invariant: a create action must return its requested ID.
          throw new Error("Design creation returned an unexpected ID.");
        }
        createdDesignId = created.id;
      }

      const access = await assertAccess("design", designId, "editor");
      const design = access.resource as typeof schema.designs.$inferSelect;
      const board = await migrateBoardObjectsToFile.run({ designId }, context);
      boardFileId = board.boardFileId;
      const [boardFile] = await db
        .select({
          id: schema.designFiles.id,
          designId: schema.designFiles.designId,
          filename: schema.designFiles.filename,
          fileType: schema.designFiles.fileType,
          content: schema.designFiles.content,
          createdAt: schema.designFiles.createdAt,
          updatedAt: schema.designFiles.updatedAt,
        })
        .from(schema.designFiles)
        .where(
          and(
            eq(schema.designFiles.id, board.boardFileId),
            eq(schema.designFiles.designId, designId),
            eq(schema.designFiles.filename, BOARD_FILENAME),
          ),
        )
        .limit(1);
      if (!boardFile) {
        // guard:allow-bare-error — invariant: board migration must return a persisted board file.
        throw new Error("The Design board file was not created.");
      }
      const liveBoard = await readLiveSourceFile(
        boardFile as SourceWorkspaceFile,
      );
      previousBoardContent = liveBoard.content;
      nextBoardContent = liveBoard.content;

      let origin = { x: 0, y: 0 };
      let lockedBoardContent = liveBoard.content;
      const ownBlobHandles = new Set<string>();
      const now = new Date().toISOString();
      mutationStarted = true;
      await mutateDesignData({
        designId,
        lockSourceMutation: true,
        mutate: (current, { updatedAt }) => {
          mutationUpdatedAt = updatedAt;
          const frames = withoutJourneyEntries(current.canvasFrames);
          // A refresh redraws in place; only a first draw goes below existing content.
          const previous = current.journeyCanvasOrigin;
          origin =
            isRecord(previous) &&
            typeof previous.x === "number" &&
            typeof previous.y === "number"
              ? { x: previous.x, y: previous.y }
              : {
                  x: 0,
                  y: nextFreeCanvasRowY(frames, EXISTING_CONTENT_GAP),
                };
          const placedFrames = Object.fromEntries(
            plan.screens.map((screen) => [
              screen.fileId,
              {
                x: screen.frame.x + origin.x,
                y: screen.frame.y + origin.y,
                width: screen.frame.width,
                height: screen.frame.height,
                z: screen.frame.z,
              },
            ]),
          );
          const metadata = Object.fromEntries(
            plan.screens.map((screen) => [
              screen.fileId,
              {
                title: screen.title,
                width: screen.frame.width,
                height: screen.frame.height,
                breakpointWidths: [],
                heightPinned: true,
                heightMode: "fixed",
                ...(screen.provenance
                  ? { journeyExample: screen.provenance }
                  : {}),
              },
            ]),
          );
          return {
            ...current,
            journeyCanvasOrigin: origin,
            canvasFrames: { ...frames, ...placedFrames },
            screenMetadata: {
              ...withoutJourneyEntries(current.screenMetadata),
              ...metadata,
            },
          };
        },
        mutateFiles: (_current, _next, { files }) => {
          const lockedBoard = files.find((file) => file.id === boardFile.id);
          if (!lockedBoard) {
            // guard:allow-bare-error — invariant: the board file was just read from this design.
            throw new Error(
              "The Design board file disappeared before the write.",
            );
          }
          lockedBoardContent = lockedBoard.content;
          nextBoardContent = replaceJourneyBoardObjects(
            liveBoard.content,
            plan.boardFragments(origin),
          );
          return [{ fileId: boardFile.id, content: nextBoardContent }];
        },
        mutateInTransaction: async (tx) => {
          // The replacement board was built from the pre-lock read; an edit
          // committed since then would be lost, so refuse instead of writing.
          const lockedLive = await readLiveSourceFile({
            ...boardFile,
            content: lockedBoardContent,
          } as SourceWorkspaceFile);
          if (lockedLive.content !== liveBoard.content) {
            fail(
              "The Design board changed while the journey was being drawn. No journey content was written; run the action again.",
              { errorCode: "journey_board_changed", statusCode: 409 },
            );
          }
          for (const { attachment } of stagedScreens) {
            stored.delete(attachment!.rowId);
            stagedSourceAppByRowId.delete(attachment!.rowId);
          }
          if (stagedScreens.length > 0) {
            const stagedFrameIds = stagedScreens.map(
              ({ attachment }) => attachment!.stagedFrameId!,
            );
            const stagedRows = await tx
              .select({
                id: schema.designBoardReplayScreenshots.id,
                app: schema.designBoardReplayScreenshots.app,
                route: schema.designBoardReplayScreenshots.route,
                captureSourceFingerprint:
                  schema.designBoardReplayScreenshots.captureSourceFingerprint,
                replayId: schema.designBoardReplayScreenshots.replayId,
                capturedAt: schema.designBoardReplayScreenshots.capturedAt,
                offsetMs: schema.designBoardReplayScreenshots.offsetMs,
                viewportWidth:
                  schema.designBoardReplayScreenshots.viewportWidth,
                viewportHeight:
                  schema.designBoardReplayScreenshots.viewportHeight,
                mimeType: schema.designBoardReplayScreenshots.mimeType,
                sizeBytes: schema.designBoardReplayScreenshots.sizeBytes,
                blobHandle: schema.designBoardReplayScreenshots.blobHandle,
                createdAt: schema.designBoardReplayScreenshots.createdAt,
                sourceStageId:
                  schema.designBoardReplayScreenshots.sourceStageId,
              })
              .from(schema.designBoardReplayScreenshots)
              .where(
                and(
                  eq(schema.designBoardReplayScreenshots.designId, designId),
                  inArray(
                    schema.designBoardReplayScreenshots.id,
                    stagedFrameIds,
                  ),
                  like(
                    schema.designBoardReplayScreenshots.id,
                    likePrefix(JOURNEY_STAGED_REPLAY_ROW_PREFIX),
                  ),
                ),
              )
              .for("update");
            const finalFrameIds = stagedScreens.map(
              ({ attachment }) => attachment!.rowId,
            );
            const promotedRows = await tx
              .select({
                id: schema.designBoardReplayScreenshots.id,
                app: schema.designBoardReplayScreenshots.app,
                route: schema.designBoardReplayScreenshots.route,
                captureSourceFingerprint:
                  schema.designBoardReplayScreenshots.captureSourceFingerprint,
                replayId: schema.designBoardReplayScreenshots.replayId,
                capturedAt: schema.designBoardReplayScreenshots.capturedAt,
                offsetMs: schema.designBoardReplayScreenshots.offsetMs,
                viewportWidth:
                  schema.designBoardReplayScreenshots.viewportWidth,
                viewportHeight:
                  schema.designBoardReplayScreenshots.viewportHeight,
                mimeType: schema.designBoardReplayScreenshots.mimeType,
                sizeBytes: schema.designBoardReplayScreenshots.sizeBytes,
                blobHandle: schema.designBoardReplayScreenshots.blobHandle,
                sourceStageId:
                  schema.designBoardReplayScreenshots.sourceStageId,
              })
              .from(schema.designBoardReplayScreenshots)
              .where(
                and(
                  eq(schema.designBoardReplayScreenshots.designId, designId),
                  inArray(
                    schema.designBoardReplayScreenshots.id,
                    finalFrameIds,
                  ),
                  like(
                    schema.designBoardReplayScreenshots.id,
                    likePrefix(JOURNEY_REPLAY_ROW_PREFIX),
                  ),
                ),
              )
              .for("update");
            const stagedById = new Map(stagedRows.map((row) => [row.id, row]));
            const promotedById = new Map(
              promotedRows.map((row) => [row.id, row]),
            );
            for (const screen of stagedScreens) {
              const attachment = screen.attachment!;
              const stagedFrameId = attachment.stagedFrameId!;
              const stagedRow = stagedById.get(stagedFrameId);
              const row = stagedRow ?? promotedById.get(attachment.rowId);
              if (stagedRow) {
                const createdAtMs = stagedRow.createdAt
                  ? Date.parse(stagedRow.createdAt)
                  : Number.NaN;
                if (
                  !Number.isFinite(createdAtMs) ||
                  Date.now() - createdAtMs >= JOURNEY_STAGED_REPLAY_MAX_AGE_MS
                ) {
                  fail(
                    "This staged screenshot expired after 7 days. Restage it in this Design before drawing the journey.",
                    {
                      errorCode: "journey_staged_frame_expired",
                      statusCode: 410,
                    },
                  );
                }
              }
              const expectedApp = journeyFrameSourceApp(
                screen.nodeKey,
                input.tree.app,
                attachment.sourceApp,
              );
              if (!row || !expectedApp) {
                fail(
                  "A staged screenshot is missing or its journey node does not identify a source app. Restage the frame in this Design and retry.",
                  {
                    errorCode: "journey_staged_frame_not_found",
                    statusCode: 404,
                  },
                );
              }
              const frameKey = `${screen.nodeKey}\u0000${screen.exampleIndex}`;
              const marker = stagedRow ? parseStageMarker(row.app) : null;
              const stagedIdentityMatches = stagedRow
                ? Boolean(
                    marker &&
                    marker.app === expectedApp &&
                    marker.frameKeyHash === digest(frameKey) &&
                    stageRowId(designId, marker.importId, frameKey) ===
                      stagedFrameId,
                  )
                : row.sourceStageId === stagedFrameId &&
                  row.app === expectedApp;
              const handle = parseStagedBlobHandle(row.blobHandle);
              if (
                !stagedIdentityMatches ||
                row.route !== attachment.route ||
                row.captureSourceFingerprint !==
                  attachment.captureSourceFingerprint ||
                row.replayId !== attachment.replayId ||
                row.capturedAt !== attachment.capturedAt ||
                row.offsetMs !== attachment.offsetMs ||
                row.viewportWidth !== attachment.width ||
                row.viewportHeight !== attachment.height ||
                row.mimeType !== "image/png" ||
                !handle
              ) {
                fail(
                  "A staged or promoted screenshot failed its Design, frame identity, provenance, or blob-handle checks. Restage the frame in this Design and retry.",
                  {
                    errorCode: "journey_staged_frame_invalid",
                    statusCode: 409,
                  },
                );
              }
              stored.set(attachment.rowId, {
                blobHandle: handle,
                mimeType: "image/png",
                sizeBytes: row.sizeBytes,
              });
              stagedSourceAppByRowId.set(attachment.rowId, expectedApp);
            }
          }
          const totalBytes = [...stored.values()].reduce(
            (sum, blob) => sum + blob.sizeBytes,
            0,
          );
          if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
            fail("The journey screenshots exceed 256 MiB in total.", {
              errorCode: "journey_screenshots_too_large",
              statusCode: 413,
            });
          }
          ownBlobHandles.clear();
          for (const blob of stored.values()) {
            ownBlobHandles.add(JSON.stringify(blob.blobHandle));
          }
          const staleFiles = await tx
            .select({ id: schema.designFiles.id })
            .from(schema.designFiles)
            .where(
              and(
                eq(schema.designFiles.designId, designId),
                like(schema.designFiles.id, likePrefix(JOURNEY_FILE_ID_PREFIX)),
                like(
                  schema.designFiles.filename,
                  likePrefix(JOURNEY_FILENAME_PREFIX),
                ),
              ),
            );
          const staleRows = await tx
            .select({
              id: schema.designBoardReplayScreenshots.id,
              blobHandle: schema.designBoardReplayScreenshots.blobHandle,
            })
            .from(schema.designBoardReplayScreenshots)
            .where(
              and(
                eq(schema.designBoardReplayScreenshots.designId, designId),
                like(
                  schema.designBoardReplayScreenshots.id,
                  likePrefix(JOURNEY_REPLAY_ROW_PREFIX),
                ),
              ),
            );
          // A retried attempt finds this run's own rows; their blobs stay.
          removedBlobHandles = staleRows
            .map((row) => row.blobHandle)
            .filter((handle) => !ownBlobHandles.has(handle));
          await queueVisualEditSnapshotBlobCleanupInTransaction(
            tx,
            removedBlobHandles,
          );
          if (staleRows.length) {
            await tx.delete(schema.designBoardReplayScreenshots).where(
              and(
                eq(schema.designBoardReplayScreenshots.designId, designId),
                inArray(
                  schema.designBoardReplayScreenshots.id,
                  staleRows.map((row) => row.id),
                ),
              ),
            );
          }
          if (stagedScreens.length) {
            await tx.delete(schema.designBoardReplayScreenshots).where(
              and(
                eq(schema.designBoardReplayScreenshots.designId, designId),
                inArray(
                  schema.designBoardReplayScreenshots.id,
                  stagedScreens.map(
                    ({ attachment }) => attachment!.stagedFrameId!,
                  ),
                ),
              ),
            );
          }
          if (staleFiles.length) {
            await tx.delete(schema.designFiles).where(
              and(
                eq(schema.designFiles.designId, designId),
                inArray(
                  schema.designFiles.id,
                  staleFiles.map((file) => file.id),
                ),
              ),
            );
          }
          for (const batch of chunks(plan.screens, INSERT_CHUNK)) {
            await tx.insert(schema.designFiles).values(
              batch.map((screen) => ({
                id: screen.fileId,
                designId,
                filename: screen.filename,
                fileType: "html",
                content: screen.html,
                contentOperationSource: null,
                contentOperationRevision: null,
                contentOperationResultHash: null,
                createdAt: now,
                updatedAt: now,
              })),
            );
          }
          for (const batch of chunks(attachmentScreens, INSERT_CHUNK)) {
            await tx.insert(schema.designBoardReplayScreenshots).values(
              batch.map(({ attachment }) => {
                const blob = stored.get(attachment!.rowId)!;
                return {
                  id: attachment!.rowId,
                  designId,
                  boardFileId: boardFile.id,
                  replayId: attachment!.replayId,
                  capturedAt: attachment!.capturedAt,
                  app:
                    stagedSourceAppByRowId.get(attachment!.rowId) ??
                    attachment!.sourceApp ??
                    input.tree.app,
                  route: attachment!.route,
                  captureSourceFingerprint:
                    attachment!.captureSourceFingerprint,
                  offsetMs: attachment!.offsetMs,
                  viewportWidth: attachment!.width,
                  viewportHeight: attachment!.height,
                  eventCount: 0,
                  mimeType: blob.mimeType,
                  sizeBytes: blob.sizeBytes,
                  blobHandle: JSON.stringify(blob.blobHandle),
                  sourceStageId: attachment!.stagedFrameId ?? null,
                  createdAt: now,
                  visibility: design.visibility,
                  ownerEmail: design.ownerEmail,
                  orgId: design.orgId,
                };
              }),
            );
          }
        },
        isApplied: (persistedData) => {
          const frames = isRecord(persistedData.canvasFrames)
            ? persistedData.canvasFrames
            : {};
          return plan.screens.every((screen) => {
            const frame = frames[screen.fileId];
            return isRecord(frame) && frame.width === screen.frame.width;
          });
        },
      });

      const collabSyncPending = await reconcileCollaboration({
        boardFileId: boardFile.id,
        previousBoardContent,
        nextBoardContent: nextBoardContent!,
        screens: plan.screens,
      });
      if (removedBlobHandles.length) {
        try {
          await deleteVisualEditSnapshotBlobs(removedBlobHandles);
        } catch (error) {
          console.warn(
            "[design-journey-canvas] Replaced screenshot cleanup remains queued:",
            error,
          );
        }
      }

      return {
        designId,
        url: designDeepLink(designId),
        nodeCount: plan.nodeCount,
        frameCount: plan.frameCount,
        skippedNodes: plan.skippedNodes,
        collabSyncPending,
      };
    } catch (error) {
      const landingStatus = mutationStarted
        ? await writeMayHaveLanded({
            designId,
            updatedAt: mutationUpdatedAt,
            screens: plan.screens.map((screen) => {
              const attachment = screen.attachment;
              const blob = attachment
                ? stored.get(attachment.rowId)
                : undefined;
              return {
                fileId: screen.fileId,
                html: screen.html,
                ...(attachment
                  ? {
                      screenshot: {
                        rowId: attachment.rowId,
                        blobHandle: blob
                          ? JSON.stringify(blob.blobHandle)
                          : null,
                      },
                    }
                  : {}),
              };
            }),
          })
        : "not_landed";
      if (landingStatus === "landed") {
        if (
          !boardFileId ||
          previousBoardContent === undefined ||
          nextBoardContent === undefined
        ) {
          console.warn(
            "[design-journey-canvas] The storyboard rows landed but collaboration inputs are unavailable; preserving the saved Design.",
          );
          throw error;
        }
        const collabSyncPending = await reconcileCollaboration({
          boardFileId,
          previousBoardContent,
          nextBoardContent,
          screens: plan.screens.map(({ fileId, html }) => ({ fileId, html })),
        });
        if (removedBlobHandles.length) {
          try {
            await deleteVisualEditSnapshotBlobs(removedBlobHandles);
          } catch (cleanupError) {
            console.warn(
              "[design-journey-canvas] Replaced screenshot cleanup remains queued:",
              cleanupError,
            );
          }
        }
        return {
          designId,
          url: designDeepLink(designId),
          nodeCount: plan.nodeCount,
          frameCount: plan.frameCount,
          skippedNodes: plan.skippedNodes,
          collabSyncPending,
        };
      }
      if (landingStatus === "not_landed" || landingStatus === "unknown") {
        const blobCleanup = await findUnreferencedStoredBlobs({
          designId,
          ownerEmail: blobOwnerEmail,
          blobs: [...newlyStored.values()],
        });
        if (
          blobCleanup.verified &&
          !blobCleanup.hasReferences &&
          landingStatus === "not_landed" &&
          createdDesignId
        ) {
          try {
            await deleteDesign.run({ id: createdDesignId }, context);
          } catch (cleanupError) {
            console.warn(
              "[design-journey-canvas] Newly created Design cleanup failed:",
              cleanupError,
            );
          }
        }
        if (blobCleanup.verified && blobCleanup.unreferenced.length) {
          await discardPrivateBlobs(
            blobCleanup.unreferenced.map((blob) => blob.blobHandle),
          );
        }
      }
      throw error;
    }
  },
  changeResource: (_input, result) =>
    designChangeResource((result as { designId?: string }).designId, result),
  link: ({ result }) => {
    const { url } = (result ?? {}) as { url?: string };
    return url
      ? { url, label: "Open journey storyboard", view: "editor" }
      : null;
  },
});

async function findUnreferencedStoredBlobs(args: {
  designId: string;
  ownerEmail: string;
  blobs: readonly StoredReplayScreenshotBlob[];
}): Promise<{
  verified: boolean;
  hasReferences: boolean;
  unreferenced: StoredReplayScreenshotBlob[];
}> {
  const blobsByHandle = new Map(
    args.blobs.map((blob) => [JSON.stringify(blob.blobHandle), blob]),
  );
  if (blobsByHandle.size === 0) {
    return { verified: true, hasReferences: false, unreferenced: [] };
  }
  try {
    const rows = await getDb()
      .select({ blobHandle: schema.designBoardReplayScreenshots.blobHandle })
      .from(schema.designBoardReplayScreenshots)
      .where(
        and(
          eq(schema.designBoardReplayScreenshots.designId, args.designId),
          eq(schema.designBoardReplayScreenshots.ownerEmail, args.ownerEmail),
          inArray(schema.designBoardReplayScreenshots.blobHandle, [
            ...blobsByHandle.keys(),
          ]),
        ),
      );
    const referencedHandles = new Set(rows.map((row) => row.blobHandle));
    return {
      verified: true,
      hasReferences: referencedHandles.size > 0,
      unreferenced: [...blobsByHandle]
        .filter(([handle]) => !referencedHandles.has(handle))
        .map(([, blob]) => blob),
    };
  } catch (error) {
    console.warn(
      "[design-journey-canvas] Could not verify newly uploaded screenshot references; keeping uploaded blobs:",
      error,
    );
    return { verified: false, hasReferences: false, unreferenced: [] };
  }
}

/** Unknown verification must preserve resources but cannot turn the failed write into success. */
async function writeMayHaveLanded(args: {
  designId: string;
  updatedAt: string | undefined;
  screens: readonly {
    fileId: string;
    html: string;
    screenshot?: { rowId: string; blobHandle: string | null };
  }[];
}): Promise<"landed" | "not_landed" | "unknown"> {
  try {
    await assertAccess("design", args.designId, "editor");
    const db = getDb();
    const [design] = await db
      .select({ updatedAt: schema.designs.updatedAt })
      .from(schema.designs)
      .where(
        and(
          accessFilter(schema.designs, schema.designShares),
          eq(schema.designs.id, args.designId),
        ),
      )
      .limit(1);
    const designVersionMatches =
      args.updatedAt !== undefined && design?.updatedAt === args.updatedAt;
    const files = await db
      .select({
        id: schema.designFiles.id,
        content: schema.designFiles.content,
      })
      .from(schema.designFiles)
      .where(
        and(
          eq(schema.designFiles.designId, args.designId),
          inArray(
            schema.designFiles.id,
            args.screens.map(({ fileId }) => fileId),
          ),
        ),
      );
    const filesById = new Map(files.map((file) => [file.id, file.content]));
    const filesMatch = args.screens.every(
      (screen) => filesById.get(screen.fileId) === screen.html,
    );
    const anyScreenFound = args.screens.some((screen) =>
      filesById.has(screen.fileId),
    );

    const expectedScreenshots = args.screens.flatMap(({ screenshot }) =>
      screenshot ? [screenshot] : [],
    );
    let screenshotsMatch = true;
    let expectedHandleStillReferenced = false;
    if (expectedScreenshots.length) {
      const rows = await db
        .select({
          id: schema.designBoardReplayScreenshots.id,
          blobHandle: schema.designBoardReplayScreenshots.blobHandle,
        })
        .from(schema.designBoardReplayScreenshots)
        .where(
          and(
            eq(schema.designBoardReplayScreenshots.designId, args.designId),
            inArray(
              schema.designBoardReplayScreenshots.id,
              expectedScreenshots.map(({ rowId }) => rowId),
            ),
          ),
        );
      const rowsById = new Map(rows.map((row) => [row.id, row.blobHandle]));
      screenshotsMatch = expectedScreenshots.every(
        ({ rowId, blobHandle }) =>
          blobHandle !== null && rowsById.get(rowId) === blobHandle,
      );
      expectedHandleStillReferenced = expectedScreenshots.some(
        ({ rowId, blobHandle }) =>
          blobHandle !== null && rowsById.get(rowId) === blobHandle,
      );
      if (!screenshotsMatch && !expectedHandleStillReferenced) {
        const expectedHandles = expectedScreenshots.flatMap(({ blobHandle }) =>
          blobHandle ? [blobHandle] : [],
        );
        if (expectedHandles.length) {
          const references = await db
            .select({
              blobHandle: schema.designBoardReplayScreenshots.blobHandle,
            })
            .from(schema.designBoardReplayScreenshots)
            .where(
              and(
                eq(schema.designBoardReplayScreenshots.designId, args.designId),
                inArray(
                  schema.designBoardReplayScreenshots.blobHandle,
                  expectedHandles,
                ),
              ),
            );
          expectedHandleStillReferenced = references.length > 0;
        }
      }
    }
    if (designVersionMatches && filesMatch && screenshotsMatch) {
      return "landed";
    }
    if (anyScreenFound || expectedHandleStillReferenced) {
      return "unknown";
    }
    return "not_landed";
  } catch (error) {
    console.warn(
      "[design-journey-canvas] Could not tell whether the write landed; keeping the design and screenshots:",
      error,
    );
    return "unknown";
  }
}

/**
 * The SQL rows are already committed; this brings the live Yjs documents in
 * line with them. A failure here is logged and returned as the file ids still
 * pending, never thrown: the storyboard is saved and the editor reseeds an
 * unseeded document from SQL on open.
 */
async function reconcileCollaboration(args: {
  boardFileId: string;
  previousBoardContent: string;
  nextBoardContent: string;
  screens: readonly { fileId: string; html: string }[];
}): Promise<string[]> {
  const pending: string[] = [];
  try {
    if (await hasCollabState(args.boardFileId)) {
      await applyText(
        args.boardFileId,
        args.nextBoardContent,
        "content",
        "agent",
        {
          validateBase: (base) => {
            if (base !== args.previousBoardContent) {
              // guard:allow-bare-error — invariant: refuse to merge into a board edited since we read it.
              throw new Error(
                "Live board content changed before the journey canvas was written.",
              );
            }
          },
        },
      );
    } else {
      await seedFromText(args.boardFileId, args.nextBoardContent);
    }
  } catch (error) {
    pending.push(args.boardFileId);
    console.warn(
      "[design-journey-canvas] Board saved but collaboration reconcile is pending:",
      error,
    );
  }
  for (const batch of chunks(args.screens, UPLOAD_CONCURRENCY)) {
    const results = await Promise.allSettled(
      // Refresh reuses screen ids, and seedFromText skips a document that
      // already has state, so a live document must be updated in place.
      batch.map(async (screen) => {
        if (await hasCollabState(screen.fileId)) {
          await applyText(screen.fileId, screen.html, "content", "agent");
        } else {
          await seedFromText(screen.fileId, screen.html);
        }
      }),
    );
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        pending.push(batch[index]!.fileId);
        console.warn(
          "[design-journey-canvas] Screen saved but collaboration sync is pending:",
          result.reason,
        );
      }
    });
  }
  return pending;
}
