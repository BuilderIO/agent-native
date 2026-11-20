import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { edgeSchema, nodeSchema } from "../shared/types.js";
import { getDb, schema } from "../server/db/index.js";
import { errors, nowIso, ready } from "../server/core.js";

export default defineAction({
  description: "Edit a journey: name, goal, audience, settings, or the full canvas (pass the complete nodes and edges arrays). Active journeys must be paused first to change steps.",
  schema: z.object({
    id: z.string().min(1).describe("Journey id"),
    name: z.string().min(1).max(200).optional().describe("New name"),
    goal: z.string().max(500).optional().describe("New goal"),
    audienceId: z.string().nullish().describe("New audience id"),
    settings: z.record(z.string(), z.unknown()).optional().describe("Journey settings: reentry (never|after-exit|always), exitCriteria, communicationLimits (apply|ignore), timezone, conversionId"),
    nodes: nodeSchema.array().optional().describe("Complete replacement steps"),
    edges: edgeSchema.array().optional().describe("Complete replacement connections"),
  }),
  outputSchema: z.object({ id: z.string(), updatedAt: z.string() }),
  errors,
  run: async ({ id, name, goal, audienceId, settings, nodes, edges }) => {
    await ready();
    const [row] = await getDb().select().from(schema.journeys).where(eq(schema.journeys.id, id));
    if (!row) return errors.noWrite("Journey not found.", "not_found", { statusCode: 404 });
    if (row.status === "active" && (nodes || edges))
      return errors.noWrite("Pause this journey before editing its steps.", "conflict", { statusCode: 409 });
    const updatedAt = nowIso();
    await getDb().update(schema.journeys).set({
      ...(name !== undefined && { name }),
      ...(goal !== undefined && { goal }),
      ...(audienceId !== undefined && { audienceId }),
      ...(settings && { settings: { ...(row.settings as object), ...settings } }),
      ...(nodes && { nodes }),
      ...(edges && { edges }),
      updatedAt,
    }).where(eq(schema.journeys.id, id));
    return { id, updatedAt };
  },
});
