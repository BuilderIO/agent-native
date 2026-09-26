
import { listShaderMounts } from "@shared/shader-fills";
import { describe, expect, it } from "vitest";

function hasShaderEffect(html: string, nodeId: string | undefined): boolean {
  const mounts = listShaderMounts(html);
  return Boolean(
    nodeId &&
    mounts.some((mount) => mount.nodeId === nodeId && mount.mode === "effect"),
  );
}

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
