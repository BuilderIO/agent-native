/**
 * Create a new recording row in 'uploading' status.
 *
 * Returns the new recording id plus a chunk upload URL template the
 * frontend fills in per-chunk. The chunk route accepts a binary body
 * with query params index/total/isFinal and calls finalize when isFinal=true.
 *
 * Usage:
 *   pnpm action create-recording --title="Quick demo"
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import {
  getCurrentOwnerEmail,
  nanoid,
  requireOrganizationAccess,
} from "../server/lib/recordings.js";
import { writeAppState } from "@agent-native/core/application-state";

const cliBoolean = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((value) => value === true || value === "true");

export default defineAction({
  description:
    "Create a new recording row in 'uploading' status and return its id plus the chunk upload URL template. The frontend POSTs chunks to /api/uploads/:id/chunk?index=N&total=T&isFinal=0|1, then finalizes on the last chunk.",
  schema: z.object({
    id: z
      .string()
      .optional()
      .describe("Pre-generated recording ID (for optimistic UI)"),
    title: z
      .string()
      .optional()
      .describe("Recording title (defaults to 'Untitled recording')"),
    folderId: z.string().nullish().describe("Optional folder ID"),
    organizationId: z
      .string()
      .optional()
      .describe(
        "Organization the recording belongs to (defaults to the caller's active org)",
      ),
    hasCamera: z
      .union([z.boolean(), cliBoolean])
      .optional()
      .describe("Whether the recording includes a camera track"),
    hasAudio: z
      .union([z.boolean(), cliBoolean])
      .optional()
      .describe("Whether the recording includes an audio track"),
    width: z.coerce
      .number()
      .optional()
      .describe("Width of the recording in pixels (may be 0 until finalized)"),
    height: z.coerce
      .number()
      .optional()
      .describe("Height of the recording in pixels (may be 0 until finalized)"),
    visibility: z
      .enum(["private", "org", "public"])
      .optional()
      .describe("Initial share visibility for the recording"),
  }),
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const id = args.id || nanoid();
    const now = new Date().toISOString();

    const { organizationId } = await requireOrganizationAccess(
      args.organizationId,
    );

    await db.insert(schema.recordings).values({
      id,
      organizationId,
      orgId: organizationId,
      folderId: args.folderId ?? null,
      title: args.title?.trim() || "Untitled recording",
      status: "uploading",
      uploadProgress: 0,
      hasAudio: args.hasAudio ?? true,
      hasCamera: args.hasCamera ?? false,
      visibility: args.visibility ?? "private",
      width: args.width ?? 0,
      height: args.height ?? 0,
      ownerEmail,
      createdAt: now,
      updatedAt: now,
    });

    await writeAppState("refresh-signal", { ts: Date.now() });
    await writeAppState(`recording-upload-${id}`, {
      recordingId: id,
      status: "uploading",
      progress: 0,
      startedAt: now,
    });

    console.log(
      `Created recording "${args.title ?? "Untitled recording"}" (${id})`,
    );

    return {
      id,
      organizationId,
      status: "uploading" as const,
      uploadChunkUrl: `/api/uploads/${id}/chunk`,
      abortUrl: `/api/uploads/${id}/abort`,
      // Frontend substitutes {index}/{total}/{isFinal}
      uploadChunkUrlTemplate: `/api/uploads/${id}/chunk?index={index}&total={total}&isFinal={isFinal}`,
    };
  },
});
