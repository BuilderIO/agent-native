import { describe, expect, it } from "vitest";

import { renderHtmlTemplates } from "./fig-file-to-html.js";

type Fields = Record<string, unknown>;

const at = (x = 0, y = 0) => ({
  m00: 1,
  m01: 0,
  m02: x,
  m10: 0,
  m11: 1,
  m12: y,
});
const id = (localID: number) => ({ sessionID: 1, localID });
const PAGE = 2;
const INTERNAL = 3;
const FRAME = 10;

let position = 0;
function node(parent: number, localID: number, fields: Fields = {}): Fields {
  position += 1;
  return {
    guid: id(localID),
    parentIndex: {
      guid: id(parent),
      position: String.fromCharCode(33 + position),
    },
    type: "FRAME",
    name: `Node${localID}`,
    size: { x: 100, y: 100 },
    transform: at(),
    ...fields,
  };
}

function document(nodes: Fields[], frame: Fields = {}): Fields {
  return {
    nodeChanges: [
      { guid: id(1), type: "DOCUMENT", name: "Doc" },
      node(1, PAGE, { type: "CANVAS", name: "Page 1" }),
      node(1, INTERNAL, {
        type: "CANVAS",
        name: "Internal",
        internalOnly: true,
      }),
      node(PAGE, FRAME, { name: "Screen", size: { x: 400, y: 300 }, ...frame }),
      ...nodes,
    ],
  };
}

function render(nodes: Fields[], frame: Fields = {}) {
  return renderHtmlTemplates(document(nodes, frame));
}

function html(nodes: Fields[], frame: Fields = {}): string {
  return render(nodes, frame).frames[0]!.html;
}

function styleOf(markup: string, localID: number): string {
  const match = new RegExp(
    `data-figma-node-id="1:${localID}"[^>]*?style="([^"]*)"`,
  ).exec(markup);
  if (!match) throw new Error(`1:${localID} not rendered`);
  return match[1]!;
}

const instance = (localID: number, symbol: number, fields: Fields = {}) =>
  node(FRAME, localID, {
    type: "INSTANCE",
    symbolData: { symbolID: id(symbol) },
    ...fields,
  });
const symbol = (localID: number, fields: Fields = {}) =>
  node(INTERNAL, localID, { type: "SYMBOL", ...fields });
const assign = (def: number, value: Fields) => ({
  defID: { sessionID: 9, localID: def },
  varValue: { value },
});
const ref = (def: number, field: string) => ({
  defID: { sessionID: 9, localID: def },
  componentPropNodeField: field,
});

describe("component slots", () => {
  const slotted = () => [
    symbol(50, { stackMode: "VERTICAL", size: { x: 390, y: 700 } }),
    node(50, 51, {
      name: "Slot",
      stackMode: "VERTICAL",
      stackSpacing: 16,
      size: { x: 390, y: 688 },
      componentPropRefs: [ref(1, "SLOT_CONTENT_ID")],
    }),
    node(51, 52, { name: "Default content" }),
    node(INTERNAL, 60, {
      isSlotContent: true,
      stackMode: "VERTICAL",
      stackSpacing: 32,
      size: { x: 390, y: 236 },
    }),
    node(60, 61, { size: { x: 390, y: 100 } }),
    node(60, 62, { size: { x: 390, y: 100 } }),
    instance(20, 50, {
      size: { x: 390, y: 700 },
      componentPropAssignments: [
        assign(1, { slotContentIdValue: { guid: id(60) } }),
      ],
    }),
  ];

  it("draws the assigned content inside the slot, not its default children", () => {
    const markup = html(slotted());
    const slot = markup.indexOf('data-figma-node-id="1:51"');
    expect(markup.indexOf('data-figma-node-id="1:61"')).toBeGreaterThan(slot);
    expect(markup.indexOf('data-figma-node-id="1:62"')).toBeGreaterThan(slot);
    expect(markup).not.toContain('data-figma-node-id="1:52"');
  });

  it("lays the slot out with the content's spacing and hugs it", () => {
    const style = styleOf(html(slotted()), 51);
    expect(style).toContain("gap: 32px");
    expect(style).not.toContain("height: 688px");
  });

  it("does not render slot content as a screen of its own", () => {
    expect(render(slotted()).frames).toHaveLength(1);
  });
});

describe("an instance's derived layout", () => {
  it("draws a descendant at the size and position Figma resolved for this instance", () => {
    const markup = html([
      symbol(50, { size: { x: 200, y: 100 } }),
      node(50, 51, {
        overrideKey: { sessionID: 7, localID: 51 },
        size: { x: 100, y: 50 },
        transform: at(10, 10),
      }),
      instance(20, 50, {
        size: { x: 200, y: 100 },
        derivedSymbolData: [
          {
            guidPath: { guids: [{ sessionID: 7, localID: 51 }] },
            size: { x: 180, y: 80 },
            transform: at(5, 6),
          },
        ],
      }),
    ]);
    const style = styleOf(markup, 51);
    expect(style).toContain("left: 5px");
    expect(style).toContain("top: 6px");
    expect(style).toContain("width: 180px");
    expect(style).toContain("height: 80px");
  });

  it("re-lays a resized frame's children by their constraints", () => {
    const markup = html([
      symbol(50, { size: { x: 200, y: 100 } }),
      node(50, 51, {
        overrideKey: { sessionID: 7, localID: 51 },
        size: { x: 200, y: 100 },
      }),
      node(51, 52, {
        horizontalConstraint: "MAX",
        size: { x: 20, y: 20 },
        transform: at(170, 0),
      }),
      node(51, 53, {
        horizontalConstraint: "CENTER",
        size: { x: 20, y: 20 },
        transform: at(90, 0),
      }),
      instance(20, 50, {
        size: { x: 400, y: 100 },
        derivedSymbolData: [
          {
            guidPath: { guids: [{ sessionID: 7, localID: 51 }] },
            size: { x: 400, y: 100 },
          },
        ],
      }),
    ]);
    expect(styleOf(markup, 52)).toContain("right: 10px");
    expect(styleOf(markup, 53)).toContain("left: 190px");
  });
});

describe("an instance's own auto-layout", () => {
  it("keeps an alignment the instance overrode", () => {
    const markup = html([
      symbol(50, { stackMode: "VERTICAL" }),
      node(50, 51),
      instance(20, 50, {
        stackMode: "VERTICAL",
        stackCounterAlignItems: "CENTER",
      }),
    ]);
    expect(styleOf(markup, 20)).toContain("align-items: center");
  });

  it("takes a swapped variant's layout but keeps the instance's own override", () => {
    const markup = html([
      symbol(50),
      node(50, 51, {
        type: "INSTANCE",
        overrideKey: { sessionID: 7, localID: 51 },
        symbolData: { symbolID: id(70) },
        stackMode: "HORIZONTAL",
        stackSpacing: 4,
        stackPaddingRight: 9,
      }),
      symbol(70, { stackMode: "HORIZONTAL", stackSpacing: 4 }),
      node(70, 71),
      symbol(80, { stackMode: "VERTICAL", stackSpacing: 12 }),
      node(80, 81),
      instance(20, 50, {
        symbolData: {
          symbolID: id(50),
          symbolOverrides: [
            {
              guidPath: { guids: [{ sessionID: 7, localID: 51 }] },
              overriddenSymbolID: id(80),
            },
          ],
        },
      }),
    ]);
    const style = styleOf(markup, 51);
    expect(style).toContain("flex-direction: column");
    expect(style).toContain("gap: 12px");
    expect(style).toContain("padding: 0px 9px 0px 0px");
  });
});

describe("auto-layout distribution", () => {
  const spaced = (children: Fields[]) =>
    html(children, {
      stackMode: "HORIZONTAL",
      stackPrimaryAlignItems: "SPACE_EVENLY",
      stackPrimarySizing: "FIXED",
    });

  it("centres a lone child under space-between, as Figma does", () => {
    const markup = spaced([
      node(FRAME, 40),
      node(FRAME, 41, { visible: false }),
    ]);
    expect(styleOf(markup, FRAME)).toContain("justify-content: center");
  });

  it("still distributes two children", () => {
    const markup = spaced([node(FRAME, 40), node(FRAME, 41)]);
    expect(styleOf(markup, FRAME)).toContain("justify-content: space-between");
  });

  it("grows FILL siblings from their resolved outer size, whatever their padding", () => {
    const fill = (localID: number, padding: number) =>
      node(FRAME, localID, {
        stackChildPrimaryGrow: 1,
        stackMode: "HORIZONTAL",
        stackHorizontalPadding: padding,
        stackPaddingRight: padding,
        size: { x: 100, y: 40 },
      });
    const markup = html([fill(40, 4), fill(41, 30), fill(42, 4)], {
      stackMode: "HORIZONTAL",
      stackPrimarySizing: "FIXED",
      size: { x: 300, y: 40 },
    });
    for (const localID of [40, 41, 42]) {
      expect(styleOf(markup, localID)).toContain("flex: 1 1 100px");
    }
  });

  it("keeps a hugging frame's stored size when its only child is hidden", () => {
    const markup = html([
      node(FRAME, 40, {
        stackMode: "HORIZONTAL",
        stackCounterSizing: "RESIZE_TO_FIT_WITH_IMPLICIT_SIZE",
        size: { x: 44, y: 44 },
      }),
      node(40, 41, { visible: false }),
    ]);
    const style = styleOf(markup, 40);
    expect(style).toContain("width: 44px");
    expect(style).toContain("height: 44px");
  });

  it("applies a padding bound to a variable to the side the layout reads", () => {
    const markup = html([
      node(PAGE, 90, {
        type: "VARIABLE",
        variableDataValues: {
          entries: [
            {
              modeID: { sessionID: 9, localID: 1 },
              variableData: { value: { floatValue: 24 } },
            },
          ],
        },
      }),
      node(FRAME, 40, {
        stackMode: "HORIZONTAL",
        stackHorizontalPadding: 8,
        variableConsumptionMap: {
          entries: [
            {
              variableField: "STACK_PADDING_LEFT",
              variableData: { value: { alias: { guid: id(90) } } },
            },
          ],
        },
      }),
    ]);
    expect(styleOf(markup, 40)).toContain("padding: 0px 0px 0px 24px");
  });
});

describe("component props", () => {
  const withProps = (extra: Fields[], assignments: Fields[]) =>
    html([
      symbol(50),
      ...extra,
      instance(20, 50, { componentPropAssignments: assignments }),
    ]);

  it("reads a TEXT value stored as textDataValue", () => {
    const markup = withProps(
      [
        node(50, 51, {
          type: "TEXT",
          textData: { characters: "Master" },
          componentPropRefs: [ref(2, "TEXT_DATA")],
        }),
      ],
      [assign(2, { textDataValue: { characters: "Override" } })],
    );
    expect(markup).toContain("Override");
    expect(markup).not.toContain("Master");
  });

  it("shows a layer the master hides when a BOOL prop turns it on", () => {
    const markup = withProps(
      [
        node(50, 51, {
          visible: false,
          overrideKey: { sessionID: 7, localID: 51 },
          componentPropRefs: [ref(3, "VISIBLE")],
        }),
      ],
      [assign(3, { boolValue: true })],
    );
    expect(markup).toContain('data-figma-node-id="1:51"');
  });

  it("merges an outer override's prop values with the nested instance's own", () => {
    const markup = html([
      symbol(50),
      node(50, 51, {
        type: "INSTANCE",
        overrideKey: { sessionID: 7, localID: 51 },
        symbolData: { symbolID: id(70) },
        componentPropAssignments: [assign(3, { boolValue: false })],
      }),
      symbol(70),
      node(70, 71, {
        type: "TEXT",
        textData: { characters: "Label" },
        componentPropRefs: [ref(2, "TEXT_DATA")],
      }),
      node(70, 72, { componentPropRefs: [ref(3, "VISIBLE")] }),
      instance(20, 50, {
        symbolData: {
          symbolID: id(50),
          symbolOverrides: [
            {
              guidPath: { guids: [{ sessionID: 7, localID: 51 }] },
              componentPropAssignments: [
                assign(2, { textDataValue: { characters: "Renamed" } }),
              ],
            },
          ],
        },
      }),
    ]);
    expect(markup).toContain("Renamed");
    expect(markup).not.toContain('data-figma-node-id="1:72"');
  });
});

describe("text layout", () => {
  const text = (fields: Fields) =>
    html([
      node(FRAME, 40, {
        type: "TEXT",
        textData: { characters: "Hello" },
        fontSize: 16,
        lineHeight: { value: 20, units: "PIXELS" },
        fillPaints: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
        size: { x: 100, y: 60 },
        ...fields,
      }),
    ]);

  it("centres a fixed box's lines vertically, keeping the runs in one span", () => {
    const markup = text({ textAlignVertical: "CENTER" });
    expect(styleOf(markup, 40)).toContain(
      "display: flex; flex-direction: column; justify-content: center",
    );
    expect(markup).toContain("<span>Hello</span>");
  });

  it("does not align text that hugs its height", () => {
    const markup = text({
      textAlignVertical: "BOTTOM",
      textAutoResize: "HEIGHT",
    });
    expect(styleOf(markup, 40)).not.toContain("justify-content");
  });

  it("ends a one-line truncation with an ellipsis", () => {
    const style = styleOf(
      text({ textTruncation: "ENDING", maxLines: 1, textAutoResize: "HEIGHT" }),
      40,
    );
    expect(style).toContain("text-overflow: ellipsis");
    expect(style).toContain("white-space: nowrap");
  });

  it("clamps a fixed box to the lines it holds", () => {
    expect(styleOf(text({ textTruncation: "ENDING" }), 40)).toContain(
      "-webkit-line-clamp: 3",
    );
  });

  it("styles a run that changes size and weight", () => {
    const markup = text({
      textData: {
        characters: "AB",
        characterStyleIDs: [0, 1],
        styleOverrideTable: [
          {
            styleID: 1,
            fontSize: 24,
            fontName: { family: "Inter", style: "Bold" },
          },
        ],
      },
      fontName: { family: "Inter", style: "Regular" },
    });
    expect(markup).toContain(
      '<span style="font-size: 24px; font-weight: 700">B</span>',
    );
  });

  it("does not ask Google Fonts for Apple's system families", () => {
    const markup = text({ fontName: { family: "SF Pro", style: "Regular" } });
    expect(markup).not.toContain("fonts.googleapis.com/css2");
    expect(styleOf(markup, 40)).toContain("&quot;SF Pro&quot;, system-ui");
  });
});

describe("icon-font glyphs", () => {
  const square = (() => {
    const bytes = new Uint8Array(1 + 1 + 8 + 1 + 8 + 1 + 8 + 1);
    const view = new DataView(bytes.buffer);
    let offset = 0;
    const op = (code: number, ...args: number[]) => {
      bytes[offset++] = code;
      for (const arg of args) {
        view.setFloat32(offset, arg, true);
        offset += 4;
      }
    };
    op(0);
    op(1, 0, 0);
    op(2, 1, 0);
    op(2, 1, 1);
    op(0);
    return bytes;
  })();
  const glyphText = (endCharacter: number, characters = "\u{100001}") => ({
    ...document([
      node(FRAME, 40, {
        type: "TEXT",
        textData: { characters },
        fontSize: 17,
        fillPaints: [{ type: "SOLID", color: { r: 0, g: 0, b: 1, a: 1 } }],
        size: { x: 13, y: 20 },
        derivedTextData: {
          glyphs: Array.from(characters, (_, index) => ({
            commandsBlob: 0,
            position: { x: 0.5 + index * 8, y: 16 },
            fontSize: 17,
          })),
          baselines: [{ endCharacter }],
        },
      }),
    ]),
    blobs: [{ bytes: square }],
  });

  it("draws private-use text from the outlines Figma stored", () => {
    const result = renderHtmlTemplates(glyphText(1));
    const markup = result.frames[0]!.html;
    expect(markup).toContain(
      '<path transform="translate(0.5 16) scale(17 -17)" d="M0 0 L1 0 L1 1 Z"/>',
    );
    expect(markup).toContain('fill="currentColor"');
    expect(result.approximatedNodes).toEqual([]);
  });

  it("falls back to dropping the glyphs when the outlines belong to other text", () => {
    const result = renderHtmlTemplates(glyphText(2));
    expect(result.frames[0]!.html).not.toContain("<path");
    expect(result.approximatedNodes[0]?.notes[0]).toMatch(/glyphs dropped/);
  });

  it("keeps a label beside a symbol as live text", () => {
    const result = renderHtmlTemplates(glyphText(8, "Search \u{100001}"));
    const markup = result.frames[0]!.html;
    expect(markup).toContain("Search");
    expect(markup).not.toContain("<path");
    expect(markup).not.toContain("\u{100001}");
    expect(result.approximatedNodes[0]?.notes[0]).toMatch(/glyphs dropped/);
  });
});

describe("strokes and effects", () => {
  it("draws a gradient stroke as a masked layer instead of dropping it", () => {
    const markup = html([
      node(FRAME, 40, {
        strokeWeight: 2,
        strokeAlign: "INSIDE",
        strokePaints: [
          {
            type: "GRADIENT_LINEAR",
            stops: [
              { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
              { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 },
            ],
            transform: at(),
          },
        ],
      }),
    ]);
    expect(markup).toContain(
      "padding:2px 2px 2px 2px;background:linear-gradient",
    );
    expect(markup).toContain("mask-composite:xor");
    expect(styleOf(markup, 40)).toContain("position: absolute");
  });

  it("paints a container's INSIDE stroke after its children", () => {
    const markup = html([
      node(FRAME, 40, {
        strokeWeight: 1,
        strokeAlign: "INSIDE",
        strokePaints: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
      }),
      node(40, 41, {
        fillPaints: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
      }),
    ]);
    const stroke = markup.indexOf("border-color:rgb(255, 0, 0)");
    expect(stroke).toBeGreaterThan(markup.indexOf('data-figma-node-id="1:41"'));
    expect(styleOf(markup, 40)).not.toContain("inset 0 0 0 1px");
  });

  it("approximates GLASS as a background blur and says so", () => {
    const result = render([
      node(FRAME, 40, {
        effects: [{ type: "GLASS", radius: 10, visible: true }],
      }),
    ]);
    expect(styleOf(result.frames[0]!.html, 40)).toContain(
      "backdrop-filter: blur(",
    );
    expect(result.approximatedNodes[0]?.notes[0]).toMatch(/GLASS/);
  });

  it("reports an effect it cannot draw", () => {
    const result = render([
      node(FRAME, 40, { effects: [{ type: "NOISE", visible: true }] }),
    ]);
    expect(result.approximatedNodes[0]?.notes[0]).toBe("NOISE effect omitted");
  });

  it("reports an approximated master node once however often it is inlined", () => {
    const result = render([
      symbol(50),
      node(50, 51, { blendMode: "LINEAR_BURN" }),
      instance(20, 50),
      instance(21, 50),
    ]);
    expect(
      result.approximatedNodes.filter((entry) => entry.nodeId === "1:51"),
    ).toHaveLength(1);
  });
});

describe("rendered frames", () => {
  it("reports each frame's page position, through sections", () => {
    const result = renderHtmlTemplates({
      nodeChanges: [
        { guid: id(1), type: "DOCUMENT" },
        node(1, PAGE, { type: "CANVAS" }),
        node(PAGE, 10, { transform: at(300, -40) }),
        node(PAGE, 11, { type: "SECTION", transform: at(1000, 100) }),
        node(11, 12, { transform: at(10, 20) }),
      ],
    });
    expect(result.frames.map(({ x, y }) => [x, y])).toEqual([
      [300, -40],
      [1010, 120],
    ]);
  });

  it("reads image hashes and blobs given as bytes", () => {
    const markup = renderHtmlTemplates(
      document([
        node(FRAME, 40, {
          fillPaints: [
            { type: "IMAGE", image: { hash: new Uint8Array([0xab, 0xcd]) } },
          ],
        }),
      ]),
      { imageMap: new Map([["abcd", "https://example.test/abcd.png"]]) },
    ).frames[0]!.html;
    expect(markup).toContain("https://example.test/abcd.png");
  });

  it("refuses a blob that is not bytes rather than drawing without it", () => {
    expect(() =>
      renderHtmlTemplates({ ...document([]), blobs: [{ bytes: "00ff" }] }),
    ).toThrow(/not bytes/);
  });
});
