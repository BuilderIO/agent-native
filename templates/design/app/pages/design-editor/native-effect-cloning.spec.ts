// @vitest-environment happy-dom

import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";
import { catalogFloat, catalogShader } from "@shared/native-effect-catalog-kit";
import { NativeEffectCloningError } from "@shared/native-effect-cloning";
import {
  parseEffectsFromHtml,
  writeEffectsToHtml,
  type EffectDocument,
  type EffectInstance,
} from "@shared/native-effects";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { reassignDuplicatedNodeIds } from "./canvas-primitive-insert";
import {
  insertClonedHtmlLayers,
  planLinkedComponentStructureClone,
} from "./clone-and-pen-edit";
import { runDuplicateSelection } from "./commands/duplicate-selection";
import { prepareCanonicalSourceContent } from "./source-publication";
import type { DesignFile } from "./types";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const subtree =
  '<section data-agent-native-node-id="frame"><div data-agent-native-node-id="child"></div></section>';
const sourceHtml = `<html><body>${subtree}<img data-agent-native-node-id="outside" src="/example.svg"></body></html>`;
const fill = catalogShader({
  id: "clone-fill-proof",
  name: "Clone fill",
  kind: "generator",
  properties: { gain: catalogFloat("Gain", 0.5, 0, 1) },
  fragment: () => "return vec4f(0.0);",
});
const processor = catalogShader({
  id: "clone-processor-proof",
  name: "Clone processor",
  kind: "processor",
  backdrop: true,
  properties: { edge: catalogFloat("Edge", 1, 0, 3) },
  fragment: () => "return sampleSource(input.uv);",
});

function instance(
  id: string,
  nodeId: string,
  placement: EffectInstance["placement"] = "fill",
): EffectInstance {
  const definition = placement === "fill" ? fill : processor;
  return {
    id,
    nodeId,
    definitionId: definition.id,
    definitionVersion: definition.version,
    placement,
    params: placement === "fill" ? { gain: 0.27 } : { edge: 2 },
    enabled: true,
    opacity: 0.41,
    seed: 123,
    clip: "bounds",
    blend: "normal",
    timing: { speed: 1.75, paused: true, time: 3.25, seekRevision: 4 },
    transform: { translate: [2, 4], scale: [0.8, 1.2], rotate: 0.25 },
  };
}

function fixture() {
  const document: EffectDocument = {
    schemaVersion: 2,
    definitions: [fill, processor],
    instances: [
      { ...instance("frame-lower", "frame"), enabled: false },
      instance("child-fill", "child"),
      { ...instance("frame-upper", "frame"), params: { gain: 0.72 } },
      {
        ...instance("frame-layer", "frame", "layer"),
        bindings: {
          source: {
            kind: "authored-node",
            nodeId: "child",
            capture: "appearance",
          },
        },
      },
      {
        ...instance("child-backdrop", "child", "backdrop"),
        bindings: {
          source: {
            kind: "authored-node",
            nodeId: "outside",
            capture: "content",
          },
        },
      },
      instance("outside-fill", "outside"),
    ],
    preview: { quality: "quality", frameRateTarget: 120 },
    presets: [
      {
        id: "saved-input",
        name: "Saved input",
        definitionId: processor.id,
        definitionVersion: processor.version,
        placement: "layer",
        params: { edge: 2 },
        clip: "bounds",
        bindings: {
          source: {
            kind: "authored-node",
            nodeId: "child",
            capture: "content",
          },
        },
        provenance: { origin: "user-authored" },
      },
    ],
  };
  return writeEffectsToHtml(sourceHtml, document);
}

function effects(html: string) {
  const result = parseEffectsFromHtml(html);
  expect(result.errors).toEqual([]);
  expect(result.document).not.toBeNull();
  return result.document!;
}

function expectClonedStack(
  before: string,
  after: string,
  nodeIdMap: ReadonlyMap<string, string>,
  originalsRetained = true,
) {
  const original = effects(before);
  const document = effects(after);
  const sourceInstances = [...nodeIdMap.keys()].flatMap((nodeId) =>
    original.instances.filter((effect) => effect.nodeId === nodeId),
  );
  const clones = [...nodeIdMap.values()].flatMap((nodeId) =>
    document.instances.filter((effect) => effect.nodeId === nodeId),
  );
  expect(clones).toHaveLength(sourceInstances.length);
  clones.forEach((clone, index) => {
    const source = sourceInstances[index]!;
    expect(clone.id).not.toBe(source.id);
    expect(clone).toEqual({
      ...source,
      id: clone.id,
      nodeId: nodeIdMap.get(source.nodeId),
      ...(source.bindings
        ? {
            bindings: Object.fromEntries(
              Object.entries(source.bindings).map(([key, binding]) => [
                key,
                binding.kind === "authored-node"
                  ? {
                      ...binding,
                      nodeId: nodeIdMap.get(binding.nodeId) ?? binding.nodeId,
                    }
                  : binding,
              ]),
            ),
          }
        : {}),
    });
  });
  expect(new Set(document.instances.map((effect) => effect.id)).size).toBe(
    document.instances.length,
  );
  expect(document.definitions).toEqual(original.definitions);
  expect(document.preview).toEqual(original.preview);
  if (originalsRetained)
    expect(document.instances.slice(0, original.instances.length)).toEqual(
      original.instances,
    );
  const doc = new DOMParser().parseFromString(after, "text/html");
  const ids = [...doc.querySelectorAll("[data-agent-native-node-id]")].map(
    (node) => node.getAttribute("data-agent-native-node-id"),
  );
  expect(new Set(ids).size).toBe(ids.length);
}

function clone(before = fixture()) {
  const result = insertClonedHtmlLayers(before, [subtree], {
    targetSelectors: ['[data-agent-native-node-id="frame"]'],
  });
  expect(result).not.toBeNull();
  return result!;
}

describe("native effects at authored duplication boundaries", () => {
  it("clones entire subtree stacks in order with independent IDs, settings, and internal or external inputs", () => {
    const before = fixture();
    const result = clone(before);
    expectClonedStack(before, result.content, result.nodeIdMap);
    expect(effects(result.content).presets).toEqual(effects(before).presets);
    const second = clone(result.content);
    expectClonedStack(result.content, second.content, second.nodeIdMap);
  });

  it("composes the Alt-drag bridge's original-to-incoming IDs before copying effects", () => {
    const before = fixture();
    const source = { kind: "design-file" as const, fileId: "screen" };
    const incoming = subtree
      .replace('"frame"', '"bridge-frame"')
      .replace('"child"', '"bridge-child"');
    const result = insertClonedHtmlLayers(before, [incoming], {
      preserveIncomingNodeIds: true,
      componentLinks: {
        sourceFileIds: ["screen"],
        sourceNodeIdMaps: [
          [
            ["frame", "bridge-frame"],
            ["child", "bridge-child"],
          ],
        ],
        targetSource: source,
        documents: [{ source, content: before }],
      },
    });
    expect(result).not.toBeNull();
    const nodeIdMap = new Map([
      ["frame", result!.nodeIdMap.get("bridge-frame")!],
      ["child", result!.nodeIdMap.get("bridge-child")!],
    ]);
    expectClonedStack(before, result!.content, nodeIdMap);
  });

  it("remaps every whole-screen target, instance, preset input and subtree input", () => {
    const before = fixture();
    const after = reassignDuplicatedNodeIds(before);
    const doc = new DOMParser().parseFromString(after, "text/html");
    const nodeIdMap = new Map([
      [
        "frame",
        doc
          .querySelector("section")!
          .getAttribute("data-agent-native-node-id")!,
      ],
      [
        "child",
        doc
          .querySelector("section div")!
          .getAttribute("data-agent-native-node-id")!,
      ],
      [
        "outside",
        doc.querySelector("img")!.getAttribute("data-agent-native-node-id")!,
      ],
    ]);
    expectClonedStack(before, after, nodeIdMap, false);
    expect(effects(after).instances).toHaveLength(
      effects(before).instances.length,
    );
    expect(effects(after).presets![0].bindings!.source).toEqual({
      kind: "authored-node",
      nodeId: nodeIdMap.get("child"),
      capture: "content",
    });
  });

  it("imports only needed shared definitions when cloning across screens", () => {
    const before = fixture();
    const targetSource = { kind: "design-file" as const, fileId: "target" };
    const source = { kind: "design-file" as const, fileId: "source" };
    const result = insertClonedHtmlLayers(
      "<html><body></body></html>",
      [subtree],
      {
        componentLinks: {
          sourceFileIds: ["source"],
          targetSource,
          documents: [{ source, content: before }],
        },
      },
    );
    expect(result).not.toBeNull();
    expect(effects(result!.content).instances).toHaveLength(5);
    expect(effects(result!.content).definitions).toEqual([fill, processor]);
  });

  it("refuses unreadable native metadata and component snapshots that cannot carry the manifest", () => {
    const invalid = fixture().replace(
      '"schemaVersion":2',
      '"schemaVersion":999',
    );
    expect(() => reassignDuplicatedNodeIds(invalid)).toThrow(
      NativeEffectCloningError,
    );
    expect(insertClonedHtmlLayers(invalid, [subtree])).toBeNull();
    const source = { kind: "design-file" as const, fileId: "screen" };
    expect(
      insertClonedHtmlLayers(fixture(), [subtree], {
        componentLinks: {
          sourceFileIds: ["screen"],
          sourceNodeIdMaps: [null],
          targetSource: source,
          documents: [{ source, content: fixture() }],
        },
      }),
    ).toBeNull();
    const before = fixture()
      .replace(
        "<body>",
        '<body><main data-agent-native-node-id="main" data-agent-native-component-id="cmp-main">',
      )
      .replace("</body>", "</main></body>");
    const onUnsupportedStructure = vi.fn();
    const result = planLinkedComponentStructureClone(before, [subtree], {
      targetSelectors: ['[data-agent-native-node-id="frame"]'],
      onUnsupportedStructure,
    });
    expect(result).toBeNull();
    expect(onUnsupportedStructure).toHaveBeenCalledOnce();
  });

  it.each([
    { selection: "subtree", nodeIds: ["frame"], instanceCount: 11 },
    {
      selection: "multiple layers",
      nodeIds: ["child", "outside"],
      instanceCount: 9,
    },
  ])(
    "publishes $selection atomically and preserves saved content through Yjs undo/redo",
    ({ nodeIds, instanceCount }) => {
      const before = fixture();
      const source = {
        kind: "design-file" as const,
        fileId: "screen",
        filename: "screen.html",
      };
      const projection = buildCodeLayerProjection(before, { source });
      const selectedNodes = nodeIds.map(
        (nodeId) =>
          projection.nodes.find(
            (candidate) =>
              candidate.dataAttributes["data-agent-native-node-id"] === nodeId,
          )!,
      );
      const node = selectedNodes[0]!;
      const sourceDoc = new DOMParser().parseFromString(before, "text/html");
      const clonedNodeIdMap = new Map<string, string>();
      const doc = new Y.Doc();
      const content = doc.getText("content");
      content.insert(0, before);
      const undoManager = new Y.UndoManager(content);
      let persisted = before;
      content.observe(() => {
        persisted = content.toString();
      });
      const publish = (nextContent: string) => {
        const publication = prepareCanonicalSourceContent(nextContent, {
          fileId: "screen",
          fileType: "html",
        });
        doc.transact(() => {
          content.delete(0, content.length);
          content.insert(0, publication.content);
        });
        return {
          status: "accepted" as const,
          content: publication.content,
          nodeIdMap: publication.nodeIdMap,
        };
      };
      const file = {
        id: "screen",
        filename: "screen.html",
        fileType: "html",
        content: before,
        createdAt: "",
        updatedAt: "",
      } as DesignFile;
      runDuplicateSelection({
        activeFile: file,
        designId: "design",
        files: [file],
        canEditDesign: true,
        applyFileContentUpdate: (_fileId, nextContent) => publish(nextContent),
        applyLocalContentUpdate: publish,
        getFreshActiveContent: () => content.toString(),
        getScreenContent: () => content.toString(),
        getSelectedLayerSnapshots: () =>
          selectedNodes.map((selectedNode, index) => ({
            html: sourceDoc.querySelector(
              `[data-agent-native-node-id="${nodeIds[index]}"]`,
            )!.outerHTML,
            rootNodeId: nodeIds[index],
            sourceFileId: "screen",
            sourceIndex: index,
            node: selectedNode,
            tree: buildCodeLayerTree(projection),
          })),
        handleDuplicateScreen: vi.fn(),
        lastDuplicateTransformRef: { current: null },
        overviewSelectedScreenIds: [],
        remapMotionTracksForClone: (map) =>
          map.forEach((value, key) => clonedNodeIdMap.set(key, value)),
        selectedCanvasSelector: node.selector,
        selectedElement: null,
        selectedLayerIdsState: selectedNodes.map(
          (selectedNode) => selectedNode.id,
        ),
        setOverviewSelectedScreenIds: vi.fn(),
        setSelectedElement: vi.fn(),
        setSelectedLayerIdsState: vi.fn(),
        t: (key) => key,
        undoManagerRef: { current: undoManager },
        viewModeRef: { current: "single" },
      });
      const duplicated = persisted;
      expect(effects(duplicated).instances).toHaveLength(instanceCount);
      expectClonedStack(before, duplicated, clonedNodeIdMap);
      expect(undoManager.undoStack).toHaveLength(1);
      undoManager.undo();
      expect(persisted).toBe(before);
      undoManager.redo();
      expect(persisted).toBe(duplicated);
      expect(effects(persisted).instances).toEqual(
        effects(duplicated).instances,
      );
      undoManager.destroy();
      doc.destroy();
    },
  );
});
