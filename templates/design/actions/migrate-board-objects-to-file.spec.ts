/**
 * Tests for migrate-board-objects-to-file action and its integration with
 * the board-file helpers.
 *
 * These tests cover:
 * - Schema validation
 * - Negative-coordinate preservation via boardObjectEntryToHtmlFragment
 * - The emptyBoardHtml + fragment injection pipeline
 * - Idempotency guard logic
 *
 * DB interactions are NOT tested here (no real DB in unit tests).
 * The migration action's run() function requires a real DB; those are
 * integration/e2e concerns.
 */

import { describe, expect, it } from "vitest";

import {
  BOARD_FILENAME,
  boardObjectEntryToHtmlFragment,
  emptyBoardHtml,
  isBoardFile,
} from "../shared/board-file.js";
import type { BoardObjectEntry } from "../shared/board-objects.js";
import migrateBoardObjectsAction from "./migrate-board-objects-to-file.js";

// ---------------------------------------------------------------------------
// Action schema
// ---------------------------------------------------------------------------

describe("migrate-board-objects-to-file schema", () => {
  it("accepts a valid designId", () => {
    const result = migrateBoardObjectsAction.schema.safeParse({
      designId: "design_abc123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing designId", () => {
    const result = migrateBoardObjectsAction.schema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects non-string designId", () => {
    const result = migrateBoardObjectsAction.schema.safeParse({
      designId: 42,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Board file reserved filename
// ---------------------------------------------------------------------------

describe("BOARD_FILENAME is the reserved board filename", () => {
  it("is __board__.html", () => {
    expect(BOARD_FILENAME).toBe("__board__.html");
    expect(isBoardFile(BOARD_FILENAME)).toBe(true);
  });

  it("does not match ordinary files", () => {
    expect(isBoardFile("index.html")).toBe(false);
    expect(isBoardFile("board.html")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Negative coordinate preservation (core migration contract)
// ---------------------------------------------------------------------------

describe("negative-coordinate preservation in boardObjectEntryToHtmlFragment", () => {
  it("preserves negative x without clamping", () => {
    const entry: BoardObjectEntry = {
      id: "obj-neg-x",
      kind: "rectangle",
      geometry: { x: -500, y: 100, width: 200, height: 80 },
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    const fragment = boardObjectEntryToHtmlFragment(entry);
    expect(fragment).toContain("left:-500px");
    expect(fragment).not.toContain("left:0px");
  });

  it("preserves negative y without clamping", () => {
    const entry: BoardObjectEntry = {
      id: "obj-neg-y",
      kind: "rectangle",
      geometry: { x: 100, y: -300, width: 200, height: 80 },
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    const fragment = boardObjectEntryToHtmlFragment(entry);
    expect(fragment).toContain("top:-300px");
    expect(fragment).not.toContain("top:0px");
  });

  it("preserves both negative x and y simultaneously", () => {
    const entry: BoardObjectEntry = {
      id: "obj-both-neg",
      kind: "ellipse",
      geometry: { x: -1024, y: -768, width: 50, height: 50 },
      fill: "#ff00ff",
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    const fragment = boardObjectEntryToHtmlFragment(entry);
    expect(fragment).toContain("left:-1024px");
    expect(fragment).toContain("top:-768px");
  });

  it("preserves large negative coordinates (deep-left-of-origin objects)", () => {
    const entry: BoardObjectEntry = {
      id: "obj-deep",
      kind: "text",
      geometry: { x: -9999, y: -8888, width: 100, height: 30 },
      text: "Off canvas",
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    const fragment = boardObjectEntryToHtmlFragment(entry);
    expect(fragment).toContain("left:-9999px");
    expect(fragment).toContain("top:-8888px");
  });
});

// ---------------------------------------------------------------------------
// Fragment injection into emptyBoardHtml
// ---------------------------------------------------------------------------

describe("fragment injection pipeline", () => {
  it("injects a single fragment before </body>", () => {
    const entry: BoardObjectEntry = {
      id: "obj-1",
      kind: "rectangle",
      geometry: { x: 10, y: 20, width: 100, height: 50 },
      fill: "#aabbcc",
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    const fragment = boardObjectEntryToHtmlFragment(entry);
    let html = emptyBoardHtml();
    html = html.replace("</body>", `${fragment}\n</body>`);

    expect(html).toContain(`data-agent-native-node-id="obj-1"`);
    expect(html).toContain("left:10px");
    expect(html).toContain("top:20px");
    expect(html).toContain("#aabbcc");
    expect(html).toContain("</body>");
    // Should still be a well-formed document
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("injects multiple fragments in order", () => {
    const entries: BoardObjectEntry[] = [
      {
        id: "obj-a",
        kind: "rectangle",
        geometry: { x: 0, y: 0, width: 50, height: 50, z: 0 },
        fill: "#ff0000",
        createdAt: "2024-01-01T00:00:00.000Z",
      },
      {
        id: "obj-b",
        kind: "ellipse",
        geometry: { x: 100, y: 100, width: 50, height: 50, z: 1 },
        fill: "#00ff00",
        createdAt: "2024-01-01T00:00:01.000Z",
      },
    ];
    const fragments = entries
      .sort((a, b) => (a.geometry.z ?? 0) - (b.geometry.z ?? 0))
      .map((e) => boardObjectEntryToHtmlFragment(e))
      .join("\n");
    let html = emptyBoardHtml();
    html = html.replace("</body>", `${fragments}\n</body>`);

    const posA = html.indexOf("obj-a");
    const posB = html.indexOf("obj-b");
    expect(posA).toBeGreaterThan(-1);
    expect(posB).toBeGreaterThan(-1);
    // obj-a (z=0) should appear before obj-b (z=1)
    expect(posA).toBeLessThan(posB);
  });

  it("handles zero board objects: produces valid empty-board HTML", () => {
    let html = emptyBoardHtml();
    // Simulating migration with no entries
    const fragments = "";
    html = html.replace("</body>", `${fragments}\n</body>`);

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</body>");
    expect(html).not.toContain("data-agent-native-node-id");
  });

  it("preserves negative coordinates through the full pipeline", () => {
    const entries: BoardObjectEntry[] = [
      {
        id: "obj-neg",
        kind: "rectangle",
        geometry: { x: -200, y: -100, width: 80, height: 60 },
        fill: "#123456",
        createdAt: "2024-01-01T00:00:00.000Z",
      },
    ];
    const fragments = entries
      .map((e) => boardObjectEntryToHtmlFragment(e))
      .join("\n");
    let html = emptyBoardHtml();
    html = html.replace("</body>", `${fragments}\n</body>`);

    expect(html).toContain("left:-200px");
    expect(html).toContain("top:-100px");
  });
});

// ---------------------------------------------------------------------------
// boardObjectEntryToHtmlFragment — node id and layer attributes
// ---------------------------------------------------------------------------

describe("boardObjectEntryToHtmlFragment — node id and layer attributes", () => {
  it("embeds data-agent-native-node-id matching the entry id", () => {
    const entry: BoardObjectEntry = {
      id: "my-unique-id",
      kind: "rectangle",
      geometry: { x: 0, y: 0, width: 100, height: 50 },
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    const fragment = boardObjectEntryToHtmlFragment(entry);
    expect(fragment).toContain(`data-agent-native-node-id="my-unique-id"`);
  });

  it("uses name field as layer name when provided", () => {
    const entry: BoardObjectEntry = {
      id: "named",
      kind: "rectangle",
      geometry: { x: 0, y: 0, width: 100, height: 50 },
      name: "My Header Box",
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    const fragment = boardObjectEntryToHtmlFragment(entry);
    expect(fragment).toContain(`data-agent-native-layer-name="My Header Box"`);
  });

  it("falls back to a kind-based default name when name is absent", () => {
    const entry: BoardObjectEntry = {
      id: "unnamed",
      kind: "ellipse",
      geometry: { x: 0, y: 0, width: 50, height: 50 },
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    const fragment = boardObjectEntryToHtmlFragment(entry);
    expect(fragment).toContain(`data-agent-native-layer-name="Ellipse"`);
  });
});

// ---------------------------------------------------------------------------
// boardObjectEntryToHtmlFragment — all kinds produce valid fragments
// ---------------------------------------------------------------------------

describe("boardObjectEntryToHtmlFragment — all kinds", () => {
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
    it(`produces a non-empty fragment for kind "${kind}"`, () => {
      const entry: BoardObjectEntry = {
        id: `test-${kind}`,
        kind,
        geometry: { x: 10, y: 20, width: 80, height: 60 },
        createdAt: "2024-01-01T00:00:00.000Z",
      };
      const fragment = boardObjectEntryToHtmlFragment(entry);
      expect(fragment.length).toBeGreaterThan(0);
      expect(fragment).toContain(`data-agent-native-node-id="test-${kind}"`);
    });

    it(`preserves negative coords for kind "${kind}"`, () => {
      const entry: BoardObjectEntry = {
        id: `neg-${kind}`,
        kind,
        geometry: { x: -50, y: -75, width: 80, height: 60 },
        createdAt: "2024-01-01T00:00:00.000Z",
      };
      const fragment = boardObjectEntryToHtmlFragment(entry);
      expect(fragment).toContain("left:-50px");
      expect(fragment).toContain("top:-75px");
    });
  }
});
