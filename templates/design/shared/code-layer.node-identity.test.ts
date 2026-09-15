import { describe, expect, it } from "vitest";

import {
  applyVisualEdit,
  buildCodeLayerTree,
  buildCodeLayerProjection,
  ensureCodeLayerNodeIdInHtml,
  moveNodeBetweenDocuments,
  resolveCodeLayerTarget,
} from "./code-layer.js";

const SOURCE_HTML = `<!doctype html><html><body>
  <section class="row"><h2>Heading</h2><p>Body</p></section>
</body></html>`;
const DEST_HTML = `<!doctype html><html><body>
  <main class="target"><span>Destination</span></main>
</body></html>`;

describe("code-layer source identity", () => {
  it("stamps a selected source node through its unique selector without invalidating sibling ids", () => {
    const source = { kind: "design-file" as const, fileId: "screen-a" };
    const originalProjection = buildCodeLayerProjection(SOURCE_HTML, {
      source,
    });
    const heading = originalProjection.nodes.find((node) => node.tag === "h2");
    const body = originalProjection.nodes.find((node) => node.tag === "p");
    expect(heading).toBeDefined();
    expect(body).toBeDefined();

    const stamped = ensureCodeLayerNodeIdInHtml(SOURCE_HTML, heading!.id, {
      source,
      selector: heading!.path,
    });

    expect(stamped.changed).toBe(true);
    expect(stamped.nodeId).toMatch(/^an-/);
    expect(stamped.content).toContain(
      `data-agent-native-node-id="${stamped.nodeId}"`,
    );
    const nextProjection = buildCodeLayerProjection(stamped.content, {
      source,
    });
    expect(nextProjection.nodes.find((node) => node.tag === "p")?.id).toBe(
      body!.id,
    );

    const samePathOtherFile = ensureCodeLayerNodeIdInHtml(
      SOURCE_HTML,
      heading!.id,
      {
        source: { kind: "design-file", fileId: "screen-b" },
        selector: heading!.path,
      },
    );
    expect(samePathOtherFile.nodeId).not.toBe(stamped.nodeId);
  });

  it("disambiguates repeated primitive data selectors without changing sibling identity", () => {
    const source = { kind: "design-file" as const, fileId: "same-primitives" };
    const content = `<div data-agent-native-group="true">
      <div data-an-primitive="rectangle"></div>
      <div data-an-primitive="rectangle"></div>
    </div>`;
    const projection = buildCodeLayerProjection(content, { source });
    const rectangles = projection.nodes.filter(
      (node) => node.dataAttributes["data-an-primitive"] === "rectangle",
    );

    expect(rectangles).toHaveLength(2);
    expect(rectangles[0]?.id).not.toBe(rectangles[1]?.id);
    expect(rectangles[0]?.path).not.toBe(rectangles[1]?.path);
    expect(rectangles[1]?.path).toContain(":nth-of-type(2)");

    const stamped = ensureCodeLayerNodeIdInHtml(content, rectangles[1]!.id, {
      source,
      selector: rectangles[1]!.path,
    });
    const nextProjection = buildCodeLayerProjection(stamped.content, {
      source,
    });
    const nextRectangles = nextProjection.nodes.filter(
      (node) => node.dataAttributes["data-an-primitive"] === "rectangle",
    );

    expect(stamped.changed).toBe(true);
    expect(nextRectangles[0]?.id).toBe(rectangles[0]?.id);
    expect(nextRectangles[1]?.dataAttributes["data-agent-native-node-id"]).toBe(
      stamped.nodeId,
    );
  });

  it("keeps repeated authored ids distinct in the projected hierarchy", () => {
    const content = `<body>
      <div class="first" data-agent-native-node-id="duplicate">
        <span class="nested" data-agent-native-node-id="duplicate">
          <b class="leaf" data-agent-native-node-id="duplicate">First</b>
        </span>
      </div>
      <div class="second" data-agent-native-node-id="duplicate">
        <span class="nested" data-agent-native-node-id="duplicate">
          <b class="leaf" data-agent-native-node-id="duplicate">Second</b>
        </span>
      </div>
    </body>`;
    const projection = buildCodeLayerProjection(content);
    const duplicatedNodes = projection.nodes.filter(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === "duplicate",
    );
    const internalIds = duplicatedNodes.map((node) => node.id);
    expect(duplicatedNodes).toHaveLength(6);
    expect(new Set(internalIds).size).toBe(duplicatedNodes.length);

    const first = duplicatedNodes.find((node) =>
      node.classes.includes("first"),
    );
    const second = duplicatedNodes.find((node) =>
      node.classes.includes("second"),
    );
    const firstNested = duplicatedNodes.find(
      (node) => node.parentId === first?.id && node.classes.includes("nested"),
    );
    const firstLeaf = duplicatedNodes.find(
      (node) =>
        node.parentId === firstNested?.id && node.classes.includes("leaf"),
    );
    const secondNested = duplicatedNodes.find(
      (node) => node.parentId === second?.id && node.classes.includes("nested"),
    );
    const secondLeaf = duplicatedNodes.find(
      (node) =>
        node.parentId === secondNested?.id && node.classes.includes("leaf"),
    );
    expect(first?.children).toEqual([firstNested?.id]);
    expect(firstNested?.children).toEqual([firstLeaf?.id]);
    expect(second?.children).toEqual([secondNested?.id]);
    expect(secondNested?.children).toEqual([secondLeaf?.id]);

    const tree = buildCodeLayerTree(projection);
    expect(tree.find((node) => node.id === first?.id)?.children[0]?.id).toBe(
      firstNested?.id,
    );
    expect(tree.find((node) => node.id === second?.id)?.children[0]?.id).toBe(
      secondNested?.id,
    );

    const resolved = resolveCodeLayerTarget(content, {
      nodeId: "duplicate",
      selector: "div.second",
    });
    expect(resolved.resolution.status).toBe("resolved");
    expect(resolved.resolution.node?.source?.start).toBe(second?.source?.start);

    const edited = applyVisualEdit(content, {
      kind: "style",
      target: { nodeId: "duplicate", selector: "div.second" },
      property: "background-color",
      value: "#3b82f6",
    });
    expect(edited.result.status).toBe("applied");
    expect(edited.content).toMatch(
      /class="first"[^>]*data-agent-native-node-id="duplicate"[^>]*>/,
    );
    expect(edited.content).toMatch(
      /class="second"[^>]*background-color:\s*#3b82f6/,
    );

    const ambiguous = applyVisualEdit(content, {
      kind: "style",
      target: { nodeId: "duplicate" },
      property: "background-color",
      value: "#3b82f6",
    });
    expect(ambiguous.result.status).toBe("conflict");
    expect(ambiguous.content).toBe(content);
  });

  it("moves by source and destination selectors while persisting both identities", () => {
    const source = buildCodeLayerProjection(SOURCE_HTML);
    const destination = buildCodeLayerProjection(DEST_HTML);
    const heading = source.nodes.find((node) => node.tag === "h2");
    const target = destination.nodes.find((node) => node.tag === "main");
    expect(heading).toBeDefined();
    expect(target).toBeDefined();

    const result = moveNodeBetweenDocuments(SOURCE_HTML, DEST_HTML, {
      nodeId: "runtime-1mv2vou",
      sourceSelector: heading!.path,
      anchorNodeId: "runtime-destination",
      anchorSelector: target!.path,
      placement: "inside",
    });

    expect(result.status).toBe("applied");
    expect(result.movedNodeId).toMatch(/^an-/);
    expect(result.sourceHtml).not.toContain("<h2>Heading</h2>");
    expect(result.destHtml).toContain(
      `data-agent-native-node-id="${result.movedNodeId}"`,
    );
    expect(result.destHtml).toMatch(
      /<main[^>]*data-agent-native-node-id="an-[^"]+"[^>]*>[\s\S]*<h2[^>]*data-agent-native-node-id="an-[^"]+"[^>]*>Heading<\/h2>/,
    );
  });

  it("uses the same unique selector fallback for same-document moves", () => {
    const projection = buildCodeLayerProjection(SOURCE_HTML);
    const heading = projection.nodes.find((node) => node.tag === "h2");
    const section = projection.nodes.find((node) => node.tag === "section");
    expect(heading).toBeDefined();
    expect(section).toBeDefined();

    const result = applyVisualEdit(SOURCE_HTML, {
      kind: "moveNode",
      target: { nodeId: "runtime-source", selector: heading!.path },
      anchor: { nodeId: "runtime-anchor", selector: section!.path },
      placement: "inside",
    });

    expect(result.result.status).toBe("applied");
    expect(result.content).toContain("<section");
    expect(result.content.indexOf("<h2")).toBeGreaterThan(
      result.content.indexOf("<section"),
    );
    expect(result.content).toContain("Heading</h2>");
  });

  it("refuses ambiguous or missing requested targets without changing either document", () => {
    const duplicatedSource = `<!doctype html><html><body><p class="item">A</p><p class="item">B</p></body></html>`;
    const ambiguous = moveNodeBetweenDocuments(duplicatedSource, DEST_HTML, {
      nodeId: "missing-source-id",
      sourceSelector: "p.item",
      anchorNodeId: "runtime-destination",
      anchorSelector: "main.target",
      placement: "inside",
    });
    expect(ambiguous.status).toBe("unsupported");
    expect(ambiguous.sourceHtml).toBe(duplicatedSource);
    expect(ambiguous.destHtml).toBe(DEST_HTML);

    const missingAnchor = moveNodeBetweenDocuments(SOURCE_HTML, DEST_HTML, {
      sourceSelector: "h2",
      anchorNodeId: "runtime-destination",
      anchorSelector: "main.missing",
      placement: "inside",
    });
    expect(missingAnchor.status).toBe("unsupported");
    expect(missingAnchor.sourceHtml).toBe(SOURCE_HTML);
    expect(missingAnchor.destHtml).toBe(DEST_HTML);

    const duplicateStableIds = `<body><div data-agent-native-node-id="duplicate"></div><span data-agent-native-node-id="duplicate"></span></body>`;
    const ambiguousStableId = moveNodeBetweenDocuments(
      duplicateStableIds,
      DEST_HTML,
      {
        nodeId: "duplicate",
        anchorSelector: "main.target",
      },
    );
    expect(ambiguousStableId.status).toBe("unsupported");
    expect(ambiguousStableId.sourceHtml).toBe(duplicateStableIds);
    expect(ambiguousStableId.destHtml).toBe(DEST_HTML);
  });
});
