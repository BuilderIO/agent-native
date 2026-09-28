import { describe, expect, it } from "vitest";

import { composeIndividualTransforms } from "./export-individual-transforms";

const none = {
  transform: "none",
  translate: "none",
  rotate: "none",
  scale: "none",
};

describe("composeIndividualTransforms", () => {
  it("leaves layers without individual transforms to html2canvas", () => {
    expect(composeIndividualTransforms(none)).toBeNull();
    expect(
      composeIndividualTransforms({
        ...none,
        transform: "matrix(1, 0, 0, 1, 4, 0)",
      }),
    ).toBeNull();
    expect(
      composeIndividualTransforms({
        transform: "",
        translate: "",
        rotate: "",
        scale: "",
      }),
    ).toBeNull();
  });

  it("keeps a flip applied through scale ahead of the layer's rotation", () => {
    const rotation =
      "matrix3d(0.906923, -0.201485, -0.369993, 0, 0.192772, 0.979358, -0.0608022, 0, 0.374607, -0.0161816, 0.927043, 0, 0, 0, 0, 1)";
    expect(
      composeIndividualTransforms({
        ...none,
        transform: rotation,
        scale: "1 -1",
      }),
    ).toBe(`scale(1, -1) ${rotation}`);
  });

  it("applies translate, rotate, then scale like CSS does", () => {
    expect(
      composeIndividualTransforms({
        transform: "none",
        translate: "calc(50% + 4px) -10px",
        rotate: "45deg",
        scale: "-1",
      }),
    ).toBe("translate(calc(50% + 4px), -10px) rotate(45deg) scale(-1)");
  });

  it("converts 3D and axis forms of the individual properties", () => {
    expect(
      composeIndividualTransforms({
        transform: "none",
        translate: "1px 2px 3px",
        rotate: "x 30deg",
        scale: "1 -1 2",
      }),
    ).toBe("translate3d(1px, 2px, 3px) rotateX(30deg) scale3d(1, -1, 2)");
    expect(
      composeIndividualTransforms({ ...none, rotate: "0 0 1 90deg" }),
    ).toBe("rotate3d(0, 0, 1, 90deg)");
    expect(composeIndividualTransforms({ ...none, scale: "50% 200%" })).toBe(
      "scale(0.5, 2)",
    );
  });

  it("fails loudly on a computed value it cannot express", () => {
    expect(() =>
      composeIndividualTransforms({ ...none, rotate: "w 30deg" }),
    ).toThrow(/Unsupported computed rotate/);
  });
});
