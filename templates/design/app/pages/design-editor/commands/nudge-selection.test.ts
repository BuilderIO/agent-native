import { describe, expect, it } from "vitest";

import type { ElementInfo } from "@/components/design/types";

import {
  resolveNudgeTarget,
  runNudgeSelection,
  type NudgeSelectionArgs,
} from "./nudge-selection";

const element = (left: string): ElementInfo =>
  ({
    selector: "[data-agent-native-node-id=box]",
    computedStyles: { left },
  }) as unknown as ElementInfo;

describe("resolveNudgeTarget", () => {
  it("prefers the post-drag rendered measurement over stale selection", () => {
    const stale = element("30px");
    const rendered = element("230px");
    const target = {
      fileId: "screen-a",
      layerId: "box",
      elementInfo: stale,
      node: { id: "box" },
    } as any;

    expect(
      resolveNudgeTarget(
        stale,
        [target],
        new Map([["screen-a:box", rendered]]),
      ),
    ).toBe(rendered);
  });

  it("uses the focused layer when multiple layers are selected", () => {
    const focused = element("30px");
    focused.sourceLayerIdentity = { screenId: "screen-a", nodeId: "focused" };
    const first = {
      fileId: "screen-a",
      layerId: "first",
      elementInfo: element("10px"),
      node: { id: "first" },
    } as any;
    const second = {
      fileId: "screen-a",
      layerId: "focused",
      elementInfo: focused,
      node: { id: "different-node-id" },
    } as any;
    const rendered = element("230px");

    expect(
      resolveNudgeTarget(
        focused,
        [first, second],
        new Map([["screen-a:focused", rendered]]),
      ),
    ).toBe(rendered);
  });
});

describe("runNudgeSelection — rapid translate nudges", () => {
  const setup = () => {
    let content =
      '<div data-agent-native-node-id="box" style="position: absolute;left: 100px;top: 50px"></div>';
    const commits: Array<Record<string, string>> = [];
    const stale = {
      selector: "[data-agent-native-node-id=box]",
      sourceId: "box",
      tagName: "div",
      classes: [],
      computedStyles: { position: "absolute", left: "100px", top: "50px" },
    } as unknown as ElementInfo;
    const args = {
      activeFile: { id: "screen-a", content },
      applyLocalContentUpdate: () => {},
      boardFileId: undefined,
      boardFrameGeometry: undefined,
      canEditDesign: true,
      isRunningAppSource: false,
      commitVisualStyles: (
        _selector: string,
        styles: Record<string, string>,
      ) => {
        commits.push(styles);
        content = content.replace(
          /left: \d+px;top: \d+px/,
          `left: ${styles.left};top: ${styles.top}`,
        );
      },
      designDataJsonRef: { current: {} },
      editorPreferences: { nudge: { small: 1, big: 10 } },
      files: [],
      getFreshActiveContent: () => content,
      handleGeometryCommit: () => {},
      hideSelectionChromeForNudge: () => {},
      overviewScreens: [],
      overviewSelectedScreenIds: [],
      selectedElement: stale,
      selectedLayerIdsState: [],
      selectedLayerTargetsRef: { current: [] },
      renderedElementInfoByLayerKeyRef: { current: new Map() },
      setSelectedElement: () => {},
      setSelectedLayerIdsState: () => {},
      viewModeRef: { current: "single" },
    } as unknown as NudgeSelectionArgs;
    return {
      args,
      commits,
      setContent: (next: string) => {
        content = next;
      },
    };
  };

  it("adds every tap while the rendered position still shows the first one", () => {
    const { args, commits } = setup();
    runNudgeSelection(args, "right", true);
    runNudgeSelection(args, "right", true);
    runNudgeSelection(args, "right", true);
    expect(commits.map((styles) => styles.left)).toEqual([
      "110px",
      "120px",
      "130px",
    ]);
    expect(commits.every((styles) => styles.top === "50px")).toBe(true);
  });

  it("starts from the rendered position again after another edit changes the source", () => {
    const { args, commits, setContent } = setup();
    runNudgeSelection(args, "right", true);
    runNudgeSelection(args, "right", true);
    setContent(
      '<div data-agent-native-node-id="box" style="position: absolute;left: 100px;top: 50px"></div>',
    );
    runNudgeSelection(args, "right", true);
    expect(commits.map((styles) => styles.left)).toEqual([
      "110px",
      "120px",
      "110px",
    ]);
  });
});

describe("runNudgeSelection — shapes inside an SVG", () => {
  function svgNudge(
    initial: string,
    svgShapeOffset: { x: number; y: number } | null,
  ) {
    let content = initial;
    const commits: Array<Record<string, string>> = [];
    const refusals: string[] = [];
    const rendered = {
      selector: "[data-agent-native-node-id=dot]",
      sourceId: "dot",
      tagName: "rect",
      classes: [],
      computedStyles: {},
      positionContainingBlockTransform: { a: 2, b: 0, c: 0, d: 2 },
      svgShapeOffset,
    } as unknown as ElementInfo;
    const args = {
      activeFile: { id: "screen-a", content },
      applyLocalContentUpdate: () => {},
      boardFileId: undefined,
      boardFrameGeometry: undefined,
      canEditDesign: true,
      isRunningAppSource: false,
      commitVisualStyles: (
        _selector: string,
        styles: Record<string, string>,
      ) => {
        commits.push(styles);
        content = content.replace(
          /<rect data-agent-native-node-id="dot"( style="[^"]*")?/,
          `<rect data-agent-native-node-id="dot" style="translate: ${styles.translate}"`,
        );
      },
      designDataJsonRef: { current: {} },
      editorPreferences: { nudge: { small: 1, big: 10 } },
      files: [],
      getFreshActiveContent: () => content,
      handleGeometryCommit: () => {},
      hideSelectionChromeForNudge: () => {},
      refuseMove: (refusal: string) => refusals.push(refusal),
      overviewScreens: [],
      overviewSelectedScreenIds: [],
      selectedElement: rendered,
      selectedLayerIdsState: [],
      selectedLayerTargetsRef: { current: [] },
      renderedElementInfoByLayerKeyRef: { current: new Map() },
      setSelectedElement: () => {},
      setSelectedLayerIdsState: () => {},
      viewModeRef: { current: "single" },
    } as unknown as NudgeSelectionArgs;
    return { args, commits, refusals };
  }

  it("moves by translate in the SVG's units, continuing from the source", () => {
    const { args, commits, refusals } = svgNudge(
      '<svg data-an-primitive="pasted-svg" viewBox="0 0 100 50" width="200" height="100"><rect data-agent-native-node-id="dot" width="10" height="10"/></svg>',
      { x: 0, y: 0 },
    );

    runNudgeSelection(args, "right", true);
    runNudgeSelection(args, "left", false);
    runNudgeSelection(args, "down", false);

    expect(commits).toEqual([
      { translate: "5px 0px" },
      { translate: "4.5px 0px" },
      { translate: "4.5px 0.5px" },
    ]);
    expect(commits.some((styles) => "left" in styles)).toBe(false);
    expect(refusals).toEqual([]);
  });

  it("says why it can't move a shape offset by a percentage", () => {
    const { args, commits, refusals } = svgNudge(
      '<svg data-an-primitive="pasted-svg" viewBox="0 0 100 50" width="200" height="100"><rect data-agent-native-node-id="dot" width="10" height="10" style="translate: 10% 0px"/></svg>',
      null,
    );

    runNudgeSelection(args, "right", false);

    expect(commits).toEqual([]);
    expect(refusals).toEqual(["unsupported-position"]);
  });
});
