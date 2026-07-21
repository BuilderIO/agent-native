import { defineAction } from "@agent-native/core";
import {
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  rewindExtensionKey,
  type RewindExtensionRequest,
} from "./request-rewind-extension.js";

export default defineAction({
  description:
    "Update the local Clips Alpha processing state for an explicit Rewind pre-roll request.",
  schema: z.object({
    recordingId: z.string(),
    requestId: z.string(),
    status: z.enum(["processing", "ready", "failed"]),
    preRollRecordingId: z.string().optional(),
    actualDurationMs: z.number().int().positive().optional(),
    error: z.string().max(1200).optional(),
  }),
  run: async (args) => {
    await assertAccess("recording", args.recordingId, "owner");
    const key = rewindExtensionKey(args.recordingId);
    const current = (await readAppState(key)) as RewindExtensionRequest | null;
    if (!current || current.requestId !== args.requestId) {
      throw new Error("Rewind extension request is no longer current.");
    }
    const next: RewindExtensionRequest = {
      ...current,
      status: args.status,
      updatedAt: new Date().toISOString(),
      ...(args.preRollRecordingId
        ? { preRollRecordingId: args.preRollRecordingId }
        : {}),
      ...(args.actualDurationMs
        ? { actualDurationMs: args.actualDurationMs }
        : {}),
      ...(args.error ? { error: args.error } : {}),
    };
    await writeAppState(key, next);
    return next;
  },
});
