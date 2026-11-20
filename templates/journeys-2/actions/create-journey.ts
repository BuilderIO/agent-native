import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { nodeSchema, edgeSchema } from "../shared/types.js";
import { getDb, schema } from "../server/db/index.js";
import { errors, newId, nowIso, ready } from "../server/core.js";

export default defineAction({
  description: "Create a draft journey. kind 'audience' enrolls everyone in an audience; 'trigger' enrolls contacts when they perform an event. Optionally pass an initial canvas.",
  schema: z.object({
    name: z.string().min(1).max(200).describe("Journey name"),
    kind: z.enum(["audience", "trigger"]).default("audience").describe("Entry type; defaults to audience"),
    audienceId: z.string().nullish().describe("Audience to enroll (audience journeys)"),
    goal: z.string().max(500).default("").describe("What the journey should achieve"),
    nodes: z.array(nodeSchema).optional().describe("Initial steps; defaults to a single entry step"),
    edges: z.array(edgeSchema).optional().describe("Initial connections"),
  }),
  outputSchema: z.object({ id: z.string() }),
  errors,
  run: async ({ name, kind, audienceId, goal, nodes, edges }) => {
    await ready();
    const id = newId("jr");
    const now = nowIso();
    await getDb().insert(schema.journeys).values({
      id, name, kind, audienceId: audienceId ?? null, goal,
      nodes: nodes ?? [{ id: "start", type: "trigger", x: 320, y: 40, label: kind === "trigger" ? "Performs an event" : "Audience entry", config: {} }],
      edges: edges ?? [],
      settings: { reentry: "never", exitCriteria: "", communicationLimits: "apply", timezone: "America/Los_Angeles", conversionId: "" },
      createdAt: now, updatedAt: now,
    });
    return { id };
  },
});
