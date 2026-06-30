import { defineAction } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import {
  INLINE_DEFAULT_CAPABILITIES,
  hasCapability,
} from "../shared/design-source-capabilities.js";
import {
  isSafeCssTokenValue,
  isSafeCssVarName,
  resolveTweaksToCssVars,
} from "../shared/resolve-tweaks.js";

// ---------------------------------------------------------------------------
// Token-edit patch schema (mirrors preview-design-token-edit)
// ---------------------------------------------------------------------------

const tokenEditSchema = z.object({
  /** The CSS custom property to update, e.g. "--primary-color". */
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
  /** New value string, e.g. "#3B82F6" or "0.75rem". */
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

/** Editor deep link so external agents can surface "Open design". */
function designDeepLink(designId: string): string {
  return buildDeepLink({
    app: "design",
    view: "editor",
    params: { designId },
  });
}

// ---------------------------------------------------------------------------
// Action — persist token edit through the Tweaks loop (Tier-A)
// ---------------------------------------------------------------------------

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
  run: async ({ designId, edits, sourceRef }) => {
    await assertAccess("design", designId, "editor");

    // ------------------------------------------------------------------
    // Capability check — real-app write-back (writeTokens) is gated
    // ------------------------------------------------------------------
    // TODO(fusion): When the bridge proves writeTokens capability, pass the
    // resolved capabilities from the active source connection here instead of
    // falling back to INLINE_DEFAULT_CAPABILITIES.
    const caps = INLINE_DEFAULT_CAPABILITIES;
    const canWriteTokens = hasCapability(caps, "writeTokens");
    // sourceRef will be used once real write-back is implemented
    void sourceRef;

    const db = getDb();
    const now = new Date().toISOString();

    // ------------------------------------------------------------------
    // Load current design data
    // ------------------------------------------------------------------
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

    type TweakDef = Parameters<typeof resolveTweaksToCssVars>[0][number];
    const tweaks: TweakDef[] = Array.isArray(prevData.tweaks)
      ? (prevData.tweaks as TweakDef[])
      : [];

    // Map cssVar -> tweakId for known tweaks
    const cssVarToTweakId = new Map<string, string>();
    for (const t of tweaks) {
      if (t.cssVar) cssVarToTweakId.set(t.cssVar, t.id);
    }

    const prevSelections: Record<string, string | number | boolean> =
      prevData.tweakSelections &&
      typeof prevData.tweakSelections === "object" &&
      !Array.isArray(prevData.tweakSelections)
        ? (prevData.tweakSelections as Record<
            string,
            string | number | boolean
          >)
        : {};

    // ------------------------------------------------------------------
    // Merge edits into tweakSelections
    // ------------------------------------------------------------------
    // For each edit:
    //   - If the cssVar maps to a known tweak, persist by tweakId (the standard
    //     Tweaks loop key) so apply-tweaks, get-design-snapshot, and the bridge
    //     script all pick it up consistently.
    //   - If the cssVar does NOT map to a known tweak, we synthesise a minimal
    //     tweak entry and persist via the raw cssVar key so the bridge script
    //     (`TWEAK_BRIDGE_SCRIPT`) still applies it.
    const newSelections = { ...prevSelections };

    for (const { cssVar, value } of edits) {
      const tweakId = cssVarToTweakId.get(cssVar);
      if (tweakId) {
        newSelections[tweakId] = value;
      } else {
        // Fallback: persist using the cssVar as the key — the bridge script
        // calls documentElement.style.setProperty with the key directly, so
        // any key starting with "--" is applied as-is.
        newSelections[cssVar] = value;
      }
    }

    // ------------------------------------------------------------------
    // Persist — same atomic write as apply-tweaks
    // ------------------------------------------------------------------
    const mergedData: Record<string, unknown> = {
      ...prevData,
      tweakSelections: newSelections,
      tweaksAppliedAt: now,
    };

    await db
      .update(schema.designs)
      .set({ data: JSON.stringify(mergedData), updatedAt: now })
      .where(eq(schema.designs.id, designId));

    // Resolve to full CSS var map for the response (so the caller can send a
    // tweak-values postMessage without a separate round-trip)
    const resolvedCssVars = resolveTweaksToCssVars(tweaks, newSelections);

    return {
      designId,
      persisted: true,
      /**
       * Advisory when real-app source write-back is not yet available.
       * `null` means the edit was fully applied via the Tweaks loop.
       */
      writeTokensAdvisory: canWriteTokens
        ? null
        : "Token source write-back is not yet available for this source tier. " +
          "The value is persisted in the design's tweakSelections and reflected " +
          "live via the CSS-var bridge. Connect Builder to unlock real write-back.",
      /** Resolved CSS var map — pass directly to the tweak-values postMessage. */
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
