// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { GlslShaderPanelContext } from "./inspector/GlslShaderPanel";
import type { ElementInfo } from "./types";

const captured = vi.hoisted(() => ({
  fill: [] as Array<GlslShaderPanelContext | undefined>,
  effect: [] as Array<GlslShaderPanelContext | undefined>,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("./edit-panel/fill-properties", () => ({
  FillProperties: (props: { glslShaderContext?: GlslShaderPanelContext }) => {
    captured.fill.push(props.glslShaderContext);
    return null;
  },
}));

vi.mock("./edit-panel/effects-properties", () => ({
  EffectsProperties: (props: {
    glslShaderContext?: GlslShaderPanelContext;
  }) => {
    captured.effect.push(props.glslShaderContext);
    return null;
  },
}));

import { EditPanel } from "./EditPanel";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  captured.fill.length = 0;
  captured.effect.length = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function renderSelectedLayer(ownerFileId: string, activeFileId: string) {
  const selectedElement: ElementInfo = {
    tagName: "DIV",
    sourceId: "frame-1",
    sourceLayerIdentity: { screenId: ownerFileId, nodeId: "layer-1" },
    classes: [],
    computedStyles: { backgroundColor: "rgb(1, 2, 3)" },
    boundingRect: { x: 0, y: 0, width: 100, height: 100 },
    isFlexChild: false,
    isFlexContainer: false,
  };
  act(() => {
    root.render(
      <EditPanel
        selectedElement={selectedElement}
        viewMode="overview"
        mode="edit"
        onStyleChange={vi.fn()}
        designId="design-1"
        fileId={activeFileId}
        boardFileId="board-file"
        activeContent='<div data-agent-native-node-id="active-node"></div>'
      />,
    );
  });
  return {
    fill: captured.fill[captured.fill.length - 1],
    effect: captured.effect[captured.effect.length - 1],
  };
}

it("targets the selected layer's owning screen for fill and effect shaders", () => {
  const { fill, effect } = renderSelectedLayer("board-file", "active-file");

  expect(fill).toMatchObject({
    designId: "design-1",
    fileId: "board-file",
    nodeId: "frame-1",
  });
  expect(effect).toMatchObject({
    designId: "design-1",
    fileId: "board-file",
    nodeId: "frame-1",
  });
  expect(fill?.content).toBeUndefined();
  expect(effect?.content).toBeUndefined();
});

it("keeps held source content only when it belongs to the selected layer's screen", () => {
  const { fill, effect } = renderSelectedLayer("active-file", "active-file");

  expect(fill?.fileId).toBe("active-file");
  expect(effect?.fileId).toBe("active-file");
  expect(fill?.content).toBe(
    '<div data-agent-native-node-id="active-node"></div>',
  );
  expect(effect?.content).toBe(fill?.content);
});

it("passes two authored targets in one file to the native fill and effect editors", () => {
  const selectedElements: ElementInfo[] = ["first", "second"].map(
    (sourceId) => ({
      tagName: "DIV",
      sourceId,
      sourceLayerIdentity: { screenId: "file-1", nodeId: sourceId },
      classes: [],
      computedStyles: { backgroundColor: "rgb(1, 2, 3)" },
      boundingRect: { x: 0, y: 0, width: 100, height: 100 },
      isFlexChild: false,
      isFlexContainer: false,
    }),
  );
  act(() => {
    root.render(
      <EditPanel
        selectedElement={selectedElements[0]}
        selectedElements={selectedElements}
        viewMode="overview"
        mode="edit"
        onStyleChange={vi.fn()}
        designId="design-1"
        fileId="file-1"
        activeContent="<html><body></body></html>"
      />,
    );
  });
  expect(captured.fill[captured.fill.length - 1]).toMatchObject({
    fileId: "file-1",
    nodeIds: ["first", "second"],
    nativeOnly: true,
  });
  expect(captured.effect[captured.effect.length - 1]).toMatchObject({
    fileId: "file-1",
    nodeIds: ["first", "second"],
    nativeOnly: true,
  });
});
