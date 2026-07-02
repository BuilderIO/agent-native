import { describe, expect, it } from "vitest";

import { buildGradientLayer, parseGradientLayer } from "./EditPanel";

describe("EditPanel gradient layer serialization", () => {
  it("preserves a linear gradient angle when editing stops", () => {
    const parsed = parseGradientLayer(
      "linear-gradient(135deg, #111111 0%, #eeeeee 100%)",
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.prefix).toBe("135deg");
    expect(
      buildGradientLayer(
        parsed!.type,
        [{ ...parsed!.stops[0]!, color: "#222222" }, parsed!.stops[1]!],
        parsed!.prefix,
      ),
    ).toBe("linear-gradient(135deg, #222222 0%, #eeeeee 100%)");
  });

  it("preserves conic gradient geometry when editing stops", () => {
    const parsed = parseGradientLayer(
      "conic-gradient(from 45deg at 30% 70%, #111111 0%, #eeeeee 100%)",
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe("angular");
    expect(parsed?.prefix).toBe("from 45deg at 30% 70%");
    expect(
      buildGradientLayer(parsed!.type, parsed!.stops, parsed!.prefix),
    ).toBe("conic-gradient(from 45deg at 30% 70%, #111111 0%, #eeeeee 100%)");
  });

  it("parses modern CSS color functions as editable gradient stops", () => {
    const parsed = parseGradientLayer(
      "linear-gradient(42deg, oklch(70% 0.1 200) 0%, color-mix(in srgb, red 40%, blue) 100%)",
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.prefix).toBe("42deg");
    expect(parsed?.stops).toHaveLength(2);
    expect(parsed?.stops[0]?.color).toBe("oklch(70% 0.1 200)");
    expect(parsed?.stops[1]?.color).toBe("color-mix(in srgb, red 40%, blue)");
  });
});
