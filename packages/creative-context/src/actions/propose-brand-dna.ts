import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { saveBrandDnaCandidate } from "../store/index.js";

const dna = z
  .object({ summary: z.string().trim().min(1).max(20_000) })
  .catchall(z.unknown());

export default defineAction({
  description:
    "Save an inferred immutable brand DNA proposal pinned to exact evidence without overwriting published context.",
  schema: z.object({
    profileId: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    dna,
    evidenceItemIds: z.array(z.string().min(1)).max(500).optional(),
  }),
  publicAgent: { expose: true, readOnly: false, requiresAuth: true },
  run: (args) => saveBrandDnaCandidate({ ...args, status: "proposed" }),
});
