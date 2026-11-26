import { describe, expect, it } from "vitest";

import { emitFrames } from "./emit";
import type { PasteFrame, PasteNode, PasteWarnings } from "./ir";
import { inexact, PASTE_LIMITS, pushWarning } from "./ir";

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

describe("output accounting", () => {
  const text = (label: string, content: string): PasteNode => ({
    kind: "text",
    label,
    style: {},
    text: content,
  });

  it("does not charge later frames for output a frame rejected", () => {
    const warnings: PasteWarnings = [];
    const frames: PasteFrame[] = Array.from({ length: 10 }, (_, i) =>
      frame(
        box({}, [
          text(`kept${i}`, "k".repeat(1_200_000)),
          text(`dropped${i}`, "d".repeat(1_200_000)),
        ]),
      ),
    );
    const { layers } = emitFrames(frames, warnings);
    // Every frame keeps its first text; none is blanked by an earlier frame's
    // rejected node.
    expect(layers).toHaveLength(10);
    for (const layer of layers) {
      expect(layer.content).toContain("kkkkkkkk");
      expect(layer.content).not.toContain("dddddddd");
    }
  });

  it("refuses oversized text before escaping can grow it", () => {
    const { layers, warnings } = emit(
      box({}, [text("big", "<".repeat(PASTE_LIMITS.frameBytes + 1))]),
    );
    expect(layers[0]?.content.length).toBeLessThan(1000);
    expect(warnings).toContainEqual({
      kind: "inexact",
      detail: `Stopped at the ${PASTE_LIMITS.frameBytes} byte limit for one frame.`,
    });
  });

  it("keeps only the first few image fills of one layer", () => {
    const images = Array.from({ length: 20 }, (_, i) => ({
      url: `https://cdn.example.test/${i}.png`,
    }));
    const { layers, warnings, imageUrls } = emit({
      kind: "box",
      label: "Gallery",
      style: {},
      images,
      children: [],
    });
    expect((layers[0]?.content.match(/url\(&quot;/g) ?? []).length).toBe(8);
    expect(imageUrls).toHaveLength(8);
    expect(warnings).toContainEqual({
      kind: "inexact",
      detail: "Kept the first 8 image fills of a layer.",
    });
  });
});

describe("fonts, kept images and warnings are bounded", () => {
  const withFont = (family: string): PasteNode => ({
    kind: "text",
    label: "t",
    style: {},
    font: { family },
    text: "x",
  });

  it("links only a few font families and says the rest were not loaded", () => {
    const families = Array.from({ length: 30 }, (_, i) => `Family ${i}`);
    const { layers, warnings } = emit(box({}, families.map(withFont)));
    expect((layers[0]?.content.match(/<link /g) ?? []).length).toBe(
      PASTE_LIMITS.fontFamilies,
    );
    expect(warnings).toContainEqual({
      kind: "inexact",
      detail: "Did not load every font the copy uses.",
    });
  });

  it("never links a family with an oversized name", () => {
    const { layers } = emit(
      box({}, [withFont("F".repeat(PASTE_LIMITS.fontFamilyChars + 1))]),
    );
    expect(layers[0]?.content).not.toContain("<link ");
  });

  it("does not report images of a layer that was dropped for size", () => {
    const filler: PasteNode = {
      kind: "text",
      label: "filler",
      style: {},
      text: "f".repeat(PASTE_LIMITS.frameBytes - 5_000),
    };
    const gallery: PasteNode = {
      kind: "box",
      label: "Gallery",
      style: {},
      images: [{ url: "https://cdn.example.test/late.png" }],
      children: [],
    };
    const lots = Array.from({ length: 200 }, (_, i) => ({
      ...gallery,
      label: `Gallery ${i}`,
      images: [{ url: `https://cdn.example.test/${i}.png` }],
    }));
    const { layers, imageUrls } = emit(box({}, [filler, ...lots]));
    const linked = (layers[0]?.content.match(/cdn\.example\.test/g) ?? [])
      .length;
    // Whatever was dropped is neither in the markup nor sent to be hosted.
    expect(imageUrls).toHaveLength(linked);
    expect(imageUrls.length).toBeLessThan(lots.length);
  });

  it("caps the style properties read and the warnings kept for one layer", () => {
    const style: Record<string, string> = {};
    for (let i = 0; i < 5000; i += 1) style[`bogus${i}`] = "1";
    const { warnings } = emit(box(style));
    expect(warnings.length).toBeLessThanOrEqual(202);
    expect(warnings).toContainEqual({
      kind: "inexact",
      detail: `Read only the first ${PASTE_LIMITS.styleProperties} style properties of a layer.`,
    });
  });

  it("marks where the warning list was cut off", () => {
    const warnings: PasteWarnings = [];
    for (let i = 0; i < 500; i += 1) pushWarning(warnings, inexact(`w${i}`));
    expect(warnings).toHaveLength(201);
    expect(warnings[warnings.length - 1]).toEqual({
      kind: "inexact",
      detail: "More problems were found than are listed.",
    });
  });
});

describe("layer names are bounded", () => {
  it("keeps only the start of an enormous, quote-heavy label", () => {
    const { layers } = emit({
      kind: "box",
      label: '"'.repeat(1_000_000),
      style: {},
      children: [],
    });
    const content = layers[0]?.content ?? "";
    expect(content.length).toBeLessThan(5000);
    expect(content).toContain(`${"&quot;".repeat(PASTE_LIMITS.labelChars)}"`);
  });
});
