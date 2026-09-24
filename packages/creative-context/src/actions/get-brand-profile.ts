import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { serializePublicBrandProfile } from "../server/public-serialization.js";
import { getBrandProfile } from "../store/index.js";

export default defineAction({
  description:
    "Get an accessible brand profile and its current published DNA version.",
  schema: z.object({ profileId: z.string().min(1).optional() }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async (input) =>
    serializePublicBrandProfile(await getBrandProfile(input)),
});
