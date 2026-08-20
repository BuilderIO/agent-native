// @vitest-environment happy-dom

import {
  buildCodeLayerProjection,
  moveNodeBetweenDocuments,
  removeCodeLayerNodeFromHtml,
} from "@shared/code-layer";
import { describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";
import { resolveCodeLayerNodeFromBridge } from "@/pages/design-editor/code-layer-state";
import { runVisualDuplicateChange } from "@/pages/design-editor/commands/visual-duplicate-change";
import type { DesignFile } from "@/pages/design-editor/types";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const ORIGINAL_NODE_ID = "an-aside-original";
// editor-chrome.bridge.ts's resetRuntimeStableIds stamps the live alt-drag
// clone with these before the host ever sees it.
const CLONE_NODE_ID = "an-copy-dmhhtd51h4jy";

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
      setSelectedElement: () => {},
      setSelectedLayerIdsState: (value) => {
        selectedLayerIds.push(value as string[]);
      },
      t: (key) => key,
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
    const projection = buildCodeLayerProjection(content);
    const original = projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === ORIGINAL_NODE_ID,
    );

    expect(selectedLayerId).toBeDefined();
    expect(selectedLayerId).not.toBe(original!.id);
  });

  it("deletes only the clone when the selection is deleted", () => {
    const { content, selectedLayerId } = duplicateThroughBridgeMessage();
    const projection = buildCodeLayerProjection(content);
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
});
