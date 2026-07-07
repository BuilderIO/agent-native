import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import type {
  BreakpointDefinition,
  BreakpointSet,
} from "../shared/design-state.js";
import { widthToPrefix } from "../shared/responsive-classes.js";

/**
 * Read the active breakpoint set from designs.data, or return a fresh one.
 * Breakpoint sets are stored inline in `designs.data.breakpointSet` rather
 * than a dedicated table (simplest additive storage for v1; a dedicated table
 * can be added later if per-screen sets are needed).
 *
 * Follow-up: if per-screen breakpoint sets become necessary, add a
 * `design_breakpoint_set` table keyed by (design_id, file_id) and migrate
 * this in-data storage to it.
 */
function readBreakpointSet(designData: string | null): BreakpointSet {
  if (designData) {
    try {
      const parsed = JSON.parse(designData) as Record<string, unknown>;
      if (parsed.breakpointSet && typeof parsed.breakpointSet === "object") {
        return parsed.breakpointSet as BreakpointSet;
      }
    } catch {
      // ignore parse errors; fall through to default
    }
  }
  return { id: nanoid(), breakpoints: [] };
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
    "Add a breakpoint frame to the design's breakpoint set. " +
    "The breakpoint set is stored in designs.data and controls which side-by-side " +
    "device widths are shown in the overview canvas and the editor's breakpoint bar " +
    "(Framer defaults: Phone 390 / Tablet 810 / Desktop 1200, or a custom width). " +
    "Every frame renders the SAME document at its own viewport width (Framer model); " +
    "edits made at a narrower active frame persist as width-scoped overrides that " +
    "cascade down (see the responsive-breakpoints skill). The legacy Tailwind prefix " +
    "is derived automatically from the width. Duplicate widths are silently ignored.",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
    label: z
      .string()
      .min(1)
      .describe(
        "Human-readable label shown in the canvas header (e.g. 'Mobile', 'Tablet', 'Desktop').",
      ),
    widthPx: z
      .number()
      .int()
      .min(320)
      .max(3840)
      .describe(
        "Frame width in pixels. Snaps semantics to the nearest Tailwind min-width threshold " +
          "(sm:640 / md:768 / lg:1024 / xl:1280 / 2xl:1536); the exact pixel value is preserved " +
          "for the frame geometry.",
      ),
    id: z
      .string()
      .optional()
      .describe("Optional pre-generated id. Omit to auto-generate."),
  }),
  run: async ({ designId, label, widthPx, id: providedId }) => {
    await assertAccess("design", designId, "editor");

    const db = getDb();
    const [design] = await db
      .select({ data: schema.designs.data })
      .from(schema.designs)
      .where(eq(schema.designs.id, designId))
      .limit(1);

    if (!design) throw new Error(`Design '${designId}' not found.`);

    const set = readBreakpointSet(design.data);

    // Ignore duplicate widths.
    if (set.breakpoints.some((bp) => bp.widthPx === widthPx)) {
      return {
        ignored: true,
        reason: `A breakpoint with width ${widthPx}px already exists.`,
        breakpointSet: set,
      };
    }

    const breakpointId = providedId ?? nanoid();
    const prefix = widthToPrefix(widthPx);

    const newBreakpoint: BreakpointDefinition = {
      id: breakpointId,
      label,
      widthPx,
      prefix,
    };

    // Insert sorted by widthPx ascending (Mobile → Tablet → Desktop).
    const breakpoints = [...set.breakpoints, newBreakpoint].sort(
      (a, b) => a.widthPx - b.widthPx,
    );
    const updatedSet: BreakpointSet = { ...set, breakpoints };

    const now = new Date().toISOString();
    const updatedData = writeBreakpointSet(design.data, updatedSet, now);
    await db
      .update(schema.designs)
      .set({ data: updatedData, updatedAt: now })
      .where(eq(schema.designs.id, designId));

    return {
      added: newBreakpoint,
      breakpointSet: updatedSet,
    };
  },
});
