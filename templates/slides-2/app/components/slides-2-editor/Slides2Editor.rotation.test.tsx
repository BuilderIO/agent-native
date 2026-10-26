// @vitest-environment happy-dom
import {
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
import type { SourceEdit } from "./types";
import type { ElementSnapshot } from "./types";

const frameControllerSend = vi.hoisted(() => vi.fn());
const editorCommandMocks = vi.hoisted(() => ({
  appState: new Map<string, unknown>(),
  commandVersion: 0,
  useDbSync: vi.fn(),
}));

afterEach(cleanup);

beforeEach(() => {
  frameControllerSend.mockClear();
  editorCommandMocks.appState.clear();
  editorCommandMocks.commandVersion = 0;
  editorCommandMocks.useDbSync.mockClear();
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
  getBrowserTabId: () => "slides-2-editor-rotation-test",
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
  Slides2AssetBrowser: () => null,
}));
vi.mock("@/components/slides-2-editor/Slides2CommandMenu", () => ({
  Slides2CommandMenu: () => null,
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
  Slides2Inspector: () => null,
}));
vi.mock("../slides-2-runtime/Slides2Canvas", () => ({
  Slides2Canvas: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("../slides-2-runtime/SandboxedSlide", async () => {
  const { useEffect } = await import("react");
  return {
    SandboxedSlide: ({
      onNodes,
      onPointer,
      onController,
    }: {
      onNodes: (nodes: ElementSnapshot[]) => void;
      onPointer: (pointer: FramePointer) => void;
      onController: (controller: SlideFrameController | null) => void;
    }) => {
      const node: ElementSnapshot = {
        nodeId: "rotate-node",
        line: 1,
        column: 41,
        tagName: "div",
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
      useEffect(() => {
        onNodes([node]);
        onController({ send: frameControllerSend });
      }, [onController, onNodes]);
      return (
        <button
          type="button"
          data-testid="mock-slide-object"
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
                line: node.line,
                column: node.column,
                nodeId: node.nodeId,
                snapshot: node,
              },
            })
          }
        >
          Mock slide object
        </button>
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
  onSelectSlide: vi.fn(),
  onPresent: vi.fn(),
  onSave: async () => ({
    sourceTsx: "export default function Slide() { return <div />; }",
    revision: 1,
    sourceHash: "a".repeat(64),
  }),
  onReloadSource: async () => ({
    id: "slide-1",
    deckId: "deck-1",
    position: 0,
    sourceTsx: "export default function Slide() { return <div />; }",
    revision: 1,
    sourceHash: "a".repeat(64),
  }),
  onRestore: async () => ({
    sourceTsx: "export default function Slide() { return <div />; }",
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

describe("Slides2Editor rotation", () => {
  it("drags to 45 degrees and restores the edit through undo and redo", async () => {
    const props = createEditorProps();
    const onSave = vi.fn(async (_edits: SourceEdit[]) => ({
      sourceTsx: props.source.sourceTsx,
      revision: 2,
      sourceHash: "b".repeat(64),
    }));
    render(
      <MemoryRouter>
        <Slides2Editor {...props} onSave={onSave} />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByTestId("mock-slide-object"));
    const rotateHandle = screen.getByRole("button", {
      name: "styleInspector.rotateHandle",
    });
    Object.defineProperty(rotateHandle, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });

    fireEvent.pointerDown(rotateHandle, {
      pointerId: 41,
      button: 0,
      clientX: 110,
      clientY: 35,
    });
    fireEvent.pointerMove(rotateHandle, {
      pointerId: 41,
      clientX: 95.3553390593,
      clientY: 70.3553390593,
    });
    expect(frameControllerSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "preview",
        patches: [expect.objectContaining({ styles: { rotate: "45deg" } })],
      }),
    );
    fireEvent.pointerUp(rotateHandle, {
      pointerId: 41,
      clientX: 95.3553390593,
      clientY: 70.3553390593,
    });

    const saveButton = screen.getByRole("button", {
      name: "designSystemSetup.saveChanges",
    }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false);

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(saveButton.disabled).toBe(true);

    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(saveButton.disabled).toBe(false);
    fireEvent.click(saveButton);

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          line: 1,
          column: 41,
          ops: [
            expect.objectContaining({
              kind: "set-style",
              key: "rotate",
              value: "45deg",
            }),
          ],
        }),
      ]),
    );
  });
});
