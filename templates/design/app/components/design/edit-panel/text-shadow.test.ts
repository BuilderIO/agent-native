import { describe, expect, it } from "vitest";

import {
  parseShadowLayers,
  serializeShadowLayers,
  serializeTextShadowLayers,
  type ShadowLayer,
} from "./effects-properties";

function layer(overrides: Partial<ShadowLayer> = {}): ShadowLayer {
  return {
    id: "shadow-0",
    x: 0,
    y: 4,
    blur: 12,
    spread: 0,
    color: "rgba(0, 0, 0, 0.25)",
    inset: false,
    ...overrides,
  };
}

describe("serializeTextShadowLayers", () => {
  it("emits offsets, blur, and colour only", () => {
    expect(serializeTextShadowLayers([layer()])).toBe(
      "0px 4px 12px rgba(0, 0, 0, 0.25)",
    );
  });

  it("omits spread, which text-shadow has no slot for", () => {
    // Keeping the spread token would make the whole declaration invalid and the
    // browser would drop it, so the shadow would silently not render.
    const value = serializeTextShadowLayers([layer({ spread: 6 })]);
    expect(value).toBe("0px 4px 12px rgba(0, 0, 0, 0.25)");
    expect(serializeShadowLayers([layer({ spread: 6 })])).toContain("6px");
  });

  it("drops inset layers, which text-shadow cannot express", () => {
    expect(serializeTextShadowLayers([layer({ inset: true })])).toBe("none");
  });

  it("keeps non-inset layers when mixed with inset ones", () => {
    const value = serializeTextShadowLayers([
      layer({ id: "shadow-0", inset: true }),
      layer({ id: "shadow-1", x: 2, y: 3, blur: 0, color: "red" }),
    ]);
    expect(value).toBe("2px 3px 0px red");
  });

  it("serializes multiple shadows comma-separated", () => {
    const value = serializeTextShadowLayers([
      layer({ id: "shadow-0", x: 1, y: 1, blur: 0, color: "red" }),
      layer({ id: "shadow-1", x: 2, y: 2, blur: 1, color: "blue" }),
    ]);
    expect(value).toBe("1px 1px 0px red, 2px 2px 1px blue");
  });

  it("clamps negative blur, which CSS rejects", () => {
    expect(serializeTextShadowLayers([layer({ blur: -5 })])).toContain("0px");
  });

  it("returns none for an empty layer list", () => {
    expect(serializeTextShadowLayers([])).toBe("none");
  });

  it("round-trips through the shared parser", () => {
    // The panel reads text shadows back with parseShadowLayers, so what this
    // writes has to parse into the same offsets/blur/colour.
    const parsed = parseShadowLayers(serializeTextShadowLayers([layer()]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      x: 0,
      y: 4,
      blur: 12,
      inset: false,
    });
  });
});
