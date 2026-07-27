import { defineAction } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import { z } from "zod";

import {
  CLIPS_BUILDER_CREDITS_STATE_KEY,
  normalizeBuilderCreditsStatus,
} from "../shared/builder-credits.js";

export default defineAction({
  description:
    "Return the last known Builder.io AI credit limit state for Clips. Use this before explaining paused backup transcription, transcript cleanup, summaries, or AI title generation.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => {
    const raw = await readAppState(CLIPS_BUILDER_CREDITS_STATE_KEY).catch(
      () => null,
    );
    return normalizeBuilderCreditsStatus(raw);
  },
});
