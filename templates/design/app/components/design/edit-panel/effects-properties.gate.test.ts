/**
 * Effects-section empty-spacer gate tests (B5-13, third report).
 *
 * Root cause of the repeated regression: EffectsProperties gated its
 * collapsed-empty state on `Boolean(glslShaderContext?.nodeId)`. But
 * `nodeId` is the SELECTION TARGET's node id — it is set for every selected
 * element that could host a shader, regardless of whether a shader effect
 * actually exists on it. So for any plain element selected on a real design
 * the gate was always true, and PanelSection rendered its empty spacer div
 * (`space-y-1.5 px-3 pb-3 pt-0.5`) under the header.
 *
 * The fix derives "an effect actually exists" from the screen's shader
 * mounts — the same `screen.mounts.find(m => m.nodeId === nodeId &&
 * m.mode === "effect")` lookup GlslShaderEffectSection itself performs.
 * This template has no jsdom/testing-library (see
 * ScrubInput.gesture.test.ts's header), so per that file's precedent these
 * tests drive the same exported primitive (listShaderMounts) through the
 * exact predicate the component uses, against realistic screen HTML.
 */

import { listShaderMounts } from "@shared/shader-fills";
import { describe, expect, it } from "vitest";

/** The exact hasShaderEffect predicate EffectsProperties now uses. */
function hasShaderEffect(html: string, nodeId: string | undefined): boolean {
  const mounts = listShaderMounts(html);
  return Boolean(
    nodeId &&
    mounts.some((mount) => mount.nodeId === nodeId && mount.mode === "effect"),
  );
}

/** The full section gate, mirroring EffectsProperties' hasEffectsContent. */
function hasEffectsContent(options: {
  shadowLayerCount: number;
  filterHasBlur: boolean;
  backdropFilterHasBlur: boolean;
  html: string;
  nodeId: string | undefined;
  shaderPickerOpen: boolean;
}): boolean {
  return (
    options.shadowLayerCount > 0 ||
    options.filterHasBlur ||
    options.backdropFilterHasBlur ||
    hasShaderEffect(options.html, options.nodeId) ||
    options.shaderPickerOpen
  );
}

const PLAIN_SCREEN_HTML = `<!DOCTYPE html>
<html><body>
  <div data-agent-native-node-id="card-1" class="card">Finalize Q3 roadmap deck</div>
  <div data-agent-native-node-id="card-2" class="card">Review pull request #482</div>
</body></html>`;

const SHADER_EFFECT_SCREEN_HTML = `<!DOCTYPE html>
<html><body>
  <div data-agent-native-node-id="card-1" data-an-shader-effect="shader_abc123">glowing card</div>
  <div data-agent-native-node-id="card-2">plain card</div>
  <script type="application/x-agent-native-shader" data-shader-id="shader_abc123" data-shader-name="Glow" data-shader-mode="effect">
void main() { gl_FragColor = vec4(1.0); }
</script>
</body></html>`;

const SHADER_FILL_ONLY_HTML = `<!DOCTYPE html>
<html><body>
  <div data-agent-native-node-id="card-1" data-an-shader-fill="shader_fill9">shader-filled card</div>
</body></html>`;

describe("Effects gate — shader presence (B5-13)", () => {
  it("a selected plain element (nodeId set, no shader anywhere) does NOT count as effects content", () => {
    // This is the exact regression: nodeId truthy for every selection.
    expect(hasShaderEffect(PLAIN_SCREEN_HTML, "card-1")).toBe(false);
    expect(
      hasEffectsContent({
        shadowLayerCount: 0,
        filterHasBlur: false,
        backdropFilterHasBlur: false,
        html: PLAIN_SCREEN_HTML,
        nodeId: "card-1",
        shaderPickerOpen: false,
      }),
    ).toBe(false);
  });

  it("an element with an applied shader EFFECT counts as effects content", () => {
    expect(hasShaderEffect(SHADER_EFFECT_SCREEN_HTML, "card-1")).toBe(true);
    expect(
      hasEffectsContent({
        shadowLayerCount: 0,
        filterHasBlur: false,
        backdropFilterHasBlur: false,
        html: SHADER_EFFECT_SCREEN_HTML,
        nodeId: "card-1",
        shaderPickerOpen: false,
      }),
    ).toBe(true);
  });

  it("a shader effect on a DIFFERENT node does not leak into this selection", () => {
    expect(hasShaderEffect(SHADER_EFFECT_SCREEN_HTML, "card-2")).toBe(false);
  });

  it("a shader FILL (not effect) on the node does not open the Effects section", () => {
    expect(hasShaderEffect(SHADER_FILL_ONLY_HTML, "card-1")).toBe(false);
  });

  it("no nodeId (nothing selected / not a shader host) is never effects content", () => {
    expect(hasShaderEffect(SHADER_EFFECT_SCREEN_HTML, undefined)).toBe(false);
  });

  it("opening the shader picker shows the section even before an effect exists", () => {
    // Mirrors GlslShaderEffectSection's own `!effectMount && !pickerOpen`
    // early return: while the picker is open the section must render so the
    // picker itself has somewhere to appear.
    expect(
      hasEffectsContent({
        shadowLayerCount: 0,
        filterHasBlur: false,
        backdropFilterHasBlur: false,
        html: PLAIN_SCREEN_HTML,
        nodeId: "card-1",
        shaderPickerOpen: true,
      }),
    ).toBe(true);
  });

  it("classic effects (shadows/blur) still gate the section on their own", () => {
    expect(
      hasEffectsContent({
        shadowLayerCount: 1,
        filterHasBlur: false,
        backdropFilterHasBlur: false,
        html: PLAIN_SCREEN_HTML,
        nodeId: "card-1",
        shaderPickerOpen: false,
      }),
    ).toBe(true);
    expect(
      hasEffectsContent({
        shadowLayerCount: 0,
        filterHasBlur: true,
        backdropFilterHasBlur: false,
        html: PLAIN_SCREEN_HTML,
        nodeId: undefined,
        shaderPickerOpen: false,
      }),
    ).toBe(true);
  });
});
