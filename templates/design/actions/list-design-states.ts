import { defineAction } from "@agent-native/core";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs

function parseJsonRecord(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export default defineAction({
  description:
    "List all design states, fixtures, and captures for a design. " +
    "States are alternate DOM/Alpine snapshots (Default, Loading, Empty, Error). " +
    "Fixtures hold static data payloads for real-app preview. " +
    "Captures are live snapshots of a running app's route + props taken via the bridge.",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
    kind: z
      .enum(["state", "fixture", "capture"])
      .optional()
      .describe("Filter to a specific kind. Omit to return all kinds."),
    sourceRef: z
      .string()
      .optional()
      .describe(
        "Filter to a specific source ref (file id for inline, route id for localhost/fusion). Omit to return all.",
      ),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ designId, kind, sourceRef }) => {
    const db = getDb();

    // Access is checked via the parent designs row (design_state has no own shares table).
    const conditions = [
      accessFilter(schema.designs, schema.designShares),
      eq(schema.designState.designId, designId),
    ];

    if (kind) {
      conditions.push(eq(schema.designState.kind, kind));
    }
    if (sourceRef) {
      conditions.push(eq(schema.designState.sourceRef, sourceRef));
    }

    const rows = await db
      .select({
        id: schema.designState.id,
        designId: schema.designState.designId,
        sourceRef: schema.designState.sourceRef,
        name: schema.designState.name,
        kind: schema.designState.kind,
        breakpoint: schema.designState.breakpoint,
        route: schema.designState.route,
        fixtureData: schema.designState.fixtureData,
        captureData: schema.designState.captureData,
        previewRef: schema.designState.previewRef,
        createdAt: schema.designState.createdAt,
        updatedAt: schema.designState.updatedAt,
      })
      .from(schema.designState)
      .innerJoin(
        schema.designs,
        eq(schema.designState.designId, schema.designs.id),
      )
      .where(and(...conditions))
      .orderBy(desc(schema.designState.updatedAt));

    return {
      count: rows.length,
      states: rows.map((row) => ({
        ...row,
        fixtureData: parseJsonRecord(row.fixtureData),
        captureData: parseJsonRecord(row.captureData),
      })),
    };
  },
});
