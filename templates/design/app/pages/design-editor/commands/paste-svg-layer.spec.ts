import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";
import type { SelectedLayerTarget } from "@/pages/design-editor/code-layer-state";

import {
  resolvePastedSvgInsertionOptions,
  runPastedSvgLayer,
} from "./paste-svg-layer";

const {
  insertClonedHtmlLayersMock,
  planLinkedComponentStructureCloneMock,
  queryFirstSelectorMock,
  parsePastedSvgMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  insertClonedHtmlLayersMock: vi.fn(),
  planLinkedComponentStructureCloneMock: vi.fn(),
  queryFirstSelectorMock: vi.fn(),
  parsePastedSvgMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: toastErrorMock } }));
vi.mock("@/pages/design-editor/commands/pasted-svg", () => ({
  parsePastedSvg: parsePastedSvgMock,
}));
vi.mock("@/pages/design-editor/clone-and-pen-edit", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/pages/design-editor/clone-and-pen-edit")
    >();
  return {
    ...actual,
    insertClonedHtmlLayers: insertClonedHtmlLayersMock,
    planLinkedComponentStructureClone: planLinkedComponentStructureCloneMock,
    queryFirstSelector: queryFirstSelectorMock,
  };
});

const FRAME_CONTENT = `<!doctype html><html><body>
  <section data-agent-native-node-id="paste-target" data-an-primitive="frame" style="position:absolute;left:80px;top:90px;width:260px;height:180px">
    <div data-agent-native-node-id="existing-child" style="position:absolute;left:8px;top:8px;width:24px;height:20px"></div>
  </section>
  <p data-agent-native-node-id="caption">Caption</p>
</body></html>`;

function elementInfoFor(nodeId: string, tagName = "div"): ElementInfo {
  return {
    tagName,
    sourceId: nodeId,
    selector: `[data-agent-native-node-id="${nodeId}"]`,
    classes: [],
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: 0, height: 0 },
  } as unknown as ElementInfo;
}

function selectedLayerTarget(
  fileId: string,
  nodeId: string,
): SelectedLayerTarget {
  return {
    fileId,
    elementInfo: elementInfoFor(nodeId, "section"),
    node: {
      selector: `[data-agent-native-node-id="${nodeId}"]`,
    },
  } as unknown as SelectedLayerTarget;
}

function stubDomParser() {
  class TestDOMParser {
    parseFromString() {
      const attributes = new Map<string, string>();
      return {
        documentElement: {
          setAttribute(name: string, value: string) {
            attributes.set(name, value);
          },
          getAttribute(name: string) {
            return attributes.get(name) ?? null;
          },
          get outerHTML() {
            return `<svg ${[...attributes]
              .map(([name, value]) => `${name}="${value}"`)
              .join(" ")}></svg>`;
          },
        },
      };
    }
  }
  vi.stubGlobal("DOMParser", TestDOMParser);
}

function pastedSvgArgs() {
  const applyLinkedComponentEdit = vi.fn();
  const selectionBefore = {
    overviewSelectedScreenIds: [],
    selectedLayerIds: [],
    activeFileId: "screen-1",
  };
  return {
    args: {
      activeFileId: "screen-1",
      applyLinkedComponentEdit,
      applyFileContentUpdate: vi.fn(),
      applyLocalContentUpdate: vi.fn(),
      boardFileId: "board",
      canEditDesign: true,
      canvasContainerRef: { current: null },
      canvasFrameGeometryById: {},
      designId: "design-1",
      files: [
        {
          id: "screen-1",
          filename: "screen-1.html",
          fileType: "html",
          content: FRAME_CONTENT,
          createdAt: "",
          updatedAt: "",
        },
      ],
      getFreshActiveContent: () => FRAME_CONTENT,
      getFreshActivePreviewContent: () => null,
      getScreenContent: () => FRAME_CONTENT,
      overviewScreens: [],
      overviewSelectedScreenIds: [],
      replacePreviewContent: vi.fn(),
      selectedElement: null,
      selectedLayerTargets: [selectedLayerTarget("screen-1", "paste-target")],
      selectionBefore,
      selectInsertedLayers: vi.fn(),
      t: (key: string) => key,
      viewModeRef: { current: "single" as const },
      zoom: 100,
    },
    applyLinkedComponentEdit,
    selectionBefore,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  parsePastedSvgMock.mockReturnValue({
    svg: '<svg width="10" height="12"></svg>',
    width: 10,
    height: 12,
  });
  queryFirstSelectorMock.mockReturnValue({} as Element);
  planLinkedComponentStructureCloneMock.mockReturnValue(null);
  insertClonedHtmlLayersMock.mockReturnValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolvePastedSvgInsertionOptions", () => {
  it("nests an SVG into the selected frame in the target screen", () => {
    const selector = '[data-agent-native-node-id="paste-target"]';
    const options = resolvePastedSvgInsertionOptions({
      activeFileId: "board",
      baseContent: FRAME_CONTENT,
      point: { x: 360, y: 280 },
      selectedElement: null,
      selectedLayerTargets: [selectedLayerTarget("screen-1", "paste-target")],
      targetFileId: "screen-1",
    });

    expect(options).toMatchObject({
      placement: "inside",
      stripRootPosition: true,
    });
    expect(options.targetSelectors).toContain(selector);
    expect(options.positions).toBeUndefined();
  });

  it("uses the paste point when the active selection is not a container", () => {
    const options = resolvePastedSvgInsertionOptions({
      activeFileId: "screen-1",
      baseContent: FRAME_CONTENT,
      point: { x: 320, y: 240 },
      selectedElement: elementInfoFor("caption", "p"),
      selectedLayerTargets: [],
      targetFileId: "screen-1",
    });

    expect(options).toEqual({
      positions: [{ x: 320, y: 240, space: "visual" }],
    });
  });

  it("uses the paste point instead of the scalar selection for multiple targets", () => {
    const options = resolvePastedSvgInsertionOptions({
      activeFileId: "screen-1",
      baseContent: FRAME_CONTENT,
      point: { x: 320, y: 240 },
      selectedElement: elementInfoFor("paste-target", "section"),
      selectedLayerTargets: [
        selectedLayerTarget("screen-1", "paste-target"),
        selectedLayerTarget("screen-1", "existing-child"),
      ],
      targetFileId: "screen-1",
    });

    expect(options).toEqual({
      positions: [{ x: 320, y: 240, space: "visual" }],
    });
  });

  it("uses the scalar selection when it is the only selection", () => {
    const options = resolvePastedSvgInsertionOptions({
      activeFileId: "screen-1",
      baseContent: FRAME_CONTENT,
      point: { x: 320, y: 240 },
      selectedElement: elementInfoFor("paste-target", "section"),
      selectedLayerTargets: [],
      targetFileId: "screen-1",
    });

    expect(options).toMatchObject({ placement: "inside" });
  });
});

describe("runPastedSvgLayer", () => {
  it("routes insertion into a canonical component through linked structure editing", () => {
    stubDomParser();
    const fixture = pastedSvgArgs();
    const plan = {
      mainBefore: "before",
      mainAfter: "after",
      targetNodeId: "component-main",
      selectionNodeIds: ["pasted-svg"],
      rootNodeIds: ["pasted-svg"],
      nodeIdMap: new Map(),
    };
    planLinkedComponentStructureCloneMock.mockReturnValue(plan);

    expect(
      runPastedSvgLayer(fixture.args, '<svg width="10" height="12"></svg>'),
    ).toBe(true);

    expect(planLinkedComponentStructureCloneMock).toHaveBeenCalledWith(
      FRAME_CONTENT,
      [expect.stringContaining('data-an-primitive="pasted-svg"')],
      expect.objectContaining({
        placement: "inside",
        componentLinks: expect.objectContaining({
          targetSource: expect.objectContaining({
            designId: "design-1",
            fileId: "screen-1",
          }),
        }),
      }),
    );
    expect(fixture.applyLinkedComponentEdit).toHaveBeenCalledWith(
      "screen-1",
      "component-main",
      {
        kind: "structure",
        before: "before",
        after: "after",
        selectionNodeIds: ["pasted-svg"],
      },
      fixture.selectionBefore,
    );
    expect(insertClonedHtmlLayersMock).not.toHaveBeenCalled();
  });

  it("reports unsupported component structure with a neutral insertion message", () => {
    stubDomParser();
    const fixture = pastedSvgArgs();
    insertClonedHtmlLayersMock.mockImplementation(
      (_content, _layers, options) => {
        options.onUnsupportedStructure?.();
        return null;
      },
    );

    expect(
      runPastedSvgLayer(fixture.args, '<svg width="10" height="12"></svg>'),
    ).toBe(true);

    expect(toastErrorMock).toHaveBeenCalledWith(
      "designEditor.componentInstances.linkedStructureUnsupported",
    );
    expect(fixture.args.replacePreviewContent).not.toHaveBeenCalled();
  });

  it("falls back to the paste point when a stale selection selector is missing", () => {
    stubDomParser();
    const fixture = pastedSvgArgs();
    queryFirstSelectorMock.mockReturnValue(null);
    insertClonedHtmlLayersMock.mockReturnValue({
      content: "updated",
      rootNodeIds: ["pasted-svg"],
      nodeIdMap: new Map(),
    });

    expect(
      runPastedSvgLayer(fixture.args, '<svg width="10" height="12"></svg>'),
    ).toBe(true);

    expect(planLinkedComponentStructureCloneMock).not.toHaveBeenCalled();
    expect(insertClonedHtmlLayersMock).toHaveBeenCalledWith(
      FRAME_CONTENT,
      [expect.stringContaining('data-an-primitive="pasted-svg"')],
      expect.objectContaining({
        positions: [{ x: 120, y: 120, space: "visual" }],
      }),
    );
  });
});
