import { buildCodeLayerProjection } from "@shared/code-layer";
import { describe, expect, it } from "vitest";

import {
  applyAutoLayoutSuggestion,
  hasMeaningfulCssTransform,
  inferAutoLayoutSuggestion,
  isExistingFlowLayout,
} from "./auto-layout-suggestion";
import { mergeLocalContentHistoryFallback } from "./history";

describe("inferAutoLayoutSuggestion", () => {
  it("distinguishes computed none/identity from real transforms", () => {
    expect(hasMeaningfulCssTransform({ transform: "none", scale: "1" })).toBe(
      false,
    );
    expect(hasMeaningfulCssTransform({ transform: "rotate(12deg)" })).toBe(
      true,
    );
    expect(hasMeaningfulCssTransform({ rotate: "12deg" })).toBe(true);
    expect(
      hasMeaningfulCssTransform({
        transform: "none",
        classes: ["md:rotate-6"],
      }),
    ).toBe(true);
  });

  it("keeps ordinary localhost snapshot children safe to apply", () => {
    const children = [
      { id: "a", x: 0, y: 0, width: 40, height: 40, classes: ["rounded"] },
      { id: "b", x: 50, y: 0, width: 40, height: 40, classes: ["flex-1"] },
    ].map(({ classes, ...rect }) => ({
      ...rect,
      transformed: hasMeaningfulCssTransform({
        transform: "none",
        scale: "1",
        classes,
      }),
    }));
    expect(
      inferAutoLayoutSuggestion({
        container: { id: "container", x: 0, y: 0, width: 90, height: 40 },
        children,
      })?.safeToApply,
    ).toBe(true);
  });

  it("recognizes inline, computed, and responsive-class flow containers", () => {
    expect(isExistingFlowLayout({ display: "flex" })).toBe(true);
    expect(
      isExistingFlowLayout({ display: "block", computedDisplay: "grid" }),
    ).toBe(true);
    expect(isExistingFlowLayout({ classes: ["md:flex"] })).toBe(true);
    expect(
      isExistingFlowLayout({ display: "block", classes: ["flex-1"] }),
    ).toBe(false);
  });
  it("infers measured order, asymmetric padding, gap, alignment, and sizing", () => {
    const suggestion = inferAutoLayoutSuggestion({
      container: { id: "container", x: 0, y: 0, width: 240, height: 80 },
      children: [
        { id: "b", x: 90, y: 15, width: 50, height: 50 },
        { id: "a", x: 20, y: 15, width: 50, height: 50 },
      ],
    });
    expect(suggestion).toMatchObject({
      direction: "row",
      orderedChildIds: ["a", "b"],
      gap: 20,
      padding: { top: 15, right: 100, bottom: 15, left: 20 },
      alignItems: "stretch",
      horizontalSizing: "hug",
      verticalSizing: "hug",
      safeToApply: true,
    });
  });

  it("uses Figma's column default for a single wide child", () => {
    const suggestion = inferAutoLayoutSuggestion({
      container: { id: "container", x: 0, y: 0, width: 300, height: 40 },
      children: [{ id: "wide", x: 0, y: 0, width: 300, height: 40 }],
    });
    expect(suggestion).toMatchObject({
      direction: "column",
      gap: 10,
      horizontalSizing: "hug",
      verticalSizing: "hug",
    });
  });

  it("returns no proposal for an empty container", () => {
    expect(
      inferAutoLayoutSuggestion({
        container: { id: "container", x: 0, y: 0, width: 100, height: 100 },
        children: [],
      }),
    ).toBeNull();
  });

  it("refuses destructive application for overlaps or transforms", () => {
    const suggestion = inferAutoLayoutSuggestion({
      container: { id: "container", x: 0, y: 0, width: 100, height: 100 },
      children: [
        { id: "a", x: 0, y: 0, width: 60, height: 50 },
        { id: "b", x: 40, y: 0, width: 60, height: 50, transformed: true },
      ],
    });
    expect(suggestion?.safeToApply).toBe(false);
    expect(suggestion?.warnings).toEqual(["overlap", "transformed"]);
  });
});

describe("applyAutoLayoutSuggestion", () => {
  const html = `<div data-agent-native-node-id="container" style="position:relative;width:240px;height:80px"><div data-agent-native-node-id="b" style="position:absolute;left:90px;top:15px;width:50px;height:50px"><span data-agent-native-node-id="nested" style="position:absolute;left:3px">B</span></div><div data-agent-native-node-id="a" style="position:absolute;left:20px;top:15px;width:50px;height:50px">A</div></div>`;

  it("applies the reviewed proposal while preserving nested absolute layout", () => {
    const suggestion = inferAutoLayoutSuggestion({
      container: { id: "container", x: 0, y: 0, width: 240, height: 80 },
      children: [
        { id: "b", x: 90, y: 15, width: 50, height: 50 },
        { id: "a", x: 20, y: 15, width: 50, height: 50 },
      ],
    })!;
    const result = applyAutoLayoutSuggestion(html, suggestion);
    expect(result.status).toBe("applied");
    expect(result.content.indexOf(">A</div>")).toBeLessThan(
      result.content.indexOf(">B</span>"),
    );
    expect(result.content).toContain("display: flex");
    expect(result.content).toContain("gap: 20px");
    expect(result.content).toContain("padding: 15px 100px 15px 20px");
    expect(result.content).toContain(
      'data-agent-native-node-id="nested" style="position:absolute;left:3px"',
    );
    const projection = buildCodeLayerProjection(result.content);
    const byAuthoredId = (id: string) =>
      projection.nodes.find(
        (node) => node.dataAttributes["data-agent-native-node-id"] === id,
      );
    for (const childId of ["a", "b"]) {
      const child = byAuthoredId(childId);
      expect(child?.style.position).toBeUndefined();
      expect(child?.style.left).toBeUndefined();
      expect(child?.style.top).toBeUndefined();
    }
    const nested = byAuthoredId("nested");
    expect(nested?.style).toMatchObject({ position: "absolute", left: "3px" });

    const history = mergeLocalContentHistoryFallback([], {
      fileId: "screen",
      before: html,
      after: result.content,
    });
    expect(history).toHaveLength(1);
    expect(history[0]?.before).toBe(html);
    expect(history[0]?.after).toBe(result.content);
    // The one entry is exactly what editor undo/redo consumes in each
    // direction, so the complete reorder/layout/sizing proposal is atomic.
    expect(history[0]?.before).not.toBe(history[0]?.after);
  });

  it("fails closed if children changed after preview", () => {
    const suggestion = inferAutoLayoutSuggestion({
      container: { id: "container", x: 0, y: 0, width: 240, height: 80 },
      children: [
        { id: "b", x: 90, y: 15, width: 50, height: 50 },
        { id: "a", x: 20, y: 15, width: 50, height: 50 },
      ],
    })!;
    const result = applyAutoLayoutSuggestion(
      html.replace(
        "</div></div>",
        '</div><i data-agent-native-node-id="new">New</i></div>',
      ),
      suggestion,
    );
    expect(result).toMatchObject({
      status: "conflict",
      content: expect.any(String),
    });
  });
});
