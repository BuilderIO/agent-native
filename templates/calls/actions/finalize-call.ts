import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/calls.js";
import {
  readAppState,
  writeAppState,
  deleteAppState,
  listAppState,
} from "@agent-native/core/application-state";

async function tryUploadFile(
  _data: Uint8Array,
  _filename: string,
  _mimeType: string,
  _ownerEmail: string,
): Promise<{ url: string } | null> {
  // The framework does not yet expose a dialect-agnostic storage subpath.
  // Until it does, calls are served via the dev fallback: we stash the
  // assembled bytes in application_state under `call-blob-:callId` and the
  // `/api/call-media/:callId` route streams them back. Swap this in once
  // `@agent-native/core/storage` exports `uploadFile`.
  return null;
}

function b64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    const buf = Buffer.from(b64, "base64");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

export default defineAction({
  description:
    "Assemble uploaded chunks into a final media blob, store it (via uploadFile if available, else stashed in application_state), mark the call as 'processing', and kick off transcription via request-transcript.",
  schema: z.object({
    id: z.string().describe("Call ID to finalize"),
    durationMs: z
      .number()
      .optional()
      .describe("Final recorded duration in milliseconds"),
    width: z.number().optional().describe("Media width in pixels"),
    height: z.number().optional().describe("Media height in pixels"),
    mimeType: z
      .string()
      .optional()
      .describe("MIME type of the assembled blob (e.g. video/mp4, audio/mp4)"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const id = args.id;

    const [existing] = await db
      .select()
      .from(schema.calls)
      .where(
        and(eq(schema.calls.id, id), eq(schema.calls.ownerEmail, ownerEmail)),
      );

    if (!existing) {
      throw new Error(`Call not found: ${id}`);
    }

    const uploadState = await readAppState(`call-upload-${id}`);
    const mimeType =
      args.mimeType ||
      (typeof uploadState?.mimeType === "string" ? uploadState.mimeType : "") ||
      (existing.mediaKind === "audio" ? "audio/mp4" : "video/mp4");
    const mediaFormat = mimeType.includes("webm")
      ? "webm"
      : mimeType.includes("ogg")
        ? "ogg"
        : mimeType.includes("wav")
          ? "wav"
          : existing.mediaKind === "audio"
            ? "m4a"
            : "mp4";

    await db
      .update(schema.calls)
      .set({
        status: "processing",
        progressPct: 100,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.calls.id, id));

    await writeAppState(`call-upload-${id}`, {
      callId: id,
      status: "processing",
      progress: 100,
      updatedAt: new Date().toISOString(),
    });

    const chunkEntries = await listAppState(`call-chunks-${id}-`);
    chunkEntries.sort((a, b) => {
      const ai = Number(a.key.split("-").pop() || 0);
      const bi = Number(b.key.split("-").pop() || 0);
      return ai - bi;
    });

    if (chunkEntries.length === 0) {
      await db
        .update(schema.calls)
        .set({
          status: "failed",
          failureReason: "No chunks found for call",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.calls.id, id));
      await writeAppState(`call-upload-${id}`, {
        callId: id,
        status: "failed",
        failureReason: "No chunks found for call",
      });
      throw new Error(`No chunks found for call ${id}`);
    }

    const parts: Uint8Array[] = [];
    for (const entry of chunkEntries) {
      const b64 =
        typeof entry.value?.data === "string" ? entry.value.data : null;
      if (b64) parts.push(b64ToBytes(b64));
    }
    const assembled = concatBytes(parts);

    let mediaUrl: string;
    const upload = await tryUploadFile(
      assembled,
      `${id}.${mediaFormat}`,
      mimeType,
      ownerEmail,
    );

    if (upload?.url) {
      mediaUrl = upload.url;
    } else {
      await writeAppState(`call-blob-${id}`, {
        mimeType,
        data: bytesToB64(assembled),
      });
      mediaUrl = `/api/call-media/${id}`;
    }

    await db
      .update(schema.calls)
      .set({
        status: "processing",
        mediaUrl,
        mediaFormat,
        mediaSizeBytes: assembled.byteLength,
        durationMs: args.durationMs ?? existing.durationMs ?? 0,
        width: args.width ?? existing.width ?? 0,
        height: args.height ?? existing.height ?? 0,
        progressPct: 100,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.calls.id, id));

    const [existingTranscript] = await db
      .select({ callId: schema.callTranscripts.callId })
      .from(schema.callTranscripts)
      .where(eq(schema.callTranscripts.callId, id));
    if (!existingTranscript) {
      await db.insert(schema.callTranscripts).values({
        callId: id,
        ownerEmail,
        status: "pending",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    for (const entry of chunkEntries) {
      await deleteAppState(entry.key);
    }

    await writeAppState(`call-upload-${id}`, {
      callId: id,
      status: "processing",
      progress: 100,
      mediaUrl,
      finishedAt: new Date().toISOString(),
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    // Kick off transcription. request-transcript is auto-mounted as an action.
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

    console.log(`Finalized call ${id} → ${mediaUrl}`);

    return {
      id,
      status: "processing" as const,
      mediaUrl,
      mediaSizeBytes: assembled.byteLength,
      durationMs: args.durationMs ?? existing.durationMs ?? 0,
    };
  },
});
