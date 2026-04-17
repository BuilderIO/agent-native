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
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail, nanoid } from "../server/lib/recordings.js";
import { writeAppState } from "@agent-native/core/application-state";

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
    workspaceId: z
      .string()
      .optional()
      .describe("Workspace the recording belongs to (defaults to first)"),
    hasCamera: z
      .boolean()
      .optional()
      .describe("Whether the recording includes a camera track"),
    hasAudio: z
      .boolean()
      .optional()
      .describe("Whether the recording includes an audio track"),
    width: z
      .number()
      .optional()
      .describe("Width of the recording in pixels (may be 0 until finalized)"),
    height: z
      .number()
      .optional()
      .describe("Height of the recording in pixels (may be 0 until finalized)"),
  }),
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const id = args.id || nanoid();
    const now = new Date().toISOString();

    // Resolve workspace id (fall back to first workspace owned by this user,
    // or create an implicit one if none exists yet).
    let workspaceId = args.workspaceId || null;
    if (!workspaceId) {
      const [existing] = await db
        .select({ id: schema.workspaces.id })
        .from(schema.workspaces)
        .where(eq(schema.workspaces.ownerEmail, ownerEmail))
        .limit(1);
      if (existing) {
        workspaceId = existing.id;
      } else {
        workspaceId = nanoid();
        await db.insert(schema.workspaces).values({
          id: workspaceId,
          name: "My Workspace",
          slug: `ws-${workspaceId.slice(0, 6).toLowerCase()}`,
          ownerEmail,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    await db.insert(schema.recordings).values({
      id,
      workspaceId,
      folderId: args.folderId ?? null,
      title: args.title?.trim() || "Untitled recording",
      status: "uploading",
      uploadProgress: 0,
      hasAudio: args.hasAudio ?? true,
      hasCamera: args.hasCamera ?? false,
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
      workspaceId,
      status: "uploading" as const,
      uploadChunkUrl: `/api/uploads/${id}/chunk`,
      abortUrl: `/api/uploads/${id}/abort`,
      // Frontend substitutes {index}/{total}/{isFinal}
      uploadChunkUrlTemplate: `/api/uploads/${id}/chunk?index={index}&total={total}&isFinal={isFinal}`,
    };
  },
});
