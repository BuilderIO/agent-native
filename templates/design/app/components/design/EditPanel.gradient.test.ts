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

  it("parses bare CSS named colors as gradient stops instead of dropping them", () => {
    // Regression: readLeadingColor only recognized hex/transparent/function
    // colors, so a plain named-color stop like "red" (extremely common in
    // hand-authored or generated CSS) was misread as a gradient *prefix* —
    // silently dropping that stop and corrupting an otherwise-valid 2-stop
    // gradient into a broken 1-stop one with a garbage "red" prefix.
    const parsed = parseGradientLayer("linear-gradient(red, blue)");

    expect(parsed).not.toBeNull();
    expect(parsed?.prefix).toBeUndefined();
    expect(parsed?.stops).toHaveLength(2);
    expect(parsed?.stops[0]?.color).toBe("#ff0000");
    expect(parsed?.stops[1]?.color).toBe("#0000ff");
  });

  it("still treats direction/shape keywords as a prefix, not a color", () => {
    const linear = parseGradientLayer(
      "linear-gradient(to right, red 0%, blue 100%)",
    );
    expect(linear?.prefix).toBe("to right");
    expect(linear?.stops).toHaveLength(2);

    const radial = parseGradientLayer(
      "radial-gradient(circle at 50% 50%, red 0%, blue 100%)",
    );
    expect(radial?.prefix).toBe("circle at 50% 50%");
    expect(radial?.stops).toHaveLength(2);
  });

  it("preserves a named-color angle prefix round-trip through buildGradientLayer", () => {
    const parsed = parseGradientLayer(
      "linear-gradient(135deg, red 0%, blue 100%)",
    );
    expect(parsed).not.toBeNull();
    expect(
      buildGradientLayer(parsed!.type, parsed!.stops, parsed!.prefix),
    ).toBe("linear-gradient(135deg, #ff0000 0%, #0000ff 100%)");
  });
});
