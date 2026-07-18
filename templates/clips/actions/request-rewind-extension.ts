import { defineAction } from "@agent-native/core";
import {
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { nanoid } from "../server/lib/recordings.js";

export const REWIND_EXTENSION_PREFIX = "rewind-extension-request-";

export interface RewindExtensionRequest {
  [key: string]: unknown;
  requestId: string;
  recordingId: string;
  seconds: 30 | 300;
  status:
    | "pending"
    | "processing"
    | "ready"
    | "applying"
    | "applied"
    | "failed";
  requestedAt: string;
  updatedAt: string;
  preRollRecordingId?: string;
  actualDurationMs?: number;
  error?: string;
}

export function rewindExtensionKey(recordingId: string): string {
  return `${REWIND_EXTENSION_PREFIX}${recordingId}`;
}

export default defineAction({
  description:
    "Ask the signed-in Clips Alpha app to retrieve an explicit 30-second or five-minute pre-roll from local Rewind for one owned recording.",
  schema: z.object({
    recordingId: z.string(),
    seconds: z.union([z.literal(30), z.literal(300)]),
  }),
  run: async ({ recordingId, seconds }) => {
    await assertAccess("recording", recordingId, "owner");
    const key = rewindExtensionKey(recordingId);
    const existing = (await readAppState(key)) as RewindExtensionRequest | null;
    if (existing && !["failed", "applied"].includes(existing.status)) {
      return existing;
    }
    if (existing?.status === "applied") {
      throw new Error(
        "This Clip already includes an explicit Rewind pre-roll.",
      );
    }
    const now = new Date().toISOString();
    const request: RewindExtensionRequest = {
      requestId: `rewind-extend-${nanoid()}`,
      recordingId,
      seconds,
      status: "pending",
      requestedAt: now,
      updatedAt: now,
    };
    await writeAppState(key, request);
    return request;
  },
});
