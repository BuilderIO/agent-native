import { defineAction } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  rewindExtensionKey,
  type RewindExtensionRequest,
} from "./request-rewind-extension.js";

export default defineAction({
  description: "Read the current explicit Rewind pre-roll request for a Clip.",
  schema: z.object({ recordingId: z.string() }),
  http: { method: "GET" },
  run: async ({ recordingId }) => {
    await assertAccess("recording", recordingId, "owner");
    const request = (await readAppState(
      rewindExtensionKey(recordingId),
    )) as RewindExtensionRequest | null;
    return { request };
  },
});
