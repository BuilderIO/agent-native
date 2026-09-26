/**
 * Create a screenshot: one still image stored as a `kind='image'` recording.
 *
 * Unlike a video there is nothing to stream, so this is a single call — the
 * browser captures a frame, encodes it, and posts the bytes as a data URL. The
 * server does the upload itself (rather than trusting a client-supplied URL)
 * so `imageUrl` always points at our own storage, then inserts the row already
 * `ready`: no chunked upload, no finalize, no transcript or filmstrip to wait
 * for.
 *
 * The row is an ordinary recording in every other respect, which is the point:
 * it lands in the same library and inherits sharing, share passwords, expiry,
 * folders, spaces, tags and comments without new code.
 *
 * Usage:
 *   pnpm action create-screenshot --dataUrl="data:image/jpeg;base64,..." \
 *     --width=2560 --height=1440
 */

import { defineAction } from "@agent-native/core/action";
import {
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { uploadFile } from "@agent-native/core/file-upload";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { IMAGE_EXTENSION_BY_MIME } from "../server/lib/image-signature.js";
import { resolvePlayerThumbnailUrl } from "../server/lib/player-thumbnail-url.js";
import {
  getCurrentOwnerEmail,
  getDefaultRecordingVisibility,
  nanoid,
  ownerEmailMatches,
  requireOrganizationAccess,
  stringifySpaceIds,
} from "../server/lib/recordings.js";
import { STORAGE_SETUP_REQUIRED_REASON } from "../server/lib/video-storage.js";
import { validateRecordingScope } from "./lib/recording-scope.js";
import {
  decodeScreenshotDataUrl,
  MAX_SCREENSHOT_BYTES,
} from "./lib/screenshot-image.js";

export { MAX_SCREENSHOT_BYTES } from "./lib/screenshot-image.js";

export const DEFAULT_SCREENSHOT_TITLE = "Screenshot";

export const createScreenshotSchema = z.object({
  dataUrl: z
    .string()
    .describe("base64 data: URL of the captured image (PNG, JPEG or WebP)"),
  title: z
    .string()
    .optional()
    .describe("Screenshot title (defaults to 'Screenshot')"),
  width: z.coerce
    .number()
    .int()
    .min(1)
    .describe("Captured image width in pixels"),
  height: z.coerce
    .number()
    .int()
    .min(1)
    .describe("Captured image height in pixels"),
  sourceAppName: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .describe("Captured application name, when known"),
  sourceWindowTitle: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .describe("Captured window or browser tab title, when known"),
  folderId: z.string().nullish().describe("Optional folder ID"),
  spaceIds: z
    .array(z.string().min(1))
    .nullish()
    .describe("Space IDs the screenshot should belong to"),
  organizationId: z
    .string()
    .optional()
    .describe(
      "Organization the screenshot belongs to (defaults to the caller's active org)",
    ),
  visibility: z
    .enum(["private", "org", "public"])
    .optional()
    .describe(
      "Initial share visibility. When omitted, uses the organization default.",
    ),
  requestId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,64}$/)
    .optional()
    .describe(
      "Chosen by the client once per capture. A retry with the same id returns the screenshot it already made instead of a second one.",
    ),
});

export default defineAction({
  description:
    "Store a captured screenshot as an image recording and return its id. The image is passed as a base64 data URL; the server uploads it to the configured file storage.",
  // UI-only: the pixels come from the browser's screen picker, which an agent
  // has no way to drive. Still callable from the frontend over HTTP.
  agentTool: false,
  // Base64 one picture, plus room for the marks. The framework checks
  // this against Content-Length before reading; the decode below still caps
  // each picture for a body sent without one.
  maxBodyBytes: Math.ceil((1 * 4 * MAX_SCREENSHOT_BYTES) / 3) + 1024 * 1024,
  schema: createScreenshotSchema,
  run: async (args, actionContext) => {
    const { bytes, mimeType } = decodeScreenshotDataUrl(
      args.dataUrl,
      "Screenshot",
    );

    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();

    // A save whose response was lost looks like a failure to the client,
    // which offers the capture again. The request id is reserved before the
    // upload, so the retry either finds the screenshot it made or makes it
    // under the same id — never a second one.
    const requestKey = args.requestId
      ? `screenshot-request-${args.requestId}`
      : null;
    const reserved = requestKey ? await readAppState(requestKey) : null;
    const reservedId =
      typeof reserved?.id === "string" && reserved.id ? reserved.id : null;
    if (reservedId) {
      const [made] = await db
        .select({
          id: schema.recordings.id,
          organizationId: schema.recordings.organizationId,
          thumbnailUrl: schema.recordings.thumbnailUrl,
          mediaUpdatedAt: schema.recordings.mediaUpdatedAt,
        })
        .from(schema.recordings)
        .where(
          and(
            eq(schema.recordings.id, reservedId),
            ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
          ),
        );
      if (made) {
        return {
          id: made.id,
          organizationId: made.organizationId,
          kind: "image" as const,
          imageUrl: resolvePlayerThumbnailUrl(made),
          status: "ready" as const,
        };
      }
    }
    const id = reservedId ?? nanoid();
    if (requestKey && !reservedId) await writeAppState(requestKey, { id });
    const now = new Date().toISOString();
    const title = args.title?.trim() || DEFAULT_SCREENSHOT_TITLE;

    const { organizationId } = await requireOrganizationAccess(
      args.organizationId,
    );
    const defaultVisibility = await getDefaultRecordingVisibility(
      organizationId,
      actionContext?.userEmail ?? ownerEmail,
    );

    // The same check a new recording gets: the folder has to be the
    // caller's own or in a space, and every space in this organization.
    const spaceIds = await validateRecordingScope(db, {
      organizationId,
      ownerEmail,
      spaceIds: args.spaceIds ?? [],
      folderId: args.folderId,
    });

    // Named for the recording alone: storage keys the object by this name,
    // and the media routes only serve keys under the recording's own id.
    const uploaded = await uploadFile({
      data: bytes,
      mimeType,
      filename: `${id}${IMAGE_EXTENSION_BY_MIME[mimeType]}`,
      ownerEmail,
      recordAsset: false,
    });
    // Fail closed. There is deliberately no "store the data URL instead"
    // fallback: image bytes never belong in an app table, so a deployment
    // without file storage cannot take screenshots at all.
    if (!uploaded?.url) {
      throw new Error(STORAGE_SETUP_REQUIRED_REASON);
    }
    const imageUrl = uploaded.url;

    await db.insert(schema.recordings).values({
      id,
      organizationId,
      orgId: organizationId,
      folderId: args.folderId ?? null,
      spaceIds: stringifySpaceIds(spaceIds),
      title,
      // A screenshot's title comes from what was on screen, so it stays
      // replaceable by a better one later rather than counting as user input.
      titleSource: args.title?.trim() ? "context" : "default",
      sourceAppName: args.sourceAppName?.trim() || null,
      sourceWindowTitle: args.sourceWindowTitle?.trim() || null,
      kind: "image",
      imageUrl,
      // The image is its own thumbnail. Setting a URL also keeps the
      // thumbnail sweeper away: it only looks at rows with none.
      thumbnailUrl: imageUrl,
      thumbnailStatus: "generated",
      // Nothing is uploading, so the row starts where a video ends up. No
      // upload lease either — the reaper only touches uploading/processing.
      status: "ready",
      uploadProgress: 100,
      durationMs: 0,
      videoSizeBytes: bytes.byteLength,
      hasAudio: false,
      hasCamera: false,
      visibility: args.visibility ?? defaultVisibility,
      width: args.width,
      height: args.height,
      ownerEmail,
      createdAt: now,
      updatedAt: now,
      mediaUpdatedAt: now,
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Created screenshot "${title}" (${id})`);

    return {
      id,
      organizationId,
      kind: "image" as const,
      // The gated route, never the storage URL: a caller that kept the raw
      // link would have the picture outside the password, expiry and
      // redaction checks for good.
      imageUrl: resolvePlayerThumbnailUrl({
        id,
        thumbnailUrl: imageUrl,
        mediaUpdatedAt: now,
      }),
      status: "ready" as const,
    };
  },
});
