// @vitest-environment happy-dom

import { buildCodeLayerProjection } from "@shared/code-layer";
import { describe, expect, it, vi } from "vitest";

import { runChangeSelectedZIndex } from "./change-selected-z-index";

describe("runChangeSelectedZIndex", () => {
  it("dispatches a canonical-main stacking reorder as a linked structure edit", () => {
    const content =
      '<section data-agent-native-node-id="main" data-agent-native-component-id="card"><div data-agent-native-node-id="first" style="position:absolute;left:0;top:0">First</div><div data-agent-native-node-id="second" style="position:absolute;left:0;top:0">Second</div></section>';
    const source = { kind: "design-file" as const, fileId: "main-file" };
    const projection = buildCodeLayerProjection(content, { source });
    const first = projection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "first",
    );
    if (!first) throw new Error("Missing first child projection");
    const applyLinkedComponentEdit = vi.fn();
    const applyLocalContentUpdate = vi.fn();
    const commitVisualStyles = vi.fn();

    runChangeSelectedZIndex(
      {
        applyLinkedComponentEdit,
        activeFile: { id: "main-file" } as never,
        applyLocalContentUpdate,
        canEditDesign: true,
        codeLayerOwnerByNodeIdRef: {
          current: new Map([
            [
              first.id,
              {
                fileId: "main-file",
                node: first,
                tree: [],
                runtimeOnly: false,
              },
            ],
          ]),
        },
        commitVisualStyles,
        getFreshActiveContent: () => content,
        selectedElement: {
          selector: '[data-agent-native-node-id="first"]',
          inlineStyles: { position: "absolute" },
          computedStyles: { position: "absolute", zIndex: "auto" },
        } as never,
        selectedLayerIdsState: [first.id],
        setSelectedElement: vi.fn(),
      },
      "forward",
    );

    expect(applyLinkedComponentEdit).toHaveBeenCalledOnce();
    expect(applyLinkedComponentEdit).toHaveBeenCalledWith("main-file", "main", {
      kind: "structure",
      intents: [
        {
          kind: "moveNode",
          target: { nodeId: first.id },
          anchor: { nodeId: expect.any(String) },
          placement: "after",
        },
      ],
    });
    expect(applyLocalContentUpdate).not.toHaveBeenCalled();
    expect(commitVisualStyles).not.toHaveBeenCalled();
  });
});
