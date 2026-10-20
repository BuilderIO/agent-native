// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { CachedLeaf } from "./native-source-provider";
import {
  serializeNativeSvgGroupSource,
  serializeNativeSvgSource,
} from "./native-svg-source";

const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 260 240");
  svg.innerHTML =
    '<path d="M0 0H260V240H0Z M100 80V160H160V80Z" fill-rule="evenodd" fill-opacity="0.4"/>';
  document.body.append(svg);
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    (element) =>
      ({
        backgroundColor: "rgba(0, 0, 0, 0)",
        backgroundImage: "none",
        boxShadow: "none",
        outlineStyle: "none",
        borderTopLeftRadius: "0px",
        borderTopRightRadius: "0px",
        borderBottomRightRadius: "0px",
        borderBottomLeftRadius: "0px",
        paddingTop: "0px",
        paddingRight: "0px",
        paddingBottom: "0px",
        paddingLeft: "0px",
        overflowX: "visible",
        overflowY: "visible",
        colorInterpolation: "sRGB",
        fill: "rgb(200, 100, 50)",
        stroke: "none",
        fillRule: element.getAttribute("fill-rule") ?? "nonzero",
        fillOpacity: element.getAttribute("fill-opacity") ?? "1",
        opacity: element === svg ? "0.6" : "1",
        transform: element === svg ? "matrix(2, 0, 0, 2, 10, 20)" : "none",
        getPropertyValue: (name: string) =>
          name === "d" && element.hasAttribute("d")
            ? `path("${element.getAttribute("d")}")`
            : "",
      }) as CSSStyleDeclaration,
  );
  return {
    svg,
    child: {
      svg,
      size: { width: 260, height: 240 },
      localToGroup: { ...identity, a: 2, d: 2, e: 40, f: 100 },
    },
  };
}

describe("imported SVG group coverage", () => {
  it("preserves vector holes, partial paint, and child affine placement under a bounded group clip", () => {
    const { svg, child } = fixture();
    const before = svg.outerHTML;
    const markup = serializeNativeSvgGroupSource([child], {
      width: 715,
      height: 475,
    });
    const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
    expect(parsed.documentElement.getAttribute("overflow")).toBe("hidden");
    expect(parsed.querySelector("g")!.getAttribute("transform")).toBe(
      "matrix(2 0 0 2 40 100)",
    );
    expect(parsed.querySelector("g")!.getAttribute("opacity")).toBe("0.6");
    expect(parsed.querySelector("g > svg")!.getAttribute("transform")).toBe(
      "none",
    );
    expect(parsed.querySelector("path")!.getAttribute("fill-rule")).toBe(
      "evenodd",
    );
    expect(parsed.querySelector("path")!.getAttribute("fill-opacity")).toBe(
      "0.4",
    );
    expect(parsed.querySelector("path")!.getAttribute("fill")).toBe(
      "rgb(200, 100, 50)",
    );
    expect(parsed.querySelector("path")!.getAttribute("d")).toContain(
      "M100 80V160H160V80Z",
    );
    expect(svg.outerHTML).toBe(before);
  });

  it("keeps standalone visible-overflow SVG capture unsupported", () => {
    const { svg, child } = fixture();
    expect(() =>
      serializeNativeSvgSource(svg, child.size, child.size, "coverage"),
    ).toThrow(
      expect.objectContaining({ code: "source-svg-overflow-unsupported" }),
    );
  });

  it("rejects unreadable affine geometry and conflicting paint IDs", () => {
    const { svg, child } = fixture();
    expect(() =>
      serializeNativeSvgGroupSource(
        [{ ...child, localToGroup: { ...identity, a: Number.NaN } }],
        child.size,
      ),
    ).toThrow(
      expect.objectContaining({ code: "source-svg-transform-unsupported" }),
    );
    svg.querySelector("path")!.setAttribute("id", "paint");
    expect(() =>
      serializeNativeSvgGroupSource([child, child], child.size),
    ).toThrow(expect.objectContaining({ code: "source-svg-id-duplicate" }));
  });

  it("invalidates an aggregate capture when a descendant moves", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    const group = document.createElement("div");
    const child = document.createElement("div");
    group.append(child);
    document.body.append(group);
    Object.defineProperties(group, {
      offsetWidth: { value: 100 },
      offsetHeight: { value: 100 },
    });
    const raster = vi.fn(
      async (_node: HTMLElement, canvas: HTMLCanvasElement) => {
        canvas.width = 100;
        canvas.height = 100;
      },
    );
    const leaf = new CachedLeaf(
      group,
      () => {},
      () => 1,
      raster,
      () => {},
      () => {},
      () => {},
      true,
    );
    try {
      await leaf.read();
      child.style.left = "20px";
      await vi.waitFor(async () => {
        await leaf.read();
        expect(raster).toHaveBeenCalledTimes(2);
      });
    } finally {
      leaf.dispose();
    }
  });
});
