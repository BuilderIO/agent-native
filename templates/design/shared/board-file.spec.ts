/**
 * Tests for shared/board-file.ts helpers.
 *
 * These are pure-logic tests with no DB or React dependencies.
 */

import { describe, expect, it } from "vitest";

import {
  BOARD_FILENAME,
  backfillBoardPrimitiveMarkers,
  boardObjectEntryToHtmlFragment,
  emptyBoardHtml,
  isBoardFile,
} from "./board-file.js";
import type { BoardObjectEntry } from "./board-objects.js";

// ---------------------------------------------------------------------------
// BOARD_FILENAME
// ---------------------------------------------------------------------------

describe("BOARD_FILENAME", () => {
  it("equals __board__.html", () => {
    expect(BOARD_FILENAME).toBe("__board__.html");
  });
});

// ---------------------------------------------------------------------------
// isBoardFile
// ---------------------------------------------------------------------------

describe("isBoardFile", () => {
  it("returns true for the exact board filename", () => {
    expect(isBoardFile("__board__.html")).toBe(true);
  });

  it("returns false for other filenames", () => {
    expect(isBoardFile("index.html")).toBe(false);
    expect(isBoardFile("screen.html")).toBe(false);
    expect(isBoardFile("__BOARD__.html")).toBe(false); // case-sensitive
    expect(isBoardFile("__board__")).toBe(false);
    expect(isBoardFile("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// emptyBoardHtml
// ---------------------------------------------------------------------------

describe("emptyBoardHtml", () => {
  it("returns a string containing the required body style", () => {
    const html = emptyBoardHtml();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<body");
    expect(html).toContain("</body>");
    expect(html).toContain("margin: 0");
    expect(html).toContain("position: relative");
    expect(html).toContain("html, body { background: transparent; }");
    expect(html).toContain("background: transparent");
    expect(html).toContain("overflow: visible");
  });

  it("produces a complete HTML document", () => {
    const html = emptyBoardHtml();
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
    expect(html).toContain("<head>");
    expect(html).toContain("</head>");
  });

  it("has an empty body (no content elements)", () => {
    const html = emptyBoardHtml();
    // Body content should be empty except for whitespace
    const bodyContent = html
      .replace(/^[\s\S]*<body[^>]*>([\s\S]*)<\/body>[\s\S]*$/, "$1")
      .trim();
    expect(bodyContent).toBe("");
  });
});

// ---------------------------------------------------------------------------
// boardObjectEntryToHtmlFragment — geometry & positioning
// ---------------------------------------------------------------------------

describe("boardObjectEntryToHtmlFragment — basic geometry", () => {
  const baseEntry: BoardObjectEntry = {
    id: "test-id",
    kind: "rectangle",
    geometry: { x: 100, y: 200, width: 300, height: 150 },
    createdAt: "2024-01-01T00:00:00.000Z",
  };

  it("includes left and top from geometry", () => {
    const fragment = boardObjectEntryToHtmlFragment(baseEntry);
    expect(fragment).toContain("left:100px");
    expect(fragment).toContain("top:200px");
  });

  it("includes width and height", () => {
    const fragment = boardObjectEntryToHtmlFragment(baseEntry);
    expect(fragment).toContain("width:300px");
    expect(fragment).toContain("height:150px");
  });

  it("sets position:absolute", () => {
    const fragment = boardObjectEntryToHtmlFragment(baseEntry);
    expect(fragment).toContain("position:absolute");
  });

  it("sets data-agent-native-node-id to the entry id", () => {
    const fragment = boardObjectEntryToHtmlFragment(baseEntry);
    expect(fragment).toContain(`data-agent-native-node-id="test-id"`);
  });

  it("sets data-agent-native-layer-name", () => {
    const fragment = boardObjectEntryToHtmlFragment(baseEntry);
    expect(fragment).toContain("data-agent-native-layer-name=");
  });

  it("uses explicit name when provided", () => {
    const entry = { ...baseEntry, name: "My Rectangle" };
    const fragment = boardObjectEntryToHtmlFragment(entry);
    expect(fragment).toContain(`data-agent-native-layer-name="My Rectangle"`);
  });

  it("emits a data-an-primitive kind marker for the layers-panel icon", () => {
    expect(boardObjectEntryToHtmlFragment(baseEntry)).toContain(
      `data-an-primitive="rectangle"`,
    );
    expect(
      boardObjectEntryToHtmlFragment({
        ...baseEntry,
        kind: "text",
        text: "Hi",
      }),
    ).toContain(`data-an-primitive="text"`);
    expect(
      boardObjectEntryToHtmlFragment({ ...baseEntry, kind: "ellipse" }),
    ).toContain(`data-an-primitive="ellipse"`);
  });

  it("uses a soft gray fill and darker gray border for default rectangles", () => {
    const fragment = boardObjectEntryToHtmlFragment(baseEntry);
    expect(fragment).toContain("background:rgb(218 218 218)");
    expect(fragment).toContain("border:1px solid rgb(168 168 168)");
  });

  it("preserves explicit rectangle fill and stroke overrides", () => {
    const fragment = boardObjectEntryToHtmlFragment({
      ...baseEntry,
      fill: "#eeeeee",
      stroke: "#999999",
      strokeWidth: 2,
    });
    expect(fragment).toContain("background:#eeeeee");
    expect(fragment).toContain("border:2px solid #999999");
  });
});

// ---------------------------------------------------------------------------
// Negative coordinate preservation
// ---------------------------------------------------------------------------

describe("boardObjectEntryToHtmlFragment — negative coordinate preservation", () => {
  it("preserves negative x (left)", () => {
    const entry: BoardObjectEntry = {
      id: "neg-x",
      kind: "rectangle",
      geometry: { x: -150, y: 50, width: 200, height: 80 },
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    const fragment = boardObjectEntryToHtmlFragment(entry);
    expect(fragment).toContain("left:-150px");
  });

  it("preserves negative y (top)", () => {
    const entry: BoardObjectEntry = {
      id: "neg-y",
      kind: "rectangle",
      geometry: { x: 50, y: -250, width: 100, height: 100 },
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    const fragment = boardObjectEntryToHtmlFragment(entry);
    expect(fragment).toContain("top:-250px");
  });

  it("preserves both negative x and negative y", () => {
    const entry: BoardObjectEntry = {
      id: "neg-both",
      kind: "ellipse",
      geometry: { x: -999, y: -1234, width: 50, height: 50 },
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    const fragment = boardObjectEntryToHtmlFragment(entry);
    expect(fragment).toContain("left:-999px");
    expect(fragment).toContain("top:-1234px");
  });

  it("preserves zero coordinates", () => {
    const entry: BoardObjectEntry = {
      id: "zero",
      kind: "text",
      geometry: { x: 0, y: 0, width: 100, height: 30 },
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    const fragment = boardObjectEntryToHtmlFragment(entry);
    expect(fragment).toContain("left:0px");
    expect(fragment).toContain("top:0px");
  });
});

// ---------------------------------------------------------------------------
// boardObjectEntryToHtmlFragment — rotation and z-index
// ---------------------------------------------------------------------------

describe("boardObjectEntryToHtmlFragment — rotation and z-index", () => {
  it("includes transform:rotate when rotation is set", () => {
    const entry: BoardObjectEntry = {
      id: "rotated",
      kind: "rectangle",
      geometry: { x: 10, y: 10, width: 100, height: 50, rotation: 45 },
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    const fragment = boardObjectEntryToHtmlFragment(entry);
    expect(fragment).toContain("transform:rotate(45deg)");
  });

  it("omits transform when rotation is absent", () => {
    const entry: BoardObjectEntry = {
      id: "no-rot",
      kind: "rectangle",
      geometry: { x: 0, y: 0, width: 100, height: 50 },
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    const fragment = boardObjectEntryToHtmlFragment(entry);
    expect(fragment).not.toContain("transform:");
  });

  it("includes z-index when z is set", () => {
    const entry: BoardObjectEntry = {
      id: "z-set",
      kind: "rectangle",
      geometry: { x: 0, y: 0, width: 100, height: 50, z: 5 },
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    const fragment = boardObjectEntryToHtmlFragment(entry);
    expect(fragment).toContain("z-index:5");
  });
});

// ---------------------------------------------------------------------------
// boardObjectEntryToHtmlFragment — kind-specific rendering
// ---------------------------------------------------------------------------

describe("boardObjectEntryToHtmlFragment — ellipse", () => {
  it("uses border-radius:50% for ellipse kind", () => {
    const entry: BoardObjectEntry = {
      id: "ellipse-1",
      kind: "ellipse",
      geometry: { x: 0, y: 0, width: 80, height: 80 },
      fill: "#ff0000",
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    const fragment = boardObjectEntryToHtmlFragment(entry);
    expect(fragment).toContain("border-radius:50%");
    expect(fragment).toContain("#ff0000");
  });
});

describe("boardObjectEntryToHtmlFragment — text", () => {
  it("renders text content inside the element", () => {
    const entry: BoardObjectEntry = {
      id: "text-1",
      kind: "text",
      geometry: { x: 10, y: 10, width: 200, height: 30 },
      text: "Hello, World!",
      fill: "#111111",
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    const fragment = boardObjectEntryToHtmlFragment(entry);
    expect(fragment).toContain("Hello, World!");
    expect(fragment).toContain("#111111");
  });

  it("escapes HTML special characters in text content", () => {
    const entry: BoardObjectEntry = {
      id: "text-xss",
      kind: "text",
      geometry: { x: 0, y: 0, width: 100, height: 30 },
      text: '<script>alert("xss")</script>',
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    const fragment = boardObjectEntryToHtmlFragment(entry);
    expect(fragment).not.toContain("<script>");
    expect(fragment).toContain("&lt;script&gt;");
  });
});

describe("boardObjectEntryToHtmlFragment — line / arrow / path", () => {
  it("renders an <svg> element for line kind", () => {
    const entry: BoardObjectEntry = {
      id: "line-1",
      kind: "line",
      geometry: { x: 0, y: 0, width: 200, height: 10 },
      stroke: "#2563eb",
      strokeWidth: 2,
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    const fragment = boardObjectEntryToHtmlFragment(entry);
    expect(fragment).toContain("<svg");
    expect(fragment).toContain("</svg>");
    expect(fragment).toContain("<path");
    expect(fragment).toContain("#2563eb");
  });

  it("includes marker-end defs for arrow kind", () => {
    const entry: BoardObjectEntry = {
      id: "arrow-1",
      kind: "arrow",
      geometry: { x: 0, y: 0, width: 150, height: 10 },
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    const fragment = boardObjectEntryToHtmlFragment(entry);
    expect(fragment).toContain("<marker");
    expect(fragment).toContain("marker-end");
  });

  it("uses provided pathData when given", () => {
    const entry: BoardObjectEntry = {
      id: "path-1",
      kind: "path",
      geometry: { x: 0, y: 0, width: 100, height: 100 },
      pathData: "M 0 0 L 100 100",
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    const fragment = boardObjectEntryToHtmlFragment(entry);
    expect(fragment).toContain("M 0 0 L 100 100");
  });
});

describe("boardObjectEntryToHtmlFragment — fill and stroke", () => {
  it("applies fill as background for rectangle", () => {
    const entry: BoardObjectEntry = {
      id: "rect-fill",
      kind: "rectangle",
      geometry: { x: 0, y: 0, width: 100, height: 50 },
      fill: "#aabbcc",
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    const fragment = boardObjectEntryToHtmlFragment(entry);
    expect(fragment).toContain("#aabbcc");
  });

  it("applies stroke as border for rectangle", () => {
    const entry: BoardObjectEntry = {
      id: "rect-stroke",
      kind: "rectangle",
      geometry: { x: 0, y: 0, width: 100, height: 50 },
      stroke: "#000000",
      strokeWidth: 3,
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    const fragment = boardObjectEntryToHtmlFragment(entry);
    expect(fragment).toContain("border:");
    expect(fragment).toContain("#000000");
    expect(fragment).toContain("3px");
  });
});

describe("boardObjectEntryToHtmlFragment — id escaping", () => {
  it("escapes double quotes in node id attribute", () => {
    const entry: BoardObjectEntry = {
      id: 'bad"id',
      kind: "rectangle",
      geometry: { x: 0, y: 0, width: 10, height: 10 },
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    const fragment = boardObjectEntryToHtmlFragment(entry);
    // The attribute value must not contain an unescaped double quote
    // after the opening quote.
    expect(fragment).toContain("&quot;");
    expect(fragment).not.toContain('data-agent-native-node-id="bad"id"');
  });
});

// ---------------------------------------------------------------------------
// backfillBoardPrimitiveMarkers
// ---------------------------------------------------------------------------

describe("backfillBoardPrimitiveMarkers — no-op cases", () => {
  it("returns the original string when there are no node-id-bearing elements", () => {
    const html = emptyBoardHtml();
    expect(backfillBoardPrimitiveMarkers(html)).toBe(html);
  });

  it("is idempotent: second call produces the same string as the first", () => {
    const html = `<!DOCTYPE html><html><head></head><body>
<div style="position:absolute;left:10px;top:20px;width:100px;height:50px;background:#f00" data-agent-native-node-id="a1" data-agent-native-layer-name="Rectangle"></div>
</body></html>`;
    const once = backfillBoardPrimitiveMarkers(html);
    const twice = backfillBoardPrimitiveMarkers(once);
    expect(twice).toBe(once);
  });

  it("returns the original string when all node-id elements already have the marker", () => {
    const html = `<!DOCTYPE html><html><head></head><body>
<div style="position:absolute;left:0px;top:0px;width:50px;height:50px" data-agent-native-node-id="id1" data-agent-native-layer-name="Rect" data-an-primitive="rectangle"></div>
</body></html>`;
    expect(backfillBoardPrimitiveMarkers(html)).toBe(html);
  });

  it("does not touch SVG elements that already carry the marker", () => {
    const html = `<!DOCTYPE html><html><head></head><body>
<svg style="position:absolute;left:0px;top:0px" data-agent-native-node-id="svg1" data-agent-native-layer-name="Line" data-an-primitive="line" xmlns="http://www.w3.org/2000/svg"><path d="M 0 5 L 100 5" fill="none" stroke="#2563eb" stroke-width="3"/></svg>
</body></html>`;
    const out = backfillBoardPrimitiveMarkers(html);
    // SVG is unchanged — the marker was already present and we do not add another
    expect(out).toBe(html);
  });
});

describe("backfillBoardPrimitiveMarkers — SVG vector inference", () => {
  it("infers 'path' for a single-path SVG with no marker-end", () => {
    const html = `<!DOCTYPE html><html><head></head><body>
<svg style="position:absolute;left:0px;top:0px;width:100px;height:100px" data-agent-native-node-id="p1" data-agent-native-layer-name="Path" xmlns="http://www.w3.org/2000/svg"><path d="M 0 0 L 50 80 L 100 0"/></svg>
</body></html>`;
    const out = backfillBoardPrimitiveMarkers(html);
    expect(out).toContain('data-an-primitive="path"');
  });

  it("infers 'arrow' for an SVG path with marker-end", () => {
    const html = `<!DOCTYPE html><html><head></head><body>
<svg style="position:absolute;left:0px;top:0px;width:200px;height:10px" data-agent-native-node-id="a1" data-agent-native-layer-name="Arrow" xmlns="http://www.w3.org/2000/svg"><defs><marker id="a1-arrow"><path d="M 0 0 L 10 5 L 0 10 z"/></marker></defs><path d="M 0 5 L 200 5" marker-end="url(#a1-arrow)"/></svg>
</body></html>`;
    const out = backfillBoardPrimitiveMarkers(html);
    expect(out).toContain('data-an-primitive="arrow"');
  });

  it("infers 'polygon' for an SVG containing a <polygon>", () => {
    const html = `<!DOCTYPE html><html><head></head><body>
<svg style="position:absolute;left:0px;top:0px;width:100px;height:100px" data-agent-native-node-id="g1" data-agent-native-layer-name="Polygon" xmlns="http://www.w3.org/2000/svg"><polygon points="50,0 100,100 0,100"/></svg>
</body></html>`;
    const out = backfillBoardPrimitiveMarkers(html);
    expect(out).toContain('data-an-primitive="polygon"');
  });

  it("leaves an ambiguous multi-path SVG unmarked rather than mis-classifying", () => {
    const html = `<!DOCTYPE html><html><head></head><body>
<svg style="position:absolute;left:0px;top:0px;width:100px;height:100px" data-agent-native-node-id="x1" data-agent-native-layer-name="Mystery" xmlns="http://www.w3.org/2000/svg"><path d="M 0 0 L 10 10"/><path d="M 20 20 L 30 30"/></svg>
</body></html>`;
    const out = backfillBoardPrimitiveMarkers(html);
    // No reliable single signal — left unmarked (still classifies as a shape).
    expect(out).not.toContain("data-an-primitive=");
    // Geometry untouched.
    expect(out).toBe(html);
  });

  it("does not add a second marker to an already-marked vector SVG", () => {
    const html = `<!DOCTYPE html><html><head></head><body>
<svg style="position:absolute;left:0px;top:0px;width:200px;height:10px" data-agent-native-node-id="a2" data-agent-native-layer-name="Arrow" data-an-primitive="arrow" xmlns="http://www.w3.org/2000/svg"><path d="M 0 5 L 200 5" marker-end="url(#a2-arrow)"/></svg>
</body></html>`;
    const out = backfillBoardPrimitiveMarkers(html);
    expect(out).toBe(html);
    expect((out.match(/data-an-primitive=/g) ?? []).length).toBe(1);
  });
});

describe("backfillBoardPrimitiveMarkers — ellipse inference", () => {
  it("infers 'ellipse' from border-radius:50%", () => {
    const html = `<!DOCTYPE html><html><head></head><body>
<div style="position:absolute;left:10px;top:10px;width:80px;height:80px;background:#f00;border-radius:50%" data-agent-native-node-id="e1" data-agent-native-layer-name="Ellipse"></div>
</body></html>`;
    const out = backfillBoardPrimitiveMarkers(html);
    expect(out).toContain('data-an-primitive="ellipse"');
  });

  it("infers 'ellipse' with spaces around colon (border-radius: 50%)", () => {
    const html = `<!DOCTYPE html><html><head></head><body>
<div style="position:absolute;left:0px;top:0px;width:60px;height:60px;border-radius: 50%;background:blue" data-agent-native-node-id="e2" data-agent-native-layer-name="Circle"></div>
</body></html>`;
    const out = backfillBoardPrimitiveMarkers(html);
    expect(out).toContain('data-an-primitive="ellipse"');
  });
});

describe("backfillBoardPrimitiveMarkers — frame inference", () => {
  it("infers 'frame' from background:transparent", () => {
    const html = `<!DOCTYPE html><html><head></head><body>
<div style="position:absolute;left:0px;top:0px;width:400px;height:300px;background:transparent" data-agent-native-node-id="f1" data-agent-native-layer-name="Frame 1"></div>
</body></html>`;
    const out = backfillBoardPrimitiveMarkers(html);
    expect(out).toContain('data-an-primitive="frame"');
  });

  it("infers 'frame' from layer name starting with Frame", () => {
    const html = `<!DOCTYPE html><html><head></head><body>
<div style="position:absolute;left:0px;top:0px;width:200px;height:200px;background:transparent" data-agent-native-node-id="f2" data-agent-native-layer-name="Frame 2"></div>
</body></html>`;
    const out = backfillBoardPrimitiveMarkers(html);
    expect(out).toContain('data-an-primitive="frame"');
  });
});

describe("backfillBoardPrimitiveMarkers — text inference", () => {
  it("infers 'text' from white-space:pre-wrap", () => {
    const html = `<!DOCTYPE html><html><head></head><body>
<div style="position:absolute;left:5px;top:5px;width:200px;height:30px;color:inherit;white-space:pre-wrap;" data-agent-native-node-id="t1" data-agent-native-layer-name="Text">Hello</div>
</body></html>`;
    const out = backfillBoardPrimitiveMarkers(html);
    expect(out).toContain('data-an-primitive="text"');
  });

  it("infers 'text' from color without background", () => {
    const html = `<!DOCTYPE html><html><head></head><body>
<div style="position:absolute;left:0px;top:0px;width:150px;height:24px;color:#111111;" data-agent-native-node-id="t2" data-agent-native-layer-name="Label">Caption</div>
</body></html>`;
    const out = backfillBoardPrimitiveMarkers(html);
    expect(out).toContain('data-an-primitive="text"');
  });
});

describe("backfillBoardPrimitiveMarkers — rectangle default", () => {
  it("defaults to 'rectangle' for a plain colored div", () => {
    const html = `<!DOCTYPE html><html><head></head><body>
<div style="position:absolute;left:10px;top:20px;width:100px;height:50px;background:#2563eb" data-agent-native-node-id="r1" data-agent-native-layer-name="Rectangle"></div>
</body></html>`;
    const out = backfillBoardPrimitiveMarkers(html);
    expect(out).toContain('data-an-primitive="rectangle"');
  });
});

describe("backfillBoardPrimitiveMarkers — mixed content", () => {
  it("patches only elements that lack the marker and leaves already-marked ones alone", () => {
    const html = `<!DOCTYPE html><html><head></head><body>
<div style="position:absolute;left:0px;top:0px;width:80px;height:80px;background:red;border-radius:50%" data-agent-native-node-id="already" data-agent-native-layer-name="Ellipse" data-an-primitive="ellipse"></div>
<div style="position:absolute;left:100px;top:0px;width:100px;height:50px;background:blue" data-agent-native-node-id="missing" data-agent-native-layer-name="Rectangle"></div>
</body></html>`;
    const out = backfillBoardPrimitiveMarkers(html);
    // The already-marked ellipse should appear exactly once.
    const ellipseMatches = out.match(/data-an-primitive="ellipse"/g) ?? [];
    expect(ellipseMatches.length).toBe(1);
    // The missing element should get "rectangle".
    expect(out).toContain('data-an-primitive="rectangle"');
  });

  it("does not alter geometry or other attributes", () => {
    const html = `<!DOCTYPE html><html><head></head><body>
<div style="position:absolute;left:10px;top:20px;width:100px;height:50px;background:#f00" data-agent-native-node-id="geom" data-agent-native-layer-name="Box"></div>
</body></html>`;
    const out = backfillBoardPrimitiveMarkers(html);
    expect(out).toContain("left:10px");
    expect(out).toContain("top:20px");
    expect(out).toContain("width:100px");
    expect(out).toContain("height:50px");
    expect(out).toContain("background:#f00");
    expect(out).toContain('data-agent-native-node-id="geom"');
    expect(out).toContain('data-agent-native-layer-name="Box"');
  });

  it("handles multiple elements of different kinds in one pass", () => {
    const html = `<!DOCTYPE html><html><head></head><body>
<div style="position:absolute;left:0px;top:0px;width:80px;height:80px;background:red;border-radius:50%" data-agent-native-node-id="e" data-agent-native-layer-name="Ellipse"></div>
<div style="position:absolute;left:100px;top:0px;width:100px;height:50px;background:transparent" data-agent-native-node-id="f" data-agent-native-layer-name="Frame 1"></div>
<div style="position:absolute;left:210px;top:0px;width:150px;height:24px;color:#111;white-space:pre-wrap;" data-agent-native-node-id="t" data-agent-native-layer-name="Text">Hi</div>
<div style="position:absolute;left:370px;top:0px;width:80px;height:40px;background:#2563eb" data-agent-native-node-id="r" data-agent-native-layer-name="Rectangle"></div>
</body></html>`;
    const out = backfillBoardPrimitiveMarkers(html);
    expect(out).toContain('data-an-primitive="ellipse"');
    expect(out).toContain('data-an-primitive="frame"');
    expect(out).toContain('data-an-primitive="text"');
    expect(out).toContain('data-an-primitive="rectangle"');
  });
});

// ---------------------------------------------------------------------------
// Layer name defaults
// ---------------------------------------------------------------------------

describe("boardObjectEntryToHtmlFragment — default layer names", () => {
  const kinds: BoardObjectEntry["kind"][] = [
    "frame",
    "rectangle",
    "ellipse",
    "polygon",
    "star",
    "line",
    "arrow",
    "text",
    "path",
  ];
  for (const kind of kinds) {
    it(`produces a non-empty layer name for kind "${kind}"`, () => {
      const entry: BoardObjectEntry = {
        id: `test-${kind}`,
        kind,
        geometry: { x: 0, y: 0, width: 50, height: 50 },
        createdAt: "2024-01-01T00:00:00.000Z",
      };
      const fragment = boardObjectEntryToHtmlFragment(entry);
      const match = fragment.match(/data-agent-native-layer-name="([^"]+)"/);
      expect(match).toBeTruthy();
      expect(match![1].length).toBeGreaterThan(0);
    });
  }
});
