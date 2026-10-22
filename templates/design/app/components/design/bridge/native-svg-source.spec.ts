// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { serializeNativeSvgSource } from "./native-svg-source";

afterEach(() => vi.restoreAllMocks());

function svgStyle(transform: string): CSSStyleDeclaration {
  const values: Record<string, string> = {
    backgroundColor: "transparent",
    backgroundImage: "none",
    boxShadow: "none",
    outlineStyle: "none",
    borderTopWidth: "0px",
    borderRightWidth: "0px",
    borderBottomWidth: "0px",
    borderLeftWidth: "0px",
    borderTopLeftRadius: "0px",
    borderTopRightRadius: "0px",
    borderBottomRightRadius: "0px",
    borderBottomLeftRadius: "0px",
    overflowX: "hidden",
    overflowY: "hidden",
    paddingTop: "0px",
    paddingRight: "0px",
    paddingBottom: "0px",
    paddingLeft: "0px",
    colorInterpolation: "srgb",
    opacity: "1",
    filter: "none",
    maskImage: "none",
    mixBlendMode: "normal",
    backdropFilter: "none",
    transform,
    fill: "rgb(255 0 0)",
    stroke: "none",
  };
  return {
    ...values,
    getPropertyValue: (name: string) => values[name] ?? "",
  } as CSSStyleDeclaration;
}

describe("native SVG transform serialization", () => {
  it("omits absent transforms while retaining a real child transform", () => {
    const root = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    root.setAttribute("viewBox", "0 0 100 100");
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("transform", "translate(5 6)");
    root.append(group);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) =>
      svgStyle(element === group ? "matrix(1, 0, 0, 1, 5, 6)" : "none"),
    );

    const serialized = serializeNativeSvgSource(root, {
      width: 100,
      height: 100,
    });
    const clone = new DOMParser().parseFromString(serialized, "image/svg+xml");
    expect(clone.documentElement.hasAttribute("transform")).toBe(false);
    expect(clone.querySelector("g")?.getAttribute("transform")).toBe(
      "matrix(1, 0, 0, 1, 5, 6)",
    );
    expect(serialized).not.toContain('transform="none"');
  });

  it("keeps gradientTransform handling independent of ordinary transforms", () => {
    const root = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    root.setAttribute("viewBox", "0 0 100 100");
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    const gradient = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "linearGradient",
    );
    gradient.id = "paint";
    defs.append(gradient);
    root.append(defs);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) =>
      svgStyle(element === gradient ? "matrix(1, 0, 0, 1, 2, 3)" : "none"),
    );

    const serialized = serializeNativeSvgSource(root, {
      width: 100,
      height: 100,
    });
    const clone = new DOMParser().parseFromString(serialized, "image/svg+xml");
    expect(
      clone.querySelector("linearGradient")?.getAttribute("gradientTransform"),
    ).toBe("matrix(1, 0, 0, 1, 2, 3)");
    expect(serialized).not.toContain('transform="none"');
  });
});
