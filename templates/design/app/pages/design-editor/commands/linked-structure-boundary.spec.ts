import {
  applyVisualEdit,
  moveNodeBetweenDocuments,
  LINKED_COMPONENT_STRUCTURE_REFUSAL,
  type EditIntent,
} from "@shared/code-layer";
import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
  removeCodeLayerNodeFromHtml,
} from "@shared/code-layer";
import { applyComponentPropertyEdit } from "@shared/component-links";
import { expect, it, vi } from "vitest";

// @vitest-environment happy-dom
import { insertClonedHtmlLayers } from "@/pages/design-editor/clone-and-pen-edit";
import { codeLayerPatchMessage } from "@/pages/design-editor/code-layer-state";

import { runDeleteSelection } from "./delete-selection";
import { runLayerRename } from "./layer-rename";

const main =
  '<section data-agent-native-node-id="main" data-agent-native-component-id="card"><span data-agent-native-node-id="label">Label</span></section>';
const instance =
  '<section data-agent-native-node-id="copy" data-agent-native-component-ref="card"><span data-agent-native-node-id="copy-label" data-agent-native-component-source-node-id="label">Label</span></section>';
const source = {
  kind: "design-file" as const,
  designId: "design",
  fileId: "copy-file",
};
const projection = buildCodeLayerProjection(instance, { source });
const node = projection.nodes.find(
  (node) => node.dataAttributes["data-agent-native-node-id"] === "copy-label",
)!;
function editAfter(content: string) {
  return applyComponentPropertyEdit({
    documents: [
      {
        source: {
          kind: "design-file",
          designId: "design",
          fileId: "main-file",
        },
        content: main,
      },
      { source, content },
    ],
    target: { fileId: "main-file", nodeId: "label" },
    edit: { kind: "style", property: "color", value: "red" },
  });
}
it("renames through the current command without breaking the next linked property edit", () => {
  let content = instance;
  const applyFileContentUpdate = vi.fn((_fileId, next) => {
    content = next;
    return {
      status: "accepted",
      content: next,
      nodeIdMap: new Map([[node.id, node.id]]),
    };
  });
  runLayerRename(
    {
      activeFile: { id: "copy-file" },
      canEditDesign: true,
      files: [],
      getFreshActiveContent: () => content,
      codeLayerOwnerByNodeId: new Map([
        [
          node.id,
          {
            fileId: "copy-file",
            node,
            tree: buildCodeLayerTree(projection),
            runtimeOnly: false,
          },
        ],
      ]),
      applyFileContentUpdate,
      setSelectedLayerIdsState: vi.fn(),
    } as unknown as Parameters<typeof runLayerRename>[0],
    node.id,
    "Temporary rename oracle",
  );
  expect(applyFileContentUpdate).toHaveBeenCalledOnce();
  expect(content).toContain(
    'data-agent-native-layer-name="Temporary rename oracle"',
  );
  expect(content).toContain(
    'data-agent-native-component-source-node-id="label"',
  );
  expect(editAfter(content).status).toBe("updated");
});
it("reproduces structural child removal leaving an incomplete instance", () => {
  expect(editAfter(removeCodeLayerNodeFromHtml(instance, node)!).status).toBe(
    "incomplete-instance",
  );
});

it("reproduces main child deletion also breaking the next linked edit", () => {
  const mainProjection = buildCodeLayerProjection(main, {
    source: { ...source, fileId: "main-file" },
  });
  const mainNode = mainProjection.nodes.find(
    (n) => n.dataAttributes["data-agent-native-node-id"] === "label",
  )!;
  const result = applyComponentPropertyEdit({
    documents: [
      {
        source: { ...source, fileId: "main-file" },
        content: removeCodeLayerNodeFromHtml(main, mainNode)!,
      },
      { source, content: instance },
    ],
    target: { fileId: "main-file", nodeId: "main" },
    edit: { kind: "style", property: "color", value: "red" },
  });
  expect(result.status).toBe("incomplete-instance");
});

it.each([
  { kind: "deleteNode", target: { nodeId: "copy-label" } },
  { kind: "deleteNode", target: { nodeId: "label" } },
  { kind: "wrapNodes", targetIds: ["copy-label"] },
  { kind: "wrapNodes", targetIds: ["label"] },
  { kind: "unwrap", targetId: "copy" },
  {
    kind: "moveNode",
    target: { nodeId: "copy-label" },
    anchor: { nodeId: "main" },
    placement: "after",
  },
  {
    kind: "moveNode",
    target: { nodeId: "label" },
    anchor: { nodeId: "copy" },
    placement: "after",
  },
  {
    kind: "moveNode",
    target: { nodeId: "outside" },
    anchor: { nodeId: "copy" },
    placement: "inside",
  },
  {
    kind: "moveNode",
    target: { nodeId: "outside" },
    anchor: { nodeId: "main" },
    placement: "inside",
  },
])("refuses topology change without modifying source: %j", (intent) => {
  const html =
    main + instance + '<div data-agent-native-node-id="outside">Outside</div>';
  const result = applyVisualEdit(html, intent as EditIntent, { source });
  expect(result.result.status).toBe("unsupported");
  expect(result.result.message).toBe(LINKED_COMPONENT_STRUCTURE_REFUSAL);
  expect(result.content).toBe(html);
});
it.each(["copy-label", "label"])(
  "refuses cross-document descendant removal: %s",
  (nodeId) => {
    const html = main + instance;
    const result = moveNodeBetweenDocuments(html, "<div>Other</div>", {
      nodeId,
    });
    expect(result.status).toBe("unsupported");
    expect(result.message).toBe(LINKED_COMPONENT_STRUCTURE_REFUSAL);
    expect(result.sourceHtml).toBe(html);
    expect(result.destHtml).toBe("<div>Other</div>");
  },
);
it.each(["main", "copy"])(
  "refuses cross-document insertion into a component: %s",
  (anchorNodeId) => {
    const html = main + instance;
    const other = '<div data-agent-native-node-id="outside">Other</div>';
    const result = moveNodeBetweenDocuments(other, html, {
      nodeId: "outside",
      anchorNodeId,
      placement: "inside",
    });
    expect(result.status).toBe("unsupported");
    expect(result.sourceHtml).toBe(other);
    expect(result.destHtml).toBe(html);
  },
);
it.each(["main", "copy"])(
  "preserves whole component move and delete: %s",
  (nodeId) => {
    const html =
      main + instance + '<div data-agent-native-node-id="outside">Other</div>';
    expect(
      applyVisualEdit(
        html,
        { kind: "deleteNode", target: { nodeId } },
        { source },
      ).result.status,
    ).toBe(nodeId === "main" ? "unsupported" : "applied");
    expect(
      applyVisualEdit(
        html,
        {
          kind: "moveNode",
          target: { nodeId },
          anchor: { nodeId: "outside" },
          placement: "after",
        },
        { source },
      ).result.status,
    ).toBe("applied");
    expect(
      moveNodeBetweenDocuments(html, "<div>Elsewhere</div>", { nodeId }).status,
    ).toBe("applied");
  },
);
it("uses an accurate translated refusal for the UI", () => {
  const t = vi.fn(() => "Localized detach instruction");
  expect(
    codeLayerPatchMessage(
      LINKED_COMPONENT_STRUCTURE_REFUSAL,
      "Generic move failure",
      t,
    ),
  ).toBe("Localized detach instruction");
  expect(t).toHaveBeenCalledWith(
    "designEditor.componentInstances.linkedStructureUnsupported",
  );
});

it.each(["copy-label", "label", "mixed", "copy", "main", "lower-bound-only"])(
  "routes Delete safely: %s",
  (selection) => {
    let content =
      main + instance + '<div data-agent-native-node-id="outside">Other</div>';
    const projection = buildCodeLayerProjection(content, { source });
    const lowerBoundOnly = selection === "lower-bound-only";
    const ids =
      selection === "mixed"
        ? ["copy-label", "outside"]
        : lowerBoundOnly
          ? ["copy-label"]
          : [selection];
    const nodes = projection.nodes.filter((node) =>
      ids.includes(node.dataAttributes["data-agent-native-node-id"]!),
    );
    const applyFileContentUpdate = vi.fn((_id, next) => {
      content = next;
    });
    const applyLocalContentUpdate = vi.fn((next) => {
      content = next;
    });
    const applyLinkedComponentEdit = vi.fn((_fileId, _nodeId, edit) => {
      expect(edit.kind).toBe("styleTargetsBatch");
      expect(edit.targets).toEqual([
        {
          fileId: "copy-file",
          nodeId: "copy-label",
          styles: { display: "none" },
        },
      ]);
      const hidden = applyComponentPropertyEdit({
        documents: [{ source, content }],
        target: { fileId: "copy-file", nodeId: "copy-label" },
        edit: { kind: "style", property: "display", value: "none" },
      });
      expect(hidden.status).toBe("updated");
      if (hidden.status === "updated") content = hidden.changes[0]!.after;
    });
    const original = content;
    const t = vi.fn((key) => key);
    const getFreshActiveContent = vi.fn(() => content);
    runDeleteSelection({
      activeFile: { id: "copy-file" },
      files: [{ id: "copy-file" }],
      activeCanvasSourceType: "inline",
      canEditDesign: true,
      activeBreakpointUpperBoundPx: null,
      activeBreakpointWidthStateRef: {
        current: lowerBoundOnly ? 1200 : undefined,
      },
      applyLinkedComponentEdit,
      applyFileContentUpdate,
      applyLocalContentUpdate,
      getFreshActiveContent,
      getScreenContent: () => content,
      getSelectedLayerSnapshots: () =>
        nodes.map((node) => ({
          node,
          sourceFileId: "copy-file",
          rootNodeId: node.dataAttributes["data-agent-native-node-id"],
        })),
      codeLayerOwnerByNodeIdRef: { current: new Map() },
      selectedLayerIdsState: nodes.map((node) => node.id),
      selectedElement: null,
      liveScreenSnapshotsById: {},
      previousMotionFileIdRef: { current: null },
      pruneMotionTracksByNodeId: vi.fn(),
      undoManagerRef: { current: null },
      responsiveEditScopeRef: {
        current: lowerBoundOnly ? "only" : "cascade-smaller",
      },
      viewModeRef: { current: "single" },
      setSelectedElement: vi.fn(),
      setSelectedLayerIdsState: vi.fn(),
      setOverviewSelectedScreenIds: vi.fn(),
      deleteRuntimeElement: vi.fn(),
      syncLiveScreenSnapshotPreview: vi.fn(),
      updateLiveScreenSnapshotContent: vi.fn(),
      recordPendingLiveStructureEdit: vi.fn(),
      t,
    } as unknown as Parameters<typeof runDeleteSelection>[0]);
    expect(getFreshActiveContent).toHaveBeenCalledOnce();
    if (selection === "copy-label") {
      expect(applyLinkedComponentEdit).toHaveBeenCalledOnce();
      expect(applyFileContentUpdate).not.toHaveBeenCalled();
      expect(applyLocalContentUpdate).not.toHaveBeenCalled();
      expect(content).toContain('data-agent-native-node-id="copy-label"');
      expect(content).toContain("display: none");
      expect(
        applyComponentPropertyEdit({
          documents: [{ source, content }],
          target: { fileId: "copy-file", nodeId: "label" },
          edit: { kind: "style", property: "color", value: "blue" },
        }).status,
      ).toBe("updated");
    } else if (selection === "copy") {
      expect(applyLinkedComponentEdit).not.toHaveBeenCalled();
      expect(content).not.toContain('data-agent-native-node-id="copy"');
      expect(content).toContain('data-agent-native-node-id="main"');
    } else {
      expect(content).toBe(original);
      expect(applyLinkedComponentEdit).not.toHaveBeenCalled();
      expect(applyLocalContentUpdate).not.toHaveBeenCalled();
      expect(applyFileContentUpdate).not.toHaveBeenCalled();
      expect(t).toHaveBeenCalledWith(
        lowerBoundOnly
          ? "designEditor.componentInstances.linkedEditScopeUnsupported"
          : "designEditor.componentInstances.linkedStructureUnsupported",
      );
    }
  },
);
it("records main deletion orphaning existing references for the root scope decision", () => {
  const result = applyComponentPropertyEdit({
    documents: [{ source, content: instance }],
    target: { fileId: "copy-file", nodeId: "copy-label" },
    edit: { kind: "style", property: "color", value: "red" },
  });
  expect(result.status).toBe("missing-main");
});

it.each([
  ["copy", "inside"],
  ["main", "inside"],
  ["copy-label", "after"],
  ["label", "after"],
])(
  "refuses paste/duplicate insertion into linked interiors: %s %s",
  (anchor, placement) => {
    const onUnsupportedStructure = vi.fn();
    const result = insertClonedHtmlLayers(
      main + instance,
      ['<div data-agent-native-node-id="pasted">New</div>'],
      {
        targetSelectors: [`[data-agent-native-node-id="${anchor}"]`],
        placement: placement as "inside" | "after",
        onUnsupportedStructure,
      },
    );
    expect(result).toBeNull();
    expect(onUnsupportedStructure).toHaveBeenCalledOnce();
  },
);
it.each(["copy", "ordinary"])(
  "preserves root-instance and ordinary duplication: %s",
  (id) => {
    const html =
      main + instance + '<div data-agent-native-node-id="ordinary">Other</div>';
    const clone =
      id === "copy"
        ? instance
        : '<div data-agent-native-node-id="ordinary">Other</div>';
    const refused = vi.fn();
    const result = insertClonedHtmlLayers(html, [clone], {
      targetSelectors: [`[data-agent-native-node-id="${id}"]`],
      placement: "after",
      onUnsupportedStructure: refused,
      componentLinks: {
        sourceFileIds: [source.fileId],
        targetSource: source,
        documents: [{ source, content: html }],
      },
    });
    expect(result?.rootNodeIds).toHaveLength(1);
    expect(refused).not.toHaveBeenCalled();
  },
);

it("refuses deleting a wrapper containing a main before orphaning references", () => {
  const html = `<div data-agent-native-node-id="wrapper">${main}</div>${instance}`;
  const result = applyVisualEdit(
    html,
    { kind: "deleteNode", target: { nodeId: "wrapper" } },
    { source },
  );
  expect(result.result.status).toBe("unsupported");
  expect(result.result.message).toBe(LINKED_COMPONENT_STRUCTURE_REFUSAL);
  expect(result.content).toBe(html);
});
