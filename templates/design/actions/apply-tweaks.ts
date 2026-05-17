import { defineAction } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs

/** Editor deep link so external agents can surface "Open design". */
function designDeepLink(designId: string): string {
  return buildDeepLink({
    app: "design",
    view: "editor",
    params: { designId },
  });
}

export default defineAction({
  description:
    "Persist the user's live tweak knob values (accent color, density, " +
    "radius, dark-mode, etc.) for a design. Merges the selections into " +
    "designs.data.tweakSelections so the tuned design survives reload and " +
    "is what get-design-snapshot / export-coding-handoff hand off. Other " +
    "design data keys (tweaks, lastPrompt, ...) are left intact.",
  schema: z.object({
    designId: z.string().describe("Design project ID to apply tweaks to"),
    selections: z
      .preprocess(
        (v) => (typeof v === "string" ? JSON.parse(v) : v),
        z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
      )
      .describe(
        "Map of tweak id -> selected value (string | number | boolean), " +
          "e.g. { 'theme-accent': '#0EA5E9', 'border-radius': 12, " +
          "'dark-mode': true }",
      ),
  }),
  run: async ({ designId, selections }) => {
    await assertAccess("design", designId, "editor");

    const db = getDb();
    const now = new Date().toISOString();

    // Additive JSON merge: keep every other key in designs.data intact, only
    // merge into the tweakSelections sub-object.
    const [existingDesign] = await db
      .select({ data: schema.designs.data })
      .from(schema.designs)
      .where(eq(schema.designs.id, designId));

    let prevData: Record<string, unknown> = {};
    if (existingDesign?.data) {
      try {
        const parsed = JSON.parse(existingDesign.data);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          prevData = parsed;
        }
      } catch {
        // Stale/invalid JSON — start fresh but never drop the column.
      }
    }

    const prevSelections =
      prevData.tweakSelections &&
      typeof prevData.tweakSelections === "object" &&
      !Array.isArray(prevData.tweakSelections)
        ? (prevData.tweakSelections as Record<string, unknown>)
        : {};

    const mergedData = {
      ...prevData,
      tweakSelections: { ...prevSelections, ...selections },
      tweaksAppliedAt: now,
    };

    await db
      .update(schema.designs)
      .set({ data: JSON.stringify(mergedData), updatedAt: now })
      .where(eq(schema.designs.id, designId));

    return {
      designId,
      appliedTweaks: mergedData.tweakSelections,
      deepLink: designDeepLink(designId),
    };
  },
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const designId = (result as { designId?: string }).designId;
    if (!designId) return null;
    return {
      url: designDeepLink(designId),
      label: "Open design",
      view: "editor",
    };
  },
});
