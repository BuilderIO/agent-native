import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { loadContractBundle } from "./_contracts.js";

export default defineAction({
  description:
    "Get a Contracts review bundle including assumptions, criteria, feedback, evidence, and review queue.",
  schema: z.object({
    id: z.string().describe("Contract ID"),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: true,
    title: "Get contract",
    description: "Read a Contracts review bundle.",
  },
  run: async (args) => loadContractBundle(args.id),
});
