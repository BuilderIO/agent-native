// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { readDesignToolPasteHtml } from "./index";
import { must } from "./test-support";

const rgb = (r: number, g: number, b: number, alpha = 1) => ({
  displayMode: "hex",
  tokenId: "tok_1",
  value: { alpha, b, g, mode: "rgb", r, scale: "int255" },
});

const node = (
  source: Record<string, unknown>,
  children: unknown[] = [],
  extra: Record<string, unknown> = {},
) => ({
  id: String(source.label),
  source: { type: "frame", tagName: "div", ...source },
  metadata: { bounds: { width: 1024, height: 808 } },
  globalX: 130560,
  globalY: 131943,
  children,
  ...extra,
});

interface Variant {
  image?: string;
  gridDisplay?: string;
  rootStyle?: Record<string, unknown>;
  gridFills?: unknown[];
}

const makeTree = (variant: Variant = {}) =>
  node(
    {
      label: "Vinyl – Albums",
      style: {
        ...variant.rootStyle,
        layout: {
          display: "flex",
          flexDirection: "column",
          width: 1024,
          height: 808,
          left: 130560,
          top: 131943,
          position: "absolute",
          minWidth: 0,
          flexShrink: 0,
          aspectRatio: 1,
        },
        fills: [{ type: "solid", color: rgb(255, 255, 255) }],
        borderRadius: 16,
        tokenBindings: { width: "tok_2" },
        typography: {
          fills: [{ type: "solid", color: rgb(0, 0, 0, 0.847) }],
          fontFamily: "Inter",
          lineHeight: "normal",
        },
      },
    },
    [
      node({
        label: "Grid",
        style: {
          layout: {
            display: variant.gridDisplay ?? "grid",
            gap: { x: 20, y: 24 },
            gridTemplateColumns: [
              { fr: 1 },
              "auto",
              { max: { fr: 1 }, min: 0 },
            ],
          },
          spacing: {
            padding: { x: 20, y: 0 },
            margin: { top: 8, right: 0, bottom: 0, left: 0 },
          },
          effects: {
            boxShadow: [
              {
                blur: 12,
                spread: 0,
                inset: false,
                offset: { x: 0, y: 4 },
                color: rgb(0, 0, 0, 0.15),
              },
            ],
          },
          border: { color: rgb(0, 0, 0, 0.09), style: "solid", width: 1 },
          blending: { opacity: 0.3 },
          ...(variant.gridFills ? { fills: variant.gridFills } : {}),
        },
      }),
      node({
        label: "Cover",
        style: {
          layout: { width: 147 },
          fills: [
            {
              type: "image",
              image: variant.image ?? "https://cdn.wonder.so/images/a/b.jpg",
              backgroundSize: "cover",
            },
          ],
        },
      }),
      node({
        label: "Title",
        type: "text",
        tagName: "span",
        content: "Vinyl <3 & more",
        style: {
          typography: {
            fontFamily: "-apple-system",
            fontFallback: "BlinkMacSystemFont, Inter, sans-serif",
            fontSize: 13,
            fontWeight: 600,
            lineHeight: 1.5,
          },
        },
      }),
    ],
    {
      rootPlacement: { rotation: 0, scale: { x: 1, y: 1 } },
    },
  );

const tree = makeTree();

function clipboard(payload: unknown, version: unknown = "1") {
  const json = JSON.stringify({ version, payload: { nodes: [payload] } });
  const base64 = btoa(
    Array.from(new TextEncoder().encode(json), (b) =>
      String.fromCharCode(b),
    ).join(""),
  );
  return `<meta charset='utf-8'><!-- wonder-clipboard:${base64} --><html><head><meta charset="utf-8"></head><body></body></html>`;
}

async function read(payload: unknown = tree) {
  const result = await readDesignToolPasteHtml(clipboard(payload));
  if (result.status !== "ok")
    throw new Error(`expected ok: ${JSON.stringify(result)}`);
  return result;
}

function layerContent(result: { layers: Array<{ content: string }> }): string {
  return must(result.layers[0]).content;
}

function part(content: string, name: string): HTMLElement {
  return must(
    rootOf(content).querySelector<HTMLElement>(
      `[data-agent-native-layer-name="${name}"]`,
    ),
  );
}

function rootOf(content: string) {
  const doc = new DOMParser().parseFromString(
    content.replace(/<link[^>]*>/g, ""),
    "text/html",
  );
  return doc.body.firstElementChild as HTMLElement;
}

describe("Wonder clipboard", () => {
  it("reads a copy into a layer with size, origin and title", async () => {
    const { tool, layers } = await read();
    expect(tool).toBe("wonder");
    expect(layers[0]).toMatchObject({
      title: "Vinyl – Albums",
      width: 1024,
      height: 808,
      origin: { x: 130560, y: 131943 },
    });
  });

  it("reports absent for other clipboards and invalid for damaged ones", async () => {
    expect((await readDesignToolPasteHtml("<p>hi</p>")).status).toBe("absent");
    expect(
      await readDesignToolPasteHtml("<!-- wonder-clipboard:%%%% -->"),
    ).toMatchObject({
      status: "invalid",
      tool: "wonder",
    });
    expect(
      await readDesignToolPasteHtml("<!-- wonder-clipboard:AAAA -->"),
    ).toMatchObject({ status: "invalid", tool: "wonder" });
    expect(await readDesignToolPasteHtml(clipboard(tree, "9"))).toEqual({
      status: "invalid",
      tool: "wonder",
      reason: "clipboard version 9 is not supported",
    });
  });

  it("drops the root's canvas offset but keeps its layout and fill", async () => {
    const root = rootOf(layerContent(await read()));
    expect(root.style.left).toBe("");
    expect(root.style.width).toBe("1024px");
    expect(root.style.flexShrink).toBe("0");
    expect(root.style.aspectRatio).toBe("1 / 1");
    expect(root.style.borderRadius).toBe("16px");
    expect(root.style.backgroundColor).not.toBe("");
  });

  it("converts grid tracks, spacing, shadow, border and opacity", async () => {
    const grid = part(layerContent(await read()), "Grid");
    expect(grid.style.gridTemplateColumns).toBe("1fr auto minmax(0px,1fr)");
    expect(grid.style.gap).toBe("24px 20px");
    expect(grid.style.padding).toBe("0px 20px");
    expect(grid.style.margin).toBe("8px 0px 0px");
    expect(grid.style.boxShadow).toContain("4px");
    expect(grid.style.border).toContain("1px solid");
    expect(grid.style.opacity).toBe("0.3");
  });

  it("links Wonder-hosted images instead of dropping them", async () => {
    const cover = part(layerContent(await read()), "Cover");
    expect(cover.style.backgroundImage).toContain(
      "https://cdn.wonder.so/images/a/b.jpg",
    );
    expect(cover.style.backgroundSize).toBe("cover");
  });

  it("escapes text and keeps system font names bare", async () => {
    const title = part(layerContent(await read()), "Title");
    expect(title.textContent).toBe("Vinyl <3 & more");
    expect(title.style.fontFamily).toContain("-apple-system");
    expect(title.style.lineHeight).toBe("1.5");
  });

  it("links only real web fonts, one stylesheet each", async () => {
    const content = layerContent(await read());
    expect(content.match(/<link /g)).toHaveLength(1);
    expect(content).toContain("family=Inter");
    expect(content.match(/<link [^>]*>/g)?.join("")).not.toContain(
      "apple-system",
    );
  });

  it("refuses a non-https image and says so", async () => {
    const result = await read(makeTree({ image: 'javascript:alert(1)")' }));
    expect(rootOf(layerContent(result)).innerHTML).not.toContain("javascript");
    expect(result.warnings).toContainEqual({
      kind: "inexact",
      detail: "Skipped an image Design cannot link to.",
    });
  });

  it("drops a value that could end its style declaration", async () => {
    const result = await read(
      makeTree({ gridDisplay: "grid;background:url(https://example.test/x)" }),
    );
    expect(layerContent(result)).not.toContain("example.test");
    expect(result.warnings).toContainEqual({
      kind: "inexact",
      detail: "Skipped an unsafe display value.",
    });
  });

  it("warns instead of silently flattening an unknown layer type", async () => {
    const { warnings } = await read(
      node({ label: "Mark", type: "vector", tagName: "svg", style: {} }),
    );
    expect(warnings).toContainEqual({ kind: "layer-type", type: "vector" });
  });

  it("drops a layout name that could inject a declaration", async () => {
    const result = await read(
      node({
        label: "Root",
        style: { layout: { "color:red;background": "x" } },
      }),
    );
    expect(layerContent(result)).not.toContain("color:red");
    expect(result.warnings).toContainEqual({
      kind: "inexact",
      detail: expect.stringContaining("unsupported"),
    });
  });

  it("reports a malformed nested node as invalid instead of throwing", async () => {
    const broken = clipboard(
      node({ label: "Root", style: {} }, [{ source: { style: 7 } }]),
    );
    expect(await readDesignToolPasteHtml(broken)).toMatchObject({
      status: "invalid",
      tool: "wonder",
    });
  });

  it("refuses a deeply nested copy before converting it", async () => {
    let deep: unknown = node({ label: "leaf", style: {} });
    for (let i = 0; i < 250; i += 1) {
      deep = node({ label: `n${i}`, style: {} }, [deep]);
    }
    expect(await readDesignToolPasteHtml(clipboard(deep))).toEqual({
      status: "invalid",
      tool: "wonder",
      reason: "layers nested more than 200 deep",
    });
  });

  it("refuses a copy with more layers than the paste limit", async () => {
    const children = Array.from({ length: 50_001 }, () =>
      node({ label: "x", style: {} }),
    );
    expect(
      await readDesignToolPasteHtml(
        clipboard(node({ label: "Root", style: {} }, children)),
      ),
    ).toMatchObject({
      status: "invalid",
      tool: "wonder",
      reason: "more than 50000 layers",
    });
  });

  it("refuses a copy with more frames than the paste limit", async () => {
    const roots = Array.from({ length: 51 }, () =>
      node({ label: "x", style: {} }),
    );
    const json = JSON.stringify({ version: "1", payload: { nodes: roots } });
    const base64 = btoa(
      Array.from(new TextEncoder().encode(json), (b) =>
        String.fromCharCode(b),
      ).join(""),
    );
    expect(
      await readDesignToolPasteHtml(`<!-- wonder-clipboard:${base64} -->`),
    ).toMatchObject({ status: "invalid", reason: "more than 50 frames" });
  });

  it("reports what it could not carry over rather than hiding it", async () => {
    const { warnings } = await read(
      makeTree({
        rootStyle: { filters: [{ blur: 4 }] },
        gridFills: [{ type: "solid", color: { value: { mode: "hsl" } } }],
      }),
    );
    expect(warnings).toContainEqual({
      kind: "inexact",
      detail: 'Skipped the unsupported "filters" style.',
    });
    expect(warnings).toContainEqual({
      kind: "inexact",
      detail: "Skipped a color in a format Design does not read yet.",
    });
  });
});

describe("Wonder arrays and nesting are bounded before conversion", () => {
  const image = (i: number) => ({
    type: "image",
    image: `https://cdn.example.test/${i}.png`,
  });

  it("converts only the first image fills of a layer and says so", async () => {
    const result = await read(
      node({
        label: "Gallery",
        style: { fills: Array.from({ length: 30 }, (_, i) => image(i)) },
      }),
    );
    expect(result.remoteImages).toHaveLength(8);
    expect(result.warnings).toContainEqual({
      kind: "inexact",
      detail: "Kept the first 8 image fills of a layer.",
    });
  });

  it("refuses a layer that lists more fills than the paste limit", async () => {
    const fills = Array.from({ length: 65 }, (_, i) => image(i));
    expect(
      await readDesignToolPasteHtml(
        clipboard(node({ label: "Gallery", style: { fills } })),
      ),
    ).toMatchObject({ status: "invalid", tool: "wonder" });
  });

  it("refuses a layer that lists more shadows than the paste limit", async () => {
    const boxShadow = Array.from({ length: 33 }, () => ({ blur: 1 }));
    expect(
      await readDesignToolPasteHtml(
        clipboard(node({ label: "Cards", style: { effects: { boxShadow } } })),
      ),
    ).toMatchObject({ status: "invalid", tool: "wonder" });
  });

  it("skips a grid track nested past the limit instead of recursing into it", async () => {
    let track: unknown = { fr: 1 };
    // Far past the nesting limit, yet shallow enough that JSON.stringify
    // itself is safe on every Node version CI runs.
    for (let i = 0; i < 200; i += 1) track = { min: 0, max: track };
    const result = await read(
      node({
        label: "Grid",
        style: { layout: { display: "grid", gridTemplateColumns: [track] } },
      }),
    );
    expect(result.warnings).toContainEqual({
      kind: "inexact",
      detail: "Skipped a grid column definition Design cannot read.",
    });
  });

  it("skips a grid with more columns than the paste limit", async () => {
    const result = await read(
      node({
        label: "Grid",
        style: {
          layout: {
            display: "grid",
            gridTemplateColumns: Array.from({ length: 65 }, () => ({ fr: 1 })),
          },
        },
      }),
    );
    expect(result.warnings).toContainEqual({
      kind: "inexact",
      detail: "Skipped a grid column definition Design cannot read.",
    });
  });
});
