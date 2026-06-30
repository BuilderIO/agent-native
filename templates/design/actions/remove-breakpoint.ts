import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import type { BreakpointSet } from "../shared/design-state.js";

function readBreakpointSet(designData: string | null): BreakpointSet | null {
  if (!designData) return null;
  try {
    const parsed = JSON.parse(designData) as Record<string, unknown>;
    if (parsed.breakpointSet && typeof parsed.breakpointSet === "object") {
      return parsed.breakpointSet as BreakpointSet;
    }
  } catch {
    // ignore
  }
  return null;
}

function writeBreakpointSet(
  designData: string | null,
  set: BreakpointSet,
  now: string,
): string {
  let prev: Record<string, unknown> = {};
  if (designData) {
    try {
      const parsed = JSON.parse(designData);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        prev = parsed;
      }
    } catch {
      // ignore
    }
  }
  return JSON.stringify({
    ...prev,
    breakpointSet: set,
    breakpointSetUpdatedAt: now,
  });
}

export default defineAction({
  description:
    "Remove a breakpoint frame from the design's breakpoint set by its id. " +
    "If the active breakpoint (stored in application state) matches the removed " +
    "breakpoint, the UI should reset to the first remaining breakpoint or 'auto'.",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
    breakpointId: z
      .string()
      .describe("Id of the BreakpointDefinition to remove."),
  }),
  run: async ({ designId, breakpointId }) => {
    await assertAccess("design", designId, "editor");

    const db = getDb();
    const [design] = await db
      .select({ data: schema.designs.data })
      .from(schema.designs)
      .where(eq(schema.designs.id, designId))
      .limit(1);

    if (!design) throw new Error(`Design '${designId}' not found.`);

    const set = readBreakpointSet(design.data);
    if (!set) {
      return {
        removed: false,
        reason: "No breakpoint set found for this design.",
      };
    }

    const removed = set.breakpoints.find((bp) => bp.id === breakpointId);
    if (!removed) {
      return {
        removed: false,
        reason: `Breakpoint '${breakpointId}' not found in the set.`,
      };
    }

    const updatedSet: BreakpointSet = {
      ...set,
      breakpoints: set.breakpoints.filter((bp) => bp.id !== breakpointId),
    };

    const now = new Date().toISOString();
    const updatedData = writeBreakpointSet(design.data, updatedSet, now);
    await db
      .update(schema.designs)
      .set({ data: updatedData, updatedAt: now })
      .where(eq(schema.designs.id, designId));

    return {
      removed: true,
      removedBreakpoint: removed,
      breakpointSet: updatedSet,
    };
  },
});
