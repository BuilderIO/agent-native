/**
 * list-design-components — read action.
 *
 * Scans every HTML file in a design for `data-agent-native-component`
 * annotations and returns one summary row per distinct component name
 * (instance count + a representative instance to preview/source from).
 *
 * Unlike `index-components` (which only scans one file at a time and persists
 * metadata into `component_index`), this action is a lightweight, read-only,
 * cross-file scan purpose-built for the Swap Instance component picker — the
 * caller needs to know every component name that exists ANYWHERE in the
 * design, not just on the active screen.
 *
 * Inline/Alpine designs only; real-app sources return an empty list with a
 * CTA (matches `index-components`' real-app posture).
 */

import { defineAction } from "@agent-native/core/action";
import { accessFilter, resolveAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import {
  scanComponentLibrary,
  summarizeComponentLibrary,
} from "../shared/component-library.js";
import { designSourceTypeFromData } from "../shared/source-mode.js";

export default defineAction({
  description:
    "List every distinct component (by data-agent-native-component name) " +
    "found across ALL html files in a design, with instance counts, for the " +
    "Swap Instance component picker. Inline/Alpine designs only.",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
    excludeName: z
      .string()
      .optional()
      .describe(
        "Component name to omit from the results, e.g. the currently " +
          "selected instance's own component so it isn't offered as a swap target.",
      ),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ designId, excludeName }) => {
    const access = await resolveAccess("design", designId);
    if (!access) throw new Error("Design not found");

    const rawData = (access.resource as { data?: unknown }).data;
    const sourceType = designSourceTypeFromData(rawData);

    if (sourceType !== "inline") {
      return {
        designId,
        sourceType,
        ctaRequired: true,
        ctaMessage:
          "Listing components across the design library requires a " +
          "connected Builder app for real-app sources. Not yet available.",
        components: [],
        totalComponents: 0,
      };
    }

    const db = getDb();

    const files = await db
      .select({
        id: schema.designFiles.id,
        designId: schema.designFiles.designId,
        filename: schema.designFiles.filename,
        content: schema.designFiles.content,
      })
      .from(schema.designFiles)
      .innerJoin(
        schema.designs,
        eq(schema.designFiles.designId, schema.designs.id),
      )
      .where(
        and(
          accessFilter(schema.designs, schema.designShares),
          eq(schema.designFiles.designId, designId),
          eq(schema.designFiles.fileType, "html"),
        ),
      )
      .orderBy(schema.designFiles.createdAt);

    const entries = scanComponentLibrary(files);
    const components = summarizeComponentLibrary(entries).filter(
      (component) => component.name !== excludeName,
    );

    return {
      designId,
      sourceType,
      ctaRequired: false,
      components,
      totalComponents: components.length,
    };
  },
});
