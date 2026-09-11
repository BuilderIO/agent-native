import { describe, expect, it } from "vitest";

import { buildCodeLayerProjection } from "../shared/code-layer.js";
import { componentNodeIdMatches } from "../shared/component-model.js";
import action, {
  stripComponentAnnotations,
} from "./detach-component-instance.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// stripComponentAnnotations — pure transform
// ---------------------------------------------------------------------------

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
  return node;
}

describe("stripComponentAnnotations", () => {
  it("removes the component annotation and prop attributes, preserving everything else", () => {
    const html =
      '<main><button data-agent-native-node-id="btn1" data-agent-native-component="PrimaryButton" ' +
      'data-agent-native-prop-variant="solid" data-agent-native-prop-size="lg" ' +
      'class="rounded px-4" x-data="{ open: false }">Save</button></main>';

    const node = findNode(html, "btn1");
    const result = stripComponentAnnotations(html, node.source);

    expect(result.changed).toBe(true);
    expect(result.removedAttributes).toContain("data-agent-native-component");
    expect(result.removedAttributes).toContain(
      "data-agent-native-prop-variant",
    );
    expect(result.removedAttributes).toContain("data-agent-native-prop-size");

    expect(result.content).not.toContain("data-agent-native-component");
    expect(result.content).not.toContain("data-agent-native-prop-");
    // Preserved: node id, classes, x-data, text content, tag.
    expect(result.content).toContain('data-agent-native-node-id="btn1"');
    expect(result.content).toContain('class="rounded px-4"');
    expect(result.content).toContain('x-data="{ open: false }"');
    expect(result.content).toContain(">Save</button>");
  });

  it("is a no-op (changed: false) when the node has no component annotation", () => {
    const html =
      '<main><div data-agent-native-node-id="plain1" class="box">Hi</div></main>';
    const node = findNode(html, "plain1");
    const result = stripComponentAnnotations(html, node.source);
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
    const nodeA = findNode(html, "a");
    const result = stripComponentAnnotations(html, nodeA.source);

    expect(result.changed).toBe(true);
    // Sibling "b" keeps its annotation and its own prop value untouched.
    expect(result.content).toContain(
      'data-agent-native-node-id="b" data-agent-native-component="Chip" data-agent-native-prop-tone="danger"',
    );
    // "a" lost its annotation entirely.
    const aTagMatch = /<button data-agent-native-node-id="a"[^>]*>/.exec(
      result.content,
    );
    expect(aTagMatch?.[0]).not.toContain("data-agent-native-component");
    expect(aTagMatch?.[0]).not.toContain("data-agent-native-prop-");
  });
});
