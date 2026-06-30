import { defineAction } from "@agent-native/core";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import "../server/db/index.js"; // ensure registerShareableResource runs
import {
  isSafeCssTokenValue,
  isSafeCssVarName,
  resolveTweaksToCssVars,
} from "../shared/resolve-tweaks.js";

// ---------------------------------------------------------------------------
// Token-edit patch schema
// ---------------------------------------------------------------------------

const tokenEditSchema = z.object({
  /** The CSS custom property to update, e.g. "--primary-color". */
  cssVar: z
    .string()
    .startsWith("--")
    .refine(
      isSafeCssVarName,
      "cssVar must be a valid CSS custom property name (-- followed by letters, digits, hyphens, or underscores).",
    )
    .describe("CSS custom property to edit"),
  /** New value string, e.g. "#3B82F6" or "0.75rem". */
  value: z
    .string()
    .refine(
      isSafeCssTokenValue,
      'Token value may not contain ";", "{", "}", "<", ">", CSS comments, or control characters.',
    )
    .describe("New value for the token"),
});

// ---------------------------------------------------------------------------
// Action — preview only, no DB writes
// ---------------------------------------------------------------------------

export default defineAction({
  description:
    "Preview the effect of a design token edit without persisting it. " +
    "Returns the full tweak-values payload (a { '--var': 'value' } map) " +
    "that the client pushes into the iframe via the existing tweak-values " +
    "postMessage so the user sees the change immediately before committing. " +
    "No database writes are performed.",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
    edits: z
      .array(tokenEditSchema)
      .min(1)
      .describe("One or more { cssVar, value } edits to preview"),
  }),
  readOnly: true,
  http: { method: "POST" },
  run: async ({ designId, edits }) => {
    // Requires at least viewer access
    const access = await resolveAccess("design", designId);
    if (!access) {
      throw new Error("Design not found");
    }

    const design = access.resource;

    // Load existing tweak definitions and selections from the design's data
    let designData: Record<string, unknown> = {};
    try {
      designData = design.data
        ? (JSON.parse(design.data) as Record<string, unknown>)
        : {};
    } catch {
      // Malformed JSON — treat as empty.
    }

    type TweakDef = Parameters<typeof resolveTweaksToCssVars>[0][number];
    const tweaks: TweakDef[] = Array.isArray(designData.tweaks)
      ? (designData.tweaks as TweakDef[])
      : [];

    const existingSelections =
      designData.tweakSelections &&
      typeof designData.tweakSelections === "object" &&
      !Array.isArray(designData.tweakSelections)
        ? (designData.tweakSelections as Record<
            string,
            string | number | boolean
          >)
        : {};

    // Build the merged selection map with the requested edits applied.
    // If the edit targets a known tweak cssVar we set by tweakId; otherwise
    // we include the raw var in the payload so the client can apply it directly.
    const cssVarToTweakId = new Map<string, string>();
    for (const t of tweaks) {
      if (t.cssVar) cssVarToTweakId.set(t.cssVar, t.id);
    }

    // Merged selections: existing + requested edits
    const mergedSelections: Record<string, string | number | boolean> = {
      ...existingSelections,
    };
    const directOverrides: Record<string, string> = {};
    for (const { cssVar, value } of edits) {
      const tweakId = cssVarToTweakId.get(cssVar);
      if (tweakId) {
        mergedSelections[tweakId] = value;
      } else {
        // Not a known tweak — include as a direct CSS var override
        directOverrides[cssVar] = value;
      }
    }

    // Resolve the full tweak set with the merged selections
    const resolvedFromTweaks = resolveTweaksToCssVars(tweaks, mergedSelections);

    // Merge in any direct overrides (CSS vars not backed by a tweak definition)
    const tweakValues: Record<string, string> = {
      ...resolvedFromTweaks,
      ...directOverrides,
    };

    return {
      designId,
      /** Full `tweak-values` postMessage payload — push this into the iframe. */
      tweakValues,
      /** The specific edits that were previewed, for confirmation display. */
      previewedEdits: edits,
    };
  },
});
