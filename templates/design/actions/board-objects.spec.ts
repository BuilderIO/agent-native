/**
 * Tests for create-board-object, update-board-objects, and the shared
 * board-objects utilities.  These are pure-logic / schema tests; they do not
 * hit a real DB.
 */

import { describe, expect, it } from "vitest";

import {
  parseBoardObjects,
  type BoardObjectEntry,
} from "../shared/board-objects.js";
import createBoardObjectAction from "./create-board-object.js";
import updateBoardObjectsAction from "./update-board-objects.js";

// ---------------------------------------------------------------------------
// parseBoardObjects
// ---------------------------------------------------------------------------

describe("parseBoardObjects", () => {
  it("returns empty record for null/undefined", () => {
    expect(parseBoardObjects(null)).toEqual({});
    expect(parseBoardObjects(undefined)).toEqual({});
  });

  it("returns empty record for non-object values", () => {
    expect(parseBoardObjects("not-an-object")).toEqual({});
    expect(parseBoardObjects(42)).toEqual({});
    expect(parseBoardObjects([])).toEqual({});
  });

  it("parses a valid JSON string", () => {
    const entry: BoardObjectEntry = {
      id: "obj1",
      kind: "rectangle",
      geometry: { x: 10, y: 20, width: 100, height: 50 },
      createdAt: new Date().toISOString(),
    };
    const json = JSON.stringify({ obj1: entry });
    const result = parseBoardObjects(json);
    expect(result["obj1"]).toMatchObject({ id: "obj1", kind: "rectangle" });
  });

  it("parses a pre-parsed object", () => {
    const entry: BoardObjectEntry = {
      id: "obj2",
      kind: "ellipse",
      geometry: { x: 0, y: 0, width: 40, height: 40 },
      createdAt: new Date().toISOString(),
    };
    const result = parseBoardObjects({ obj2: entry });
    expect(result["obj2"]).toMatchObject({ id: "obj2", kind: "ellipse" });
  });

  it("silently drops entries with missing required fields", () => {
    const validEntry: BoardObjectEntry = {
      id: "good",
      kind: "text",
      geometry: { x: 0, y: 0, width: 100, height: 20 },
      createdAt: new Date().toISOString(),
    };
    const raw = {
      good: validEntry,
      // Missing id
      bad1: {
        kind: "rectangle",
        geometry: { x: 0, y: 0, width: 10, height: 10 },
        createdAt: "x",
      },
      // Missing geometry
      bad2: { id: "bad2", kind: "text", createdAt: "x" },
      // Invalid kind
      bad3: {
        id: "bad3",
        kind: "unknown-kind",
        geometry: { x: 0, y: 0, width: 10, height: 10 },
        createdAt: "x",
      },
    };
    const result = parseBoardObjects(raw);
    expect(Object.keys(result)).toEqual(["good"]);
  });

  it("accepts all valid kind values", () => {
    const kinds = [
      "frame",
      "rectangle",
      "ellipse",
      "polygon",
      "star",
      "line",
      "arrow",
      "text",
      "path",
    ] as const;
    for (const kind of kinds) {
      const entry: BoardObjectEntry = {
        id: kind,
        kind,
        geometry: { x: 0, y: 0, width: 10, height: 10 },
        createdAt: "2024-01-01T00:00:00.000Z",
      };
      const result = parseBoardObjects({ [kind]: entry });
      expect(result[kind]).toBeDefined();
    }
  });

  it("preserves optional fields when present", () => {
    const entry: BoardObjectEntry = {
      id: "rich",
      kind: "text",
      geometry: { x: 5, y: 5, width: 200, height: 30, rotation: 45, z: 3 },
      fill: "#ff0000",
      stroke: "#000000",
      strokeWidth: 2,
      text: "Hello",
      autoSize: true,
      name: "Label",
      createdAt: new Date().toISOString(),
    };
    const result = parseBoardObjects({ rich: entry });
    const parsed = result["rich"];
    expect(parsed?.fill).toBe("#ff0000");
    expect(parsed?.stroke).toBe("#000000");
    expect(parsed?.strokeWidth).toBe(2);
    expect(parsed?.text).toBe("Hello");
    expect(parsed?.autoSize).toBe(true);
    expect(parsed?.name).toBe("Label");
    expect(parsed?.geometry.rotation).toBe(45);
    expect(parsed?.geometry.z).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// create-board-object schema
// ---------------------------------------------------------------------------

describe("create-board-object schema", () => {
  const validBase = {
    designId: "design_123",
    kind: "rectangle",
    geometry: { x: 0, y: 0, width: 100, height: 50 },
  } as const;

  it("accepts a minimal valid input", () => {
    expect(createBoardObjectAction.schema.safeParse(validBase).success).toBe(
      true,
    );
  });

  it("requires designId", () => {
    const { designId: _omit, ...rest } = validBase;
    expect(createBoardObjectAction.schema.safeParse(rest).success).toBe(false);
  });

  it("requires kind", () => {
    const { kind: _omit, ...rest } = validBase;
    expect(createBoardObjectAction.schema.safeParse(rest).success).toBe(false);
  });

  it("requires geometry", () => {
    const { geometry: _omit, ...rest } = validBase;
    expect(createBoardObjectAction.schema.safeParse(rest).success).toBe(false);
  });

  it("rejects unknown kind values", () => {
    expect(
      createBoardObjectAction.schema.safeParse({
        ...validBase,
        kind: "squiggle",
      }).success,
    ).toBe(false);
  });

  it("accepts all valid kind values", () => {
    const kinds = [
      "frame",
      "rectangle",
      "ellipse",
      "polygon",
      "star",
      "line",
      "arrow",
      "text",
      "path",
    ] as const;
    for (const kind of kinds) {
      expect(
        createBoardObjectAction.schema.safeParse({ ...validBase, kind })
          .success,
        `kind "${kind}" should be valid`,
      ).toBe(true);
    }
  });

  it("accepts optional fill/stroke/text/name fields", () => {
    expect(
      createBoardObjectAction.schema.safeParse({
        ...validBase,
        fill: "#aabbcc",
        stroke: "#000",
        strokeWidth: 1,
        text: "Hello",
        name: "My Box",
      }).success,
    ).toBe(true);
  });

  it("accepts geometry with optional rotation and z", () => {
    expect(
      createBoardObjectAction.schema.safeParse({
        ...validBase,
        geometry: { x: 0, y: 0, width: 10, height: 10, rotation: 30, z: 2 },
      }).success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// update-board-objects schema
// ---------------------------------------------------------------------------

describe("update-board-objects schema", () => {
  it("accepts an update with a partial geometry patch", () => {
    expect(
      updateBoardObjectsAction.schema.safeParse({
        designId: "design_123",
        updates: [{ id: "obj1", geometry: { x: 10 } }],
      }).success,
    ).toBe(true);
  });

  it("accepts deletes-only payload", () => {
    expect(
      updateBoardObjectsAction.schema.safeParse({
        designId: "design_123",
        updates: [],
        deletes: ["obj1", "obj2"],
      }).success,
    ).toBe(true);
  });

  it("accepts combined updates and deletes", () => {
    expect(
      updateBoardObjectsAction.schema.safeParse({
        designId: "design_123",
        updates: [{ id: "obj1", fill: "#ff0" }],
        deletes: ["obj2"],
      }).success,
    ).toBe(true);
  });

  it("requires designId", () => {
    expect(
      updateBoardObjectsAction.schema.safeParse({ updates: [] }).success,
    ).toBe(false);
  });

  it("defaults updates to empty array when omitted", () => {
    const result = updateBoardObjectsAction.schema.safeParse({
      designId: "design_123",
      deletes: ["obj1"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.updates).toEqual([]);
    }
  });
});
