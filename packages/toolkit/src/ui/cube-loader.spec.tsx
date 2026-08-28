import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CubeLoader } from "./cube-loader.js";

describe("CubeLoader", () => {
  it("honors explicit sizing and decorative semantics", () => {
    const loader = CubeLoader({
      "aria-label": undefined,
      role: undefined,
      size: 10,
    }) as ReactElement<Record<string, unknown>>;

    expect(loader.props.width).toBe(10);
    expect(loader.props.height).toBe(10);
    expect(loader.props.className).not.toContain("size-4");
    expect(loader.props.role).toBeUndefined();
    expect(loader.props["aria-label"]).toBeUndefined();
  });

  it("adds accessible defaults when role semantics are omitted", () => {
    const loader = CubeLoader({}) as ReactElement<Record<string, unknown>>;

    expect(loader.props.role).toBe("status");
    expect(loader.props["aria-label"]).toBe("Loading");
    expect(loader.props.className).toContain("size-4");
  });

  it("anchors its cells to the page timeline when mounted again", () => {
    expect(renderToStaticMarkup(createElement(CubeLoader))).toContain(
      "calc(90ms - var(--an-cube-loader-phase, 0ms))",
    );
  });

  it("preserves a caller ref while anchoring its phase", () => {
    const callerRef = vi.fn();
    const loader = CubeLoader({ ref: callerRef }) as ReactElement<{
      ref: (svg: SVGSVGElement | null) => void;
    }>;
    const svg = {} as SVGSVGElement;

    loader.props.ref(svg);

    expect(callerRef).toHaveBeenCalledWith(svg);
  });
});
