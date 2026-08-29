// @vitest-environment happy-dom

import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CubeLoader } from "./cube-loader.js";
import { Spinner } from "./spinner.js";

describe("CubeLoader", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("honors explicit sizing and decorative semantics", () => {
    const loader = renderToStaticMarkup(
      createElement(CubeLoader, {
        "aria-label": undefined,
        role: undefined,
        size: 10,
      }),
    );

    expect(loader).toContain('width="10"');
    expect(loader).toContain('height="10"');
    expect(loader).not.toContain('class="size-4"');
    expect(loader).not.toContain("role=");
    expect(loader).not.toContain("aria-label=");
  });

  it("adds accessible defaults when role semantics are omitted", () => {
    const loader = renderToStaticMarkup(createElement(CubeLoader));

    expect(loader).toContain('role="status"');
    expect(loader).toContain('aria-label="Loading"');
    expect(loader).toContain('class="size-4"');
  });

  it("keeps aria-hidden loaders decorative", () => {
    const loader = renderToStaticMarkup(
      createElement(CubeLoader, { "aria-hidden": true }),
    );

    expect(loader).not.toContain("role=");
    expect(loader).not.toContain("aria-label=");
  });

  it("uses the cube for the shared spinner primitive", () => {
    const spinner = renderToStaticMarkup(
      createElement(Spinner, { className: "size-8" }),
    );

    expect(spinner).toContain('data-agent-native-cube-loader="true"');
    expect(spinner).toContain('class="size-8"');
    expect(spinner).not.toContain("animate-spin");
  });

  it("anchors its cells to the page timeline when mounted again", () => {
    expect(renderToStaticMarkup(createElement(CubeLoader))).toContain(
      "calc(90ms - var(--an-cube-loader-phase, 0ms))",
    );
  });

  it("preserves a caller ref without reattaching on rerenders", () => {
    const callerRef = vi.fn();

    act(() => {
      root.render(<CubeLoader ref={callerRef} data-testid="first-render" />);
    });
    expect(callerRef).toHaveBeenCalledTimes(1);
    expect(callerRef).toHaveBeenLastCalledWith(expect.any(SVGSVGElement));

    act(() => {
      root.render(<CubeLoader ref={callerRef} data-testid="second-render" />);
    });

    expect(callerRef).toHaveBeenCalledTimes(1);
  });
});
