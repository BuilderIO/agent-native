import { describe, expect, it } from "vitest";

import { insertSourceObject } from "./object-insertion";
import {
  deleteSourceElement,
  duplicateSourceElement,
  getParentSourceSelection,
  getSelectedAssetId,
  insertAssetOnCanvas,
  staticPositionZOrderEdits,
} from "./source-structure";
import type { ElementSnapshot } from "./types";

const source = [
  "export default function Slide() {",
  "  return (",
  "    <main>",
  "      <> ",
  "        <section>",
  "          <h1>Title</h1>",
  "        </section>",
  "      </>",
  "    </main>",
  "  );",
  "}",
].join("\n");

function locationOf(value: string) {
  const offset = source.indexOf(value);
  const before = source.slice(0, offset);
  return {
    line: before.split("\n").length,
    column: offset - before.lastIndexOf("\n") - 1,
  };
}

function sourceLocationOf(sourceTsx: string, value: string) {
  const offset = sourceTsx.indexOf(value);
  const before = sourceTsx.slice(0, offset);
  return {
    line: before.split("\n").length,
    column: offset - before.lastIndexOf("\n") - 1,
  };
}

describe("getParentSourceSelection", () => {
  it("selects the nearest JSX element ancestor through fragments", () => {
    expect(getParentSourceSelection(source, locationOf("<h1>"))).toEqual(
      locationOf("<section>"),
    );
  });

  it("returns null for a root element or an unresolved source location", () => {
    expect(getParentSourceSelection(source, locationOf("<main>"))).toBeNull();
    expect(
      getParentSourceSelection(source, { line: 99, column: 0 }),
    ).toBeNull();
  });
});

describe("duplicateSourceElement", () => {
  it("duplicates editor-inserted objects with a fresh static ID", () => {
    const inserted = insertSourceObject(source, {
      kind: "text",
      text: "Editable text",
    });
    expect(inserted?.createdObjectId).toBe("slides2-text-1");
    expect(inserted?.selection).toBeDefined();
    if (!inserted?.selection)
      throw new Error("inserted object was not selected");

    const duplicated = duplicateSourceElement(
      inserted.sourceTsx,
      inserted.selection,
    );

    expect(duplicated?.createdObjectId).toBe("slides2-text-2");
    expect(duplicated?.sourceTsx.match(/id="slides2-text-\d+"/g)).toEqual([
      'id="slides2-text-1"',
      'id="slides2-text-2"',
    ]);
    expect(duplicated?.selection).toBeDefined();
  });

  it("rejects grouped source objects", () => {
    const groupedSource = `export default function Slide() {
  return <div data-slide-group="true"><span>Grouped</span></div>;
}`;
    const group = sourceLocationOf(
      groupedSource,
      '<div data-slide-group="true"',
    );

    expect(duplicateSourceElement(groupedSource, group)).toBeNull();
  });

  it("gives duplicated objects unpredictable IDs when the source has dynamic IDs", () => {
    const sourceTsx = `const runtimeId = "slides2-text-1";
export default function Slide() {
  return <main><div id={runtimeId} /></main>;
}`;
    const inserted = insertSourceObject(sourceTsx, { kind: "text" });
    expect(inserted?.createdObjectId).toMatch(/^slides2-text-[0-9a-f-]{36}$/);
    if (!inserted?.selection)
      throw new Error("inserted object was not selected");

    const duplicated = duplicateSourceElement(
      inserted.sourceTsx,
      inserted.selection,
    );

    expect(duplicated?.createdObjectId).toMatch(/^slides2-text-[0-9a-f-]{36}$/);
    expect(duplicated?.createdObjectId).not.toBe(inserted.createdObjectId);
  });

  it("refuses locators for JSX outside the rendered default component", () => {
    const sourceTsx = `const helper = <div id="outside" />;
export default function Slide() {
  return <main><div id="inside" /></main>;
}`;
    const outside = sourceLocationOf(sourceTsx, '<div id="outside"');

    expect(duplicateSourceElement(sourceTsx, outside)).toBeNull();
    expect(deleteSourceElement(sourceTsx, outside)).toBeNull();
  });
});

describe("staticPositionZOrderEdits", () => {
  it("preserves absolute descendant geometry when a static parent is positioned", () => {
    const sourceTsx = `const Slide = () => (
  <div style={{ position: "relative", width: "1920px", height: "1080px" }}>
    <div data-testid="parent" style={{ position: "static", marginLeft: 100, width: 250, height: 200, left: 80, insetInlineStart: 40, inset: 50 }}>
      <div data-testid="child" style={{ position: "absolute", left: "2%", top: 280, width: "30%", height: 1 }} />
    </div>
  </div>
);
export default [Slide];`;
    const parentLocator = sourceLocationOf(
      sourceTsx,
      '<div data-testid="parent"',
    );
    const childLocator = sourceLocationOf(
      sourceTsx,
      '<div data-testid="child"',
    );
    const parent: ElementSnapshot = {
      nodeId: `${parentLocator.line}:${parentLocator.column}:0`,
      ...parentLocator,
      tagName: "div",
      bounds: { x: 100, y: 0, width: 250, height: 200 },
      text: "",
      styles: { position: "static", width: "250px", height: "200px" },
    };
    const child: ElementSnapshot = {
      nodeId: `${childLocator.line}:${childLocator.column}:0`,
      ...childLocator,
      tagName: "div",
      bounds: { x: 38.4, y: 280, width: 576, height: 1 },
      text: "",
      styles: {
        position: "absolute",
        width: "576px",
        height: "1px",
      },
    };

    const edits = staticPositionZOrderEdits(
      sourceTsx,
      [parent],
      [parent, child],
    );

    expect(edits).toEqual([
      {
        line: parent.line,
        column: parent.column,
        ops: [
          { kind: "set-style", key: "position", value: "relative" },
          { kind: "set-style", key: "inset", value: null },
          { kind: "set-style", key: "insetInlineStart", value: null },
          { kind: "set-style", key: "left", value: null },
        ],
      },
      {
        line: child.line,
        column: child.column,
        ops: [
          { kind: "set-style", key: "left", value: "-61.6px" },
          { kind: "set-style", key: "top", value: "280px" },
          { kind: "set-style", key: "width", value: "576px" },
          { kind: "set-style", key: "height", value: "1px" },
        ],
      },
    ]);
  });

  it("fails closed when class styles make descendant geometry uncertain", () => {
    const sourceTsx = `const Slide = () => (
  <div className="parent" style={{ position: "static" }}>
    <div style={{ position: "absolute", left: 10, top: 10, width: 20, height: 20 }} />
  </div>
);`;
    const parentLocator = sourceLocationOf(
      sourceTsx,
      '<div className="parent"',
    );
    const childLocator = sourceLocationOf(
      sourceTsx,
      '<div style={{ position: "absolute"',
    );
    const parent: ElementSnapshot = {
      nodeId: `${parentLocator.line}:${parentLocator.column}:0`,
      ...parentLocator,
      tagName: "div",
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      text: "",
      styles: { position: "static", width: "100px", height: "100px" },
    };
    const child: ElementSnapshot = {
      nodeId: `${childLocator.line}:${childLocator.column}:0`,
      ...childLocator,
      tagName: "div",
      bounds: { x: 10, y: 10, width: 20, height: 20 },
      text: "",
      styles: {
        position: "absolute",
        width: "20px",
        height: "20px",
      },
    };

    expect(
      staticPositionZOrderEdits(sourceTsx, [parent], [parent, child]),
    ).toBe(null);
  });

  it("keeps existing containing blocks without rewriting child geometry", () => {
    const sourceTsx = `const Slide = () => (
  <div data-testid="parent" style={{ position: "static", transform: "translateX(0)", width: 100, height: 100 }}>
    <div data-testid="child" style={{ position: "absolute", left: 10, top: 10, width: 20, height: 20 }} />
  </div>
);`;
    const parentLocator = sourceLocationOf(
      sourceTsx,
      '<div data-testid="parent"',
    );
    const childLocator = sourceLocationOf(
      sourceTsx,
      '<div data-testid="child"',
    );
    const parent: ElementSnapshot = {
      nodeId: `${parentLocator.line}:${parentLocator.column}:0`,
      ...parentLocator,
      tagName: "div",
      bounds: { x: 100, y: 80, width: 100, height: 100 },
      text: "",
      styles: {
        position: "static",
        transform: "matrix(1, 0, 0, 1, 0, 0)",
        width: "100px",
        height: "100px",
      },
    };
    const child: ElementSnapshot = {
      nodeId: `${childLocator.line}:${childLocator.column}:0`,
      ...childLocator,
      tagName: "div",
      bounds: { x: 110, y: 90, width: 20, height: 20 },
      text: "",
      styles: {
        position: "absolute",
        width: "20px",
        height: "20px",
      },
    };

    expect(
      staticPositionZOrderEdits(sourceTsx, [parent], [parent, child]),
    ).toEqual([
      {
        line: parent.line,
        column: parent.column,
        ops: [{ kind: "set-style", key: "position", value: "relative" }],
      },
    ]);
  });
});

describe("insertAssetOnCanvas", () => {
  it("inserts into the default component when the module has helper JSX", () => {
    const sourceTsx = `const heading = <h1>Title</h1>;
export default function Slide() {
  return <main>{heading}</main>;
}`;
    const inserted = insertAssetOnCanvas(sourceTsx, "asset_1", "photo.png");

    expect(inserted).not.toBeNull();
    expect(inserted?.sourceTsx).toContain("const heading = <h1>Title</h1>;");
    expect(inserted?.sourceTsx).toContain("<main>{heading}</main>");
    expect(inserted?.selection).toBeDefined();
    expect(getSelectedAssetId(inserted!.sourceTsx, inserted!.selection!)).toBe(
      "asset_1",
    );
  });

  it("preserves CRLF source line endings", () => {
    const sourceTsx =
      "export default function Slide() {\r\n  return <main />;\r\n}";
    const inserted = insertAssetOnCanvas(sourceTsx, "asset_1", "photo.png");

    expect(inserted).not.toBeNull();
    expect(inserted?.sourceTsx.replaceAll("\r\n", "")).not.toContain("\n");
  });

  it("fails closed when the default component has ambiguous roots", () => {
    const sourceTsx = `export default function Slide() {
  if (condition) return <main />;
  return <section />;
}`;

    expect(insertAssetOnCanvas(sourceTsx, "asset_1", "photo.png")).toBeNull();
  });

  it("ignores returns inside nested callbacks when resolving the component root", () => {
    const sourceTsx = `export default function Slide() {
  const handleClick = () => {
    if (condition) return;
  };
  return <main onClick={handleClick} />;
}`;

    expect(
      insertAssetOnCanvas(sourceTsx, "asset_1", "photo.png"),
    ).not.toBeNull();
  });
});
