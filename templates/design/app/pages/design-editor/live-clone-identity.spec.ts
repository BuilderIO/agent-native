// @vitest-environment happy-dom

import {
  buildCodeLayerProjection,
  moveNodeBetweenDocuments,
  removeCodeLayerNodeFromHtml,
  type CodeLayerSource,
} from "@shared/code-layer";
import { analyzeComponentLinks } from "@shared/component-links";
import {
  COMPONENT_ID_ATTR,
  COMPONENT_REF_ATTR,
  COMPONENT_SOURCE_NODE_ID_ATTR,
} from "@shared/component-model";
import { describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";
import type { ComponentCloneBatchContext } from "@/pages/design-editor/clone-and-pen-edit";
import { resolveCodeLayerNodeFromBridge } from "@/pages/design-editor/code-layer-state";
import { runScreenVisualDuplicateChange } from "@/pages/design-editor/commands/screen-visual-duplicate-change";
import { runVisualDuplicateChange } from "@/pages/design-editor/commands/visual-duplicate-change";
import type { DesignFile } from "@/pages/design-editor/types";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const ORIGINAL_NODE_ID = "an-aside-original";
const CLONE_NODE_ID = "an-copy-dmhhtd51h4jy";
const MAIN_NODE_ID = "main-button";
const MAIN_LABEL_ID = "main-label";
const CLONE_LABEL_ID = "an-copy-child-label";
const COMPONENT_ID = "cmp-play";

const ASIDE_MARKUP = (nodeId: string) =>
  `<aside id="filters" class="panel rounded" data-agent-native-node-id="${nodeId}">Filters</aside>`;

const SCREEN_HTML = `<!DOCTYPE html>
<html><head></head><body>
<main data-agent-native-node-id="an-grid" style="display:grid;grid-template-columns:1fr 1fr">
${ASIDE_MARKUP(ORIGINAL_NODE_ID)}
</main>
</body></html>`;

const OTHER_SCREEN_HTML = `<!DOCTYPE html>
<html><head></head><body>
<main data-agent-native-node-id="an-other-grid"></main>
</body></html>`;

const COMPONENT_MAIN = `<button id="main-button" data-agent-native-node-id="${MAIN_NODE_ID}" data-agent-native-component-id="${COMPONENT_ID}"><span data-agent-native-node-id="${MAIN_LABEL_ID}">Play</span></button>`;
const COMPONENT_CLONE = `<button id="copy-button" data-agent-native-node-id="${CLONE_NODE_ID}" data-agent-native-component-id="${COMPONENT_ID}"><span data-agent-native-node-id="${CLONE_LABEL_ID}">Play</span></button>`;

function source(fileId: string, filename: string): CodeLayerSource {
  return {
    kind: "design-file",
    designId: "design-1",
    fileId,
    filename,
  };
}

function componentContext(
  targetFileId: string,
  documents: Array<{ source: CodeLayerSource; content: string }>,
): ComponentCloneBatchContext {
  const targetSource = documents.find(
    (document) => document.source.fileId === targetFileId,
  )?.source;
  if (!targetSource) throw new Error(`Missing target Screen ${targetFileId}`);
  return {
    sourceFileIds: [targetFileId],
    targetSource,
    documents,
  };
}

function linkedElementInfo(): ElementInfo {
  return {
    tagName: "BUTTON",
    id: "copy-button",
    sourceId: CLONE_NODE_ID,
    selector: `[data-agent-native-node-id="${CLONE_NODE_ID}"]`,
    classes: [],
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: 120, height: 40 },
    textContent: "Play",
    isFlexChild: false,
    isFlexContainer: false,
  };
}

function expectLinkedClone(content: string, fileId: string) {
  const projection = buildCodeLayerProjection(content, {
    source: source(fileId, `${fileId}.html`),
  });
  const result = analyzeComponentLinks([projection]);
  const component = result.components.find(
    (entry) => entry.componentId === COMPONENT_ID,
  );
  expect(component?.status).toBe("resolved");
  if (component?.status !== "resolved") return;
  expect(
    component.references.some(
      (reference) =>
        reference.dataAttributes["data-agent-native-node-id"] === CLONE_NODE_ID,
    ),
  ).toBe(true);
  const cloneLabel = projection.nodes.find(
    (node) =>
      node.dataAttributes["data-agent-native-node-id"] === CLONE_LABEL_ID,
  );
  expect(cloneLabel?.dataAttributes[COMPONENT_SOURCE_NODE_ID_ATTR]).toBe(
    MAIN_LABEL_ID,
  );
}

function cloneElementInfo(): ElementInfo {
  return {
    tagName: "ASIDE",
    id: "filters",
    sourceId: CLONE_NODE_ID,
    selector: `[data-agent-native-node-id="${CLONE_NODE_ID}"]`,
    classes: ["panel", "rounded"],
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: 240, height: 400 },
    textContent: "Filters",
    isFlexChild: false,
    isFlexContainer: false,
  };
}

function duplicateThroughBridgeMessage() {
  let nextContent = SCREEN_HTML;
  const selectedLayerIds: string[][] = [];
  const activeFile = {
    id: "screen-a",
    filename: "screen-a.html",
    fileType: "html",
    content: SCREEN_HTML,
  } as unknown as DesignFile;

  const applied = runVisualDuplicateChange(
    {
      activeFile,
      applyLocalContentUpdate: (content) => {
        nextContent = content;
      },
      canEditDesign: true,
      getFreshActiveContent: () => nextContent,
      selectedElement: null,
      selectedLayerIdsState: [],
      setSelectedElement: () => {},
      setSelectedLayerIdsState: (value) => {
        selectedLayerIds.push(value as string[]);
      },
      t: (key) => key,
      undoManagerRef: { current: null },
    },
    `[data-agent-native-node-id="${ORIGINAL_NODE_ID}"]`,
    ASIDE_MARKUP(CLONE_NODE_ID),
    cloneElementInfo(),
    {
      sourceId: ORIGINAL_NODE_ID,
      anchorSelector: `[data-agent-native-node-id="${ORIGINAL_NODE_ID}"]`,
      anchorSourceId: ORIGINAL_NODE_ID,
      placement: "after",
    },
  );

  expect(applied).toBe(true);
  return {
    content: nextContent,
    selectedLayerId: selectedLayerIds[selectedLayerIds.length - 1]?.[0],
  };
}

describe("alt-drag clone identity", () => {
  it("writes the clone into source under the id the live element already carries", () => {
    const { content } = duplicateThroughBridgeMessage();
    const projection = buildCodeLayerProjection(content);

    const resolved = resolveCodeLayerNodeFromBridge(
      projection,
      `[data-agent-native-node-id="${CLONE_NODE_ID}"]`,
      CLONE_NODE_ID,
    );

    expect(resolved?.dataAttributes["data-agent-native-node-id"]).toBe(
      CLONE_NODE_ID,
    );
  });

  it("selects the clone rather than the node it was copied from", () => {
    const { content, selectedLayerId } = duplicateThroughBridgeMessage();
    const projection = buildCodeLayerProjection(content, {
      source: { kind: "design-file", fileId: "screen-a" },
    });
    const original = projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === ORIGINAL_NODE_ID,
    );

    expect(selectedLayerId).toBeDefined();
    expect(selectedLayerId).not.toBe(original!.id);
    expect(
      projection.nodes.find((node) => node.id === selectedLayerId)
        ?.dataAttributes["data-agent-native-node-id"],
    ).toBe(CLONE_NODE_ID);
  });

  it("deletes only the clone when the selection is deleted", () => {
    const { content, selectedLayerId } = duplicateThroughBridgeMessage();
    const projection = buildCodeLayerProjection(content, {
      source: { kind: "design-file", fileId: "screen-a" },
    });
    const selectedNode = projection.nodes.find(
      (node) => node.id === selectedLayerId,
    );

    const afterDelete = removeCodeLayerNodeFromHtml(content, selectedNode!);

    expect(afterDelete).toContain(ORIGINAL_NODE_ID);
    expect(afterDelete!.match(/<aside/g)).toHaveLength(1);
  });

  it("moves the clone to another screen instead of reporting it missing from source", () => {
    const { content } = duplicateThroughBridgeMessage();

    const result = moveNodeBetweenDocuments(content, OTHER_SCREEN_HTML, {
      nodeId: CLONE_NODE_ID,
    });

    expect(result.message).toBeUndefined();
    expect(result.status).toBe("applied");
  });

  it("materializes a linked main clone through the active-Screen visual route", () => {
    let nextContent = `<!DOCTYPE html><html><body><main>${COMPONENT_MAIN}<aside data-agent-native-node-id="anchor">Anchor</aside></main></body></html>`;
    const activeFile = {
      id: "screen-a",
      filename: "screen-a.html",
      fileType: "html",
      content: nextContent,
    } as unknown as DesignFile;
    const docs = [
      {
        source: source("screen-a", "screen-a.html"),
        content: nextContent,
      },
      {
        source: source("screen-b", "screen-b.html"),
        content: OTHER_SCREEN_HTML,
      },
    ];
    const selectedLayerIds: string[][] = [];
    const applied = runVisualDuplicateChange(
      {
        activeFile,
        componentLinks: componentContext("screen-a", docs),
        applyLocalContentUpdate: (content) => {
          nextContent = content;
        },
        canEditDesign: true,
        getFreshActiveContent: () => nextContent,
        selectedElement: null,
        selectedLayerIdsState: [],
        setSelectedElement: () => {},
        setSelectedLayerIdsState: (value) => {
          selectedLayerIds.push(value as string[]);
        },
        t: (key) => key,
        undoManagerRef: { current: null },
      },
      `[data-agent-native-node-id="${MAIN_NODE_ID}"]`,
      COMPONENT_CLONE,
      linkedElementInfo(),
      {
        sourceId: MAIN_NODE_ID,
        sourceNodeIdMap: [
          [MAIN_NODE_ID, CLONE_NODE_ID],
          [MAIN_LABEL_ID, CLONE_LABEL_ID],
        ],
        anchorSelector: '[data-agent-native-node-id="anchor"]',
        anchorSourceId: "anchor",
        placement: "after",
      },
    );

    expect(applied).toBe(true);
    expect(selectedLayerIds).toHaveLength(1);
    expectLinkedClone(nextContent, "screen-a");
  });

  it("uses the same Design identity context when the duplicate originates on another Screen", () => {
    let screenB = `<!DOCTYPE html><html><body><main>${COMPONENT_MAIN}<aside data-agent-native-node-id="anchor-b">Anchor</aside></main></body></html>`;
    const screenA = `<!DOCTYPE html><html><body><main data-agent-native-node-id="other-main"></main></body></html>`;
    const files = new Map([
      ["screen-a", screenA],
      ["screen-b", screenB],
    ]);
    const docs = [
      { source: source("screen-a", "screen-a.html"), content: screenA },
      { source: source("screen-b", "screen-b.html"), content: screenB },
    ];
    const activeFile = {
      id: "screen-a",
      filename: "screen-a.html",
      fileType: "html",
      content: screenA,
    } as unknown as DesignFile;

    const applied = runScreenVisualDuplicateChange(
      {
        activeFile,
        componentLinksForFile: (fileId) => componentContext(fileId, docs),
        applyFileContentUpdate: (fileId, content) => {
          files.set(fileId, content);
          if (fileId === "screen-b") screenB = content;
        },
        canEditDesign: true,
        designSourceType: "inline",
        getScreenContent: (fileId) => files.get(fileId) ?? "",
        handleVisualDuplicateChange: () => {
          throw new Error("The inactive-Screen branch must own this duplicate");
        },
        overviewScreens: [],
        recordPendingLiveStructureEdit: vi.fn(),
        t: (key) => key,
      },
      "screen-b",
      `[data-agent-native-node-id="${MAIN_NODE_ID}"]`,
      COMPONENT_CLONE,
      linkedElementInfo(),
      {
        sourceId: MAIN_NODE_ID,
        sourceNodeIdMap: [
          [MAIN_NODE_ID, CLONE_NODE_ID],
          [MAIN_LABEL_ID, CLONE_LABEL_ID],
        ],
        anchorSelector: '[data-agent-native-node-id="anchor-b"]',
        anchorSourceId: "anchor-b",
        placement: "after",
      },
    );

    expect(applied).toBe(true);
    expectLinkedClone(screenB, "screen-b");
  });

  it.each([
    ["missing", undefined],
    [
      "ambiguous",
      [
        [MAIN_NODE_ID, CLONE_NODE_ID],
        ["another-source", CLONE_NODE_ID],
      ],
    ],
  ])(
    "refuses %s source-to-clone identity without writing",
    (_label, sourceNodeIdMap) => {
      const baseContent = `<!DOCTYPE html><html><body><main>${COMPONENT_MAIN}<aside data-agent-native-node-id="anchor">Anchor</aside></main></body></html>`;
      const activeFile = {
        id: "screen-a",
        filename: "screen-a.html",
        fileType: "html",
        content: baseContent,
      } as unknown as DesignFile;
      const applyLocalContentUpdate = vi.fn();
      const applied = runVisualDuplicateChange(
        {
          activeFile,
          componentLinks: componentContext("screen-a", [
            {
              source: source("screen-a", "screen-a.html"),
              content: baseContent,
            },
          ]),
          applyLocalContentUpdate,
          canEditDesign: true,
          getFreshActiveContent: () => baseContent,
          selectedElement: null,
          selectedLayerIdsState: [],
          setSelectedElement: () => {},
          setSelectedLayerIdsState: () => {},
          t: (key) => key,
          undoManagerRef: { current: null },
        },
        `[data-agent-native-node-id="${MAIN_NODE_ID}"]`,
        COMPONENT_CLONE,
        linkedElementInfo(),
        {
          sourceId: MAIN_NODE_ID,
          sourceNodeIdMap: sourceNodeIdMap as
            | readonly (readonly [string, string])[]
            | undefined,
          anchorSelector: '[data-agent-native-node-id="anchor"]',
          anchorSourceId: "anchor",
          placement: "after",
        },
      );

      expect(applied).toBe(false);
      expect(applyLocalContentUpdate).not.toHaveBeenCalled();
    },
  );
});
