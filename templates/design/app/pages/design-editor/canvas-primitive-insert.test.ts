// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import type { CanvasPrimitiveInsert } from "@/components/design/multi-screen/types";

import {
  appendCanvasPrimitiveToHtml,
  blankScreenHtml,
  extractCanvasPrimitiveHtml,
} from "./canvas-primitive-insert";

describe("blankScreenHtml", () => {
  const html = blankScreenHtml("Screen 1");

  it("is a free canvas: no centering grid and no <main> wrapper", () => {
    // The centering grid + <main> wrapper trapped drawn shapes at center and,
    // once dragged, flow-inserted them (converting the wrapper to auto layout
    // and stripping their absolute position). A blank screen must be a plain
    // free canvas so absolute children keep their x,y.
    expect(html).not.toMatch(/display:\s*grid/);
    expect(html).not.toMatch(/place-items:\s*center/);
    expect(html).not.toContain("<main");
  });

  it("names the screen root and escapes the title", () => {
    expect(blankScreenHtml("A & B")).toContain(
      'data-agent-native-layer-name="A &amp; B"',
    );
    expect(blankScreenHtml("A & B")).toContain("<title>A &amp; B</title>");
  });
});

// BUG F4: a live/localhost screen stores its route URL in `design_files.content`.
// DOMParser turns that URL into body text, so appending a primitive returned a
// full HTML document that the caller persisted OVER the URL — the screen stopped
// being live and the route was destroyed.
describe("appendCanvasPrimitiveToHtml on a URL-backed live screen", () => {
  const rect: CanvasPrimitiveInsert = {
    kind: "rectangle",
    nodeId: "rect-1",
    geometry: { x: 10, y: 20, width: 100, height: 50 },
  };

  it("refuses a bridge URL instead of writing a document over it", () => {
    expect(appendCanvasPrimitiveToHtml("http://localhost:8210/", rect)).toBe(
      null,
    );
    expect(
      appendCanvasPrimitiveToHtml("  https://app.example.com/dash  ", rect),
    ).toBe(null);
  });

  it("still inserts into a real stored document", () => {
    const inserted = appendCanvasPrimitiveToHtml(
      blankScreenHtml("Screen 1"),
      rect,
    );
    expect(inserted).toContain('data-agent-native-node-id="rect-1"');
  });

  const textAt = (bodyStyle: string) =>
    appendCanvasPrimitiveToHtml(
      `<!doctype html><html><head><title>S</title></head><body style="${bodyStyle}"></body></html>`,
      {
        kind: "text",
        nodeId: "t-1",
        geometry: { x: 0, y: 0, width: 80, height: 24 },
        text: "Hello",
      },
    );

  it("gives drawn text a light fill on a dark screen, not currentColor", () => {
    expect(textAt("background:#0b0f19")).toContain("color: #ffffff");
  });

  it("leaves drawn text inheriting currentColor on a light screen", () => {
    expect(textAt("background:#ffffff")).toContain("color: currentcolor");
  });

  const withContainer = (kind: "frame" | "rectangle") =>
    appendCanvasPrimitiveToHtml(
      appendCanvasPrimitiveToHtml(blankScreenHtml("S"), {
        kind,
        nodeId: "box",
        geometry: { x: 20, y: 150, width: 280, height: 300 },
      }) ?? "",
      {
        kind: "text",
        nodeId: "inner",
        geometry: { x: 60, y: 260, width: 100, height: 20 },
        text: "Inside",
      },
    ) ?? "";

  it("nests a primitive drawn inside a frame's bounds into that frame", () => {
    const html = withContainer("frame");
    const frameAt = html.indexOf('data-an-primitive="frame"');
    expect(html.indexOf('nodeId="inner"') === -1).toBe(true);
    expect(html.indexOf('data-agent-native-node-id="inner"')).toBeGreaterThan(
      frameAt,
    );
    expect(html.indexOf('data-agent-native-node-id="inner"')).toBeLessThan(
      html.indexOf("</div>", frameAt) + "</div>".length,
    );
  });

  it("never nests into a rectangle — it is a shape, not a container", () => {
    const html = withContainer("rectangle");
    const rectCloses =
      html.indexOf("</div>", html.indexOf('data-an-primitive="rectangle"')) +
      "</div>".length;
    expect(html.indexOf('data-agent-native-node-id="inner"')).toBeGreaterThan(
      rectCloses,
    );
  });
});

describe("extractCanvasPrimitiveHtml", () => {
  it.each([
    ["rectangle", "div"],
    ["ellipse", "div"],
    ["frame", "div"],
    ["text", "div"],
    ["line", "svg"],
    ["arrow", "svg"],
    ["polygon", "svg"],
    ["star", "svg"],
    ["path", "svg"],
  ] as const)(
    "serializes a %s as one bridge-insertable %s root",
    (kind, expectedTag) => {
      const nodeId = `new-${kind}`;
      const content = appendCanvasPrimitiveToHtml(
        blankScreenHtml("Temporary live insert"),
        {
          kind,
          nodeId,
          geometry: { x: 12, y: 24, width: 96, height: 48 },
          ...(kind === "line" || kind === "arrow" || kind === "path"
            ? {
                points: [
                  { x: 12, y: 24 },
                  { x: 108, y: 72 },
                ],
              }
            : {}),
        },
      );

      expect(content).not.toBeNull();
      const html = extractCanvasPrimitiveHtml(content!, nodeId);
      expect(html).toMatch(new RegExp(`^<${expectedTag}\\b`));
      expect(html).toContain(`data-agent-native-node-id="${nodeId}"`);
      expect(html).not.toContain("<!DOCTYPE");
      expect(html).not.toContain("<body");
    },
  );

  it("returns null when the requested primitive is absent", () => {
    expect(
      extractCanvasPrimitiveHtml(blankScreenHtml("Empty"), "missing"),
    ).toBeNull();
  });
});
