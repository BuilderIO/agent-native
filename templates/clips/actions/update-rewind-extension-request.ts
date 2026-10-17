import { defineAction } from "@agent-native/core/action";
import {
  compareAndSetAppState,
  readAppState,
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
    preRollWidth: z.number().int().positive().optional(),
    preRollHeight: z.number().int().positive().optional(),
    error: z.string().max(1200).optional(),
  }),
  run: async (args) => {
    await assertAccess("recording", args.recordingId, "owner");
    const key = rewindExtensionKey(args.recordingId);
    let current = (await readAppState(key)) as RewindExtensionRequest | null;
    if (!current || current.requestId !== args.requestId) {
      throw new Error("Rewind extension request is no longer current.");
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      if (
        ["applying", "applied", "failed"].includes(current.status) ||
        (current.status === "ready" && args.status === "processing")
      ) {
        return current;
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
        ...(args.preRollWidth ? { preRollWidth: args.preRollWidth } : {}),
        ...(args.preRollHeight ? { preRollHeight: args.preRollHeight } : {}),
        ...(args.error ? { error: args.error } : {}),
      };
      if (await compareAndSetAppState(key, current, next)) return next;
      const latest = (await readAppState(key)) as RewindExtensionRequest | null;
      if (!latest || latest.requestId !== args.requestId) {
        throw new Error("Rewind extension request is no longer current.");
      }
      current = latest;
    }
    throw new Error("Rewind extension request kept changing. Try again.");
  },
});
