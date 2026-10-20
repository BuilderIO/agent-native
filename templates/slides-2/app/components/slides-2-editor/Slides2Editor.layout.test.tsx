// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  FramePointer,
  SlideFrameController,
} from "../slides-2-runtime/SandboxedSlide";
import type { ElementSnapshot } from "./types";

const frameControllerSend = vi.hoisted(() => vi.fn());
const assetBrowserMocks = vi.hoisted(() => ({ onInsert: null as unknown }));
const sandboxNodeMocks = vi.hoisted(() => ({
  line: 1,
  column: 0,
  tagName: "div",
  nodes: null as unknown[] | null,
}));
const sandboxPreviewMocks = vi.hoisted(() => ({
  initialRevealedSteps: null as number | null,
  onNavigationInput: null as ((input: unknown) => void) | null,
}));
const sandboxPointerMocks = vi.hoisted(() => ({
  onPointer: null as ((pointer: FramePointer) => void) | null,
}));
const editorMocks = vi.hoisted(() => ({ showArrange: false }));
const canvasMocks = vi.hoisted(() => ({ scale: 1 }));
const editorCommandMocks = vi.hoisted(() => ({
  appState: new Map<string, unknown>(),
  commandVersion: 0,
  failNextCompareAndSet: false,
  useDbSync: vi.fn(),
}));

afterEach(cleanup);
beforeEach(() => {
  frameControllerSend.mockClear();
  editorCommandMocks.appState.clear();
  editorCommandMocks.commandVersion = 0;
  editorCommandMocks.failNextCompareAndSet = false;
  editorCommandMocks.useDbSync.mockClear();
  assetBrowserMocks.onInsert = null;
  sandboxNodeMocks.line = 1;
  sandboxNodeMocks.column = 0;
  sandboxNodeMocks.tagName = "div";
  sandboxNodeMocks.nodes = null;
  sandboxPreviewMocks.initialRevealedSteps = null;
  sandboxPreviewMocks.onNavigationInput = null;
  sandboxPointerMocks.onPointer = null;
  editorMocks.showArrange = false;
  canvasMocks.scale = 1;
});

vi.mock("@agent-native/core/client/application-state", () => ({
  readClientAppState: async (key: string) =>
    editorCommandMocks.appState.get(key) ?? null,
  writeClientAppState: async (key: string, value: unknown) => {
    editorCommandMocks.appState.set(key, value);
    return value;
  },
  compareAndSetClientAppState: async (
    key: string,
    expected: unknown,
    next: unknown,
  ) => {
    if (editorCommandMocks.failNextCompareAndSet) {
      editorCommandMocks.failNextCompareAndSet = false;
      throw new Error("temporary app-state write failure");
    }
    if (
      JSON.stringify(editorCommandMocks.appState.get(key) ?? null) !==
      JSON.stringify(expected)
    ) {
      return false;
    }
    editorCommandMocks.appState.set(key, next);
    return true;
  },
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  getBrowserTabId: () => "slides-2-editor-layout-test",
  useActionQuery: () => ({ data: undefined, isError: false, isLoading: false }),
  useChangeVersion: () => editorCommandMocks.commandVersion,
  useDbSync: editorCommandMocks.useDbSync,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, unknown>) => {
    const template =
      key === "styleInspector.resizeHandle" ? "Resize {{handle}}" : key;
    return Object.entries(values ?? {}).reduce(
      (label, [name, value]) => label.replaceAll(`{{${name}}}`, String(value)),
      template,
    );
  },
}));

vi.mock("@/components/slides-2-editor/Slides2AssetBrowser", () => ({
  Slides2AssetBrowser: ({
    onInsert,
  }: {
    onInsert: (...args: [string, string, string]) => Promise<string | null>;
  }) => {
    assetBrowserMocks.onInsert = onInsert;
    return null;
  },
}));
vi.mock("@/components/slides-2-editor/Slides2CommandMenu", () => ({
  Slides2CommandMenu: ({ backHref }: { backHref?: string }) => (
    <div data-testid="command-menu-back-href" data-href={backHref} />
  ),
}));
vi.mock("@/components/slides-2-editor/Slides2Comments", () => ({
  Slides2Comments: () => null,
}));
vi.mock("@/components/slides-2-editor/Slides2DesignTokens", () => ({
  Slides2DesignTokens: () => null,
}));
vi.mock("@/components/slides-2-editor/Slides2ExportMenu", () => ({
  Slides2ExportMenu: () => null,
}));
vi.mock("@/components/slides-2-editor/Slides2ImageCropControls", () => ({
  Slides2ImageCropControls: () => null,
}));
vi.mock("@/components/slides-2-editor/Slides2Inspector", () => ({
  Slides2Inspector: ({
    selected,
    selectionCount,
    onArrange,
  }: {
    selected: ElementSnapshot | null;
    selectionCount: number;
    onArrange: (direction: "front" | "forward" | "backward" | "back") => void;
  }) => (
    <>
      <output data-testid="mock-selection-count">{selectionCount}</output>
      {editorMocks.showArrange && selected ? (
        <button
          type="button"
          data-testid="mock-bring-to-front"
          onClick={() => onArrange("front")}
        >
          Bring to front
        </button>
      ) : null}
    </>
  ),
}));
vi.mock("../slides-2-runtime/Slides2Canvas", async () => {
  const { useEffect } = await import("react");
  return {
    Slides2Canvas: ({
      children,
      onScaleChange,
    }: {
      children: ReactNode;
      onScaleChange?: (scale: number) => void;
    }) => {
      useEffect(() => {
        onScaleChange?.(canvasMocks.scale);
      }, [onScaleChange]);
      return <div data-testid="mock-slides-2-canvas">{children}</div>;
    },
  };
});
vi.mock("../slides-2-runtime/SandboxedSlide", async () => {
  const { useEffect } = await import("react");
  return {
    SandboxedSlide: ({
      onNodes,
      onPointer,
      onController,
      onNavigationInput,
      onStepCount,
      initialRevealedSteps,
    }: {
      onNodes: (nodes: ElementSnapshot[]) => void;
      onPointer: (pointer: FramePointer) => void;
      onController: (controller: SlideFrameController | null) => void;
      onNavigationInput?: (input: unknown) => void;
      onStepCount?: (stepCount: number) => void;
      initialRevealedSteps?: number | null;
    }) => {
      sandboxPreviewMocks.initialRevealedSteps = initialRevealedSteps ?? null;
      sandboxPreviewMocks.onNavigationInput = onNavigationInput ?? null;
      sandboxPointerMocks.onPointer = onPointer;
      const node: ElementSnapshot = {
        nodeId: "node-1",
        line: sandboxNodeMocks.line,
        column: sandboxNodeMocks.column,
        tagName: sandboxNodeMocks.tagName,
        bounds: { x: 10, y: 10, width: 100, height: 50 },
        text: "Object",
        styles: {},
        transform: {
          basis: { a: 1, b: 0, c: 0, d: 1 },
          translate: { x: 0, y: 0 },
          width: 100,
          height: 50,
          rotation: 0,
        },
      };
      const nodes = (
        (sandboxNodeMocks.nodes as ElementSnapshot[] | null) ?? [node]
      ).map((targetNode) => ({
        ...targetNode,
        ancestorLocators: targetNode.ancestorLocators ?? [],
        ancestorLocatorsComplete: targetNode.ancestorLocatorsComplete ?? true,
      }));
      useEffect(() => {
        onNodes(nodes);
        onController({ send: frameControllerSend });
        onStepCount?.(2);
      }, [onController, onNodes, onStepCount]);
      return (
        <>
          {nodes.map((targetNode, index) => (
            <button
              key={targetNode.nodeId}
              type="button"
              data-testid={
                index === 0
                  ? "mock-slide-object"
                  : `mock-slide-object-${targetNode.nodeId}`
              }
              onClick={() =>
                onPointer({
                  phase: "down",
                  pointerType: "mouse",
                  x: 20,
                  y: 20,
                  button: 0,
                  pointerId: 1,
                  shiftKey: false,
                  altKey: false,
                  ctrlKey: false,
                  metaKey: false,
                  target: {
                    line: targetNode.line,
                    column: targetNode.column,
                    nodeId: targetNode.nodeId,
                    snapshot: targetNode,
                  },
                })
              }
            >
              Mock slide object
            </button>
          ))}
          <button
            type="button"
            data-testid="mock-preview-click"
            onClick={() =>
              onNavigationInput?.({
                type: "click",
                x: 0.75,
                y: 0.5,
                button: 0,
                defaultPrevented: false,
                interactive: false,
                hasSelection: false,
              })
            }
          >
            Mock preview click
          </button>
          <button
            type="button"
            data-testid="mock-slide-pointer-move"
            onClick={() =>
              onPointer({
                phase: "move",
                pointerType: "mouse",
                x: 40,
                y: 40,
                button: 0,
                pointerId: 1,
                shiftKey: false,
                altKey: false,
                ctrlKey: false,
                metaKey: false,
                target: null,
              })
            }
          >
            Move mock slide object
          </button>
          <button
            type="button"
            data-testid="mock-slide-pointer-up"
            onClick={() =>
              onPointer({
                phase: "up",
                pointerType: "mouse",
                x: 40,
                y: 40,
                button: 0,
                pointerId: 1,
                shiftKey: false,
                altKey: false,
                ctrlKey: false,
                metaKey: false,
                target: null,
              })
            }
          >
            Finish mock slide object move
          </button>
          <button
            type="button"
            data-testid="mock-slide-pointer-cancel"
            onClick={() =>
              onPointer({
                phase: "cancel",
                pointerType: "mouse",
                x: 40,
                y: 40,
                button: 0,
                pointerId: 1,
                shiftKey: false,
                altKey: false,
                ctrlKey: false,
                metaKey: false,
                target: null,
              })
            }
          >
            Cancel mock slide object move
          </button>
        </>
      );
    },
  };
});

import { Slides2Editor } from "./Slides2Editor";

const createEditorProps = () => ({
  deckId: "deck-1",
  title: "Deck",
  slides: [{ id: "slide-1", slideNumber: 1 }],
  activeIndex: 0,
  source: {
    id: "slide-1",
    deckId: "deck-1",
    position: 0,
    sourceTsx: "export default function Slide() { return <div />; }",
    revision: 1,
    sourceHash: "a".repeat(64),
  },
  notes: "",
  artifact: {
    protocolVersion: 1,
    deckId: "deck-1",
    slideId: "slide-1",
    revision: 1,
    sourceHash: "a".repeat(64),
    width: 1920,
    height: 1080,
    html: "<div>Object</div>",
  },
  designTokens: null,
  savingDesignTokens: false,
  savingNotes: false,
  loading: false,
  saving: false,
  sourceConflict: false,
  structuralSaving: false,
  canEdit: true,
  canComment: true,
  backHref: "/home",
  presentHref: "/deck/deck-1/present",
  onSelectSlide: () => {},
  onPresent: () => {},
  onSave: async () => ({
    sourceTsx: "",
    revision: 1,
    sourceHash: "a".repeat(64),
  }),
  onReloadSource: async () => ({
    id: "slide-1",
    deckId: "deck-1",
    position: 0,
    sourceTsx: "",
    revision: 1,
    sourceHash: "a".repeat(64),
  }),
  onRestore: async () => ({
    sourceTsx: "",
    revision: 1,
    sourceHash: "a".repeat(64),
  }),
  onSaveDesignTokens: async () => {},
  onSaveNotes: async () => {},
  onSelectionChange: () => {},
  onAddSlide: () => {},
  onDuplicateSlide: () => {},
  onDeleteSlide: () => {},
  onMoveSlide: () => {},
});

function sourceLocation(sourceTsx: string, openingTag: string) {
  const offset = sourceTsx.indexOf(openingTag);
  const before = sourceTsx.slice(0, offset);
  return {
    line: before.split("\n").length,
    column: offset - before.lastIndexOf("\n") - 1,
  };
}

function sourceLocator(sourceTsx: string, openingTag: string) {
  const location = sourceLocation(sourceTsx, openingTag);
  return `${location.line}:${location.column}`;
}

function sourceSnapshot(
  sourceTsx: string,
  nodeId: string,
  openingTag: string,
  bounds: ElementSnapshot["bounds"],
  ancestorLocators: string[] = [],
  ancestorLocatorsComplete = true,
): ElementSnapshot {
  return {
    nodeId,
    ...sourceLocation(sourceTsx, openingTag),
    tagName: openingTag.slice(1).split(/[\s/>]/, 1)[0] ?? "div",
    bounds,
    text: nodeId,
    styles: {},
    ancestorLocators,
    ancestorLocatorsComplete,
  };
}

function pointerClick(
  node: ElementSnapshot,
  modifiers: Partial<
    Pick<FramePointer, "ctrlKey" | "metaKey" | "shiftKey">
  > = {},
) {
  const pointer: FramePointer = {
    phase: "down",
    pointerType: "mouse",
    x: node.bounds.x + 1,
    y: node.bounds.y + 1,
    button: 0,
    pointerId: 1,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...modifiers,
    target: {
      line: node.line,
      column: node.column,
      nodeId: node.nodeId,
      snapshot: node,
    },
  };
  act(() => {
    sandboxPointerMocks.onPointer?.(pointer);
    sandboxPointerMocks.onPointer?.({ ...pointer, phase: "up" });
  });
}

function framePointer(
  phase: FramePointer["phase"],
  x: number,
  y: number,
  overrides: Partial<FramePointer> = {},
): FramePointer {
  return {
    phase,
    pointerType: "mouse",
    x,
    y,
    button: 0,
    pointerId: 1,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    target: null,
    ...overrides,
  };
}

function expectLastInspect(
  targets: Array<{ line: number; column: number; nodeId: string }>,
) {
  const inspections = frameControllerSend.mock.calls
    .map(([command]) => command as { type?: string; targets?: typeof targets })
    .filter((command) => command.type === "inspect");
  expect(inspections.at(-1)).toEqual({ type: "inspect", targets });
}

describe("Slides2Editor shell layout", () => {
  it("uses the dark surface frame for its toolbar and inset slide rail", () => {
    const { container } = render(
      <MemoryRouter>
        <Slides2Editor {...createEditorProps()} />
      </MemoryRouter>,
    );

    const header = container.querySelector("header");
    const slideList = container.querySelector("#slides-2-slide-list");
    const slideRail = slideList?.closest("aside");
    const canvasWorkspace = container.querySelector("main");
    const [leftControls, title, rightControls] = Array.from(
      header?.children ?? [],
    );

    expect(header?.children).toHaveLength(3);
    expect(header?.className).toContain(
      "grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]",
    );
    expect(title?.textContent).toBe("Deck");
    expect(title?.className).toContain("justify-self-center");
    expect(
      leftControls?.querySelector('[aria-label="editorToolbar.backToDecks"]'),
    ).toBeTruthy();
    expect(
      leftControls?.querySelector('[aria-label="editorToolbar.undo"]'),
    ).toBeTruthy();
    expect(
      rightControls?.querySelector('a[href="/deck/deck-1/present"]'),
    ).toBeTruthy();
    expect(
      rightControls?.querySelector('[aria-label="slides2Editor.preview"]'),
    ).toBeTruthy();
    expect(header?.className).toContain("bg-[hsl(var(--surface))]");
    expect(header?.className).toContain("border-[hsl(var(--sidebar-border))]");
    expect(slideRail?.className).toContain("bg-[hsl(var(--surface))]");
    expect(slideList?.className).toContain("px-3");
    expect(slideList?.className).toContain("py-2");
    expect(slideList?.className).toContain(
      "border-[hsl(var(--sidebar-border))]",
    );
    expect(canvasWorkspace?.className).toContain("bg-[hsl(var(--surface))]");
    expect(
      screen.getByRole("button", { name: "editorSidebar.addEmptySlide" }),
    ).toBeTruthy();
  });

  it("selects independent transform targets with Command or Control+A", async () => {
    const sourceTsx = [
      "function Slide() {",
      "  return (",
      '    <div style={{ position: "relative", width: "1920px", height: "1080px" }}>',
      '      <section id="group">',
      '        <h1 id="title">Title</h1>',
      '        <p id="subtitle">Subtitle</p>',
      "      </section>",
      '      <img id="logo" src="logo.png" />',
      '      <aside id="uncertain">Hidden</aside>',
      "    </div>",
      "  );",
      "}",
    ].join("\n");
    const wrapperTag =
      '<div style={{ position: "relative", width: "1920px", height: "1080px" }}>';
    const wrapperLocator = sourceLocator(sourceTsx, wrapperTag);
    const groupLocator = sourceLocator(sourceTsx, '<section id="group">');
    const nodes = [
      sourceSnapshot(sourceTsx, "wrapper", wrapperTag, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      }),
      sourceSnapshot(
        sourceTsx,
        "group",
        '<section id="group">',
        {
          x: 100,
          y: 100,
          width: 700,
          height: 400,
        },
        [wrapperLocator],
      ),
      sourceSnapshot(
        sourceTsx,
        "title",
        '<h1 id="title">',
        {
          x: 120,
          y: 120,
          width: 300,
          height: 60,
        },
        [groupLocator, wrapperLocator],
      ),
      sourceSnapshot(
        sourceTsx,
        "subtitle",
        '<p id="subtitle">',
        {
          x: 120,
          y: 200,
          width: 300,
          height: 40,
        },
        [groupLocator, wrapperLocator],
      ),
      sourceSnapshot(
        sourceTsx,
        "logo",
        '<img id="logo"',
        {
          x: 1000,
          y: 100,
          width: 300,
          height: 180,
        },
        [wrapperLocator],
      ),
      sourceSnapshot(
        sourceTsx,
        "uncertain",
        '<aside id="uncertain">',
        { x: 500, y: 500, width: 200, height: 40 },
        [],
        false,
      ),
    ];
    sandboxNodeMocks.nodes = nodes;
    const props = createEditorProps();
    render(
      <MemoryRouter>
        <Slides2Editor {...props} source={{ ...props.source, sourceTsx }} />
      </MemoryRouter>,
    );

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByTestId("mock-selection-count").textContent).toBe("2");
      expect(frameControllerSend).toHaveBeenCalledWith({
        type: "inspect",
        targets: [
          { line: nodes[1]!.line, column: nodes[1]!.column, nodeId: "group" },
          { line: nodes[4]!.line, column: nodes[4]!.column, nodeId: "logo" },
        ],
      });
    });

    fireEvent.keyDown(window, { key: "a", metaKey: true });

    await waitFor(() => {
      expect(frameControllerSend).toHaveBeenLastCalledWith({
        type: "inspect",
        targets: [
          { line: nodes[1]!.line, column: nodes[1]!.column, nodeId: "group" },
          { line: nodes[4]!.line, column: nodes[4]!.column, nodeId: "logo" },
        ],
      });
    });
  });

  it("keeps a selected ancestor on ordinary clicks and drills through with Command or Control", async () => {
    const sourceTsx = [
      "function Slide() {",
      "  return (",
      '    <div style={{ position: "relative", width: "1920px", height: "1080px" }}>',
      '      <section id="group">',
      '        <h1 id="child">Title</h1>',
      "      </section>",
      '      <img id="logo" src="logo.png" />',
      "    </div>",
      "  );",
      "}",
    ].join("\n");
    const wrapperTag =
      '<div style={{ position: "relative", width: "1920px", height: "1080px" }}>';
    const wrapperLocator = sourceLocator(sourceTsx, wrapperTag);
    const groupLocator = sourceLocator(sourceTsx, '<section id="group">');
    const parent = sourceSnapshot(
      sourceTsx,
      "group",
      '<section id="group">',
      {
        x: 100,
        y: 100,
        width: 700,
        height: 400,
      },
      [wrapperLocator],
    );
    const child = sourceSnapshot(
      sourceTsx,
      "child",
      '<h1 id="child">',
      {
        x: 120,
        y: 120,
        width: 300,
        height: 60,
      },
      [groupLocator, wrapperLocator],
    );
    const logo = sourceSnapshot(
      sourceTsx,
      "logo",
      '<img id="logo"',
      { x: 1000, y: 100, width: 300, height: 180 },
      [wrapperLocator],
    );
    sandboxNodeMocks.nodes = [parent, child, logo];
    const props = createEditorProps();
    render(
      <MemoryRouter>
        <Slides2Editor {...props} source={{ ...props.source, sourceTsx }} />
      </MemoryRouter>,
    );

    pointerClick(parent);
    pointerClick(child);
    await waitFor(() => {
      expect(screen.getByTestId("mock-selection-count").textContent).toBe("1");
      expectLastInspect([
        { line: parent.line, column: parent.column, nodeId: "group" },
      ]);
    });

    pointerClick(logo, { shiftKey: true });
    await waitFor(() => {
      expect(screen.getByTestId("mock-selection-count").textContent).toBe("2");
    });

    pointerClick(child, { metaKey: true });
    await waitFor(() => {
      expect(screen.getByTestId("mock-selection-count").textContent).toBe("2");
      expectLastInspect([
        { line: logo.line, column: logo.column, nodeId: "logo" },
        { line: child.line, column: child.column, nodeId: "child" },
      ]);
    });

    pointerClick(parent);
    pointerClick(child, { ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByTestId("mock-selection-count").textContent).toBe("1");
      expectLastInspect([
        { line: child.line, column: child.column, nodeId: "child" },
      ]);
    });
  });

  it("toggles Shift-click membership without retaining conflicting ancestors", async () => {
    const sourceTsx = [
      "function Slide() {",
      "  return (",
      '    <div style={{ position: "relative", width: "1920px", height: "1080px" }}>',
      '      <section id="group">',
      '        <h1 id="child">Title</h1>',
      '        <p id="uncertain">Deep</p>',
      "      </section>",
      "    </div>",
      "  );",
      "}",
    ].join("\n");
    const wrapperTag =
      '<div style={{ position: "relative", width: "1920px", height: "1080px" }}>';
    const wrapperLocator = sourceLocator(sourceTsx, wrapperTag);
    const groupLocator = sourceLocator(sourceTsx, '<section id="group">');
    const parent = sourceSnapshot(
      sourceTsx,
      "group",
      '<section id="group">',
      {
        x: 100,
        y: 100,
        width: 700,
        height: 400,
      },
      [wrapperLocator],
    );
    const child = sourceSnapshot(
      sourceTsx,
      "child",
      '<h1 id="child">',
      {
        x: 120,
        y: 120,
        width: 300,
        height: 60,
      },
      [groupLocator, wrapperLocator],
    );
    const uncertain = sourceSnapshot(
      sourceTsx,
      "uncertain",
      '<p id="uncertain">',
      { x: 120, y: 200, width: 300, height: 40 },
      [],
      false,
    );
    sandboxNodeMocks.nodes = [parent, child, uncertain];
    const props = createEditorProps();
    render(
      <MemoryRouter>
        <Slides2Editor {...props} source={{ ...props.source, sourceTsx }} />
      </MemoryRouter>,
    );

    pointerClick(parent);
    pointerClick(uncertain, { shiftKey: true });
    await waitFor(() => {
      expect(screen.getByTestId("mock-selection-count").textContent).toBe("1");
      expectLastInspect([
        { line: parent.line, column: parent.column, nodeId: "group" },
      ]);
    });

    pointerClick(child, { shiftKey: true });
    await waitFor(() => {
      expect(screen.getByTestId("mock-selection-count").textContent).toBe("1");
      expectLastInspect([
        { line: child.line, column: child.column, nodeId: "child" },
      ]);
    });

    pointerClick(child, { shiftKey: true });
    expect(screen.getByTestId("mock-selection-count").textContent).toBe("0");
  });

  it("adds Shift-marquee targets and preserves selection on Shift-click blank canvas", async () => {
    const firstNode: ElementSnapshot = {
      nodeId: "node-1",
      line: 1,
      column: 0,
      tagName: "div",
      bounds: { x: 10, y: 10, width: 100, height: 50 },
      text: "First",
      styles: {},
    };
    const secondNode: ElementSnapshot = {
      ...firstNode,
      nodeId: "node-2",
      line: 2,
      bounds: { x: 200, y: 10, width: 100, height: 50 },
      text: "Second",
    };
    sandboxNodeMocks.nodes = [firstNode, secondNode];
    render(
      <MemoryRouter>
        <Slides2Editor {...createEditorProps()} />
      </MemoryRouter>,
    );

    const pointer = (
      phase: FramePointer["phase"],
      x: number,
      y: number,
      pointerId: number,
    ) => {
      act(() =>
        sandboxPointerMocks.onPointer?.({
          phase,
          pointerType: "mouse",
          x,
          y,
          button: 0,
          pointerId,
          shiftKey: true,
          altKey: false,
          ctrlKey: false,
          metaKey: false,
          target: null,
        }),
      );
    };

    fireEvent.click(await screen.findByTestId("mock-slide-object"));
    expect(screen.getByTestId("mock-selection-count").textContent).toBe("1");

    pointer("down", 180, 0, 2);
    pointer("move", 320, 70, 2);
    pointer("up", 320, 70, 2);
    expect(screen.getByTestId("mock-selection-count").textContent).toBe("2");

    pointer("down", 400, 100, 3);
    pointer("up", 400, 100, 3);
    expect(screen.getByTestId("mock-selection-count").textContent).toBe("2");
  });

  it("keeps marquee selection independent when wrappers and children overlap", async () => {
    const sourceTsx = [
      "function Slide() {",
      "  return (",
      '    <div style={{ position: "relative", width: "1920px", height: "1080px" }}>',
      '      <section id="group">',
      '        <h1 id="child">Title</h1>',
      "      </section>",
      '      <aside id="overlap">Overlap</aside>',
      "    </div>",
      "  );",
      "}",
    ].join("\n");
    const wrapperTag =
      '<div style={{ position: "relative", width: "1920px", height: "1080px" }}>';
    const wrapper = sourceSnapshot(sourceTsx, "canvas", wrapperTag, {
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
    const wrapperLocator = sourceLocator(sourceTsx, wrapperTag);
    const groupTag = '<section id="group">';
    const groupLocator = sourceLocator(sourceTsx, groupTag);
    const group = sourceSnapshot(
      sourceTsx,
      "group",
      groupTag,
      { x: 10, y: 10, width: 300, height: 200 },
      [wrapperLocator],
    );
    const child = sourceSnapshot(
      sourceTsx,
      "child",
      '<h1 id="child">',
      { x: 50, y: 50, width: 80, height: 40 },
      [groupLocator, wrapperLocator],
    );
    const overlap = sourceSnapshot(
      sourceTsx,
      "overlap",
      '<aside id="overlap">',
      { x: 50, y: 50, width: 80, height: 40 },
      [wrapperLocator],
    );
    sandboxNodeMocks.nodes = [wrapper, group, child, overlap];
    const props = createEditorProps();
    render(
      <MemoryRouter>
        <Slides2Editor {...props} source={{ ...props.source, sourceTsx }} />
      </MemoryRouter>,
    );
    await screen.findByTestId("mock-slide-object");

    const dragMarquee = (
      from: { x: number; y: number },
      to: { x: number; y: number },
      pointerId: number,
      shiftKey = false,
    ) => {
      const pointer = {
        pointerType: "mouse" as const,
        button: 0,
        pointerId,
        shiftKey,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        target: null,
      };
      act(() => {
        sandboxPointerMocks.onPointer?.({ ...pointer, phase: "down", ...from });
        sandboxPointerMocks.onPointer?.({ ...pointer, phase: "move", ...to });
        sandboxPointerMocks.onPointer?.({ ...pointer, phase: "up", ...to });
      });
    };

    dragMarquee({ x: 0, y: 0 }, { x: 400, y: 300 }, 2);
    await waitFor(() => {
      expect(screen.getByTestId("mock-selection-count").textContent).toBe("2");
      expectLastInspect([
        { line: group.line, column: group.column, nodeId: "group" },
        { line: overlap.line, column: overlap.column, nodeId: "overlap" },
      ]);
    });

    dragMarquee({ x: 40, y: 40 }, { x: 150, y: 100 }, 3);
    await waitFor(() => {
      expect(screen.getByTestId("mock-selection-count").textContent).toBe("2");
      expectLastInspect([
        { line: child.line, column: child.column, nodeId: "child" },
        { line: overlap.line, column: overlap.column, nodeId: "overlap" },
      ]);
    });

    dragMarquee({ x: 0, y: 0 }, { x: 400, y: 300 }, 4, true);
    await waitFor(() => {
      expect(screen.getByTestId("mock-selection-count").textContent).toBe("2");
      expectLastInspect([
        { line: overlap.line, column: overlap.column, nodeId: "overlap" },
        { line: group.line, column: group.column, nodeId: "group" },
      ]);
    });
  });

  it("treats an unselected full-slide canvas target as blank space", async () => {
    const background: ElementSnapshot = {
      nodeId: "canvas-background",
      line: 1,
      column: 0,
      tagName: "div",
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      text: "",
      styles: {},
    };
    const object: ElementSnapshot = {
      nodeId: "node-1",
      line: 2,
      column: 0,
      tagName: "div",
      bounds: { x: 10, y: 10, width: 100, height: 50 },
      text: "Object",
      styles: {},
    };
    sandboxNodeMocks.nodes = [background, object];
    render(
      <MemoryRouter>
        <Slides2Editor {...createEditorProps()} />
      </MemoryRouter>,
    );

    pointerClick(object);
    expect(screen.getByTestId("mock-selection-count").textContent).toBe("1");
    await waitFor(() => {
      expectLastInspect([
        { line: object.line, column: object.column, nodeId: object.nodeId },
      ]);
    });

    pointerClick(background);
    expect(screen.getByTestId("mock-selection-count").textContent).toBe("0");
    await act(async () => {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
    });
    expectLastInspect([
      { line: object.line, column: object.column, nodeId: object.nodeId },
    ]);
  });

  it("toggles Preview, reveals builds, and keeps the inspector shortcut available", async () => {
    render(
      <MemoryRouter>
        <Slides2Editor {...createEditorProps()} />
      </MemoryRouter>,
    );

    const previewButton = screen.getByRole("button", {
      name: "slides2Editor.preview",
    });
    expect(sandboxPreviewMocks.initialRevealedSteps).toBeNull();

    fireEvent.click(previewButton);

    expect(
      screen
        .getByRole("button", { name: "slides2Editor.edit" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(sandboxPreviewMocks.initialRevealedSteps).toBe(0);
    expect(
      screen.getByRole("button", { name: "slides2Editor.showInspector" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByTestId("mock-preview-click"));
    expect(frameControllerSend).toHaveBeenCalledWith({
      type: "set-revealed-steps",
      revealedSteps: 1,
    });

    fireEvent.keyDown(window, { key: "i" });
    expect(
      screen.getByRole("button", { name: "slides2Editor.hideInspector" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "slides2Editor.edit" }));
    expect(sandboxPreviewMocks.initialRevealedSteps).toBeNull();
    expect(
      screen.getByRole("button", { name: "slides2Editor.preview" }),
    ).toBeTruthy();
  });

  it("preserves nested absolute geometry when bringing a static parent forward", async () => {
    const sourceTsx = [
      "const Slide = () => (",
      '  <div style={{ position: "relative", width: "1920px", height: "1080px" }}>',
      '    <div data-testid="static-first" style={{ marginLeft: 100, width: 250, height: 200, left: 80, insetInlineStart: 40, inset: 50, background: "red" }}>',
      '      <div data-testid="absolute-child" style={{ position: "absolute", left: "2%", top: 280, width: "30%", height: 1 }} />',
      "    </div>",
      '    <div data-testid="static-second" style={{ marginLeft: 120, width: 250, height: 200, background: "green" }} />',
      "  </div>",
      ");",
      "export default [Slide];",
    ].join("\n");
    const parentLocator = sourceLocation(
      sourceTsx,
      '<div data-testid="static-first"',
    );
    const childLocator = sourceLocation(
      sourceTsx,
      '<div data-testid="absolute-child"',
    );
    const secondLocator = sourceLocation(
      sourceTsx,
      '<div data-testid="static-second"',
    );
    const parent: ElementSnapshot = {
      nodeId: `${parentLocator.line}:${parentLocator.column}:0`,
      ...parentLocator,
      tagName: "div",
      bounds: { x: 100, y: 0, width: 250, height: 200 },
      text: "",
      styles: {
        position: "static",
        zIndex: "0",
        width: "250px",
        height: "200px",
      },
    };
    const child: ElementSnapshot = {
      nodeId: `${childLocator.line}:${childLocator.column}:0`,
      ...childLocator,
      tagName: "div",
      bounds: { x: 38.4, y: 280, width: 576, height: 1 },
      text: "",
      styles: {
        position: "absolute",
        zIndex: "0",
        width: "576px",
        height: "1px",
      },
    };
    const second: ElementSnapshot = {
      nodeId: `${secondLocator.line}:${secondLocator.column}:0`,
      ...secondLocator,
      tagName: "div",
      bounds: { x: 120, y: 0, width: 250, height: 200 },
      text: "",
      styles: {
        position: "static",
        zIndex: "0",
        width: "250px",
        height: "200px",
      },
    };
    sandboxNodeMocks.nodes = [parent, child, second];
    editorMocks.showArrange = true;
    const props = createEditorProps();
    const onSave = vi.fn(async () => ({
      sourceTsx,
      revision: 2,
      sourceHash: "b".repeat(64),
    }));

    render(
      <MemoryRouter>
        <Slides2Editor
          {...props}
          source={{ ...props.source, sourceTsx }}
          onSave={onSave}
        />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByTestId("mock-slide-object"));
    fireEvent.click(await screen.findByTestId("mock-bring-to-front"));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "designSystemSetup.saveChanges",
      }),
    );

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const savedEdits = (
      onSave.mock.calls[0] as unknown as [
        Array<{
          line: number;
          column: number;
          ops: Array<Record<string, unknown>>;
        }>,
      ]
    )[0];
    const parentEdit = savedEdits.find(
      (edit) => edit.line === parent.line && edit.column === parent.column,
    );
    const childEdit = savedEdits.find(
      (edit) => edit.line === child.line && edit.column === child.column,
    );

    expect(parentEdit?.ops).toEqual(
      expect.arrayContaining([
        { kind: "set-style", key: "position", value: "relative" },
        { kind: "set-style", key: "zIndex", value: "1" },
        { kind: "set-style", key: "left", value: null },
        { kind: "set-style", key: "inset", value: null },
      ]),
    );
    expect(childEdit?.ops).toEqual(
      expect.arrayContaining([
        { kind: "set-style", key: "left", value: "-61.6px" },
        { kind: "set-style", key: "top", value: "280px" },
        { kind: "set-style", key: "width", value: "576px" },
        { kind: "set-style", key: "height", value: "1px" },
      ]),
    );
  });

  it("inserts an uploaded video using its asset handle", async () => {
    const onRestore = vi.fn(async (sourceTsx: string) => ({
      sourceTsx,
      revision: 2,
      sourceHash: "b".repeat(64),
    }));
    render(
      <MemoryRouter>
        <Slides2Editor {...createEditorProps()} onRestore={onRestore} />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(typeof assetBrowserMocks.onInsert).toBe("function"),
    );
    const insertAsset = assetBrowserMocks.onInsert as (
      assetId: string,
      filename: string,
      type: string,
    ) => Promise<string | null>;
    expect(await insertAsset("video_asset", "intro.mp4", "video/mp4")).toBe(
      null,
    );

    expect(onRestore).toHaveBeenCalledOnce();
    expect(onRestore.mock.calls[0]?.[0]).toContain(
      '<video src={"asset://video_asset"}',
    );
    expect(onRestore.mock.calls[0]?.[0]).toContain("controls playsInline");
  });

  it("replaces the selected video source with a new uploaded asset handle", async () => {
    const sourceTsx =
      'export default function Slide() { return <video src={"asset://old_video"} controls />; }';
    sandboxNodeMocks.line = 1;
    sandboxNodeMocks.column = sourceTsx.indexOf("<video");
    sandboxNodeMocks.tagName = "video";
    const onRestore = vi.fn(async (nextSourceTsx: string) => ({
      sourceTsx: nextSourceTsx,
      revision: 2,
      sourceHash: "b".repeat(64),
    }));
    const props = {
      ...createEditorProps(),
      source: { ...createEditorProps().source, sourceTsx },
      onRestore,
    };
    render(
      <MemoryRouter>
        <Slides2Editor {...props} />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByTestId("mock-slide-object"));

    const insertAsset = assetBrowserMocks.onInsert as (
      assetId: string,
      filename: string,
      type: string,
    ) => Promise<string | null>;
    expect(
      await insertAsset("new_video", "replacement.webm", "video/webm"),
    ).toBeNull();

    expect(onRestore).toHaveBeenCalledOnce();
    const savedSource = onRestore.mock.calls[0]?.[0] ?? "";
    expect(savedSource).toContain('src={"asset://new_video"}');
    expect(savedSource).not.toContain("old_video");
  });

  it("opens presenter view and starts windowed presentation from P", () => {
    const events: string[] = [];
    render(
      <MemoryRouter>
        <Slides2Editor
          {...createEditorProps()}
          onOpenPresenter={() => events.push("open-presenter")}
          onPresent={(mode) => events.push(`present:${mode}`)}
        />
      </MemoryRouter>,
    );

    fireEvent.keyDown(window, { key: "p" });

    expect(events).toEqual(["open-presenter", "present:windowed"]);
  });

  it("gates undo and redo during composition and honors pending edit history", async () => {
    render(
      <MemoryRouter>
        <Slides2Editor {...createEditorProps()} />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByTestId("mock-slide-object"));
    const saveButton = screen.getByRole("button", {
      name: "designSystemSetup.saveChanges",
    }) as HTMLButtonElement;
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(saveButton.disabled).toBe(false);

    const composingUndo = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });
    Object.defineProperty(composingUndo, "keyCode", { value: 229 });
    window.dispatchEvent(composingUndo);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, altKey: true });

    const alreadyHandledUndo = new KeyboardEvent("keydown", {
      key: "z",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    alreadyHandledUndo.preventDefault();
    window.dispatchEvent(alreadyHandledUndo);
    expect(saveButton.disabled).toBe(false);

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(saveButton.disabled).toBe(true);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(saveButton.disabled).toBe(false);
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(saveButton.disabled).toBe(false);
  });

  it.each([false, true])(
    "applies a queued Undo once when the active editor CAS identity matches (ack failure: %s)",
    async (failAcknowledgementOnce) => {
      const props = createEditorProps();
      const editor = () => (
        <MemoryRouter>
          <Slides2Editor {...props} />
        </MemoryRouter>
      );
      const { rerender } = render(editor());
      fireEvent.click(await screen.findByTestId("mock-slide-object"));
      fireEvent.keyDown(window, { key: "ArrowRight" });

      const statusKey =
        "slides-2:slide-editor-status:slides-2-editor-layout-test";
      const commandKey =
        "slides-2:slide-editor-command:slides-2-editor-layout-test";
      await waitFor(() =>
        expect(editorCommandMocks.appState.get(statusKey)).toMatchObject({
          hasPendingEdits: true,
          canUndo: true,
        }),
      );
      const status = editorCommandMocks.appState.get(statusKey) as Record<
        string,
        unknown
      >;
      editorCommandMocks.appState.set(commandKey, {
        protocolVersion: 1,
        commandId: "command_123456",
        operation: "undo",
        deckId: status.deckId,
        slideId: status.slideId,
        editorSessionId: status.editorSessionId,
        historyVersion: status.historyVersion,
        sourceRevision: status.sourceRevision,
        sourceHash: status.sourceHash,
        status: "pending",
      });
      editorCommandMocks.failNextCompareAndSet = failAcknowledgementOnce;
      editorCommandMocks.commandVersion += 1;
      rerender(editor());

      await waitFor(() =>
        expect(editorCommandMocks.appState.get(commandKey)).toMatchObject({
          commandId: "command_123456",
          operation: "undo",
          status: "applied",
        }),
      );
      expect(
        (
          screen.getByRole("button", {
            name: "designSystemSetup.saveChanges",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
      await waitFor(() =>
        expect(editorCommandMocks.appState.get(statusKey)).toMatchObject({
          historyVersion: (status.historyVersion as number) + 1,
        }),
      );
    },
  );

  it("finishes an in-flight Save across an editor remount without replaying it", async () => {
    let resolveSave!: (source: {
      sourceTsx: string;
      revision: number;
      sourceHash: string;
    }) => void;
    const savePromise = new Promise<{
      sourceTsx: string;
      revision: number;
      sourceHash: string;
    }>((resolve) => {
      resolveSave = resolve;
    });
    const onSave = vi.fn(() => savePromise);
    const props = { ...createEditorProps(), onSave };
    const editor = () => (
      <MemoryRouter>
        <Slides2Editor {...props} />
      </MemoryRouter>
    );
    const firstEditor = render(editor());
    fireEvent.click(await screen.findByTestId("mock-slide-object"));
    fireEvent.keyDown(window, { key: "ArrowRight" });

    const statusKey =
      "slides-2:slide-editor-status:slides-2-editor-layout-test";
    const commandKey =
      "slides-2:slide-editor-command:slides-2-editor-layout-test";
    await waitFor(() =>
      expect(editorCommandMocks.appState.get(statusKey)).toMatchObject({
        hasPendingEdits: true,
        canSave: true,
      }),
    );
    const status = editorCommandMocks.appState.get(statusKey) as Record<
      string,
      unknown
    >;
    const originalSessionId = status.editorSessionId;
    editorCommandMocks.appState.set(commandKey, {
      protocolVersion: 1,
      commandId: "command_save_123",
      operation: "save",
      deckId: status.deckId,
      slideId: status.slideId,
      editorSessionId: status.editorSessionId,
      historyVersion: status.historyVersion,
      sourceRevision: status.sourceRevision,
      sourceHash: status.sourceHash,
      status: "pending",
    });
    editorCommandMocks.commandVersion += 1;
    firstEditor.rerender(editor());
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    firstEditor.unmount();
    render(editor());
    await waitFor(() => {
      const replacementStatus = editorCommandMocks.appState.get(
        statusKey,
      ) as Record<string, unknown>;
      expect(replacementStatus.editorSessionId).not.toBe(originalSessionId);
      expect(editorCommandMocks.appState.get(commandKey)).toMatchObject({
        commandId: "command_save_123",
        status: "pending",
      });
    });

    await act(async () => {
      resolveSave({
        sourceTsx: "export default function Slide() { return <div />; }",
        revision: 2,
        sourceHash: "b".repeat(64),
      });
    });
    await waitFor(() =>
      expect(editorCommandMocks.appState.get(commandKey)).toMatchObject({
        commandId: "command_save_123",
        operation: "save",
        status: "applied",
      }),
    );
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("keeps the footer outside the editor row and supports rail boundary keys", () => {
    const { container } = render(
      <MemoryRouter>
        <Slides2Editor
          deckId="deck-1"
          title="Deck"
          slides={[]}
          activeIndex={0}
          source={{
            id: "slide-1",
            deckId: "deck-1",
            position: 0,
            sourceTsx: "export default function Slide() { return <div />; }",
            revision: 1,
            sourceHash: "a".repeat(64),
          }}
          notes=""
          artifact={null}
          designTokens={null}
          savingDesignTokens={false}
          savingNotes={false}
          loading
          saving={false}
          sourceConflict={false}
          structuralSaving={false}
          canEdit
          canComment
          backHref="/home"
          presentHref="/deck/deck-1/present"
          onSelectSlide={() => {}}
          onPresent={() => {}}
          onSave={async () => ({ sourceTsx: "", revision: 1, sourceHash: "" })}
          onReloadSource={async () => ({
            id: "slide-1",
            deckId: "deck-1",
            position: 0,
            sourceTsx: "",
            revision: 1,
            sourceHash: "",
          })}
          onRestore={async () => ({
            sourceTsx: "",
            revision: 1,
            sourceHash: "",
          })}
          onSaveDesignTokens={async () => {}}
          onSaveNotes={async () => {}}
          onSelectionChange={() => {}}
          onAddSlide={() => {}}
          onDuplicateSlide={() => {}}
          onDeleteSlide={() => {}}
          onMoveSlide={() => {}}
        />
      </MemoryRouter>,
    );

    const shell = container.firstElementChild;
    expect(shell).not.toBeNull();
    const [header, workspace, footer] = Array.from(shell!.children);

    expect(header?.tagName).toBe("HEADER");
    expect(workspace?.querySelectorAll(":scope > aside")).toHaveLength(2);
    expect(
      workspace?.querySelector(":scope > main")?.classList.contains("pb-2"),
    ).toBe(true);
    expect(footer?.tagName).toBe("FOOTER");
    expect(footer?.classList.contains("h-9")).toBe(true);
    expect(workspace?.contains(footer ?? null)).toBe(false);
    expect(
      screen.getByTestId("command-menu-back-href").getAttribute("data-href"),
    ).toBe("/home");

    const slideRailResize = screen.getByRole("separator", {
      name: "editorToolbar.resizeSlideList",
    });
    expect(slideRailResize.getAttribute("aria-valuenow")).toBe("264");

    fireEvent.keyDown(slideRailResize, {
      key: "ArrowRight",
      shiftKey: true,
    });
    expect(slideRailResize.getAttribute("aria-valuenow")).toBe("296");

    fireEvent.keyDown(slideRailResize, { key: "ArrowUp" });
    expect(slideRailResize.getAttribute("aria-valuenow")).toBe("296");

    fireEvent.keyDown(slideRailResize, { key: "ArrowDown" });
    expect(slideRailResize.getAttribute("aria-valuenow")).toBe("296");

    fireEvent.keyDown(slideRailResize, { key: "Home" });
    expect(slideRailResize.getAttribute("aria-valuenow")).toBe("200");

    fireEvent.keyDown(slideRailResize, { key: "End" });
    expect(slideRailResize.getAttribute("aria-valuenow")).toBe("480");

    fireEvent.keyDown(slideRailResize, { key: "ArrowLeft" });
    expect(slideRailResize.getAttribute("aria-valuenow")).toBe("472");
  });

  it("labels each resize handle distinctly and names the rotate control", async () => {
    render(
      <MemoryRouter>
        <Slides2Editor {...createEditorProps()} />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByTestId("mock-slide-object"));

    const resizeLabels = ["nw", "n", "ne", "e", "se", "s", "sw", "w"].map(
      (handle) => `Resize ${handle}`,
    );
    const resizeButtons = resizeLabels.map((name) =>
      screen.getByRole("button", { name }),
    );
    const rotateButton = screen.getByRole("button", {
      name: "styleInspector.rotateHandle",
    });

    expect(
      resizeButtons.map((button) => button.getAttribute("aria-label")),
    ).toEqual(resizeLabels);
    expect(
      resizeButtons.every((button) =>
        button.classList.contains("focus-visible:outline-2"),
      ),
    ).toBe(true);
    expect(rotateButton.classList.contains("focus-visible:outline-2")).toBe(
      true,
    );
  });

  it("restores the slide preview when an object move is canceled", async () => {
    frameControllerSend.mockClear();
    render(
      <MemoryRouter>
        <Slides2Editor {...createEditorProps()} />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByTestId("mock-slide-object"));
    frameControllerSend.mockClear();
    fireEvent.click(screen.getByTestId("mock-slide-pointer-move"));
    expect(frameControllerSend).toHaveBeenCalledWith(
      expect.objectContaining({ type: "preview" }),
    );

    fireEvent.click(screen.getByTestId("mock-slide-pointer-cancel"));

    expect(frameControllerSend).toHaveBeenCalledWith({
      type: "clear-preview",
    });
    expect(
      (
        screen.getByRole("button", {
          name: "designSystemSetup.saveChanges",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("cancels an active move on Escape and preserves prior nudges", async () => {
    frameControllerSend.mockClear();
    render(
      <MemoryRouter>
        <Slides2Editor {...createEditorProps()} />
      </MemoryRouter>,
    );

    const object = await screen.findByTestId("mock-slide-object");
    const pointerUp = screen.getByTestId("mock-slide-pointer-up");
    fireEvent.click(object);
    fireEvent.click(pointerUp);
    fireEvent.keyDown(window, { key: "ArrowRight" });

    const saveButton = screen.getByRole("button", {
      name: "designSystemSetup.saveChanges",
    }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false);
    await waitFor(() =>
      expect(frameControllerSend).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: "preview",
          patches: [
            expect.objectContaining({
              styles: { translate: "1px 0px" },
            }),
          ],
        }),
      ),
    );

    frameControllerSend.mockClear();
    fireEvent.click(object);
    fireEvent.click(screen.getByTestId("mock-slide-pointer-move"));
    expect(frameControllerSend).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "preview",
        patches: [
          expect.objectContaining({
            styles: { translate: "20px 20px" },
          }),
        ],
      }),
    );

    fireEvent.keyDown(window, { key: "Escape" });

    expect(frameControllerSend).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "preview",
        patches: [
          expect.objectContaining({
            styles: { translate: "1px 0px" },
          }),
        ],
      }),
    );
    const callsAfterEscape = frameControllerSend.mock.calls.length;
    fireEvent.click(pointerUp);
    expect(frameControllerSend).toHaveBeenCalledTimes(callsAfterEscape);
    expect(saveButton.disabled).toBe(false);
  });

  it("uses screen-scaled drag thresholds and commits the pointer-up endpoint", async () => {
    canvasMocks.scale = 0.5;
    render(
      <MemoryRouter>
        <Slides2Editor {...createEditorProps()} />
      </MemoryRouter>,
    );

    const object = await screen.findByTestId("mock-slide-object");
    fireEvent.click(object);
    await waitFor(() =>
      expect(screen.getByTestId("mock-selection-count").textContent).toBe("1"),
    );
    frameControllerSend.mockClear();

    act(() => {
      sandboxPointerMocks.onPointer?.(framePointer("move", 25, 20));
    });
    expect(frameControllerSend).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "preview" }),
    );

    act(() => {
      sandboxPointerMocks.onPointer?.(framePointer("up", 26, 20));
    });

    expect(frameControllerSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "preview",
        patches: [
          expect.objectContaining({
            styles: { translate: "6px 0px" },
          }),
        ],
      }),
    );
  });

  it("clears live marquee handles when Escape cancels the gesture", async () => {
    render(
      <MemoryRouter>
        <Slides2Editor {...createEditorProps()} />
      </MemoryRouter>,
    );
    await screen.findByTestId("mock-slide-object");

    act(() => {
      sandboxPointerMocks.onPointer?.(
        framePointer("down", 0, 0, { pointerId: 12 }),
      );
      sandboxPointerMocks.onPointer?.(
        framePointer("move", 200, 100, { pointerId: 12 }),
      );
    });
    expect(screen.getByRole("button", { name: "Resize nw" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("button", { name: "Resize nw" })).toBeNull();
  });

  it("resizes from the visual bounds and preserves Shift aspect ratio on pointer up", async () => {
    render(
      <MemoryRouter>
        <Slides2Editor {...createEditorProps()} />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByTestId("mock-slide-object"));

    const westHandle = screen.getByRole("button", { name: "Resize w" });
    Object.defineProperty(westHandle, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    fireEvent.pointerDown(westHandle, {
      pointerId: 30,
      button: 0,
      clientX: 10,
      clientY: 35,
    });
    fireEvent.pointerMove(westHandle, {
      pointerId: 30,
      clientX: 0,
      clientY: 35,
    });

    expect(frameControllerSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "preview",
        patches: [
          expect.objectContaining({
            styles: expect.objectContaining({ width: "110px" }),
          }),
        ],
      }),
    );

    fireEvent.pointerCancel(westHandle, {
      pointerId: 30,
      clientX: 0,
      clientY: 35,
    });
    fireEvent.click(await screen.findByTestId("mock-slide-object"));

    const southeastHandle = screen.getByRole("button", { name: "Resize se" });
    Object.defineProperty(southeastHandle, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    frameControllerSend.mockClear();
    fireEvent.pointerDown(southeastHandle, {
      pointerId: 31,
      button: 0,
      clientX: 110,
      clientY: 60,
    });
    fireEvent.pointerUp(southeastHandle, {
      pointerId: 31,
      clientX: 140,
      clientY: 70,
      shiftKey: true,
    });

    expect(frameControllerSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "preview",
        patches: [
          expect.objectContaining({
            styles: expect.objectContaining({
              width: "130px",
              height: "65px",
            }),
          }),
        ],
      }),
    );
  });

  it("cancels in-progress resize and rotation previews on pointer cancellation", async () => {
    frameControllerSend.mockClear();
    render(
      <MemoryRouter>
        <Slides2Editor {...createEditorProps()} />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByTestId("mock-slide-object"));
    const resizeHandle = screen.getByRole("button", {
      name: "Resize se",
    });
    const rotateHandle = screen.getByRole("button", {
      name: "styleInspector.rotateHandle",
    });
    Object.defineProperty(resizeHandle, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(rotateHandle, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    frameControllerSend.mockClear();

    fireEvent.click(resizeHandle);
    fireEvent.click(rotateHandle);
    expect(frameControllerSend).not.toHaveBeenCalled();

    fireEvent.pointerDown(resizeHandle, {
      pointerId: 19,
      button: 0,
      clientX: 110,
      clientY: 60,
    });
    fireEvent.pointerMove(resizeHandle, {
      pointerId: 19,
      clientX: 130,
      clientY: 80,
    });
    expect(frameControllerSend).toHaveBeenCalledWith(
      expect.objectContaining({ type: "preview" }),
    );

    fireEvent.pointerCancel(resizeHandle, {
      pointerId: 19,
      clientX: 130,
      clientY: 80,
    });

    expect(frameControllerSend).toHaveBeenCalledWith({
      type: "clear-preview",
    });
    expect(
      (
        screen.getByRole("button", {
          name: "designSystemSetup.saveChanges",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    frameControllerSend.mockClear();
    fireEvent.pointerDown(rotateHandle, {
      pointerId: 20,
      button: 0,
      clientX: 60,
      clientY: 10,
    });
    fireEvent.pointerMove(rotateHandle, {
      pointerId: 20,
      clientX: 110,
      clientY: 35,
    });
    expect(frameControllerSend).toHaveBeenCalledWith(
      expect.objectContaining({ type: "preview" }),
    );
    fireEvent.pointerCancel(rotateHandle, {
      pointerId: 20,
      clientX: 110,
      clientY: 35,
    });
    expect(frameControllerSend).toHaveBeenCalledWith({
      type: "clear-preview",
    });
    expect(
      (
        screen.getByRole("button", {
          name: "designSystemSetup.saveChanges",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("toggles the design panel with bare D only in development", () => {
    const onPanelChange = vi.fn();
    render(
      <MemoryRouter>
        <Slides2Editor
          deckId="deck-1"
          title="Deck"
          slides={[]}
          activeIndex={0}
          source={{
            id: "slide-1",
            deckId: "deck-1",
            position: 0,
            sourceTsx: "export default function Slide() { return <div />; }",
            revision: 1,
            sourceHash: "a".repeat(64),
          }}
          notes=""
          artifact={null}
          designTokens={null}
          savingDesignTokens={false}
          savingNotes={false}
          loading
          saving={false}
          sourceConflict={false}
          structuralSaving={false}
          canEdit
          canComment
          backHref="/home"
          presentHref="/deck/deck-1/present"
          onPanelChange={onPanelChange}
          onSelectSlide={() => {}}
          onPresent={() => {}}
          onSave={async () => ({ sourceTsx: "", revision: 1, sourceHash: "" })}
          onReloadSource={async () => ({
            id: "slide-1",
            deckId: "deck-1",
            position: 0,
            sourceTsx: "",
            revision: 1,
            sourceHash: "",
          })}
          onRestore={async () => ({
            sourceTsx: "",
            revision: 1,
            sourceHash: "",
          })}
          onSaveDesignTokens={async () => {}}
          onSaveNotes={async () => {}}
          onSelectionChange={() => {}}
          onAddSlide={() => {}}
          onDuplicateSlide={() => {}}
          onDeleteSlide={() => {}}
          onMoveSlide={() => {}}
        />
      </MemoryRouter>,
    );

    const currentPanel = () => onPanelChange.mock.calls.at(-1)?.[0];
    expect(currentPanel()).toBe("format");

    fireEvent.keyDown(window, { key: "d" });
    expect(currentPanel()).toBe(import.meta.env.DEV ? "design" : "format");
    if (import.meta.env.DEV) {
      fireEvent.keyDown(window, { key: "D" });
      expect(currentPanel()).toBe("format");
      fireEvent.keyDown(window, { key: "D", shiftKey: true });
      expect(currentPanel()).toBe("design");
      fireEvent.keyDown(window, { key: "d" });
      expect(currentPanel()).toBe("format");
    }

    const callCount = onPanelChange.mock.calls.length;
    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "d" });
    input.remove();
    const button = document.createElement("button");
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    button.append(icon);
    document.body.append(button);
    fireEvent.keyDown(icon, { key: "d" });
    button.remove();
    fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    fireEvent.keyDown(window, { key: "d", metaKey: true });
    fireEvent.keyDown(window, { key: "d", altKey: true });
    fireEvent.keyDown(window, { key: "d", isComposing: true });
    fireEvent.keyDown(window, { key: "d", keyCode: 229 });
    const alreadyHandled = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "d",
    });
    alreadyHandled.preventDefault();
    window.dispatchEvent(alreadyHandled);
    expect(onPanelChange).toHaveBeenCalledTimes(callCount);
  });
});
