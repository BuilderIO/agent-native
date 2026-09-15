import { applyVisualEdit, buildCodeLayerProjection } from "@shared/code-layer";
import { describe, expect, it } from "vitest";

import type { KScaleStyleChange } from "@/components/design/multi-screen/types";

import { resolveCodeLayerTargetFromBridge } from "./code-layer-state";
import { applyKScaleStyleChanges } from "./k-scale";
import { applyScopedVisualStyleEdit } from "./pending-edits";

const HTML = `<!doctype html><html><body>
<div data-agent-native-node-id="frame" style="width:200px;height:160px">
  <div data-agent-native-node-id="fixed" style="position:absolute;left:24px;top:20px;width:60px;height:40px;padding:8px;gap:4px"></div>
  <div data-agent-native-node-id="fill" style="flex:1 1 0%;width:180px;height:96px"></div>
</div></body></html>`;

describe("applyKScaleStyleChanges", () => {
  it("composes the gesture's per-node styles into one source document", () => {
    const result = applyKScaleStyleChanges(HTML, [
      {
        selector: '[data-agent-native-node-id="frame"]',
        sourceId: "frame",
        styles: { width: "240px", height: "192px" },
      },
      {
        selector: '[data-agent-native-node-id="fixed"]',
        sourceId: "fixed",
        styles: {
          left: "28.8px",
          top: "24px",
          width: "72px",
          height: "48px",
          "padding-top": "9.6px",
          "padding-right": "9.6px",
          "padding-bottom": "9.6px",
          "padding-left": "9.6px",
          "row-gap": "4.8px",
          "column-gap": "4.8px",
        },
      },
    ]);

    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;
    expect(result.content).toMatch(/width:\s*240px/);
    expect(result.content).toMatch(/left:\s*28\.8px/);
    expect(result.content).toMatch(/height:\s*48px/);
    expect(result.content).toMatch(/padding-top:\s*9\.6px/);
    expect(result.content).toMatch(/padding-left:\s*9\.6px/);
    expect(result.content).toMatch(/row-gap:\s*4\.8px/);
    expect(result.content).toMatch(/column-gap:\s*4\.8px/);
    expect(result.content).toMatch(/width:180px/);
    expect(result.content).toContain("flex:1 1 0%");
  });

  it("matches the legacy writer for idless nested selectors and normalized duplicate properties", () => {
    const source = `<html><body><section class='outer' style='width: 200px; --note: "quoted"; color: red'><article class="child"><span>Keep me</span></article></section></body></html>`;
    const projection = buildCodeLayerProjection(source);
    const parent = projection.nodes.find((node) =>
      node.classes.includes("outer"),
    );
    const child = projection.nodes.find((node) =>
      node.classes.includes("child"),
    );
    expect(parent?.dataAttributes["data-agent-native-node-id"]).toBeUndefined();
    expect(child?.dataAttributes["data-agent-native-node-id"]).toBeUndefined();
    expect(parent).toBeDefined();
    expect(child).toBeDefined();

    const changes: KScaleStyleChange[] = [
      {
        selector: parent!.path,
        styles: { width: "240px", height: "192px" },
      },
      {
        selector: child!.path,
        styles: {
          left: "12px",
          marginLeft: "8px",
          "margin-left": "8px",
        },
      },
    ];
    let legacyContent = source;
    for (const change of changes) {
      const currentProjection = buildCodeLayerProjection(legacyContent);
      const resolved = resolveCodeLayerTargetFromBridge(
        currentProjection,
        change.selector,
      );
      expect(resolved.status).toBe("resolved");
      if (resolved.status !== "resolved") return;

      for (const [property, value] of Object.entries(change.styles)) {
        const patch = applyScopedVisualStyleEdit({
          content: legacyContent,
          target: { nodeId: resolved.node.id },
          property,
          value,
          upperBoundPx: null,
        });
        expect(patch.result.status).toBe("applied");
        if (patch.result.status !== "applied") return;
        legacyContent = patch.content;
      }
    }

    const batched = applyKScaleStyleChanges(source, changes);
    expect(batched.status).toBe("applied");
    if (batched.status !== "applied") return;
    expect(batched.content).toBe(legacyContent);
    expect(batched.content).toContain(
      'style="width: 240px; --note: &quot;quoted&quot;; color: red; height: 192px"',
    );
    expect(batched.content).toContain(
      'class="child" style="left: 12px; margin-left: 8px"',
    );
  });

  it("returns an explicit failure when a gesture target no longer resolves", () => {
    expect(
      applyKScaleStyleChanges(HTML, [
        {
          selector: '[data-agent-native-node-id="missing"]',
          sourceId: "missing",
          styles: { width: "72px" },
        },
      ]),
    ).toMatchObject({ status: "failed", selector: expect.any(String) });
  });

  it("rejects conflicting writes to one target without returning partial content", () => {
    expect(
      applyKScaleStyleChanges(HTML, [
        {
          selector: '[data-agent-native-node-id="fixed"]',
          sourceId: "fixed",
          styles: { width: "72px" },
        },
        {
          selector: '[data-agent-native-node-id="fixed"]',
          sourceId: "fixed",
          styles: { width: "80px" },
        },
      ]),
    ).toMatchObject({ status: "failed", selector: expect.any(String) });
  });

  it("removes only exact breakpoint overrides for properties in the gesture", () => {
    const projection = buildCodeLayerProjection(HTML);
    const fixedId = projection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "fixed",
    )!.id;
    const fillId = projection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "fill",
    )!.id;
    const withOverrides = HTML.replace(
      "</body>",
      `<style data-agent-native-breakpoint-range="${encodeURIComponent(fixedId)}::width::640-800">@media(max-width:800px){[data-agent-native-node-id="${fixedId}"]{width:40px}}</style>
<style data-agent-native-breakpoint-range="${encodeURIComponent(fixedId)}::height::640-800">@media(max-width:800px){[data-agent-native-node-id="${fixedId}"]{height:40px}}</style>
<style data-agent-native-breakpoint-range="${encodeURIComponent(fillId)}::width::640-800">@media(max-width:800px){[data-agent-native-node-id="${fillId}"]{width:40px}}</style>
</body>`,
    );
    const result = applyKScaleStyleChanges(withOverrides, [
      {
        selector: '[data-agent-native-node-id="fixed"]',
        sourceId: "fixed",
        styles: { width: "72px" },
      },
    ]);

    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;
    expect(result.content).not.toContain(
      `data-agent-native-breakpoint-range="${encodeURIComponent(fixedId)}::width::640-800"`,
    );
    expect(result.content).toContain(
      `data-agent-native-breakpoint-range="${encodeURIComponent(fixedId)}::height::640-800"`,
    );
    expect(result.content).toContain(
      `data-agent-native-breakpoint-range="${encodeURIComponent(fillId)}::width::640-800"`,
    );
  });

  it("falls back for semantic vector targets and commits the whole gesture", () => {
    const svgHtml = `<!doctype html><html><body>
<div data-agent-native-node-id="regular" style="width:100px;height:50px"></div>
<svg data-agent-native-node-id="vector" data-an-primitive="rectangle" width="100" height="60" style="width:100px;height:60px"><rect x="0" y="0" width="100" height="60" style="fill:#f97316;stroke:#111827"/></svg>
</body></html>`;
    const result = applyKScaleStyleChanges(svgHtml, [
      {
        selector: '[data-agent-native-node-id="regular"]',
        sourceId: "regular",
        styles: { width: "120px" },
      },
      {
        selector: '[data-agent-native-node-id="vector"]',
        sourceId: "vector",
        styles: { width: "120px", fill: "#3b82f6" },
      },
    ]);

    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;
    expect(result.content).toMatch(
      /data-agent-native-node-id="regular"[^>]*width: 120px/,
    );
    expect(result.content).toMatch(
      /data-agent-native-node-id="vector"[^>]*width: 120px/,
    );
    expect(result.content).toMatch(/<rect[^>]*fill: #3b82f6/);
    expect(result.content).toMatch(/stroke:\s*#111827/);
  });

  it("supports zero and nonzero word-spacing across HTML and semantic SVG K targets", () => {
    const html = `<!doctype html><html><body>
<div data-agent-native-node-id="html-text" style="word-spacing: 2px">HTML</div>
<svg data-agent-native-node-id="svg-text" data-an-primitive="rectangle" viewBox="0 0 80 60" style="width:80px;height:60px;word-spacing:1px"><rect width="80" height="60"/><text>SVG</text></svg>
<svg data-agent-native-node-id="svg-default" data-an-primitive="rectangle" viewBox="0 0 80 60" style="width:80px;height:60px"><rect width="80" height="60"/></svg>
</body></html>`;
    const result = applyKScaleStyleChanges(html, [
      {
        selector: '[data-agent-native-node-id="html-text"]',
        sourceId: "html-text",
        styles: { "word-spacing": "3px" },
      },
      {
        selector: '[data-agent-native-node-id="svg-text"]',
        sourceId: "svg-text",
        styles: { "word-spacing": "2px" },
      },
      {
        selector: '[data-agent-native-node-id="svg-default"]',
        sourceId: "svg-default",
        styles: { wordSpacing: "0px" },
      },
    ]);

    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;
    expect(result.content).toMatch(
      /data-agent-native-node-id="html-text"[^>]*word-spacing: 3px/,
    );
    expect(result.content).toMatch(
      /data-agent-native-node-id="svg-text"[^>]*word-spacing: 2px/,
    );
    expect(result.content).toMatch(
      /data-agent-native-node-id="svg-default"[^>]*word-spacing: 0px/,
    );
  });

  it("keeps Boolean results on the existing semantic style path", () => {
    const source = `<main><div data-agent-native-node-id="base" data-an-primitive="rectangle" style="position:absolute;left:0px;top:0px;width:80px;height:80px;background:#cc3366"></div><div data-agent-native-node-id="cutter" data-an-primitive="ellipse" style="position:absolute;left:20px;top:20px;width:40px;height:40px;background:#3366cc"></div><div data-agent-native-node-id="regular" style="width:80px;height:60px"></div></main>`;
    const boolean = applyVisualEdit(source, {
      kind: "booleanSubtract",
      targetIds: ["base", "cutter"],
    });
    expect(boolean.result.status).toBe("applied");
    if (boolean.result.status !== "applied" || !boolean.result.wrapperNodeId) {
      return;
    }

    const result = applyKScaleStyleChanges(boolean.content, [
      {
        selector: '[data-agent-native-node-id="regular"]',
        sourceId: "regular",
        styles: { width: "120px", height: "90px" },
      },
      {
        selector: `[data-agent-native-node-id="${boolean.result.wrapperNodeId}"]`,
        sourceId: boolean.result.wrapperNodeId,
        styles: { width: "120px", height: "120px" },
      },
    ]);

    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;
    expect(result.content).toMatch(
      /data-agent-native-node-id="regular"[^>]*width: 120px[^>]*height: 90px/,
    );
    expect(result.content).toContain('data-an-primitive="boolean"');
    expect(result.content).toContain("width: 120px");
    expect(result.content).toContain("height: 120px");
  });
});
