import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export const MOBILE_CAPTURE_STATE_KEY = "mobile-capture-state";

const mobileCaptureStateSchema = z
  .object({
    view: z.enum(["home", "dictate", "meeting", "video"]),
    phase: z.enum([
      "idle",
      "ready",
      "recording",
      "paused",
      "saving",
      "processing",
      "review",
      "error",
    ]),
    captureId: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export default defineAction({
  description:
    "Record the privacy-safe view and phase of the Agent Native mobile capture companion.",
  agentTool: false,
  schema: mobileCaptureStateSchema,
  run: async (args) => {
    const state = {
      ...args,
      updatedAt: new Date().toISOString(),
    };
    await writeAppState(MOBILE_CAPTURE_STATE_KEY, state);
    return state;
  },
});
