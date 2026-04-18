import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import {
  getCurrentOwnerEmail,
  nanoid,
  resolveDefaultWorkspaceId,
} from "../server/lib/calls.js";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Create a new call row in 'uploading' status and return its id plus the chunk upload URL template. The frontend POSTs chunks to /api/uploads/:id/chunk?index=N&total=T&isFinal=0|1, then finalizes on the last chunk.",
  schema: z.object({
    id: z
      .string()
      .optional()
      .describe("Pre-generated call ID (for optimistic UI)"),
    title: z
      .string()
      .optional()
      .describe("Call title (defaults to 'Untitled call')"),
    folderId: z.string().nullish().describe("Optional folder ID"),
    workspaceId: z
      .string()
      .optional()
      .describe("Workspace the call belongs to (defaults to the user's first)"),
    source: z
      .enum(["upload", "browser", "recall-bot", "zoom-cloud"])
      .default("upload")
      .describe("Where the call came from"),
    mediaKind: z
      .enum(["video", "audio"])
      .default("video")
      .describe("Video or audio-only"),
    mediaFormat: z
      .string()
      .optional()
      .describe("Media container format (e.g. mp4, webm, m4a)"),
    recordedAt: z
      .string()
      .optional()
      .describe("ISO timestamp the meeting was recorded at"),
    accountId: z
      .string()
      .nullish()
      .describe("Optional account (CRM-lite) id to tag this call with"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const id = args.id || nanoid();
    const now = new Date().toISOString();

    const workspaceId = args.workspaceId || (await resolveDefaultWorkspaceId());

    await db.insert(schema.calls).values({
      id,
      workspaceId,
      folderId: args.folderId ?? null,
      title: args.title?.trim() || "Untitled call",
      source: args.source,
      mediaKind: args.mediaKind,
      mediaFormat: args.mediaFormat ?? (args.mediaKind === "audio" ? "m4a" : "mp4"),
      recordedAt: args.recordedAt ?? null,
      accountId: args.accountId ?? null,
      status: "uploading",
      progressPct: 0,
      ownerEmail,
      createdAt: now,
      updatedAt: now,
    });

    await writeAppState("refresh-signal", { ts: Date.now() });
    await writeAppState(`call-upload-${id}`, {
      callId: id,
      status: "uploading",
      progress: 0,
      startedAt: now,
    });

    console.log(`Created call "${args.title ?? "Untitled call"}" (${id})`);

    return {
      id,
      workspaceId,
      status: "uploading" as const,
      uploadChunkUrl: `/api/uploads/${id}/chunk`,
      abortUrl: `/api/uploads/${id}/abort`,
      uploadChunkUrlTemplate: `/api/uploads/${id}/chunk?index={index}&total={total}&isFinal={isFinal}`,
    };
  },
});
