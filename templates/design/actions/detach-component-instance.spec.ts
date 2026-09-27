import { describe, expect, it } from "vitest";

import { buildCodeLayerProjection } from "../shared/code-layer.js";
import { componentNodeIdMatches } from "../shared/component-model.js";
import action, {
  stripComponentAnnotations,
} from "./detach-component-instance.js";

describe("detach-component-instance schema", () => {
  it("accepts the minimal designId + nodeId payload", () => {
    expect(
      action.schema.safeParse({ designId: "design_1", nodeId: "node_1" })
        .success,
    ).toBe(true);
  });

  it("accepts an optional fileId and source revision guard", () => {
    const parsed = action.schema.safeParse({
      designId: "design_1",
      nodeId: "node_1",
      fileId: "file_about",
      source: { currentContent: "<div></div>", revision: "2024-01-01" },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a payload missing nodeId", () => {
    expect(action.schema.safeParse({ designId: "design_1" }).success).toBe(
      false,
    );
  });
});

function findNode(html: string, nodeId: string) {
  const projection = buildCodeLayerProjection(html, {
    source: {
      kind: "design-file",
      designId: "d1",
      fileId: "f1",
      filename: "index.html",
    },
  });
  const node = projection.nodes.find((n) => componentNodeIdMatches(n, nodeId));
  if (!node) throw new Error(`test fixture node "${nodeId}" not found`);
  return { node, projectionNodes: projection.nodes };
}

describe("stripComponentAnnotations", () => {
  it("removes the component annotation and prop attributes, preserving everything else", () => {
    const html =
      '<main><button data-agent-native-node-id="btn1" data-agent-native-component="PrimaryButton" ' +
      'data-agent-native-prop-variant="solid" data-agent-native-prop-size="lg" ' +
      'class="rounded px-4" x-data="{ open: false }">Save</button></main>';

    const { node, projectionNodes } = findNode(html, "btn1");
    const result = stripComponentAnnotations(html, node, projectionNodes);

    expect(result.changed).toBe(true);
    expect(result.removedAttributes).toContain("data-agent-native-component");
    expect(result.removedAttributes).toContain(
      "data-agent-native-prop-variant",
    );
    expect(result.removedAttributes).toContain("data-agent-native-prop-size");

    expect(result.content).not.toContain("data-agent-native-component");
    expect(result.content).not.toContain("data-agent-native-prop-");
    expect(result.content).toContain('data-agent-native-node-id="btn1"');
    expect(result.content).toContain('class="rounded px-4"');
    expect(result.content).toContain('x-data="{ open: false }"');
    expect(result.content).toContain(">Save</button>");
  });

  it("is a no-op (changed: false) when the node has no component annotation", () => {
    const html =
      '<main><div data-agent-native-node-id="plain1" class="box">Hi</div></main>';
    const { node, projectionNodes } = findNode(html, "plain1");
    const result = stripComponentAnnotations(html, node, projectionNodes);
    expect(result.changed).toBe(false);
    expect(result.content).toBe(html);
    expect(result.removedAttributes).toEqual([]);
  });

  it("returns unchanged content when the source span is missing", () => {
    const result = stripComponentAnnotations("<div></div>", null);
    expect(result).toEqual({
      content: "<div></div>",
      changed: false,
      removedAttributes: [],
    });
  });

  it("does not disturb sibling instances of the same component", () => {
    const html =
      "<main>" +
      '<button data-agent-native-node-id="a" data-agent-native-component="Chip" data-agent-native-prop-tone="info">A</button>' +
      '<button data-agent-native-node-id="b" data-agent-native-component="Chip" data-agent-native-prop-tone="danger">B</button>' +
      "</main>";
    const { node: nodeA, projectionNodes } = findNode(html, "a");
    const result = stripComponentAnnotations(html, nodeA, projectionNodes);

    expect(result.changed).toBe(true);
    expect(result.content).toContain(
      'data-agent-native-node-id="b" data-agent-native-component="Chip" data-agent-native-prop-tone="danger"',
    );
    const aTagMatch = /<button data-agent-native-node-id="a"[^>]*>/.exec(
      result.content,
    );
    expect(aTagMatch?.[0]).not.toContain("data-agent-native-component");
    expect(aTagMatch?.[0]).not.toContain("data-agent-native-prop-");
  });

  it("clears this instance mapping while preserving a nested instance mapping", () => {
    const html =
      "<main>" +
      '<article data-agent-native-node-id="card-instance" data-agent-native-component="Card" data-agent-native-component-ref="cmp-card" data-agent-native-component-overrides="card-override">' +
      '<button data-agent-native-node-id="play-instance" data-agent-native-component-ref="cmp-play" data-agent-native-component-source-node-id="card-play" data-agent-native-component-overrides="play-override"><span data-agent-native-node-id="play-label" data-agent-native-component-source-node-id="play-label-main">Play</span></button>' +
      '<p data-agent-native-node-id="card-copy" data-agent-native-component-source-node-id="card-copy-main" data-agent-native-component-overrides="copy-override">Card copy</p>' +
      "</article></main>";
    const { node, projectionNodes } = findNode(html, "card-instance");
    const result = stripComponentAnnotations(html, node, projectionNodes);
    const detached = buildCodeLayerProjection(result.content);
    const root = detached.nodes.find(
      (candidate) => candidate.tag === "article",
    );
    const nestedRef = detached.nodes.find(
      (candidate) =>
        candidate.dataAttributes["data-agent-native-node-id"] ===
        "play-instance",
    );
    const nestedChild = detached.nodes.find(
      (candidate) =>
        candidate.dataAttributes["data-agent-native-node-id"] === "play-label",
    );
    const ordinaryChild = detached.nodes.find(
      (candidate) =>
        candidate.dataAttributes["data-agent-native-node-id"] === "card-copy",
    );

    expect(
      root?.dataAttributes["data-agent-native-component-ref"],
    ).toBeUndefined();
    expect(
      root?.dataAttributes["data-agent-native-component-overrides"],
    ).toBeUndefined();
    expect(nestedRef?.dataAttributes["data-agent-native-component-ref"]).toBe(
      "cmp-play",
    );
    expect(
      nestedRef?.dataAttributes["data-agent-native-component-source-node-id"],
    ).toBeUndefined();
    expect(
      nestedRef?.dataAttributes["data-agent-native-component-overrides"],
    ).toBe("play-override");
    expect(
      nestedChild?.dataAttributes["data-agent-native-component-source-node-id"],
    ).toBe("play-label-main");
    expect(
      ordinaryChild?.dataAttributes[
        "data-agent-native-component-source-node-id"
      ],
    ).toBeUndefined();
    expect(
      ordinaryChild?.dataAttributes["data-agent-native-component-overrides"],
    ).toBeUndefined();
  });
});
