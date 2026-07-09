import { defineAction } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import "../server/db/index.js"; // ensure registerShareableResource runs
import {
  mutateDesignData,
  type DesignDataRecord,
} from "../server/lib/design-data-mutation.js";

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

    const readSelections = (data: DesignDataRecord) =>
      data.tweakSelections &&
      typeof data.tweakSelections === "object" &&
      !Array.isArray(data.tweakSelections)
        ? (data.tweakSelections as Record<string, unknown>)
        : {};

    // Transactional CAS merge: keep every sibling key in designs.data and
    // retry against the newest revision if another editor/action writes while
    // this request is in flight.
    const { data: persistedData } = await mutateDesignData({
      designId,
      mutate: (prevData, { updatedAt }) => ({
        ...prevData,
        tweakSelections: { ...readSelections(prevData), ...selections },
        tweaksAppliedAt: updatedAt,
      }),
      isApplied: (data) => {
        const persistedSelections = readSelections(data);
        return Object.entries(selections).every(
          ([key, value]) => persistedSelections[key] === value,
        );
      },
    });

    return {
      designId,
      appliedTweaks: readSelections(persistedData),
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
