import { defineAction } from "@agent-native/core/action";
import baseFlags from "@agent-native/core/feature-flags/actions/get-feature-flags";
import { z } from "zod";

import profile from "./get-experience-profile.js";

export default defineAction({
  description:
    "Read evaluated feature flags, including the current user's experience preset over presentation deviations.",
  schema: z.object({}),
  outputSchema: z.record(z.string(), z.boolean()),
  http: { method: "GET" },
  run: async (args, ctx) => {
    const [values, experience] = await Promise.all([
      baseFlags.run(args, ctx),
      profile.run(args, ctx),
    ]);
    return { ...values, ...experience.values };
  },
});
