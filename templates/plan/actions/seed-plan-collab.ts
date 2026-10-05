import { defineAction } from "@agent-native/core/action";
import {
  base64ToUint8Array,
  seedXmlFragmentIfEmpty,
  uint8ArrayToBase64,
} from "@agent-native/core/collab";
import { z } from "zod";

import { assertPlanEditor } from "../server/plans.js";

export default defineAction({
  description:
    "Initialize a plan's live editor from its saved blocks exactly once.",
  agentTool: false,
  deferLoading: false,
  schema: z.object({
    planId: z.string().min(1),
    seedUpdateBase64: z.string().min(1).max(16_000_000),
  }),
  run: async ({ planId, seedUpdateBase64 }, ctx) => {
    if (ctx?.caller !== "frontend") {
      throw Object.assign(
        new Error("This operation belongs to the browser editor."),
        { statusCode: 403 },
      );
    }
    await assertPlanEditor(planId);
    const result = await seedXmlFragmentIfEmpty(
      `plan:${planId}`,
      base64ToUint8Array(seedUpdateBase64),
    );
    return {
      seeded: result.seeded,
      stateBase64: uint8ArrayToBase64(result.state),
    };
  },
});
