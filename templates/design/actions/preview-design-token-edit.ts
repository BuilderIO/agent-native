import { defineAction } from "@agent-native/core/action";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import "../server/db/index.js";
import {
  isSafeCssTokenValue,
  isSafeCssVarName,
  resolveTweaksToCssVars,
} from "../shared/resolve-tweaks.js";

const tokenEditSchema = z.object({
  cssVar: z
    .string()
    .startsWith("--")
    .refine(
      isSafeCssVarName,
      "cssVar must be a valid CSS custom property name (-- followed by letters, digits, hyphens, or underscores).",
    )
    .describe("CSS custom property to edit"),
  value: z
    .string()
    .refine(
      isSafeCssTokenValue,
      'Token value may not contain ";", "{", "}", "<", ">", CSS comments, or control characters.',
    )
    .describe("New value for the token"),
});

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
    const access = await resolveAccess("design", designId);
    if (!access) {
      throw new Error("Design not found");
    }

    const design = access.resource;

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

    const cssVarToTweakId = new Map<string, string>();
    for (const t of tweaks) {
      if (t.cssVar) cssVarToTweakId.set(t.cssVar, t.id);
    }

    const mergedSelections: Record<string, string | number | boolean> = {
      ...existingSelections,
    };
    const directOverrides: Record<string, string> = {};
    for (const { cssVar, value } of edits) {
      const tweakId = cssVarToTweakId.get(cssVar);
      if (tweakId) {
        mergedSelections[tweakId] = value;
      } else {
        directOverrides[cssVar] = value;
      }
    }

    const resolvedFromTweaks = resolveTweaksToCssVars(tweaks, mergedSelections);

    const tweakValues: Record<string, string> = {
      ...resolvedFromTweaks,
      ...directOverrides,
    };

    return {
      designId,
      tweakValues,
      previewedEdits: edits,
    };
  },
});
