import { describe, expect, it } from "vitest";

import { emitFrames } from "./emit";
import type { PasteFrame, PasteNode, PasteWarnings } from "./ir";
import { PASTE_LIMITS } from "./ir";

const frame = (root: PasteNode): PasteFrame => ({
  title: "Frame",
  root,
  width: 100,
  height: 100,
  origin: null,
});

const box = (
  style: Record<string, string | number>,
  children: PasteNode[] = [],
): PasteNode => ({ kind: "box", label: "Box", style, children });

function emit(root: PasteNode) {
  const warnings: PasteWarnings = [];
  return { ...emitFrames([frame(root)], warnings), warnings };
}

describe("emitted values cannot reach a resource", () => {
  it.each([
    "url(https://example.test/a.png)",
    "url/**/(https://example.test/a.png)",
    "u/**/rl(https://example.test/a.png)",
    "expression/* x */(alert(1))",
  ])("drops a style value like %s", (value) => {
    const { layers, warnings } = emit(box({ width: value }));
    expect(layers[0]?.content).not.toContain("example.test");
    expect(layers[0]?.content).not.toContain("expression");
    expect(warnings).toContainEqual({
      kind: "inexact",
      detail: "Skipped an unsafe width value.",
    });
  });

  it("drops an SVG paint that hides a url() behind a comment", () => {
    const { layers, warnings } = emit({
      kind: "svg",
      label: "Icon",
      attrs: { fill: "url/**/(https://example.test/p.svg#p)" },
      style: {},
      children: [],
    });
    expect(layers[0]?.content).not.toContain("example.test");
    expect(warnings).toContainEqual({
      kind: "inexact",
      detail: "Skipped an unsafe fill attribute value.",
    });
  });

  it("keeps ordinary calc() and minmax() values", () => {
    const { layers } = emit(
      box({
        width: "calc(100% - 20px)",
        gridTemplateColumns: "minmax(0px,1fr)",
      }),
    );
    expect(layers[0]?.content).toContain("width:calc(100% - 20px)");
    expect(layers[0]?.content).toContain(
      "grid-template-columns:minmax(0px,1fr)",
    );
  });
});

describe("emitted size is bounded", () => {
  const text = (label: string, size: number): PasteNode => ({
    kind: "text",
    label,
    style: {},
    text: "x".repeat(size),
  });

  it("stops a frame at its byte limit and says so", () => {
    const chunk = 256 * 1024;
    const count = Math.ceil(PASTE_LIMITS.frameBytes / chunk) + 3;
    const { layers, warnings } = emit(
      box(
        {},
        Array.from({ length: count }, (_, i) => text(`t${i}`, chunk)),
      ),
    );
    const content = layers[0]?.content ?? "";
    expect(new TextEncoder().encode(content).length).toBeLessThan(
      PASTE_LIMITS.frameBytes + 4096,
    );
    expect(content.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(content.endsWith("</body></html>")).toBe(true);
    expect(warnings).toContainEqual({
      kind: "inexact",
      detail: `Stopped at the ${PASTE_LIMITS.frameBytes} byte limit for one frame.`,
    });
  });

  it("keeps a frame that fits whole", () => {
    const { layers, warnings } = emit(
      box({}, [text("a", 1000), text("b", 1000)]),
    );
    expect(layers[0]?.content).toContain("xxxxxxxx");
    expect(warnings).toEqual([]);
  });
});
