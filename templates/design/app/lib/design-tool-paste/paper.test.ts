// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { readDesignToolPasteHtml } from "./index";
import { must } from "./test-support";

const ROOT = "temp_A_0";
const gray = (l: number, alpha?: number) => ({
  value: { mode: "oklch", l, c: 0, h: 29.235, ...(alpha ? { alpha } : {}) },
  mode: "hex",
});

const embed = {
  id: "A",
  fileId: "F",
  topLevelNodeIds: [ROOT],
  nodes: {
    [ROOT]: {
      id: ROOT,
      label: "Landing page",
      component: "Frame",
      styles: {
        display: "flex",
        width: 1280,
        height: "800px",
        left: "-770px",
        top: "-686px",
        flexDirection: "column",
      },
      styleMeta: {
        fill: [{ type: "solid", color: gray(0.14479), isVisible: true }],
      },
    },
    temp_A_1: {
      id: "temp_A_1",
      label: "Heading",
      component: "Text",
      styles: { fontSize: "32px", lineHeight: "40px" },
      styleMeta: {
        fill: [{ type: "solid", color: gray(1), isVisible: true }],
        font: { family: "IBM Plex Mono", weight: 400, isItalic: false },
      },
      b: { "0": ["O", ["Hello <world>"]], "1": ["f", [" again"]] },
    },
    temp_A_2: {
      id: "temp_A_2",
      label: "Card",
      component: "Rectangle",
      styles: {
        width: "24px",
        height: "24px",
        flexShrink: 0,
        borderRadius: "8px",
      },
      styleMeta: {
        fill: [{ type: "image", imageId: "IMG", isVisible: true }],
        outerShadow: [
          {
            color: gray(0, 0.2),
            offsetX: "0px",
            offsetY: "2px",
            blur: "3px",
            spread: "0px",
            isVisible: true,
          },
        ],
        borders: {
          bottom: {
            isVisible: true,
            width: "1px",
            style: "solid",
            color: gray(0.26),
          },
        },
      },
    },
    temp_A_3: {
      id: "temp_A_3",
      label: "Icon",
      component: "SVG",
      styles: { display: "inline-block" },
      props: { width: "29", height: "17", viewBox: "0 0 38 22" },
      styleMeta: {},
    },
    temp_A_4: {
      id: "temp_A_4",
      label: "Path",
      component: "SVGVisualElement",
      tag: "path",
      styles: {},
      props: { d: "M0 0h10v10z" },
      styleMeta: { svgFill: { color: gray(1) } },
    },
  },
  images: { IMG: { name: "logo" } },
  parentToChildrenIndex: {
    [ROOT]: ["temp_A_1", "temp_A_2", "temp_A_3"],
    temp_A_3: ["temp_A_4"],
  },
  oldIdToNewIdMap: { "1-0": ROOT },
  positions: { [ROOT]: [-770, -686] },
};

// Paper does not escape the embedded JSON for the attribute it sits in.
const html = `<meta charset='utf-8'><html><head><meta charset="utf-8"><!--<paper-paste-start data-embed="${JSON.stringify(embed)}"></paper-paste-start>--></head><body><span style="white-space:pre-wrap;">Node IDs: 1-0</span></body></html>`;

describe("Paper clipboard", () => {
  it("reads the embedded node tree into one layer per top-level node", async () => {
    const read = await readDesignToolPasteHtml(html);
    expect(read).toMatchObject({ status: "ok", tool: "paper" });
    if (read.status === "ok") expect(read.layers).toHaveLength(1);
  });

  it("reports absent for any other clipboard", async () => {
    expect((await readDesignToolPasteHtml("<p>hi</p>")).status).toBe("absent");
    expect((await readDesignToolPasteHtml(undefined)).status).toBe("absent");
  });

  it("reports invalid, not absent, when the embed is damaged", async () => {
    const truncated = html.slice(0, html.indexOf("topLevelNodeIds") + 20);
    expect((await readDesignToolPasteHtml(truncated)).status).toBe("invalid");
    const garbled = html.replace('"topLevelNodeIds"', '"topLevel"');
    expect(await readDesignToolPasteHtml(garbled)).toMatchObject({
      status: "invalid",
      tool: "paper",
      reason: expect.stringContaining("topLevelNodeIds"),
    });
  });

  it("warns that image fills became placeholders", async () => {
    const read = await readDesignToolPasteHtml(html);
    expect(read.status === "ok" && read.warnings).toContainEqual({
      kind: "image-placeholders",
      count: 1,
    });
  });

  it("drops a value that could end its style declaration", async () => {
    const hostile = html.replace(
      '"height":"800px"',
      '"height":"800px;background:url(https://example.test/x)"',
    );
    const read = await readDesignToolPasteHtml(hostile);
    expect(read.status === "ok" && read.layers[0]?.content).not.toContain(
      "example.test",
    );
    expect(read.status === "ok" && read.warnings).toContainEqual({
      kind: "inexact",
      detail: "Skipped an unsafe height value.",
    });
  });
});

describe("Paper clipboard hardening", () => {
  it("drops a style whose name could inject a declaration", async () => {
    const hostile = html.replace(
      '"flexDirection":"column"',
      '"color:red;background":"x","flexDirection":"column"',
    );
    const read = await readDesignToolPasteHtml(hostile);
    expect(read.status === "ok" && read.layers[0]?.content).not.toContain(
      "color:red",
    );
    expect(read.status === "ok" && read.warnings).toContainEqual({
      kind: "inexact",
      detail: expect.stringContaining("unsupported"),
    });
  });

  it("drops an SVG paint that points at an external resource", async () => {
    const hostile = html.replace(
      '"viewBox":"0 0 38 22"',
      '"viewBox":"0 0 38 22","fill":"url(https://example.test/paint.svg#p)"',
    );
    const read = await readDesignToolPasteHtml(hostile);
    expect(read.status === "ok" && read.layers[0]?.content).not.toContain(
      "example.test",
    );
    expect(read.status === "ok" && read.warnings).toContainEqual({
      kind: "inexact",
      detail: "Skipped an unsafe fill attribute value.",
    });
  });

  it("refuses a copy with more frames than the paste limit", async () => {
    const many = JSON.stringify({
      ...embed,
      topLevelNodeIds: Array.from({ length: 51 }, () => ROOT),
    });
    const read = await readDesignToolPasteHtml(
      html.replace(JSON.stringify(embed), many),
    );
    expect(read).toMatchObject({
      status: "invalid",
      tool: "paper",
      reason: expect.stringContaining("topLevelNodeIds"),
    });
  });

  it("stops a very deep tree at the depth limit instead of overflowing the stack", async () => {
    const depth = 400;
    const nodes: Record<string, unknown> = {};
    const index: Record<string, string[]> = {};
    for (let i = 0; i < depth; i += 1) {
      nodes[`d${i}`] = {
        id: `d${i}`,
        label: `d${i}`,
        component: "Frame",
        styles: {},
      };
      if (i + 1 < depth) index[`d${i}`] = [`d${i + 1}`];
    }
    const deep = JSON.stringify({
      topLevelNodeIds: ["d0"],
      nodes,
      parentToChildrenIndex: index,
    });
    const read = await readDesignToolPasteHtml(
      html.replace(JSON.stringify(embed), deep),
    );
    expect(read.status).toBe("ok");
    expect(read.status === "ok" && read.warnings).toContainEqual({
      kind: "inexact",
      detail: "Stopped at 200 nested layers.",
    });
  });

  it("refuses more child references than the paste limit, duplicates included", async () => {
    const crowded = JSON.stringify({
      ...embed,
      parentToChildrenIndex: {
        ...embed.parentToChildrenIndex,
        [ROOT]: Array.from({ length: 50_001 }, () => "temp_A_1"),
      },
    });
    const read = await readDesignToolPasteHtml(
      html.replace(JSON.stringify(embed), crowded),
    );
    expect(read).toMatchObject({
      status: "invalid",
      tool: "paper",
      reason: expect.stringContaining("child references"),
    });
  });

  it("warns instead of silently flattening an unknown layer type", async () => {
    const read = await readDesignToolPasteHtml(
      html.replace('"component":"Rectangle"', '"component":"Ellipse"'),
    );
    expect(read.status === "ok" && read.warnings).toContainEqual({
      kind: "layer-type",
      type: "Ellipse",
    });
  });

  it("reports a malformed nested node as invalid instead of throwing", async () => {
    const broken = html.replace(
      '"styles":{"fontSize":"32px"',
      '"styles":null,"x":{"fontSize":"32px"',
    );
    expect(await readDesignToolPasteHtml(broken)).toMatchObject({
      status: "invalid",
      tool: "paper",
    });
  });
});

const converted = await readDesignToolPasteHtml(html);

describe("Paper conversion", () => {
  if (converted.status !== "ok") throw new Error("fixture must parse");
  const layer = must(converted.layers[0]);
  // happy-dom would fetch the stylesheet link; assert it from the source instead.
  const doc = new DOMParser().parseFromString(
    layer.content.replace(/<link[^>]*>/, ""),
    "text/html",
  );
  const root = doc.body.firstElementChild as HTMLElement;

  it("keeps size, origin and title for placement", async () => {
    expect(layer).toMatchObject({
      title: "Landing page",
      width: 1280,
      height: 800,
      origin: { x: -770, y: -686 },
      wrapsLooseNode: false,
    });
  });

  it("drops the root's canvas position but keeps its layout", async () => {
    expect(root.style.left).toBe("");
    expect(root.style.top).toBe("");
    expect(root.style.width).toBe("1280px");
    expect(root.style.flexDirection).toBe("column");
    expect(root.style.backgroundColor).not.toBe("");
  });

  it("renders text runs escaped, with color and font from styleMeta", async () => {
    const text = must(
      root.querySelector<HTMLElement>(
        '[data-agent-native-layer-name="Heading"]',
      ),
    );
    expect(text.textContent).toBe("Hello <world> again");
    expect(text.style.fontFamily).toContain("IBM Plex Mono");
    expect(text.style.color).not.toBe("");
    expect(layer.content).toContain("family=IBM+Plex+Mono");
  });

  it("keeps unitless properties unitless and adds shadow and border", async () => {
    const card = must(
      root.querySelector<HTMLElement>('[data-agent-native-layer-name="Card"]'),
    );
    expect(card.style.flexShrink).toBe("0");
    expect(card.style.boxShadow).toContain("2px");
    expect(layer.content).toContain("#00000033");
    expect(card.style.borderBottom).toContain("1px solid");
  });

  it("nests SVG paths with their fill", async () => {
    const path = must(root.querySelector("svg path"));
    expect(path.getAttribute("d")).toBe("M0 0h10v10z");
    expect(path.getAttribute("fill")).toBe("#ffffff");
  });
});
