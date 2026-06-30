/**
 * Tests for shared/board-file.ts helpers.
 *
 * These are pure-logic tests with no DB or React dependencies.
 */

import { describe, expect, it } from "vitest";

import {
  BOARD_FILENAME,
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
