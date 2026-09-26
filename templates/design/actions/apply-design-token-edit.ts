import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import "../server/db/index.js";
import {
  mutateDesignData,
  type DesignDataRecord,
} from "../server/lib/design-data-mutation.js";
import { snapshotDesignBeforeAgentEdit } from "../server/lib/design-versions.js";
import {
  INLINE_DEFAULT_CAPABILITIES,
  hasCapability,
} from "../shared/design-source-capabilities.js";
import {
  isSafeCssTokenValue,
  isSafeCssVarName,
  resolveTweaksToCssVars,
} from "../shared/resolve-tweaks.js";


const tokenEditSchema = z.object({
  cssVar: z
    .string()
    .startsWith("--")
    // The token name is spliced raw into a `:root { … }` rule, so constrain it
    // to a safe CSS custom-property ident (leading "--" plus ident chars only).
    .refine(
      isSafeCssVarName,
      "cssVar must be a valid CSS custom property name (-- followed by letters, digits, hyphens, or underscores).",
    )
    .describe("CSS custom property to edit"),
  value: z
    .string()
    // The value is rendered into CSS custom-property declarations; reject
    // declaration terminators and style-tag breakout characters.
    .refine(
      isSafeCssTokenValue,
      'Token value may not contain ";", "{", "}", "<", ">", CSS comments, or control characters.',
    )
    .describe("New value for the token"),
});

function designDeepLink(designId: string): string {
  return buildDeepLink({
    app: "design",
    view: "editor",
    params: { designId },
  });
}

type TweakDef = Parameters<typeof resolveTweaksToCssVars>[0][number];
type TweakSelections = Record<string, string | number | boolean>;

function readTweaks(data: DesignDataRecord): TweakDef[] {
  return Array.isArray(data.tweaks) ? (data.tweaks as TweakDef[]) : [];
}

function readSelections(data: DesignDataRecord): TweakSelections {
  return data.tweakSelections &&
    typeof data.tweakSelections === "object" &&
    !Array.isArray(data.tweakSelections)
    ? (data.tweakSelections as TweakSelections)
    : {};
}

function selectionKeyForCssVar(tweaks: TweakDef[], cssVar: string): string {
  return tweaks.find((tweak) => tweak.cssVar === cssVar)?.id ?? cssVar;
}


export default defineAction({
  description:
    "Persist one or more design token edits for a design. " +
    "Tier-A (inline/Alpine): routes the edit through the same mechanism as " +
    "apply-tweaks — merges the value into designs.data.tweakSelections so the " +
    "tuned token survives reload and is visible in the Tokens panel. " +
    "Source file write-back (Tier-B, real apps) is gated behind a capability " +
    "check and currently returns a 'planned' advisory — no file is written.",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
    edits: z
      .array(tokenEditSchema)
      .min(1)
      .describe("One or more { cssVar, value } edits to persist"),
    sourceRef: z
      .string()
      .optional()
      .describe(
        "Opaque source connection ref for real-app (localhost/fusion) " +
          "write-back. Omit for inline designs.",
      ),
  }),
  run: async ({ designId, edits, sourceRef }, context) => {
    await assertAccess("design", designId, "editor");
    await snapshotDesignBeforeAgentEdit(designId, context);

    const caps = INLINE_DEFAULT_CAPABILITIES;
    const canWriteTokens = hasCapability(caps, "writeTokens");
    void sourceRef;

    const { data: persistedData } = await mutateDesignData({
      designId,
      mutate: (prevData, { updatedAt }) => {
        const tweaks = readTweaks(prevData);
        const newSelections = { ...readSelections(prevData) };
        for (const { cssVar, value } of edits) {
          newSelections[selectionKeyForCssVar(tweaks, cssVar)] = value;
        }
        return {
          ...prevData,
          tweakSelections: newSelections,
          tweaksAppliedAt: updatedAt,
        };
      },
      isApplied: (data) => {
        const tweaks = readTweaks(data);
        const selections = readSelections(data);
        return edits.every(
          ({ cssVar, value }) =>
            selections[selectionKeyForCssVar(tweaks, cssVar)] === value,
        );
      },
    });

    const tweaks = readTweaks(persistedData);
    const newSelections = readSelections(persistedData);

    const resolvedCssVars = resolveTweaksToCssVars(tweaks, newSelections);

    return {
      designId,
      persisted: true,
      writeTokensAdvisory: canWriteTokens
        ? null
        : "Token source write-back is not yet available for this source tier. " +
          "The value is persisted in the design's tweakSelections and reflected " +
          "live via the CSS-var bridge. Connect Builder (free tier available) to unlock real write-back.",
      resolvedCssVars,
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
