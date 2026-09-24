import { describe, expect, it } from "vitest";

import {
  parseShadowLayers,
  readBlurFilter,
  remapIndexedShadowStash,
  removeBlurFilterValue,
  serializeShadowLayers,
  setBlurFilterValue,
} from "./effects-properties";

describe("effect CSS persistence", () => {
  it("adds layer blur without deleting sibling filter effects", () => {
    expect(setBlurFilterValue("brightness(1.2) contrast(90%)", 4)).toBe(
      "brightness(1.2) contrast(90%) blur(4px)",
    );
  });

  it("updates an existing blur in place without disturbing filter order", () => {
    expect(
      setBlurFilterValue("brightness(1.2) blur(4px) saturate(80%)", 6.5),
    ).toBe("brightness(1.2) blur(6.5px) saturate(80%)");
  });

  it("removes only blur and preserves sibling filters", () => {
    expect(
      removeBlurFilterValue(
        "brightness(1.2) blur(6.5px) drop-shadow(0 2px 4px #0008)",
      ),
    ).toBe("brightness(1.2) drop-shadow(0 2px 4px #0008)");
    expect(removeBlurFilterValue("blur(4px)")).toBe("none");
  });

  it("keeps one-decimal blur precision and clamps negative blur", () => {
    expect(readBlurFilter("blur(.5px)")).toBe(0.5);
    expect(setBlurFilterValue("blur(4px)", 2.56)).toBe("blur(2.6px)");
    expect(setBlurFilterValue("blur(4px)", -2)).toBe("blur(0px)");
  });

  it("round-trips fractional and negative shadow geometry", () => {
    const serialized = serializeShadowLayers([
      {
        id: "shadow-0",
        x: -1.25,
        y: 2.55,
        blur: 3.45,
        spread: -4.25,
        color: "rgba(0, 0, 0, 0.25)",
        inset: false,
      },
    ]);

    expect(serialized).toBe("-1.2px 2.6px 3.5px -4.2px rgba(0, 0, 0, 0.25)");
    expect(parseShadowLayers(serialized)[0]).toMatchObject({
      x: -1.2,
      y: 2.6,
      blur: 3.5,
      spread: -4.2,
      color: "rgba(0, 0, 0, 0.25)",
    });
  });

  it("clamps only shadow blur while keeping negative spread valid", () => {
    expect(
      serializeShadowLayers([
        {
          id: "shadow-0",
          x: 0,
          y: 0,
          blur: -3,
          spread: -7.5,
          color: "#000000",
          inset: true,
        },
      ]),
    ).toBe("inset 0px 0px 0px -7.5px #000000");
  });

  it("keeps a hidden shadow's original alpha attached through reorder", () => {
    const stash = {
      "node-1:shadow:shadow-1": "rgba(0, 0, 0, 0.6)",
      "node-1:filter:blur": "8",
    };
    const reordered = remapIndexedShadowStash(stash, "node-1", [
      { id: "shadow-1" },
      { id: "shadow-0" },
    ]);

    expect(reordered).toEqual({
      "node-1:shadow:shadow-0": "rgba(0, 0, 0, 0.6)",
      "node-1:filter:blur": "8",
    });
  });

  it("shifts a hidden shadow's stash when an earlier layer is removed", () => {
    expect(
      remapIndexedShadowStash(
        { "node-1:shadow:shadow-1": "rgba(1, 2, 3, 0.7)" },
        "node-1",
        [{ id: "shadow-1" }],
      ),
    ).toEqual({ "node-1:shadow:shadow-0": "rgba(1, 2, 3, 0.7)" });
  });

  it("drops a removed hidden layer's stale stash", () => {
    expect(
      remapIndexedShadowStash(
        {
          "node-1:shadow:shadow-0": "rgba(1, 2, 3, 0.7)",
          "node-1:filter:blur": "4",
        },
        "node-1",
        [],
      ),
    ).toEqual({ "node-1:filter:blur": "4" });
  });

  it("preserves state identity when indexed stashes already match", () => {
    const stash = { "node-1:shadow:shadow-0": "rgba(1, 2, 3, 0.7)" };
    expect(remapIndexedShadowStash(stash, "node-1", [{ id: "shadow-0" }])).toBe(
      stash,
    );
  });
});
