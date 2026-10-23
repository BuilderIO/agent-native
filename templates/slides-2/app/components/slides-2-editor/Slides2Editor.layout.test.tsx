// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  FrameKeyboard,
  FramePointer,
  SlideFrameController,
} from "../slides-2-runtime/SandboxedSlide";
import type { CrossSlideSourceCommitEntry } from "./cross-slide-edit-history";
import type { ElementSnapshot } from "./types";

const editorStyles = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../../global.css"),
  "utf8",
);

const frameControllerSend = vi.hoisted(() => vi.fn());
const transformSlideObjectsMocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
}));
const toastMocks = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
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
  activeArtifact: null as unknown,
  activeOnError: null as ((message: string) => void) | null,
  activeOnReady: null as (() => void) | null,
}));
const sandboxPointerMocks = vi.hoisted(() => ({
  onPointer: null as ((pointer: FramePointer) => void) | null,
  activeFramePointer: null as ((pointer: FramePointer) => void) | null,
}));
const sandboxKeyboardMocks = vi.hoisted(() => ({
  activeFrameKeyboard: null as ((keyboard: FrameKeyboard) => void) | null,
}));
const sandboxCommentMocks = vi.hoisted(() => ({
  draftAnchor: null as unknown,
}));
const editorMocks = vi.hoisted(() => ({ showArrange: false }));
const canvasMocks = vi.hoisted(() => ({ scale: 1 }));
const editorCommandMocks = vi.hoisted(() => ({
  appState: new Map<string, unknown>(),
  commandVersion: 0,
  failNextCompareAndSet: false,
  useDbSync: vi.fn(),
}));
const agentConnectionMocks = vi.hoisted(() => ({
  state: "unknown" as "unknown" | "configured" | "missing" | "unavailable",
}));

afterEach(cleanup);
beforeEach(() => {
  frameControllerSend.mockClear();
  transformSlideObjectsMocks.mutateAsync.mockReset();
  toastMocks.error.mockClear();
  toastMocks.success.mockClear();
  editorCommandMocks.appState.clear();
  editorCommandMocks.commandVersion = 0;
  editorCommandMocks.failNextCompareAndSet = false;
  editorCommandMocks.useDbSync.mockClear();
  agentConnectionMocks.state = "unknown";
  assetBrowserMocks.onInsert = null;
  sandboxNodeMocks.line = 1;
  sandboxNodeMocks.column = 0;
  sandboxNodeMocks.tagName = "div";
  sandboxNodeMocks.nodes = null;
  sandboxPreviewMocks.initialRevealedSteps = null;
  sandboxPreviewMocks.onNavigationInput = null;
  sandboxPreviewMocks.activeArtifact = null;
  sandboxPreviewMocks.activeOnError = null;
  sandboxPreviewMocks.activeOnReady = null;
  sandboxPointerMocks.onPointer = null;
  sandboxPointerMocks.activeFramePointer = null;
  sandboxKeyboardMocks.activeFrameKeyboard = null;
  sandboxCommentMocks.draftAnchor = null;
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
  useActionMutation: () => ({
    mutateAsync: transformSlideObjectsMocks.mutateAsync,
    isPending: false,
  }),
  useChangeVersion: () => editorCommandMocks.commandVersion,
  useDbSync: editorCommandMocks.useDbSync,
}));

vi.mock("@agent-native/core/client/use-agent-engine-configured", () => ({
  useAgentEngineConfigured: () => ({
    canChat: agentConnectionMocks.state === "configured",
    missing: agentConnectionMocks.state === "missing",
    state: agentConnectionMocks.state,
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, unknown>) => {
    const template =
      key === "styleInspector.resizeHandle"
        ? "Resize {{handle}}"
        : key === "slides2Editor.agentConnected"
          ? "Agent connected"
          : key === "slides2Editor.footerPage"
            ? "page {{current}}/{{total}}"
            : key;
    return Object.entries(values ?? {}).reduce(
      (label, [name, value]) => label.replaceAll(`{{${name}}}`, String(value)),
      template,
    );
  },
  useFormatters: () => ({ formatNumber: (value: number) => String(value) }),
}));

vi.mock("sonner", () => ({ toast: toastMocks }));

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
  Slides2CommandMenu: ({
    backHref,
    open,
    onOpenChange,
    onToggleDesignPanel,
  }: {
    backHref?: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onToggleDesignPanel: () => void;
  }) => (
    <>
      <div data-testid="command-menu-back-href" data-href={backHref} />
      {open ? (
        <button
          type="button"
          onClick={() => {
            onOpenChange(false);
            onToggleDesignPanel();
          }}
        >
          slides2DesignTokens.title
        </button>
      ) : null}
    </>
  ),
}));
vi.mock("@/components/slides-2-editor/Slides2Comments", () => ({
  Slides2Comments: ({ draftAnchor }: { draftAnchor: unknown }) => {
    sandboxCommentMocks.draftAnchor = draftAnchor;
    return null;
  },
}));
vi.mock("@/components/slides-2-editor/Slides2DesignTokens", () => ({
  Slides2DesignTokens: () => null,
}));
vi.mock("@/components/slides-2-editor/Slides2ExportMenu", () => ({
  Slides2ExportMenu: () => null,
}));
vi.mock("@/components/slides-2-editor/Slides2ImageCropControls", () => ({
  Slides2ImageCropControls: ({ src }: { src: string }) => (
    <div data-testid="mock-image-crop-controls" data-src={src} />
  ),
}));
vi.mock("@/components/slides-2-editor/Slides2Inspector", () => ({
  Slides2Inspector: ({
    selected,
    selectionCount,
    onArrange,
    onGroup,
    onUngroup,
    canUngroup,
  }: {
    selected: ElementSnapshot | null;
    selectionCount: number;
    onArrange: (direction: "front" | "forward" | "backward" | "back") => void;
    onGroup: () => void;
    onUngroup: () => void;
    canUngroup: boolean;
  }) => (
    <>
      <output data-testid="mock-selection-count">{selectionCount}</output>
      <output data-testid="mock-selected-text">{selected?.text ?? ""}</output>
      <output data-testid="mock-can-ungroup">{String(canUngroup)}</output>
      {editorMocks.showArrange && selected ? (
        <button
          type="button"
          data-testid="mock-bring-to-front"
          onClick={() => onArrange("front")}
        >
          Bring to front
        </button>
      ) : null}
      {selectionCount > 1 ? (
        <button type="button" onClick={onGroup}>
          styleInspector.group
        </button>
      ) : null}
      {canUngroup ? (
        <button type="button" onClick={onUngroup}>
          styleInspector.ungroup
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
      onKeyboard,
      className,
      onController,
      onNavigationInput,
      onStepCount,
      initialRevealedSteps,
      artifact,
      onError,
      onReady,
    }: {
      onNodes: (nodes: ElementSnapshot[]) => void;
      onPointer: (pointer: FramePointer) => void;
      onKeyboard?: (keyboard: FrameKeyboard) => void;
      className?: string;
      onController: (controller: SlideFrameController | null) => void;
      onNavigationInput?: (input: unknown) => void;
      onStepCount?: (stepCount: number) => void;
      initialRevealedSteps?: number | null;
      artifact: unknown;
      onError?: (message: string) => void;
      onReady?: () => void;
    }) => {
      sandboxPreviewMocks.initialRevealedSteps = initialRevealedSteps ?? null;
      sandboxPreviewMocks.onNavigationInput = onNavigationInput ?? null;
      sandboxPointerMocks.onPointer = onPointer;
      if (className === "absolute inset-0") {
        sandboxPreviewMocks.activeArtifact = artifact;
        sandboxPreviewMocks.activeOnError = onError ?? null;
        sandboxPreviewMocks.activeOnReady = onReady ?? null;
        sandboxPointerMocks.activeFramePointer = onPointer;
        sandboxKeyboardMocks.activeFrameKeyboard = onKeyboard ?? null;
      }
      const node: ElementSnapshot = {
        nodeId: "node-1",
        line: sandboxNodeMocks.line,
        column: sandboxNodeMocks.column,
        instanceIndex: 0,
        instanceCount: 1,
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
        instanceIndex: targetNode.instanceIndex ?? 0,
        instanceCount: targetNode.instanceCount ?? 1,
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

import { DEFAULT_SLIDE_RAIL_WIDTH, Slides2Editor } from "./Slides2Editor";

const createEditorProps = () => ({
  deckId: "deck-1",
  title: "Deck",
  onTitleChange: vi.fn(async () => {}),
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
  canPasteSlide: true,
  clipboardSourceSlideId: null,
  clipboardOperation: null,
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
  onCopySlide: vi.fn(),
  onCutSlide: vi.fn(),
  onPasteSlide: vi.fn(),
  onDeleteSlide: () => {},
  onMoveSlide: () => {},
});

function clickDeckTitleToEdit() {
  fireEvent.click(screen.getByRole("button", { name: "deckCard.rename" }));
  return screen.getByRole("textbox", { name: "deckCard.rename" });
}

function getInspectorHeaderButton(name: string) {
  const button = screen
    .getAllByRole("button", { name })
    .find((candidate) => candidate.closest("aside"));
  if (!button) throw new Error(`Expected inspector header button: ${name}`);
  return button;
}

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
    instanceIndex: 0,
    instanceCount: 1,
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

async function dragMockSlideObject() {
  fireEvent.click(await screen.findByTestId("mock-slide-object"));
  fireEvent.click(screen.getByTestId("mock-slide-pointer-move"));
  fireEvent.click(screen.getByTestId("mock-slide-pointer-up"));
}

function expectLastInspect(
  targets: Array<{ line: number; column: number; nodeId: string }>,
) {
  const inspections = frameControllerSend.mock.calls
    .map(([command]) => command as { type?: string; targets?: typeof targets })
    .filter((command) => command.type === "inspect");
  expect(inspections.at(-1)).toEqual({ type: "inspect", targets });
}

function createCrossSlideHistory(
  commit: ReturnType<
    typeof vi.fn<(entry: Omit<CrossSlideSourceCommitEntry, "type">) => void>
  >,
) {
  return {
    editBatches: [],
    historyIndex: 0,
    canUndo: false,
    canRedo: false,
    append: vi.fn(),
    undo: vi.fn(() => false),
    redo: vi.fn(() => false),
    commit,
    clear: vi.fn(),
    onSelectionApplied: vi.fn(),
  };
}

function currentEditorStatus() {
  return [...editorCommandMocks.appState.values()].find(
    (value): value is Record<string, unknown> =>
      Boolean(value) &&
      typeof value === "object" &&
      "sourceRevision" in (value as Record<string, unknown>),
  );
}

describe("Slides2Editor active source slide selection", () => {
  it("selects text reported by the active slide frame for the Format inspector", async () => {
    const sourceTsx = [
      "function Slide() {",
      "  return <h1>Active headline</h1>;",
      "}",
    ].join("\n");
    const headline = {
      ...sourceSnapshot(sourceTsx, "headline-node", "<h1>", {
        x: 120,
        y: 80,
        width: 520,
        height: 90,
      }),
      text: "Active headline",
    };
    sandboxNodeMocks.nodes = [headline];
    const props = createEditorProps();
    const { container } = render(
      <MemoryRouter>
        <Slides2Editor {...props} source={{ ...props.source, sourceTsx }} />
      </MemoryRouter>,
    );

    const activeStage = container.querySelector("[data-slides-2-stage-inner]");
    const activeFramePointer = sandboxPointerMocks.activeFramePointer;
    expect(activeStage).not.toBeNull();
    expect(activeFramePointer).toEqual(expect.any(Function));

    const target = {
      line: headline.line,
      column: headline.column,
      nodeId: headline.nodeId,
      snapshot: headline,
    };
    act(() => {
      activeFramePointer?.(framePointer("down", 121, 81, { target }));
      activeFramePointer?.(framePointer("up", 121, 81, { target }));
    });

    await waitFor(() => {
      expect(screen.getByTestId("mock-selected-text").textContent).toBe(
        "Active headline",
      );
      expectLastInspect([
        {
          line: headline.line,
          column: headline.column,
          nodeId: headline.nodeId,
        },
      ]);
    });
    expect(
      screen
        .getByRole("button", { name: "slides2Editor.format" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("hit-tests the canvas point when the frame reports no object target", async () => {
    const sourceTsx = [
      "function Slide() {",
      "  return (",
      '    <div style={{ position: "relative", width: "1920px", height: "1080px" }}>',
      "      <h1>Active headline</h1>",
      "    </div>",
      "  );",
      "}",
    ].join("\n");
    const headline = {
      ...sourceSnapshot(sourceTsx, "headline-node", "<h1>", {
        x: 120,
        y: 80,
        width: 520,
        height: 90,
      }),
      text: "Active headline",
    };
    const canvasRoot = sourceSnapshot(sourceTsx, "canvas-root", "<div style=", {
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
    sandboxNodeMocks.nodes = [canvasRoot, headline];
    const props = createEditorProps();
    render(
      <MemoryRouter>
        <Slides2Editor {...props} source={{ ...props.source, sourceTsx }} />
      </MemoryRouter>,
    );

    const activeFramePointer = sandboxPointerMocks.activeFramePointer;
    expect(activeFramePointer).toEqual(expect.any(Function));
    act(() => {
      activeFramePointer?.(framePointer("down", 121, 81));
      activeFramePointer?.(framePointer("up", 121, 81));
    });

    await waitFor(() => {
      expect(screen.getByTestId("mock-selected-text").textContent).toBe(
        "Active headline",
      );
      expectLastInspect([
        {
          line: headline.line,
          column: headline.column,
          nodeId: headline.nodeId,
        },
      ]);
    });

    act(() => {
      activeFramePointer?.(
        framePointer("down", 121, 81, {
          target: {
            line: canvasRoot.line,
            column: canvasRoot.column,
            nodeId: canvasRoot.nodeId,
            snapshot: canvasRoot,
          },
        }),
      );
      activeFramePointer?.(
        framePointer("up", 121, 81, {
          target: {
            line: canvasRoot.line,
            column: canvasRoot.column,
            nodeId: canvasRoot.nodeId,
            snapshot: canvasRoot,
          },
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("mock-selected-text").textContent).toBe(
        "Active headline",
      );
      expectLastInspect([
        {
          line: headline.line,
          column: headline.column,
          nodeId: headline.nodeId,
        },
      ]);
    });
  });

  it("uses the frame's topmost hit when an overlapping object is reported as the canvas", async () => {
    const sourceTsx = [
      "function Slide() {",
      "  return (",
      '    <div style={{ position: "relative", width: "1920px", height: "1080px" }}>',
      '      <section id="back">Back layer</section>',
      '      <aside id="front">Front layer</aside>',
      "    </div>",
      "  );",
      "}",
    ].join("\n");
    const rootTag =
      '<div style={{ position: "relative", width: "1920px", height: "1080px" }}>';
    const backTag = '<section id="back">';
    const frontTag = '<aside id="front">';
    const canvasRoot = sourceSnapshot(sourceTsx, "canvas-root", rootTag, {
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
    const back = {
      ...sourceSnapshot(sourceTsx, "back-layer", backTag, {
        x: 80,
        y: 70,
        width: 120,
        height: 90,
      }),
      text: "Back layer",
    };
    const front = {
      ...sourceSnapshot(sourceTsx, "front-layer", frontTag, {
        x: 50,
        y: 50,
        width: 260,
        height: 180,
      }),
      text: "Front layer",
    };
    sandboxNodeMocks.nodes = [canvasRoot, front, back];
    const props = createEditorProps();
    render(
      <MemoryRouter>
        <Slides2Editor {...props} source={{ ...props.source, sourceTsx }} />
      </MemoryRouter>,
    );

    const activeFramePointer = sandboxPointerMocks.activeFramePointer;
    const canvasTarget = {
      line: canvasRoot.line,
      column: canvasRoot.column,
      nodeId: canvasRoot.nodeId,
      snapshot: canvasRoot,
    };
    const topmostHit = {
      line: front.line,
      column: front.column,
      nodeId: front.nodeId,
      snapshot: front,
    };
    expect(activeFramePointer).toEqual(expect.any(Function));
    act(() => {
      activeFramePointer?.(
        framePointer("down", 100, 100, {
          target: canvasTarget,
          hitTarget: topmostHit,
        }),
      );
      activeFramePointer?.(
        framePointer("up", 100, 100, {
          target: canvasTarget,
          hitTarget: topmostHit,
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("mock-selected-text").textContent).toBe(
        "Front layer",
      );
      expectLastInspect([
        { line: front.line, column: front.column, nodeId: front.nodeId },
      ]);
    });
  });

  it("anchors a click comment to the topmost object when the frame reports the canvas", async () => {
    const sourceTsx = [
      "function Slide() {",
      "  return (",
      '    <div style={{ position: "relative", width: "1920px", height: "1080px" }}>',
      '      <aside id="front">Front layer</aside>',
      "    </div>",
      "  );",
      "}",
    ].join("\n");
    const rootTag =
      '<div style={{ position: "relative", width: "1920px", height: "1080px" }}>';
    const frontTag = '<aside id="front">';
    const canvasRoot = sourceSnapshot(sourceTsx, "canvas-root", rootTag, {
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
    const front = sourceSnapshot(sourceTsx, "front-layer", frontTag, {
      x: 50,
      y: 50,
      width: 260,
      height: 180,
    });
    sandboxNodeMocks.nodes = [canvasRoot, front];
    const props = createEditorProps();
    render(
      <MemoryRouter>
        <Slides2Editor {...props} source={{ ...props.source, sourceTsx }} />
      </MemoryRouter>,
    );

    fireEvent.keyDown(window, { key: "c" });
    const target = {
      line: canvasRoot.line,
      column: canvasRoot.column,
      nodeId: canvasRoot.nodeId,
      snapshot: canvasRoot,
    };
    const hitTarget = {
      line: front.line,
      column: front.column,
      nodeId: front.nodeId,
      snapshot: front,
    };
    act(() => {
      sandboxPointerMocks.activeFramePointer?.(
        framePointer("down", 100, 100, { target, hitTarget }),
      );
      sandboxPointerMocks.activeFramePointer?.(
        framePointer("up", 100, 100, { target, hitTarget }),
      );
    });

    await waitFor(() =>
      expect(sandboxCommentMocks.draftAnchor).toMatchObject({
        sourceHash: "a".repeat(64),
        sourceLocator: { line: front.line, column: front.column },
      }),
    );
    expect(sandboxCommentMocks.draftAnchor).toMatchObject({
      objectX: expect.closeTo(
        ((100 - front.bounds.x) / front.bounds.width) * 100,
      ),
      objectY: expect.closeTo(
        ((100 - front.bounds.y) / front.bounds.height) * 100,
      ),
    });
  });

  it.each(["null target", "full-slide root target"] as const)(
    "starts an object drag from the topmost hit when pointerdown reports a %s",
    async (reportedTargetKind) => {
      const sourceTsx = [
        "function Slide() {",
        "  return (",
        '    <div style={{ position: "relative", width: "1920px", height: "1080px" }}>',
        '      <section id="back">Back layer</section>',
        '      <aside id="front">Front layer</aside>',
        "    </div>",
        "  );",
        "}",
      ].join("\n");
      const rootTag =
        '<div style={{ position: "relative", width: "1920px", height: "1080px" }}>';
      const canvasRoot = sourceSnapshot(sourceTsx, "canvas-root", rootTag, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      });
      const back = {
        ...sourceSnapshot(sourceTsx, "back-layer", '<section id="back">', {
          x: 80,
          y: 70,
          width: 120,
          height: 90,
        }),
        text: "Back layer",
      };
      const front = {
        ...sourceSnapshot(sourceTsx, "front-layer", '<aside id="front">', {
          x: 50,
          y: 50,
          width: 260,
          height: 180,
        }),
        text: "Front layer",
      };
      sandboxNodeMocks.nodes = [canvasRoot, front, back];
      const props = createEditorProps();
      render(
        <MemoryRouter>
          <Slides2Editor {...props} source={{ ...props.source, sourceTsx }} />
        </MemoryRouter>,
      );

      const activeFramePointer = sandboxPointerMocks.activeFramePointer;
      const canvasTarget = {
        line: canvasRoot.line,
        column: canvasRoot.column,
        nodeId: canvasRoot.nodeId,
        snapshot: canvasRoot,
      };
      const topmostHit = {
        line: front.line,
        column: front.column,
        nodeId: front.nodeId,
        snapshot: front,
      };
      expect(activeFramePointer).toEqual(expect.any(Function));
      frameControllerSend.mockClear();
      act(() => {
        activeFramePointer?.(
          framePointer("down", 100, 100, {
            target:
              reportedTargetKind === "full-slide root target"
                ? canvasTarget
                : null,
            hitTarget: topmostHit,
            pointerId: 52,
          }),
        );
        activeFramePointer?.(
          framePointer("move", 120, 110, {
            altKey: true,
            pointerId: 52,
          }),
        );
        activeFramePointer?.(
          framePointer("up", 130, 120, {
            altKey: true,
            pointerId: 52,
          }),
        );
      });

      await waitFor(() => {
        expect(screen.getByTestId("mock-selected-text").textContent).toBe(
          "Front layer",
        );
        expect(frameControllerSend).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "preview",
            patches: [
              expect.objectContaining({
                line: front.line,
                column: front.column,
                styles: { translate: "30px 20px" },
              }),
            ],
          }),
        );
      });
    },
  );

  it("deletes the selected source object with Backspace", async () => {
    const sourceTsx = [
      "export default function Slide() {",
      "  return <h1>Delete me</h1>;",
      "}",
    ].join("\n");
    const headline = {
      ...sourceSnapshot(sourceTsx, "headline-node", "<h1>", {
        x: 120,
        y: 80,
        width: 520,
        height: 90,
      }),
      text: "Delete me",
    };
    sandboxNodeMocks.nodes = [headline];
    const props = createEditorProps();
    const onRestore = vi.fn(async (nextSourceTsx: string) => ({
      sourceTsx: nextSourceTsx,
      revision: 2,
      sourceHash: "b".repeat(64),
    }));
    const { container } = render(
      <MemoryRouter>
        <Slides2Editor
          {...props}
          source={{ ...props.source, sourceTsx }}
          onRestore={onRestore}
        />
      </MemoryRouter>,
    );
    const activeFramePointer = sandboxPointerMocks.activeFramePointer;
    const target = {
      line: headline.line,
      column: headline.column,
      nodeId: headline.nodeId,
      snapshot: headline,
    };
    act(() => {
      activeFramePointer?.(framePointer("down", 121, 81, { target }));
      activeFramePointer?.(framePointer("up", 121, 81, { target }));
    });

    await waitFor(() => {
      expect(screen.getByTestId("mock-selected-text").textContent).toBe(
        "Delete me",
      );
      expectLastInspect([
        {
          line: headline.line,
          column: headline.column,
          nodeId: headline.nodeId,
        },
      ]);
    });
    const activeFrameKeyboard = sandboxKeyboardMocks.activeFrameKeyboard;
    expect(activeFrameKeyboard).toEqual(expect.any(Function));
    act(() =>
      activeFrameKeyboard?.({
        key: "Backspace",
        keyCode: 8,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        isTypingTarget: false,
        isControlTarget: false,
        isComposing: false,
      }),
    );
    await waitFor(() => expect(onRestore).toHaveBeenCalledOnce());
    expect(onRestore.mock.calls[0]?.[0]).not.toContain("<h1>");
    expect(
      container.querySelector("[data-slides-2-stage-inner]"),
    ).not.toBeNull();
  });
});

describe("Slides2Editor object grouping", () => {
  it("persists selected objects as a group and selects the saved group", async () => {
    const sourceTsx = [
      "function Slide() {",
      "  return (",
      '    <div style={{ position: "relative", width: "1920px", height: "1080px" }}>',
      '      <div data-slide-object-id="object-a" style={{ position: "absolute", left: "20px", top: "30px", width: "100px", height: "80px" }} />',
      '      <div data-slide-object-id="object-b" style={{ position: "absolute", left: "150px", top: "30px", width: "100px", height: "80px" }} />',
      "    </div>",
      "  );",
      "}",
    ].join("\n");
    const objectATag =
      '<div data-slide-object-id="object-a" style={{ position: "absolute", left: "20px", top: "30px", width: "100px", height: "80px" }} />';
    const objectBTag =
      '<div data-slide-object-id="object-b" style={{ position: "absolute", left: "150px", top: "30px", width: "100px", height: "80px" }} />';
    const groupedSourceTsx = [
      "function Slide() {",
      "  return (",
      '    <div style={{ position: "relative", width: "1920px", height: "1080px" }}>',
      '      <div className="fmd-slide-group" data-slide-group="true" data-slide-object-id="group-1" style={{ position: "absolute", left: "20px", top: "30px", width: "230px", height: "80px" }}>',
      '        <div data-slide-object-id="object-a" style={{ position: "absolute", left: "0px", top: "0px", width: "100px", height: "80px" }} />',
      '        <div data-slide-object-id="object-b" style={{ position: "absolute", left: "130px", top: "0px", width: "100px", height: "80px" }} />',
      "      </div>",
      "    </div>",
      "  );",
      "}",
    ].join("\n");
    const groupedTag =
      '<div className="fmd-slide-group" data-slide-group="true" data-slide-object-id="group-1" style={{ position: "absolute", left: "20px", top: "30px", width: "230px", height: "80px" }}>';
    const hash = "b".repeat(64);
    const props = createEditorProps();
    const commit =
      vi.fn<(entry: Omit<CrossSlideSourceCommitEntry, "type">) => void>();
    const history = createCrossSlideHistory(commit);
    const objectA = sourceSnapshot(sourceTsx, "object-a-node", objectATag, {
      x: 20,
      y: 30,
      width: 100,
      height: 80,
    });
    const objectB = sourceSnapshot(sourceTsx, "object-b-node", objectBTag, {
      x: 150,
      y: 30,
      width: 100,
      height: 80,
    });
    sandboxNodeMocks.nodes = [objectA, objectB];
    transformSlideObjectsMocks.mutateAsync.mockImplementation(async () => {
      expect(
        editorCommandMocks.appState.get(
          "slides-2:slides-selection:slides-2-editor-layout-test",
        ),
      ).toMatchObject({
        deckId: "deck-1",
        slideId: "slide-1",
        sourceRevision: 1,
        sourceHash: "a".repeat(64),
        items: [
          {
            sourceLine: objectA.line,
            sourceColumn: objectA.column,
            instanceIndex: 0,
            instanceCount: 1,
          },
          {
            sourceLine: objectB.line,
            sourceColumn: objectB.column,
            instanceIndex: 0,
            instanceCount: 1,
          },
        ],
      });
      return {
        sourceTsx: groupedSourceTsx,
        revision: 2,
        sourceHash: hash,
        operation: "group",
        targetCount: 2,
        createdObjectId: "group-1",
      };
    });
    const view = render(
      <MemoryRouter>
        <Slides2Editor
          {...props}
          source={{ ...props.source, sourceTsx }}
          crossSlideHistory={history}
        />
      </MemoryRouter>,
    );

    pointerClick(objectA);
    pointerClick(objectB, { shiftKey: true });
    expect(screen.getByTestId("mock-selection-count").textContent).toBe("2");
    fireEvent.click(
      screen.getByRole("button", { name: "styleInspector.group" }),
    );

    await waitFor(() => {
      expect(transformSlideObjectsMocks.mutateAsync).toHaveBeenCalledWith({
        deckId: "deck-1",
        slideId: "slide-1",
        expectedRevision: 1,
        expectedSourceHash: "a".repeat(64),
        operation: {
          op: "group",
          targets: [
            { line: objectA.line, column: objectA.column },
            { line: objectB.line, column: objectB.column },
          ],
        },
      });
      expect(commit).toHaveBeenCalledWith(
        expect.objectContaining({
          beforeSourceTsx: sourceTsx,
          beforeSourceHash: "a".repeat(64),
          afterSourceTsx: groupedSourceTsx,
          afterSourceHash: hash,
        }),
      );
      expect(currentEditorStatus()).toMatchObject({
        sourceRevision: 2,
        sourceHash: hash,
      });
    });

    const savedGroup = sourceSnapshot(
      groupedSourceTsx,
      "group-node",
      groupedTag,
      { x: 20, y: 30, width: 230, height: 80 },
    );
    sandboxNodeMocks.nodes = [savedGroup];
    view.rerender(
      <MemoryRouter>
        <Slides2Editor
          {...props}
          source={{
            ...props.source,
            sourceTsx: groupedSourceTsx,
            revision: 2,
            sourceHash: hash,
          }}
          artifact={{ ...props.artifact, revision: 2, sourceHash: hash }}
          crossSlideHistory={history}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("mock-selection-count").textContent).toBe("1");
      expectLastInspect([
        {
          line: savedGroup.line,
          column: savedGroup.column,
          nodeId: "group-node",
        },
      ]);
    });
  });

  it("hides Ungroup when a group contains a non-object JSX child", () => {
    const groupedSourceTsx = [
      "function Slide() {",
      "  return (",
      '    <div style={{ position: "relative", width: "1920px", height: "1080px" }}>',
      '      <div className="fmd-slide-group" data-slide-group="true" data-slide-object-id="group-1" style={{ position: "absolute", left: "20px", top: "30px", width: "230px", height: "80px" }}>',
      '        <div data-slide-object-id="object-a" style={{ position: "absolute", left: "0px", top: "0px", width: "100px", height: "80px" }} />',
      "        {/* Unsupported JSX child */}",
      '        <div data-slide-object-id="object-b" style={{ position: "absolute", left: "130px", top: "0px", width: "100px", height: "80px" }} />',
      "      </div>",
      "    </div>",
      "  );",
      "}",
    ].join("\n");
    const groupTag =
      '<div className="fmd-slide-group" data-slide-group="true" data-slide-object-id="group-1" style={{ position: "absolute", left: "20px", top: "30px", width: "230px", height: "80px" }}>';
    const props = createEditorProps();
    const selectedGroup = sourceSnapshot(
      groupedSourceTsx,
      "group-node",
      groupTag,
      { x: 20, y: 30, width: 230, height: 80 },
    );
    sandboxNodeMocks.nodes = [selectedGroup];

    render(
      <MemoryRouter>
        <Slides2Editor
          {...props}
          source={{ ...props.source, sourceTsx: groupedSourceTsx }}
        />
      </MemoryRouter>,
    );

    pointerClick(selectedGroup);

    expect(screen.getByTestId("mock-can-ungroup").textContent).toBe("false");
    expect(
      screen.queryByRole("button", { name: "styleInspector.ungroup" }),
    ).toBeNull();
  });

  it("persists ungrouping and restores selection to the saved child objects", async () => {
    const groupedSourceTsx = [
      "function Slide() {",
      "  return (",
      '    <div style={{ position: "relative", width: "1920px", height: "1080px" }}>',
      '      <div className="fmd-slide-group" data-slide-group="true" data-slide-object-id="group-1" style={{ position: "absolute", left: "20px", top: "30px", width: "230px", height: "80px" }}>',
      '        <div data-slide-object-id="object-a" style={{ position: "absolute", left: "0px", top: "0px", width: "100px", height: "80px" }} />',
      '        <div data-slide-object-id="object-b" style={{ position: "absolute", left: "130px", top: "0px", width: "100px", height: "80px" }} />',
      "      </div>",
      "    </div>",
      "  );",
      "}",
    ].join("\n");
    const groupTag =
      '<div className="fmd-slide-group" data-slide-group="true" data-slide-object-id="group-1" style={{ position: "absolute", left: "20px", top: "30px", width: "230px", height: "80px" }}>';
    const ungroupedSourceTsx = [
      "function Slide() {",
      "  return (",
      '    <div style={{ position: "relative", width: "1920px", height: "1080px" }}>',
      '      <div data-slide-object-id="object-a" style={{ position: "absolute", left: "70px", top: "70px", width: "100px", height: "80px" }} />',
      '      <div data-slide-object-id="object-b" style={{ position: "absolute", left: "200px", top: "70px", width: "100px", height: "80px" }} />',
      "    </div>",
      "  );",
      "}",
    ].join("\n");
    const objectATag =
      '<div data-slide-object-id="object-a" style={{ position: "absolute", left: "70px", top: "70px", width: "100px", height: "80px" }} />';
    const objectBTag =
      '<div data-slide-object-id="object-b" style={{ position: "absolute", left: "200px", top: "70px", width: "100px", height: "80px" }} />';
    const hash = "c".repeat(64);
    const props = createEditorProps();
    const commit =
      vi.fn<(entry: Omit<CrossSlideSourceCommitEntry, "type">) => void>();
    const history = createCrossSlideHistory(commit);
    const selectedGroup = sourceSnapshot(
      groupedSourceTsx,
      "group-node",
      groupTag,
      { x: 20, y: 30, width: 230, height: 80 },
    );
    sandboxNodeMocks.nodes = [selectedGroup];
    transformSlideObjectsMocks.mutateAsync.mockResolvedValue({
      sourceTsx: ungroupedSourceTsx,
      revision: 2,
      sourceHash: hash,
      operation: "ungroup",
      targetCount: 2,
    });
    const view = render(
      <MemoryRouter>
        <Slides2Editor
          {...props}
          source={{ ...props.source, sourceTsx: groupedSourceTsx }}
          crossSlideHistory={history}
        />
      </MemoryRouter>,
    );

    pointerClick(selectedGroup);
    expect(screen.getByTestId("mock-selection-count").textContent).toBe("1");
    expect(screen.getByTestId("mock-can-ungroup").textContent).toBe("true");
    expect(
      screen.getByRole("button", { name: "styleInspector.ungroup" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "styleInspector.ungroup" }),
    );

    await waitFor(() => {
      expect(transformSlideObjectsMocks.mutateAsync).toHaveBeenCalledWith({
        deckId: "deck-1",
        slideId: "slide-1",
        expectedRevision: 1,
        expectedSourceHash: "a".repeat(64),
        operation: {
          op: "ungroup",
          target: { line: selectedGroup.line, column: selectedGroup.column },
        },
      });
      expect(commit).toHaveBeenCalledWith(
        expect.objectContaining({
          beforeSourceTsx: groupedSourceTsx,
          afterSourceTsx: ungroupedSourceTsx,
          afterSourceHash: hash,
        }),
      );
      expect(currentEditorStatus()).toMatchObject({
        sourceRevision: 2,
        sourceHash: hash,
      });
    });

    const objectA = sourceSnapshot(
      ungroupedSourceTsx,
      "object-a-node",
      objectATag,
      {
        x: 70,
        y: 70,
        width: 100,
        height: 80,
      },
    );
    const objectB = sourceSnapshot(
      ungroupedSourceTsx,
      "object-b-node",
      objectBTag,
      {
        x: 200,
        y: 70,
        width: 100,
        height: 80,
      },
    );
    sandboxNodeMocks.nodes = [objectA, objectB];
    view.rerender(
      <MemoryRouter>
        <Slides2Editor
          {...props}
          source={{
            ...props.source,
            sourceTsx: ungroupedSourceTsx,
            revision: 2,
            sourceHash: hash,
          }}
          artifact={{ ...props.artifact, revision: 2, sourceHash: hash }}
          crossSlideHistory={history}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("mock-selection-count").textContent).toBe("2");
      expectLastInspect([
        { line: objectA.line, column: objectA.column, nodeId: "object-a-node" },
        { line: objectB.line, column: objectB.column, nodeId: "object-b-node" },
      ]);
    });
  });
});

describe("Slides2Editor shell layout", () => {
  it("shows source-only canvas render failures when the static preview is empty", () => {
    const props = createEditorProps();
    const sourceOnlyArtifact = {
      ...props.artifact,
      html: "",
      runtime: {
        kind: "agent-native-slides-react-worker-v1" as const,
        workerSource: "self.onmessage = () => {};",
        page: { current: 1, total: 1 },
        assetUrls: {},
        styles: [],
        timeoutMs: 2500 as const,
      },
    };

    render(
      <MemoryRouter>
        <Slides2Editor {...props} artifact={sourceOnlyArtifact} />
      </MemoryRouter>,
    );

    expect(sandboxPreviewMocks.activeArtifact).toMatchObject({
      html: "",
      runtime: { workerSource: "self.onmessage = () => {};" },
    });
    expect(sandboxPreviewMocks.activeOnError).toEqual(expect.any(Function));

    act(() => {
      sandboxPreviewMocks.activeOnError?.(
        "Slide source could not be rendered.",
      );
    });

    expect(screen.getByRole("alert").textContent).toBe(
      "Slide source could not be rendered.",
    );

    act(() => sandboxPreviewMocks.activeOnReady?.());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("uses the measured canvas inset at desktop widths", () => {
    const { container } = render(
      <MemoryRouter>
        <Slides2Editor {...createEditorProps()} />
      </MemoryRouter>,
    );

    const stageSurface = container.querySelector(
      "[data-slides-2-stage-surface]",
    );
    const canvasViewport = container.querySelector(
      "[data-slides-2-stage-viewport]",
    );
    expect(stageSurface?.className).toContain("rounded-xl");
    expect(stageSurface?.className).toContain("border-border");
    expect(stageSurface?.className).toContain(
      "bg-[hsl(var(--slides2-stage-backdrop))]",
    );
    expect(stageSurface?.parentElement?.className).toContain(
      "bg-[hsl(var(--surface))]",
    );
    expect(canvasViewport?.className).toContain("lg:ps-10");
    expect(canvasViewport?.className).toContain("lg:pe-10");
    expect(canvasViewport?.className).toContain("lg:pt-5");
  });

  it("keeps a long deck title on its own row until the toolbar has room", () => {
    agentConnectionMocks.state = "configured";
    const props = createEditorProps();
    props.title = "Northstar | Align work. Ship with confidence.";
    const originalGetBoundingClientRect =
      HTMLElement.prototype.getBoundingClientRect;
    const measureTitle = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.hasAttribute("data-slides2-title-measure")) {
          return {
            x: 0,
            y: 0,
            width: 360,
            height: 16,
            top: 0,
            right: 360,
            bottom: 16,
            left: 0,
            toJSON: () => ({}),
          } as DOMRect;
        }
        return originalGetBoundingClientRect.call(this);
      });
    const { container } = render(
      <MemoryRouter>
        <Slides2Editor {...props} />
      </MemoryRouter>,
    );
    measureTitle.mockRestore();

    const header = container.querySelector("header");
    const [leftControls, title, rightControls] = Array.from(
      header?.children ?? [],
    );

    expect(container.firstElementChild?.className).toContain(
      "@container/editor-header",
    );
    expect(header?.className).toContain(
      "@min-[72rem]/editor-header:grid-cols-[auto_minmax(0,1fr)_auto]",
    );
    expect(title?.className).toContain("col-span-2");
    expect(title?.className).toContain("max-w-full");
    expect(title?.className).toContain(
      "@min-[72rem]/editor-header:max-w-[min(40vw,48rem)]",
    );
    expect(title?.className).toContain(
      "@min-[72rem]/editor-header:justify-self-center",
    );
    expect(title?.className).toContain("text-[13.5px]");
    expect(title?.className).toContain("font-semibold");
    expect(title?.className).toContain("tracking-[-0.01em]");
    const measuredTitle = container.querySelector(
      "[data-slides2-title-measure]",
    );
    expect(measuredTitle?.className).toContain("text-[13.5px]");
    expect(measuredTitle?.className).toContain("font-semibold");
    expect(measuredTitle?.className).toContain("tracking-[-0.01em]");
    expect(title?.className).not.toContain("translate-x-[52px]");
    expect(
      leftControls?.querySelector('[data-agent-connection-status="configured"]')
        ?.textContent,
    ).toContain("Agent connected");
    expect(rightControls?.className).toContain(
      "@min-[72rem]/editor-header:flex-nowrap",
    );
    expect((title as HTMLButtonElement | null)?.textContent).toBe(props.title);
    expect((title as HTMLButtonElement | null)?.title).toBe(props.title);
    expect((title as HTMLButtonElement | null)?.style.width).toBe("376px");
    expect(
      rightControls?.querySelector('[href="/deck/deck-1/present"]'),
    ).not.toBeNull();
  });

  it("gives the Slides and Assets switcher balanced spacing", () => {
    render(
      <MemoryRouter>
        <Slides2Editor {...createEditorProps()} />
      </MemoryRouter>,
    );

    const slideSwitcher = screen.getByRole("group", { name: "header.slides" });
    const [activeSlideTab, assetsTab] = Array.from(slideSwitcher.children);
    expect(slideSwitcher.parentElement?.className).toContain("gap-2");
    const backLink = screen.getByRole("link", {
      name: "editorToolbar.backToDecks",
    });
    expect(backLink.className).toContain("size-7");
    const divider = slideSwitcher.parentElement?.querySelector(
      '[data-orientation="vertical"]',
    );
    expect(divider?.className).toContain("h-5");
    expect(divider?.className).toContain("w-[1px]");
    expect(activeSlideTab?.className).toContain("h-6");
    expect(activeSlideTab?.className).toContain("px-2.5");
    expect(assetsTab?.className).toContain("px-2.5");
  });

  it("shows the Design shortcut only when it is available", () => {
    render(
      <MemoryRouter>
        <Slides2Editor {...createEditorProps()} />
      </MemoryRouter>,
    );

    const designButton = screen.getByRole("button", {
      name: "slides2Editor.design",
    });

    expect(designButton.querySelector("kbd")?.textContent ?? null).toBe(
      import.meta.env.DEV ? "D" : null,
    );
  });

  it("groups Design and Format into a compact header control", () => {
    render(
      <MemoryRouter>
        <Slides2Editor {...createEditorProps()} />
      </MemoryRouter>,
    );

    const panelModes = screen.getByRole("group", { name: "header.tool" });

    expect(panelModes.className).toContain("rounded-md");
    expect(panelModes.className).toContain("p-0.5");
    expect(
      within(panelModes).getByRole("button", { name: "slides2Editor.design" }),
    ).toBeTruthy();
    expect(
      within(panelModes).getByRole("button", { name: "slides2Editor.format" }),
    ).toBeTruthy();
    expect(within(panelModes).getAllByRole("button")).toHaveLength(2);
  });

  it("keeps the Present split button compact and marks it for reference styling", () => {
    render(
      <MemoryRouter>
        <Slides2Editor {...createEditorProps()} />
      </MemoryRouter>,
    );

    const presentLink = screen.getByRole("link", {
      name: "editorToolbar.present",
    });
    const presentMenuButton = screen.getByRole("button", {
      name: "editorToolbar.more",
    });

    expect(presentLink.getAttribute("data-slides2-present")).toBe("true");
    expect(presentLink.className).toContain("h-7");
    expect(presentLink.className).toContain("px-2.5");
    expect(presentMenuButton.getAttribute("data-slides2-present")).toBe("true");
    expect(presentMenuButton.className).toContain("w-6");

    const presentRule = editorStyles.match(
      /\[data-slides2-editor\]\s+\[data-slides2-present\]\s*\{([^}]*)\}/,
    )?.[1];
    const editorRule = editorStyles.match(
      /\[data-slides2-editor\]\s*\{([^}]*)\}/,
    )?.[1];

    expect(editorRule).toMatch(/--slides2-present:\s*oklch\(0\.6 0\.2 25\)/);
    expect(presentRule).toMatch(/background-color:\s*var\(--slides2-present\)/);
  });

  it("matches the reference inspector width without shrinking the slide stage", () => {
    render(
      <MemoryRouter>
        <Slides2Editor {...createEditorProps()} inspectorOpen />
      </MemoryRouter>,
    );

    const inspector = getInspectorHeaderButton(
      "slides2Editor.hideInspector",
    ).closest("aside");
    const workspace = inspector?.parentElement;
    const slideRail = workspace?.querySelector(":scope > aside");
    const main = workspace?.querySelector(":scope > main");

    expect(inspector?.className).toContain("w-80");
    expect(workspace?.className).not.toContain("gap-2");
    expect(slideRail?.className).not.toContain("me-2");
    expect(DEFAULT_SLIDE_RAIL_WIDTH).toBe(264);
    expect(main?.className).toContain("ps-2");
    expect(main?.className).toContain("pe-2");
  });

  it("keeps the footer compact and leaves inspector collapse available", () => {
    const props = createEditorProps();
    render(
      <MemoryRouter>
        <Slides2Editor {...props} />
      </MemoryRouter>,
    );

    const footer = screen
      .getByRole("button", { name: "presentation.speakerNotes" })
      .closest("footer");
    expect(screen.getByText("slides2Editor.footerNotes")).toBeTruthy();
    expect(footer?.className).toContain("h-9");
    expect(footer?.className).not.toContain("border-t");
    expect(footer?.children).toHaveLength(2);
    expect(footer?.textContent).toContain("page 1/1");
    expect(
      within(footer!).getByRole("button", {
        name: "slides2Editor.hideInspector",
      }),
    ).toBeTruthy();

    fireEvent.click(
      within(footer!).getByRole("button", {
        name: "slides2Editor.hideInspector",
      }),
    );
    expect(
      within(footer!).getByRole("button", {
        name: "slides2Editor.showInspector",
      }),
    ).toBeTruthy();
  });

  it("keeps slide navigation in the rail", () => {
    const props = createEditorProps();
    const onSelectSlide = vi.fn();
    const { container } = render(
      <MemoryRouter>
        <Slides2Editor
          {...props}
          slides={[...props.slides, { id: "slide-2", slideNumber: 2 }]}
          onSelectSlide={onSelectSlide}
        />
      </MemoryRouter>,
    );

    const secondSlide = container.querySelector<HTMLElement>(
      '[data-slides-2-thumbnail-index="1"]',
    );
    expect(secondSlide).not.toBeNull();
    if (!secondSlide) throw new Error("Expected the second slide rail item");
    const row = secondSlide.closest<HTMLElement>("[data-slide-thumbnail-row]");
    expect(row?.parentElement?.className).toContain("block w-full");
    fireEvent.click(secondSlide);
    expect(onSelectSlide).toHaveBeenCalledWith(1);
  });

  it("uses the current theme for its editor chrome", () => {
    const { container } = render(
      <MemoryRouter>
        <Slides2Editor {...createEditorProps()} />
      </MemoryRouter>,
    );

    const header = container.querySelector("header");
    const editorRoot = header?.parentElement;
    const slideList = container.querySelector("#slides-2-slide-list");
    const slideRail = slideList?.closest("aside");
    const canvasWorkspace = container.querySelector("main");
    const [leftControls, title, rightControls] = Array.from(
      header?.children ?? [],
    );

    expect(header?.children).toHaveLength(3);
    expect(editorRoot?.classList.contains("dark")).toBe(false);
    expect(title?.getAttribute("aria-label")).toBe("deckCard.rename");
    expect((title as HTMLButtonElement | null)?.textContent).toBe("Deck");
    expect(title?.className).toContain("justify-self-center");
    expect(
      leftControls?.querySelector('[aria-label="editorToolbar.backToDecks"]'),
    ).toBeTruthy();
    expect(
      rightControls?.querySelector('a[href="/deck/deck-1/present"]'),
    ).toBeTruthy();
    expect(
      rightControls?.querySelector('[aria-label="slides2Editor.preview"]'),
    ).toBeTruthy();
    expect(
      rightControls?.querySelectorAll('[data-orientation="vertical"]'),
    ).toHaveLength(2);
    const viewModes = rightControls?.querySelector(
      '[role="group"][aria-label="editorToolbar.preview"]',
    );
    expect(viewModes?.className).toContain("h-8");
    expect(viewModes?.className).toContain("rounded-lg");
    expect(viewModes?.className).toContain("bg-muted/70");
    expect(
      Array.from(viewModes?.querySelectorAll("button") ?? []).every(
        (button) =>
          button.className.includes("h-full") &&
          button.className.includes("w-8"),
      ),
    ).toBe(true);
    expect(header?.className).toContain("bg-[hsl(var(--surface))]");
    expect(header?.className).toContain("border-[hsl(var(--sidebar-border))]");
    expect(slideRail?.className).toContain("bg-[hsl(var(--surface))]");
    expect(slideList?.className).toContain("px-3");
    expect(slideList?.className).toContain("pt-0");
    expect(slideList?.className).toContain("pb-2");
    expect(slideList?.className).toContain(
      "border-[hsl(var(--sidebar-border))]",
    );
    expect(slideList?.children[0]?.className).toContain("mb-2");
    expect(canvasWorkspace?.className).toContain("bg-[hsl(var(--surface))]");
    expect(slideList?.querySelector("span")?.textContent).toBe(
      "editorSidebar.pages",
    );
    expect(
      slideList?.querySelector('[data-slide-rail-count="true"]')?.textContent,
    ).toBe("01");
    expect(
      slideList?.querySelector('[data-slide-thumbnail-number="true"]')
        ?.textContent,
    ).toBe("01");
    expect(
      screen
        .getByRole("button", { name: "presentation.speakerNotes" })
        .closest("footer"),
    ).not.toBeNull();
    expect(
      slideRail?.querySelector('[aria-label="presentation.speakerNotes"]'),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "slides2Presenter.overview" }),
    ).toBeTruthy();
  });

  it("saves the deck title when the title input loses focus", async () => {
    const props = createEditorProps();
    const view = render(
      <MemoryRouter>
        <Slides2Editor {...props} />
      </MemoryRouter>,
    );

    expect(
      screen
        .getByRole("button", { name: "deckCard.rename" })
        .getAttribute("data-slot"),
    ).toBe("button");
    const titleInput = clickDeckTitleToEdit();
    expect(titleInput.getAttribute("data-slot")).toBe("input");
    await waitFor(() => expect(document.activeElement).toBe(titleInput));
    fireEvent.change(titleInput, { target: { value: "  Updated deck  " } });
    await act(async () => fireEvent.blur(titleInput));

    expect(props.onTitleChange).toHaveBeenCalledWith("Updated deck");
    await act(async () => {
      await props.onTitleChange.mock.results[0]?.value;
    });
    view.rerender(
      <MemoryRouter>
        <Slides2Editor {...props} title="Updated deck" />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "deckCard.rename" }).textContent,
      ).toBe("Updated deck"),
    );
  });

  it("commits the title with Enter and cancels the draft with Escape", async () => {
    const props = createEditorProps();
    const view = render(
      <MemoryRouter>
        <Slides2Editor {...props} />
      </MemoryRouter>,
    );

    const titleInput = clickDeckTitleToEdit();
    titleInput.focus();
    fireEvent.change(titleInput, { target: { value: "Renamed by Enter" } });
    fireEvent.keyDown(titleInput, { key: "Enter" });

    expect(props.onTitleChange).toHaveBeenCalledWith("Renamed by Enter");
    await act(async () => {
      await props.onTitleChange.mock.results[0]?.value;
    });
    view.rerender(
      <MemoryRouter>
        <Slides2Editor {...props} title="Renamed by Enter" />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "deckCard.rename" }).textContent,
      ).toBe("Renamed by Enter"),
    );

    const reopenedInput = clickDeckTitleToEdit();
    reopenedInput.focus();
    fireEvent.change(reopenedInput, {
      target: { value: "Discard this draft" },
    });
    fireEvent.keyDown(reopenedInput, { key: "Escape" });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "deckCard.rename" }).textContent,
      ).toBe("Renamed by Enter"),
    );
    expect(props.onTitleChange).toHaveBeenCalledTimes(1);
  });

  it("keeps title renaming disabled without permission or during structural saves", () => {
    const props = createEditorProps();
    const view = render(
      <MemoryRouter>
        <Slides2Editor {...props} canEdit={false} />
      </MemoryRouter>,
    );
    const readOnlyTitle = screen.getByRole("button", {
      name: "deckCard.rename",
    });
    expect((readOnlyTitle as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(readOnlyTitle);
    expect(
      screen.queryByRole("textbox", { name: "deckCard.rename" }),
    ).toBeNull();

    view.rerender(
      <MemoryRouter>
        <Slides2Editor {...props} />
      </MemoryRouter>,
    );
    const titleInput = clickDeckTitleToEdit();
    fireEvent.change(titleInput, { target: { value: "Do not save" } });
    view.rerender(
      <MemoryRouter>
        <Slides2Editor {...props} structuralSaving />
      </MemoryRouter>,
    );
    expect((titleInput as HTMLInputElement).disabled).toBe(true);
    fireEvent.blur(titleInput);
    expect(props.onTitleChange).not.toHaveBeenCalled();
  });

  it("copies and pastes a slide from its page menu", async () => {
    const props = createEditorProps();
    render(
      <MemoryRouter>
        <Slides2Editor {...props} />
      </MemoryRouter>,
    );

    const slide = document.querySelector<HTMLElement>(
      '[data-slides-2-thumbnail-index="0"]',
    );
    expect(slide).not.toBeNull();
    if (!slide) throw new Error("Expected the first slide rail item");
    fireEvent.contextMenu(slide, { button: 2 });
    fireEvent.click(await screen.findByRole("menuitem", { name: /copy/i }));
    fireEvent.contextMenu(slide, { button: 2 });
    fireEvent.click(await screen.findByRole("menuitem", { name: /paste/i }));

    expect(props.onCopySlide).toHaveBeenCalledWith("slide-1");
    expect(props.onPasteSlide).toHaveBeenCalledWith("slide-1");
  });

  it("cuts a slide from its page menu", async () => {
    const props = createEditorProps();
    props.slides = [...props.slides, { id: "slide-2", slideNumber: 2 }];
    render(
      <MemoryRouter>
        <Slides2Editor {...props} />
      </MemoryRouter>,
    );

    const slide = document.querySelector<HTMLElement>(
      '[data-slides-2-thumbnail-index="0"]',
    );
    expect(slide).not.toBeNull();
    if (!slide) throw new Error("Expected the first slide rail item");
    fireEvent.contextMenu(slide, { button: 2 });
    fireEvent.click(await screen.findByRole("menuitem", { name: /cut/i }));

    expect(props.onCutSlide).toHaveBeenCalledWith("slide-1");
  });

  it("keeps the page rail to a number and thumbnail without a title caption", () => {
    const props = createEditorProps();
    const slides: Array<{
      id: string;
      slideNumber: number;
      textPreview?: string;
    }> = [
      {
        id: "slide-1",
        slideNumber: 1,
        textPreview: "This slide text should not add a caption",
      },
      { id: "slide-2", slideNumber: 2 },
    ];
    render(
      <MemoryRouter>
        <Slides2Editor {...props} slides={slides} />
      </MemoryRouter>,
    );

    const thumbnailButton = document.querySelector<HTMLElement>(
      '[data-slides-2-thumbnail-index="0"]',
    );
    const unselectedThumbnailButton = document.querySelector<HTMLElement>(
      '[data-slides-2-thumbnail-index="1"]',
    );
    const resizeSeparator = screen.getByRole("separator", {
      name: "editorToolbar.resizeSlideList",
    });
    expect(resizeSeparator.getAttribute("aria-valuenow")).toBe(
      String(DEFAULT_SLIDE_RAIL_WIDTH),
    );
    expect(thumbnailButton).not.toBeNull();
    if (!thumbnailButton)
      throw new Error("Expected the first slide thumbnail button");
    const row = thumbnailButton.parentElement?.parentElement;
    expect(row).not.toBeNull();
    if (!row) throw new Error("Expected the first slide rail row");
    expect(row.parentElement?.className).toContain("mb-2");
    const [number, preview] = Array.from(row.children);
    const thumbnail = thumbnailButton.querySelector(".aspect-video");

    expect(
      screen
        .getByText("editorSidebar.pages")
        .parentElement?.parentElement?.querySelector(
          '[data-slide-rail-count="true"]',
        )?.textContent,
    ).toBe("02");
    expect(number?.getAttribute("data-slide-thumbnail-number")).toBe("true");
    expect(number?.textContent).toBe("01");
    expect(number?.className).toContain("text-destructive");
    expect(row.className).toContain("pe-0.5");
    expect(row.className).toContain("py-1.5");
    expect(row.className).toContain("flex");
    expect(row.className).toContain("bg-accent/60");
    expect(row.className).not.toContain("hover:bg-accent/50");
    expect(preview?.className).toContain("flex-1");
    expect(thumbnailButton.className).toContain("block");
    expect(thumbnailButton.className).toContain("h-auto");
    expect(thumbnailButton.className).toContain("w-full");
    expect(thumbnail?.className).toContain("w-full");
    expect(thumbnail?.className).toContain("aspect-video");
    expect(thumbnail?.className).toContain("max-w-[184px]");
    expect(thumbnail?.className).toContain("bg-muted");
    expect(thumbnail?.className).toContain("border");
    expect(thumbnail?.className).toContain("border-destructive");
    expect(thumbnail?.className).not.toContain("bg-white");
    expect(unselectedThumbnailButton).not.toBeNull();
    if (!unselectedThumbnailButton)
      throw new Error("Expected the second slide thumbnail button");
    const unselectedThumbnail =
      unselectedThumbnailButton.querySelector(".aspect-video");
    expect(unselectedThumbnail?.className).toContain("bg-muted");
    expect(unselectedThumbnail?.className).toContain("border-border/70");
    expect(unselectedThumbnail?.className).not.toContain("bg-white");
    expect(thumbnailButton.getAttribute("aria-current")).toBe("true");
    expect(unselectedThumbnailButton.getAttribute("aria-current")).toBeNull();
    expect(row.children).toHaveLength(2);
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
    ).toBe("false");
    expect(sandboxPreviewMocks.initialRevealedSteps).toBe(0);
    expect(
      screen.getByRole("button", { name: "slides2Editor.format" }),
    ).toBeTruthy();
    const formatButton = screen.getByRole("button", {
      name: "slides2Editor.format",
    });
    fireEvent.click(formatButton);
    expect(formatButton.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(getInspectorHeaderButton("slides2Editor.hideInspector"));
    expect(formatButton.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByTestId("mock-preview-click"));
    expect(frameControllerSend).toHaveBeenCalledWith({
      type: "set-revealed-steps",
      revealedSteps: 1,
    });

    fireEvent.keyDown(window, { key: "i" });
    expect(
      getInspectorHeaderButton("slides2Editor.hideInspector"),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "slides2Editor.edit" }));
    expect(sandboxPreviewMocks.initialRevealedSteps).toBeNull();
    expect(
      screen.getByRole("button", { name: "slides2Editor.preview" }),
    ).toBeTruthy();
  });

  it("switches editor modes and comment mode with V, E, and C", () => {
    render(
      <MemoryRouter>
        <Slides2Editor {...createEditorProps()} />
      </MemoryRouter>,
    );

    const preview = () =>
      screen.getByRole("button", {
        name: "slides2Editor.preview",
      });
    const edit = () =>
      screen.getByRole("button", {
        name: "slides2Editor.edit",
      });
    const comment = () =>
      screen.getByRole("button", {
        name: "comments.addComment",
      });

    fireEvent.keyDown(window, { key: "v" });
    expect(preview().getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(window, { key: "v" });
    expect(preview().getAttribute("aria-pressed")).toBe("true");

    fireEvent.keyDown(window, { key: "c" });
    expect(edit().getAttribute("aria-pressed")).toBe("true");
    expect(comment().getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(window, { key: "c" });
    expect(comment().getAttribute("aria-pressed")).toBe("false");

    fireEvent.keyDown(window, { key: "v" });
    fireEvent.keyDown(window, { key: "e" });
    expect(edit().getAttribute("aria-pressed")).toBe("true");
  });

  it("navigates adjacent slides from thumbnail focus with any arrow direction", async () => {
    const onSelectSlide = vi.fn();
    const slides = [1, 2, 3].map((slideNumber) => ({
      id: `slide-${slideNumber}`,
      slideNumber,
    }));
    const { container } = render(
      <MemoryRouter>
        <Slides2Editor
          {...createEditorProps()}
          slides={slides}
          onSelectSlide={onSelectSlide}
        />
      </MemoryRouter>,
    );

    await screen.findByTestId("mock-slide-object");
    const thumbnail = (index: number) =>
      container.querySelector<HTMLButtonElement>(
        `[data-slides-2-thumbnail-index="${index}"]`,
      );
    const first = thumbnail(0);
    const second = thumbnail(1);
    const third = thumbnail(2);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(third).not.toBeNull();

    first?.focus();
    fireEvent.keyDown(first as HTMLButtonElement, { key: "ArrowRight" });
    expect(onSelectSlide).toHaveBeenLastCalledWith(1);
    expect(document.activeElement).toBe(second);

    fireEvent.keyDown(second as HTMLButtonElement, { key: "ArrowDown" });
    expect(onSelectSlide).toHaveBeenLastCalledWith(2);
    expect(document.activeElement).toBe(third);

    fireEvent.keyDown(third as HTMLButtonElement, { key: "ArrowLeft" });
    expect(onSelectSlide).toHaveBeenLastCalledWith(1);
    expect(document.activeElement).toBe(second);

    fireEvent.keyDown(second as HTMLButtonElement, { key: "ArrowUp" });
    expect(onSelectSlide).toHaveBeenLastCalledWith(0);
    expect(document.activeElement).toBe(first);
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

  it("gates undo and redo during composition and matches platform redo keys", async () => {
    render(
      <MemoryRouter>
        <Slides2Editor {...createEditorProps()} />
      </MemoryRouter>,
    );

    await dragMockSlideObject();
    const saveButton = screen.getByRole("button", {
      name: "designSystemSetup.saveChanges",
    }) as HTMLButtonElement;
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
    expect(
      screen.queryByRole("button", {
        name: "designSystemSetup.saveChanges",
      }),
    ).toBeNull();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(
      (
        screen.getByRole("button", {
          name: "designSystemSetup.saveChanges",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(
      screen.queryByRole("button", {
        name: "designSystemSetup.saveChanges",
      }),
    ).toBeNull();

    const commandY = new KeyboardEvent("keydown", {
      key: "y",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(commandY);
    expect(commandY.defaultPrevented).toBe(false);
    expect(
      screen.queryByRole("button", {
        name: "designSystemSetup.saveChanges",
      }),
    ).toBeNull();

    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(
      (
        screen.getByRole("button", {
          name: "designSystemSetup.saveChanges",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
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
      await dragMockSlideObject();

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
      await waitFor(() =>
        expect(editorCommandMocks.appState.get(statusKey)).toMatchObject({
          hasPendingEdits: false,
          historyVersion: (status.historyVersion as number) + 1,
        }),
      );
      expect(
        screen.queryByRole("button", {
          name: "designSystemSetup.saveChanges",
        }),
      ).toBeNull();
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
    await dragMockSlideObject();

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

  it("requests fullscreen from Present before saving or navigating", async () => {
    const events: string[] = [];
    const props = {
      ...createEditorProps(),
      onRequestFullscreen: vi.fn(() => {
        events.push("fullscreen");
        return Promise.resolve(true);
      }),
      onPresent: vi.fn(() => events.push("present")),
      onSave: vi.fn(async () => {
        events.push("save");
        return {
          sourceTsx: "export default function Slide() { return <div />; }",
          revision: 2,
          sourceHash: "b".repeat(64),
        };
      }),
    };

    render(
      <MemoryRouter>
        <Slides2Editor {...props} />
      </MemoryRouter>,
    );

    fireEvent.click(
      screen.getByRole("link", { name: "editorToolbar.present" }),
    );
    await waitFor(() => expect(props.onPresent).toHaveBeenCalledOnce());
    expect(events).toEqual(["fullscreen", "present"]);

    events.length = 0;
    await dragMockSlideObject();
    await waitFor(() =>
      expect(
        editorCommandMocks.appState.get(
          "slides-2:slide-editor-status:slides-2-editor-layout-test",
        ),
      ).toMatchObject({
        hasPendingEdits: true,
        canSave: true,
      }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "editorToolbar.present" }),
    );
    await waitFor(() => expect(props.onPresent).toHaveBeenCalledTimes(2));
    expect(events).toEqual(["fullscreen", "save", "present"]);
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
      workspace?.querySelector(":scope > main")?.classList.contains("mb-2"),
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
    expect(slideRailResize.getAttribute("aria-valuenow")).toBe(
      String(DEFAULT_SLIDE_RAIL_WIDTH),
    );
    const resizedWidth = String(DEFAULT_SLIDE_RAIL_WIDTH + 32);

    fireEvent.keyDown(slideRailResize, {
      key: "ArrowRight",
      shiftKey: true,
    });
    expect(slideRailResize.getAttribute("aria-valuenow")).toBe(resizedWidth);

    fireEvent.keyDown(slideRailResize, { key: "ArrowUp" });
    expect(slideRailResize.getAttribute("aria-valuenow")).toBe(resizedWidth);

    fireEvent.keyDown(slideRailResize, { key: "ArrowDown" });
    expect(slideRailResize.getAttribute("aria-valuenow")).toBe(resizedWidth);

    fireEvent.keyDown(slideRailResize, { key: "Home" });
    expect(slideRailResize.getAttribute("aria-valuenow")).toBe("200");

    fireEvent.keyDown(slideRailResize, { key: "End" });
    expect(slideRailResize.getAttribute("aria-valuenow")).toBe("480");

    fireEvent.keyDown(slideRailResize, { key: "ArrowLeft" });
    expect(slideRailResize.getAttribute("aria-valuenow")).toBe("472");
  });

  it("keeps square resize and round rotate handles at 12 screen pixels", async () => {
    canvasMocks.scale = 0.4;
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
    const selectionOutline = document.querySelector(
      '[data-slide-selection-outline="true"]',
    );

    expect(selectionOutline?.classList.contains("border-[3px]")).toBe(true);
    expect(
      selectionOutline?.classList.contains("slides2-selection-outline"),
    ).toBe(true);
    expect(selectionOutline?.classList.contains("ring-1")).toBe(false);
    expect(
      resizeButtons.every(
        (button) =>
          button.classList.contains("rounded-[5px]") &&
          button.classList.contains("border-[3px]") &&
          button.classList.contains("slides2-selection-handle"),
      ),
    ).toBe(true);
    expect(rotateButton.classList.contains("rounded-full")).toBe(true);
    expect(rotateButton.classList.contains("border-[3px]")).toBe(true);
    expect(rotateButton.classList.contains("slides2-selection-handle")).toBe(
      true,
    );
    expect(
      document.querySelector(".slides2-selection-rotate-stem"),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-slide-rotate-stem="true"]'),
    ).not.toBeNull();

    await waitFor(() => {
      expect(
        resizeButtons.every(
          (button) =>
            button.style.width === "30px" && button.style.height === "30px",
        ),
      ).toBe(true);
      expect(rotateButton.style.width).toBe("30px");
      expect(rotateButton.style.height).toBe("30px");
      expect(rotateButton.style.top).toBe("-70px");
      const rotateStem = document.querySelector<HTMLElement>(
        '[data-slide-rotate-stem="true"]',
      );
      expect(rotateStem?.style.width).toBe("2.5px");
      expect(rotateStem?.style.height).toBe("40px");
      expect(rotateStem?.style.top).toBe("-40px");
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
      screen.queryByRole("button", {
        name: "designSystemSetup.saveChanges",
      }),
    ).toBeNull();
  });

  it("nudges a selected canvas object with arrows without changing slides", async () => {
    const sourceTsx = [
      "function Slide() {",
      "  return (",
      '    <div style={{ position: "relative", width: "1920px", height: "1080px" }}>',
      "      <h1>Repeated headline</h1>",
      "    </div>",
      "  );",
      "}",
    ].join("\n");
    const headline = {
      ...sourceSnapshot(sourceTsx, "headline", "<h1>", {
        x: 20,
        y: 30,
        width: 300,
        height: 60,
      }),
      instanceIndex: 0,
      instanceCount: 1,
    };
    sandboxNodeMocks.nodes = [headline];
    const props = createEditorProps();
    const onSelectSlide = vi.fn();
    props.slides = [
      { id: "slide-1", slideNumber: 1 },
      { id: "slide-2", slideNumber: 2 },
    ];
    props.onSelectSlide = onSelectSlide;
    const onSave = vi.fn(props.onSave);
    props.onSave = onSave;
    render(
      <MemoryRouter>
        <Slides2Editor {...props} source={{ ...props.source, sourceTsx }} />
      </MemoryRouter>,
    );

    pointerClick(headline);
    await waitFor(() =>
      expect(screen.getByTestId("mock-selection-count").textContent).toBe("1"),
    );
    frameControllerSend.mockClear();

    const sendFrameKey = (
      key: string,
      modifiers: Partial<FrameKeyboard> = {},
    ) => {
      act(() =>
        sandboxKeyboardMocks.activeFrameKeyboard?.({
          key,
          keyCode: 0,
          shiftKey: false,
          altKey: false,
          ctrlKey: false,
          metaKey: false,
          isTypingTarget: false,
          isControlTarget: false,
          isComposing: false,
          ...modifiers,
        }),
      );
    };

    sendFrameKey("ArrowRight");
    expect(frameControllerSend).toHaveBeenLastCalledWith({
      type: "preview",
      patches: [
        {
          line: headline.line,
          column: headline.column,
          styles: { translate: "1px 0px" },
        },
      ],
    });

    sendFrameKey("ArrowDown", { shiftKey: true });
    expect(frameControllerSend).toHaveBeenLastCalledWith({
      type: "preview",
      patches: [
        {
          line: headline.line,
          column: headline.column,
          styles: { translate: "0px 10px" },
        },
      ],
    });

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(frameControllerSend).toHaveBeenLastCalledWith({
      type: "preview",
      patches: [
        {
          line: headline.line,
          column: headline.column,
          styles: { translate: "-1px 0px" },
        },
      ],
    });

    fireEvent.keyDown(window, { key: "ArrowUp", shiftKey: true });
    expect(frameControllerSend).toHaveBeenLastCalledWith({
      type: "preview",
      patches: [
        {
          line: headline.line,
          column: headline.column,
          styles: { translate: "0px -10px" },
        },
      ],
    });
    expect(onSelectSlide).not.toHaveBeenCalled();

    frameControllerSend.mockClear();
    for (const modifier of ["altKey", "ctrlKey", "metaKey"] as const) {
      const event = new KeyboardEvent("keydown", {
        key: "ArrowRight",
        cancelable: true,
        [modifier]: true,
      });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      sendFrameKey("ArrowRight", { [modifier]: true });
    }

    expect(onSelectSlide).not.toHaveBeenCalled();
    expect(frameControllerSend).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "preview" }),
    );
    expect(toastMocks.error).not.toHaveBeenCalledWith(
      "slides2Editor.objectStructureUnsupported",
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("nudges every selected canvas object with arrows without changing slides", async () => {
    const sourceTsx = [
      "function Slide() {",
      "  return (",
      '    <div style={{ position: "relative", width: "1920px", height: "1080px" }}>',
      '      <h1 id="first">First</h1>',
      '      <p id="second">Second</p>',
      "    </div>",
      "  );",
      "}",
    ].join("\n");
    const wrapperLocator = sourceLocator(
      sourceTsx,
      '<div style={{ position: "relative", width: "1920px", height: "1080px" }}>',
    );
    const first = sourceSnapshot(
      sourceTsx,
      "first",
      '<h1 id="first">',
      { x: 20, y: 30, width: 300, height: 60 },
      [wrapperLocator],
    );
    const second = sourceSnapshot(
      sourceTsx,
      "second",
      '<p id="second">',
      { x: 400, y: 30, width: 300, height: 50 },
      [wrapperLocator],
    );
    sandboxNodeMocks.nodes = [first, second];
    const props = createEditorProps();
    props.slides = [
      { id: "slide-1", slideNumber: 1 },
      { id: "slide-2", slideNumber: 2 },
    ];
    const onSelectSlide = vi.fn();
    props.onSelectSlide = onSelectSlide;
    render(
      <MemoryRouter>
        <Slides2Editor {...props} source={{ ...props.source, sourceTsx }} />
      </MemoryRouter>,
    );

    pointerClick(first);
    pointerClick(second, { shiftKey: true });
    await waitFor(() =>
      expect(screen.getByTestId("mock-selection-count").textContent).toBe("2"),
    );
    frameControllerSend.mockClear();

    act(() =>
      sandboxKeyboardMocks.activeFrameKeyboard?.({
        key: "ArrowRight",
        keyCode: 0,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        isTypingTarget: false,
        isControlTarget: false,
        isComposing: false,
      }),
    );

    expect(frameControllerSend).toHaveBeenLastCalledWith({
      type: "preview",
      patches: [
        {
          line: first.line,
          column: first.column,
          styles: { translate: "1px 0px" },
        },
        {
          line: second.line,
          column: second.column,
          styles: { translate: "1px 0px" },
        },
      ],
    });
    expect(onSelectSlide).not.toHaveBeenCalled();
  });

  it("cancels an active object drag on Escape without committing its endpoint", async () => {
    frameControllerSend.mockClear();
    render(
      <MemoryRouter>
        <Slides2Editor {...createEditorProps()} />
      </MemoryRouter>,
    );

    const object = await screen.findByTestId("mock-slide-object");
    const pointerUp = screen.getByTestId("mock-slide-pointer-up");
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
      expect.objectContaining({ type: "clear-preview" }),
    );
    const callsAfterEscape = frameControllerSend.mock.calls.length;
    fireEvent.click(pointerUp);
    expect(frameControllerSend).toHaveBeenCalledTimes(callsAfterEscape);
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

  it("constrains Shift-drag movement to the dominant pointer axis", async () => {
    const sourceTsx = [
      "function Slide() {",
      "  return (",
      '    <div style={{ position: "relative", width: "1920px", height: "1080px" }}>',
      '      <div id="moving">Object</div>',
      "    </div>",
      "  );",
      "}",
    ].join("\n");
    const moving = sourceSnapshot(sourceTsx, "moving", '<div id="moving">', {
      x: 10,
      y: 10,
      width: 100,
      height: 50,
    });
    sandboxNodeMocks.nodes = [moving];
    const props = createEditorProps();
    render(
      <MemoryRouter>
        <Slides2Editor {...props} source={{ ...props.source, sourceTsx }} />
      </MemoryRouter>,
    );

    const target = {
      line: moving.line,
      column: moving.column,
      nodeId: moving.nodeId,
      snapshot: moving,
    };
    frameControllerSend.mockClear();
    act(() => {
      sandboxPointerMocks.onPointer?.(
        framePointer("down", 15, 15, { pointerId: 82, target }),
      );
      sandboxPointerMocks.onPointer?.(
        framePointer("move", 45, 80, {
          pointerId: 82,
          shiftKey: true,
        }),
      );
    });

    expect(frameControllerSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "preview",
        patches: [
          expect.objectContaining({
            line: moving.line,
            column: moving.column,
            styles: { translate: "0px 65px" },
          }),
        ],
      }),
    );
  });

  it("applies a Shift-locked group drag to every selected node and undo restores it", async () => {
    const sourceTsx = [
      "function Slide() {",
      "  return (",
      '    <div style={{ position: "relative", width: "1920px", height: "1080px" }}>',
      '      <div id="first">First</div>',
      '      <div id="second">Second</div>',
      "    </div>",
      "  );",
      "}",
    ].join("\n");
    const first = sourceSnapshot(sourceTsx, "first", '<div id="first">', {
      x: 20,
      y: 30,
      width: 100,
      height: 80,
    });
    const second = sourceSnapshot(sourceTsx, "second", '<div id="second">', {
      x: 150,
      y: 30,
      width: 100,
      height: 80,
    });
    sandboxNodeMocks.nodes = [first, second];
    const props = createEditorProps();
    render(
      <MemoryRouter>
        <Slides2Editor {...props} source={{ ...props.source, sourceTsx }} />
      </MemoryRouter>,
    );

    pointerClick(first);
    pointerClick(second, { shiftKey: true });
    expect(screen.getByTestId("mock-selection-count").textContent).toBe("2");

    const target = {
      line: first.line,
      column: first.column,
      nodeId: first.nodeId,
      snapshot: first,
    };
    frameControllerSend.mockClear();
    act(() => {
      sandboxPointerMocks.onPointer?.(
        framePointer("down", 25, 35, {
          pointerId: 83,
          shiftKey: true,
          target,
        }),
      );
      sandboxPointerMocks.onPointer?.(
        framePointer("move", 55, 100, { pointerId: 83, shiftKey: true }),
      );
    });

    frameControllerSend.mockClear();
    act(() => {
      sandboxPointerMocks.onPointer?.(
        framePointer("up", 55, 100, { pointerId: 83, shiftKey: true, target }),
      );
    });

    await waitFor(() => {
      expect(currentEditorStatus()).toMatchObject({
        hasPendingEdits: true,
        canUndo: true,
      });
      expect(screen.getByTestId("mock-selection-count").textContent).toBe("2");
      expect(frameControllerSend).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "preview",
          patches: expect.arrayContaining([
            expect.objectContaining({
              line: first.line,
              column: first.column,
              styles: { translate: "0px 65px" },
            }),
            expect.objectContaining({
              line: second.line,
              column: second.column,
              styles: { translate: "0px 65px" },
            }),
          ]),
        }),
      );
    });
    await waitFor(() =>
      expectLastInspect([
        { line: first.line, column: first.column, nodeId: first.nodeId },
        { line: second.line, column: second.column, nodeId: second.nodeId },
      ]),
    );

    frameControllerSend.mockClear();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() =>
      expect(currentEditorStatus()).toMatchObject({
        hasPendingEdits: false,
        canUndo: false,
      }),
    );
    expect(frameControllerSend).toHaveBeenCalledWith({ type: "clear-preview" });
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
      screen.queryByRole("button", {
        name: "designSystemSetup.saveChanges",
      }),
    ).toBeNull();

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
      screen.queryByRole("button", {
        name: "designSystemSetup.saveChanges",
      }),
    ).toBeNull();
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

  it("opens the design panel from the command menu when the inspector is closed", () => {
    const onPanelChange = vi.fn();
    render(
      <MemoryRouter>
        <Slides2Editor {...createEditorProps()} onPanelChange={onPanelChange} />
      </MemoryRouter>,
    );

    fireEvent.click(getInspectorHeaderButton("slides2Editor.hideInspector"));
    expect(
      screen.queryByRole("button", { name: "slides2Editor.hideInspector" }),
    ).toBeNull();

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    fireEvent.click(
      screen.getByRole("button", { name: "slides2DesignTokens.title" }),
    );

    expect(
      getInspectorHeaderButton("slides2Editor.hideInspector"),
    ).toBeTruthy();
    expect(onPanelChange).toHaveBeenLastCalledWith("design");
    expect(screen.getAllByText("slides2Editor.design")).toHaveLength(2);
  });
});

describe("Slides2Editor image crop entry", () => {
  it("opens crop on image double-click using its rendered external source", async () => {
    const imageSrc = "https://images.example.test/slide-photo.png";
    const sourceTsx = `export default function Slide() { return <img src="${imageSrc}" />; }`;
    const image = {
      ...sourceSnapshot(sourceTsx, "photo-node", "<img", {
        x: 120,
        y: 80,
        width: 520,
        height: 320,
      }),
      text: "",
      imageSrc,
    };
    sandboxNodeMocks.nodes = [image];
    const props = createEditorProps();
    render(
      <MemoryRouter>
        <Slides2Editor {...props} source={{ ...props.source, sourceTsx }} />
      </MemoryRouter>,
    );

    const target = {
      line: image.line,
      column: image.column,
      nodeId: image.nodeId,
      snapshot: image,
    };
    act(() => {
      sandboxPointerMocks.activeFramePointer?.(
        framePointer("double-click", 121, 81, { target }),
      );
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("mock-image-crop-controls").getAttribute("data-src"),
      ).toBe(imageSrc);
    });
    expect(
      screen.queryByRole("textbox", { name: "styleInspector.text" }),
    ).toBeNull();
  });
});
