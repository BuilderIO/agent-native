/**
 * preview-shader-fill — preview-only action.
 *
 * Returns the CSS mesh-gradient approximation for a shader fill so the caller
 * can apply it to the selected node via the `shader-fill-preview` bridge
 * message **without persisting anything**.
 *
 * Deliberately lightweight:
 * - No DB access.
 * - No Yjs / collab writes.
 * - No bridge message sent by this action — the client consumes the returned
 *   CSS and decides how to forward it to the iframe.
 *
 * Composes with motion: the `speed` field on the descriptor can be keyframed
 * later via `apply-motion-edit` once CSS-animation support is proven; for now
 * the preview is static-CSS-only (no WebGL, no canvas).
 *
 * Plan reference: DESIGN-STUDIO-PLAN.md §6.7 + §7 (`preview-shader-fill`).
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  generateShaderFillPreviewCss,
  generateShaderFillFallbackCss,
  buildShaderFillFallbackBlock,
} from "../shared/shader-fill.js";
import {
  SHADER_PRESET_MAP,
  type ShaderDescriptor,
  type ShaderPresetName,
  validateDescriptor,
} from "../shared/shader-presets.js";

// ─── Schema ──────────────────────────────────────────────────────────────────

const PRESET_NAMES = Object.keys(SHADER_PRESET_MAP) as [
  ShaderPresetName,
  ...ShaderPresetName[],
];

const descriptorSchema = z.object({
  preset: z
    .enum(PRESET_NAMES)
    .describe("Shader preset name.  One of: " + PRESET_NAMES.join(", ")),
  params: z
    .record(z.string(), z.union([z.number(), z.boolean(), z.string()]))
    .optional()
    .default({})
    .describe("Shader-specific params.  Merge with preset defaults."),
  colors: z
    .array(z.string())
    .optional()
    .describe("Colour palette override.  Falls back to preset defaults."),
  speed: z
    .number()
    .optional()
    .describe(
      "Animation speed multiplier (1 = normal).  Stored for future motion keyframe support; no effect on the static CSS preview.",
    ),
  frame: z.number().optional().describe("Static frame time (0–10000)."),
  fit: z.enum(["none", "contain", "cover"]).optional(),
  scale: z.number().optional(),
  rotation: z.number().optional().describe("Rotation in radians."),
  offsetX: z.number().optional(),
  offsetY: z.number().optional(),
});

const targetSchema = z
  .object({
    nodeId: z.string().optional(),
    selector: z.string().optional(),
  })
  .optional()
  .describe(
    "Target element.  Provide nodeId or CSS selector.  When omitted, the root artboard container is targeted.",
  );

// ─── Action ──────────────────────────────────────────────────────────────────

export default defineAction({
  description: `
Preview a CSS mesh-gradient shader fill on the selected design node without persisting anything.

Returns:
- previewCss   — a CSS \`background\` value for the live preview (inject via the shader-fill-preview bridge message).
- fallbackCss  — a simpler static CSS \`background\` for export / PDF / SSR contexts.
- fallbackBlock — a complete CSS rule block (selector + fallback background) ready to embed.
- descriptor   — the resolved and validated ShaderDescriptor.
- bridgeMessage — a ready-to-use JSON bridge payload for the iframe shader-fill-preview message.

Call this before apply-shader-fill.  The preview is purely CSS — no WebGL, no canvas, no writes.

Motion note: the \`speed\` field is accepted and stored on the descriptor for future motion-keyframe
support; it has no effect on the static CSS preview output today.
  `.trim(),
  schema: z.object({
    descriptor: descriptorSchema,
    target: targetSchema,
  }),
  readOnly: true,
  run: async ({ descriptor: rawDescriptor, target }) => {
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

    // Validate against the preset manifest so the caller gets clear errors
    // before wasting a round-trip to the iframe.
    const validation = validateDescriptor(descriptor);
    if (!validation.valid) {
      return {
        ok: false,
        errors: validation.errors,
        descriptor,
        hint: "Fix the descriptor errors and retry.  Call get-shader to see the full preset catalog.",
      };
    }

    const previewCss = generateShaderFillPreviewCss(descriptor);
    const fallbackCss = generateShaderFillFallbackCss(descriptor);

    // Build a selector string for the fallback block — prefer nodeId selector.
    const selector = target?.selector
      ? target.selector
      : target?.nodeId
        ? `[data-agent-native-node-id="${target.nodeId}"]`
        : ":root";

    const fallbackBlock = buildShaderFillFallbackBlock(selector, descriptor);

    // Build a ready-to-post bridge payload for the iframe.
    // The `shader-fill-preview` message type is handled by DesignCanvas.tsx.
    const bridgeMessage = {
      type: "shader-fill-preview",
      selector: target?.selector ?? null,
      nodeId: target?.nodeId ?? null,
      css: previewCss,
      // Metadata so the client can attach a "preview only" badge.
      _preview: true,
      _source: "shader-fill",
      _preset: descriptor.preset,
    };

    const instructions = [
      `== Preview CSS (set as \`background\` on the target element) ==`,
      previewCss,
      ``,
      `== Static Fallback CSS (for export/SSR — set as \`background\`) ==`,
      fallbackCss,
      ``,
      `== Fallback block (embed in a <style> tag) ==`,
      fallbackBlock,
      ``,
      `== Bridge message (post to the iframe) ==`,
      JSON.stringify(bridgeMessage, null, 2),
      ``,
      `Apply steps:`,
      `1. Inject the previewCss via a bridge "shader-fill-preview" message (no write, no persist).`,
      `2. If the user approves, call apply-shader-fill — but note that action is currently GATED`,
      `   and will return a clear not-yet-available result until runtime rendering +`,
      `   source-write + diff proof are all in place.`,
      `3. For inline/Alpine artboards, apply-shader (the existing planning action) returns`,
      `   a <canvas data-shader=...> element that the design runtime mounts as WebGL.`,
    ].join("\n");

    return {
      ok: true,
      descriptor,
      previewCss,
      fallbackCss,
      fallbackBlock,
      bridgeMessage,
      instructions,
      note: "This is a preview-only result.  Nothing was written to the database or source.",
    };
  },
});
