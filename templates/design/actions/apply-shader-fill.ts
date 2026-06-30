/**
 * apply-shader-fill — GATED apply action.
 *
 * This action is PREVIEW-FIRST per DESIGN-STUDIO-PLAN.md §6.7 + §14:
 *
 *   "Shaders: preview-first; apply/export of a shader stays DISABLED/gated
 *    until runtime rendering + a real source-write path + a generated CSS
 *    fallback + diff proof all exist."
 *
 * The apply path is safe to call today but will return a clear
 * NOT_YET_AVAILABLE result with an exact checklist of the missing conditions.
 * It NEVER silently writes when gated — the caller always gets explicit
 * feedback.
 *
 * Safety conditions that must ALL be true before writes are enabled:
 *
 *   1. RUNTIME_RENDERING — a WebGL shader canvas mounts and renders correctly
 *      in the iframe (verified by a bridge captureSnapshot round-trip).
 *   2. SOURCE_WRITE_PATH — the source write bridge (`writeFile` / `applyEdit`)
 *      is available for this design's sourceType (currently `planned` for all
 *      tiers).
 *   3. CSS_FALLBACK — a generated static CSS fallback is embedded alongside
 *      the shader canvas so designs degrade gracefully in export/SSR.
 *   4. DIFF_PROOF — the action can produce a before/after diff of the source
 *      change so the edit is reviewable and rollback-able.
 *
 * When all conditions hold, the action delegates to `apply-shader` (the
 * existing planning action) for the actual snippet generation, then writes
 * through the collab / Yjs path (same as `apply-visual-edit`).
 *
 * Plan reference: DESIGN-STUDIO-PLAN.md §6.7, §7, §14.
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  generateShaderFillPreviewCss,
  generateShaderFillFallbackCss,
} from "../shared/shader-fill.js";
import {
  SHADER_PRESET_MAP,
  type ShaderDescriptor,
  type ShaderPresetName,
  validateDescriptor,
} from "../shared/shader-presets.js";

// ─── Safety gate ─────────────────────────────────────────────────────────────

/**
 * All conditions that must hold before an apply write is allowed.
 * Each entry has a `met` flag and a human-readable `reason` explaining what
 * is still missing and (where possible) what would unlock it.
 */
interface SafetyCondition {
  id: string;
  label: string;
  met: boolean;
  reason: string;
  /** Rough work estimate to unlock this condition. */
  effort: "days" | "weeks" | "unknown";
}

/**
 * Evaluate the safety conditions for a given sourceType.
 *
 * In the current phase (6, shaders/plugins/assets) NONE of the write
 * conditions are met for any source type.  The checks are structured so
 * that future implementers can flip individual conditions to `true` as the
 * corresponding work lands, without changing the surrounding gate logic.
 */
function evaluateSafetyConditions(
  sourceType: "inline" | "localhost" | "fusion",
): SafetyCondition[] {
  return [
    {
      id: "RUNTIME_RENDERING",
      label: "Runtime WebGL rendering verified",
      // Not yet verified: requires a captureSnapshot bridge round-trip that
      // confirms the <canvas data-shader=...> element mounted + rendered.
      // The bridge captureSnapshot op IS available for inline; the verification
      // tooling to confirm WebGL canvas presence is not yet built.
      met: false,
      reason:
        "The iframe captureSnapshot round-trip that verifies a WebGL shader canvas " +
        "has mounted and rendered is not yet implemented.  Until it is, we cannot " +
        "confirm the runtime renders the shader correctly before persisting.",
      effort: "days",
    },
    {
      id: "SOURCE_WRITE_PATH",
      label: "Source write bridge available",
      // `writeFile` / `applyEdit` are `planned` for all source types today.
      // Inline uses the Yjs/collab path for HTML changes (apply-visual-edit
      // style), which is available — but a shader-specific structural insert
      // (adding a <canvas> or JSX component) needs the deterministic
      // replace-document-content path AND validation that position/parenting
      // is correct, which is not yet built for shader elements specifically.
      met: false,
      reason:
        sourceType === "fusion"
          ? "Source writes (`writeFile` / `applyEdit`) are `planned` for fusion sources. " +
            "Connect Builder and complete bridge hardening to unlock."
          : sourceType === "localhost"
            ? "Source writes (`applyEdit` / `writeFile`) are `planned` for localhost. " +
              "Bridge hardening is required before structural source inserts are safe."
            : "Structural HTML insert for a shader <canvas> element via the " +
              "replace-document-content path is not yet validated for shader-fill " +
              "placement (parent positioning, z-index, collab round-trip).",
      effort: "days",
    },
    {
      id: "CSS_FALLBACK",
      label: "Generated CSS fallback embedded alongside shader",
      // The fallback CSS generator exists (shader-fill.ts) but the action that
      // writes the fallback <style> block into the document alongside the
      // <canvas> element is not yet implemented.
      met: false,
      reason:
        "The CSS fallback generator (`generateShaderFillFallbackCss`) is ready, " +
        "but the write step that embeds the fallback <style> block adjacent to the " +
        "shader <canvas> element has not been implemented.  This must ship together " +
        "with the canvas insert so designs degrade gracefully in export/PDF/SSR.",
      effort: "days",
    },
    {
      id: "DIFF_PROOF",
      label: "Before/after diff produced and returned to caller",
      // apply-visual-edit produces a diff summary; shader-fill needs the same
      // treatment — comparing the document before and after the canvas+fallback
      // insertion.  Not yet wired for this code path.
      met: false,
      reason:
        "The diff/rollback proof (bytes before/after, changed selectors, rollback " +
        "snapshot) is not yet produced for the shader-fill write path.  Without " +
        "this the edit cannot be reviewed or rolled back safely.",
      effort: "days",
    },
  ];
}

// ─── Schema ──────────────────────────────────────────────────────────────────

const PRESET_NAMES = Object.keys(SHADER_PRESET_MAP) as [
  ShaderPresetName,
  ...ShaderPresetName[],
];

const descriptorSchema = z.object({
  preset: z.enum(PRESET_NAMES),
  params: z
    .record(z.string(), z.union([z.number(), z.boolean(), z.string()]))
    .optional()
    .default({}),
  colors: z.array(z.string()).optional(),
  speed: z.number().optional(),
  frame: z.number().optional(),
  fit: z.enum(["none", "contain", "cover"]).optional(),
  scale: z.number().optional(),
  rotation: z.number().optional(),
  offsetX: z.number().optional(),
  offsetY: z.number().optional(),
});

// ─── Action ──────────────────────────────────────────────────────────────────

export default defineAction({
  description: `
Apply a shader fill to a design element.

IMPORTANT — THIS ACTION IS CURRENTLY GATED.

Per DESIGN-STUDIO-PLAN.md §6.7: "apply/export of a shader stays DISABLED/gated
until runtime rendering + a real source-write path + a generated CSS fallback +
diff proof all exist."

Calling this action today will ALWAYS return { ok: false, gated: true } with a
checklist of the conditions that must be met before writes are enabled.  It will
never write, never persist, and never imply the write happened.

To actually preview a shader fill visually, call preview-shader-fill instead.
To generate the code snippet for a manual source edit, call apply-shader instead.
  `.trim(),
  schema: z.object({
    descriptor: descriptorSchema.describe("Shader preset + params to apply."),
    target: z
      .object({
        nodeId: z.string().optional(),
        selector: z.string().optional(),
      })
      .optional()
      .describe("Target element by nodeId or CSS selector."),
    source: z
      .object({
        kind: z.enum(["design-file", "inline-html"]).default("design-file"),
        designId: z.string().optional(),
        fileId: z.string().optional(),
      })
      .optional()
      .describe("Design source context."),
    surface: z
      .enum(["fill", "effect"])
      .default("fill")
      .describe(
        "fill: shader sits behind content (z-index 0). effect: composites over content (z-index 2, pointer-events none).",
      ),
    // Safety override — only respected when ALL conditions are independently
    // verified by the caller.  The server still validates.
    _forceApply: z
      .boolean()
      .optional()
      .describe(
        "Internal: bypass the safety gate.  Only valid when all safety conditions are met.  " +
          "The server re-evaluates conditions regardless of this flag.",
      ),
  }),
  // readOnly: true because this action never writes in the current phase.
  // When the gate is lifted this will change to false.
  readOnly: true,
  run: async ({
    descriptor: rawDescriptor,
    target: _target,
    source,
    _forceApply,
  }) => {
    const descriptor: ShaderDescriptor = {
      preset: rawDescriptor.preset as ShaderPresetName,
      params: rawDescriptor.params ?? {},
      colors: rawDescriptor.colors,
      speed: rawDescriptor.speed,
      frame: rawDescriptor.frame,
      fit: rawDescriptor.fit,
      scale: rawDescriptor.scale,
      rotation: rawDescriptor.rotation,
      offsetX: rawDescriptor.offsetX,
      offsetY: rawDescriptor.offsetY,
    };

    // Validate the descriptor regardless of gate status.
    const validation = validateDescriptor(descriptor);
    if (!validation.valid) {
      return {
        ok: false,
        gated: false,
        errors: validation.errors,
        hint: "Fix the descriptor errors first.  Call get-shader to see the full preset catalog.",
      };
    }

    // Determine source type — default to inline (most permissive) when unknown.
    const sourceKind = source?.kind ?? "design-file";
    const sourceType: "inline" | "localhost" | "fusion" =
      sourceKind === "inline-html" ? "inline" : "inline";

    // Evaluate safety conditions.
    const conditions = evaluateSafetyConditions(sourceType);
    const allMet = conditions.every((c) => c.met);

    // The server-side gate: even if _forceApply is set by the caller, all
    // conditions must be met.  This prevents accidental writes from callers
    // that incorrectly set the flag.
    if (!allMet) {
      const unmet = conditions.filter((c) => !c.met);

      // Still provide the preview CSS so the caller can at least show something.
      const previewCss = generateShaderFillPreviewCss(descriptor);
      const fallbackCss = generateShaderFillFallbackCss(descriptor);

      return {
        ok: false,
        gated: true,
        status: "NOT_YET_AVAILABLE",
        message:
          "apply-shader-fill is gated until all safety conditions are met. " +
          "No data was written.  Use preview-shader-fill to see a CSS preview, " +
          "or apply-shader to get a manual-edit code snippet.",
        conditions,
        unmetConditions: unmet.map((c) => ({
          id: c.id,
          label: c.label,
          reason: c.reason,
          effort: c.effort,
        })),
        // Provide the preview anyway so the caller has something useful.
        previewCss,
        fallbackCss,
        alternativeActions: [
          {
            action: "preview-shader-fill",
            description:
              "Preview the shader fill as a CSS gradient on the target element (no write, no persist).",
          },
          {
            action: "apply-shader",
            description:
              "Generate the JSX/HTML code snippet for a manual source edit (no automatic write).",
          },
          {
            action: "get-shader",
            description: "Browse the full shader preset catalog.",
          },
        ],
      };
    }

    // ── All conditions met ──────────────────────────────────────────────────
    // This block is unreachable in the current phase (all conditions return
    // met: false).  It is scaffolded here so the implementation path is clear
    // for the engineer who lifts the gate.
    //
    // When this block becomes reachable:
    // 1. Resolve the design file (see insert-asset.ts for the pattern).
    // 2. Build the bridge mount: buildBridgeMount(descriptor, surface) from
    //    the existing apply-shader.ts helper.
    // 3. Write the <canvas data-shader=...> element into the document via
    //    the replace-document-content path (same as apply-visual-edit.ts).
    // 4. Write the CSS fallback <style> block alongside it.
    // 5. Produce a diff summary and compiledHash (same as apply-motion-edit.ts).
    // 6. Return { ok: true, ...diff }.

    return {
      ok: false,
      gated: true,
      status: "IMPLEMENTATION_INCOMPLETE",
      message:
        "All safety conditions evaluated as met, but the write implementation " +
        "is not yet complete.  This should not be reachable in the current phase.",
    };
  },
});
