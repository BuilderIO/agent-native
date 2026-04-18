import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import {
  getCurrentOwnerEmail,
  nanoid,
  resolveDefaultWorkspaceId,
} from "../server/lib/calls.js";
import { writeAppState } from "@agent-native/core/application-state";

async function decryptToken(encrypted: string): Promise<string> {
  // Zoom tokens are stored plaintext for now. The OAuth callback route at
  // server/routes/api/oauth/zoom/callback.get.ts does AES-GCM encryption with
  // a `plain:` prefix fallback; this path assumes plaintext. Swap in a proper
  // decrypt when `@agent-native/core/encryption` becomes available.
  return encrypted.startsWith("plain:") ? encrypted.slice(6) : encrypted;
}

export default defineAction({
  description:
    "Import a Zoom cloud recording. Call with either a Zoom meeting id or a specific recording UUID — we fetch the download URL from Zoom using the user's stored OAuth token, insert a call row, and kick off transcription in the background.",
  schema: z.object({
    zoomMeetingId: z
      .string()
      .optional()
      .describe("Zoom meeting id (all recordings for the meeting are fetched)"),
    zoomRecordingUuid: z
      .string()
      .optional()
      .describe("Specific Zoom recording UUID (preferred when known)"),
    title: z.string().optional().describe("Override the call title"),
    folderId: z.string().nullish().describe("Optional folder id"),
    accountId: z.string().nullish().describe("Optional account id"),
    workspaceId: z
      .string()
      .optional()
      .describe("Workspace id (defaults to the user's current workspace)"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    if (!args.zoomMeetingId && !args.zoomRecordingUuid) {
      throw new Error(
        "Provide at least one of zoomMeetingId or zoomRecordingUuid",
      );
    }

    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const [conn] = await db
      .select()
      .from(schema.zoomConnections)
      .where(eq(schema.zoomConnections.email, ownerEmail));
    if (!conn) {
      throw new Error(
        "Zoom is not connected for this user. Run connect-zoom first.",
      );
    }

    const accessToken = await decryptToken(conn.accessTokenEncrypted);
    const workspaceId = args.workspaceId || (await resolveDefaultWorkspaceId());

    const target = args.zoomRecordingUuid
      ? encodeURIComponent(encodeURIComponent(args.zoomRecordingUuid))
      : encodeURIComponent(args.zoomMeetingId!);
    const zoomRes = await fetch(
      `https://api.zoom.us/v2/meetings/${target}/recordings`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!zoomRes.ok) {
      const body = await zoomRes.text().catch(() => "");
      throw new Error(
        `Zoom API responded ${zoomRes.status}: ${body.slice(0, 200)}`,
      );
    }
    const payload = (await zoomRes.json()) as {
      topic?: string;
      start_time?: string;
      duration?: number;
      recording_files?: Array<{
        id?: string;
        file_type?: string;
        download_url?: string;
        play_url?: string;
        recording_type?: string;
        file_size?: number;
      }>;
    };

    const video = (payload.recording_files ?? []).find(
      (f) =>
        f.file_type === "MP4" ||
        f.recording_type === "shared_screen_with_speaker_view",
    );
    const audio = (payload.recording_files ?? []).find(
      (f) => f.file_type === "M4A",
    );
    const primary = video || audio || (payload.recording_files ?? [])[0];
    if (!primary?.download_url && !primary?.play_url) {
      throw new Error("No downloadable recording file returned by Zoom");
    }

    const mediaKind: "video" | "audio" = video ? "video" : "audio";
    const mediaFormat = video ? "mp4" : "m4a";
    const mediaUrl =
      `${primary.download_url ?? primary.play_url}` +
      (primary.download_url
        ? `?access_token=${encodeURIComponent(accessToken)}`
        : "");

    const id = nanoid();
    const now = new Date().toISOString();

    await db.insert(schema.calls).values({
      id,
      workspaceId,
      folderId: args.folderId ?? null,
      title: args.title || payload.topic || "Zoom recording",
      source: "zoom-cloud",
      sourceMeta: JSON.stringify({
        zoomMeetingId: args.zoomMeetingId ?? null,
        zoomRecordingUuid: args.zoomRecordingUuid ?? null,
        recordingFileId: primary.id ?? null,
      }),
      accountId: args.accountId ?? null,
      mediaKind,
      mediaFormat,
      mediaUrl,
      mediaSizeBytes: primary.file_size ?? 0,
      durationMs: payload.duration ? payload.duration * 60_000 : 0,
      recordedAt: payload.start_time ?? now,
      status: "processing",
      ownerEmail,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(schema.callTranscripts).values({
      callId: id,
      ownerEmail,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    try {
      const mod: any = await import("./request-transcript.js").catch(
        () => null,
      );
      const action = mod?.default;
      if (action && typeof action.run === "function") {
        await action.run({ callId: id });
      }
    } catch (err) {
      console.warn(`Could not start transcription for ${id}:`, err);
    }

    return {
      id,
      workspaceId,
      mediaUrl,
      mediaKind,
      status: "processing" as const,
    };
  },
});
