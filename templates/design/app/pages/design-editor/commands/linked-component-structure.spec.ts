import type { EditIntent } from "@shared/code-layer";
import { describe, expect, it, vi } from "vitest";

import {
  dispatchLinkedComponentStructure,
  resolveLinkedComponentSelection,
} from "./linked-component-structure";

const content =
  '<main data-agent-native-node-id="main" data-agent-native-component-id="card"><div data-agent-native-node-id="group"><span data-agent-native-node-id="label">Label</span></div><i data-agent-native-node-id="icon"></i></main><main data-agent-native-node-id="copy" data-agent-native-component-ref="card"><span data-agent-native-node-id="copy-label">Label</span></main><div data-agent-native-node-id="outside"></div>';
const source = { kind: "design-file" as const, fileId: "screen" };

describe("linked component structure dispatch", () => {
  it("resolves the persisted selection in its own file and captures the source for history", () => {
    const { snapshot, nodes } = resolveLinkedComponentSelection({
      content,
      fileId: "screen",
      nodeIds: ["label"],
      previous: {
        activeFileId: "other",
        selectedLayerIds: ["old"],
        overviewSelectedScreenIds: ["screen"],
      },
    });
    expect(nodes[0]?.dataAttributes["data-agent-native-node-id"]).toBe("label");
    expect(snapshot.activeFileId).toBe("screen");
    expect(snapshot.selectedLayerIds).toEqual([nodes[0]!.id]);
    expect(snapshot.sourceContentByFileId).toEqual({ screen: content });
    expect(() =>
      resolveLinkedComponentSelection({
        content,
        fileId: "screen",
        nodeIds: ["missing"],
        previous: snapshot,
      }),
    ).toThrow("resolved uniquely");
  });

  it.each([
    { kind: "wrapNodes", targetIds: ["label"] },
    { kind: "unwrap", targetId: "group" },
    { kind: "deleteNode", target: { nodeId: "label" } },
    {
      kind: "moveNode",
      target: { nodeId: "icon" },
      anchor: { nodeId: "group" },
      placement: "before",
    },
  ] satisfies EditIntent[])(
    "routes a main descendant gesture through one atomic action: %j",
    (intent) => {
      const applyLinkedComponentEdit = vi.fn();
      expect(
        dispatchLinkedComponentStructure({
          content,
          source,
          intents: [intent],
          applyLinkedComponentEdit,
        }),
      ).toBe(true);
      expect(applyLinkedComponentEdit).toHaveBeenCalledExactlyOnceWith(
        "screen",
        "main",
        { kind: "structure", intents: [intent] },
      );
    },
  );

  it.each([
    { kind: "wrapNodes", targetIds: ["main"] },
    { kind: "deleteNode", target: { nodeId: "outside" } },
    { kind: "deleteNode", target: { nodeId: "copy-label" } },
    { kind: "wrapNodes", targetIds: ["missing"] },
    { kind: "wrapNodes", targetIds: ["label", "outside"] },
    {
      kind: "moveNode",
      target: { nodeId: "label" },
      anchor: { nodeId: "copy" },
      placement: "inside",
    },
  ] satisfies EditIntent[])(
    "leaves ordinary, instance, and unresolved edits to their existing command: %j",
    (intent) => {
      const applyLinkedComponentEdit = vi.fn();
      expect(
        dispatchLinkedComponentStructure({
          content,
          source,
          intents: [intent],
          applyLinkedComponentEdit,
        }),
      ).toBe(false);
      expect(applyLinkedComponentEdit).not.toHaveBeenCalled();
    },
  );
});
