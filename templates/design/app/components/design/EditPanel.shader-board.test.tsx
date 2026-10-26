// @vitest-environment happy-dom

/**
 * Picking a shader preset for a frame drawn on the board.
 *
 * The board is one reserved file the editor holds and saves itself. The
 * server's source actions cannot serve it: `read-source-file` answers with an
 * empty virtual file and `apply-source-edit` does not find it. The picker used
 * to read and write the frame's file through them, so every preset failed with
 * `no element with data-agent-native-node-id="frame-…" found`: the write ran
 * on an empty document. The edit now goes through the editor.
 *
 * This renders the real `EditPanel` and the real picker. The host stands in
 * for the editor: it holds the board's HTML and applies the edit it is given.
 */

import { parseEffectsFromHtml } from "@shared/native-effects";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  applySourceEdit: vi.fn(),
  readSourceFile: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  callAction: (name: string, params: unknown) => {
    if (name === "read-source-file") return mocks.readSourceFile(params);
    throw new Error(`unexpected callAction: ${name}`);
  },
  useActionMutation: (name: string) => ({
    mutate: vi.fn(),
    mutateAsync: (params: unknown) => {
      if (name === "apply-source-edit") return mocks.applySourceEdit(params);
      return Promise.resolve({});
    },
  }),
  useActionQuery: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: (...args: unknown[]) => mocks.toastError(...args),
    success: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: unknown }) => children as never,
  TooltipTrigger: ({ children }: { children?: unknown }) => children as never,
  TooltipContent: () => null,
  TooltipProvider: ({ children }: { children?: unknown }) => children as never,
}));

import { EditPanel } from "./EditPanel";
import type { ElementInfo } from "./types";

const FRAME_ID = "frame-669862c9-3d26-4dc0-8d71-ff092740decf";
const BOARD_ID = "board-file";
const SCREEN_ID = "screen-1";

const BOARD_HTML = `<!DOCTYPE html><html><head></head><body style="margin:0;position:relative"><div data-agent-native-node-id="${FRAME_ID}" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:200px;height:200px;background:#ffffff"></div></body></html>`;
const SCREEN_HTML = `<!DOCTYPE html><html><head></head><body><main data-agent-native-node-id="main"></main></body></html>`;

const frame: ElementInfo = {
  tagName: "div",
  sourceId: FRAME_ID,
  selector: `[data-agent-native-node-id="${FRAME_ID}"]`,
  sourceLayerIdentity: { screenId: BOARD_ID, nodeId: FRAME_ID },
  classes: [],
  computedStyles: {
    backgroundColor: "rgb(255, 255, 255)",
    backgroundImage: "none",
  },
  inlineStyles: { backgroundColor: "#ffffff" },
  boundingRect: { x: 0, y: 0, width: 200, height: 200 },
  isFlexChild: false,
  isFlexContainer: false,
  childElementCount: 0,
};

/** The editor, as far as the panel can tell: it holds the board and applies edits. */
function Host({
  activeFileId,
  onEdited,
  initialBoard = BOARD_HTML,
}: {
  activeFileId: string;
  onEdited: (html: string) => void;
  initialBoard?: string;
}) {
  const [board, setBoard] = useState(initialBoard);
  return (
    <QueryClientProvider client={new QueryClient()}>
      <EditPanel
        selectedElement={frame}
        viewMode="overview"
        mode="edit"
        designId="design_1"
        fileId={activeFileId}
        boardFileId={BOARD_ID}
        activeContent={activeFileId === BOARD_ID ? board : SCREEN_HTML}
        files={[
          { id: BOARD_ID, content: board },
          { id: SCREEN_ID, content: SCREEN_HTML },
        ]}
        onStyleChange={vi.fn()}
        onShaderSourceEdit={(fileId, transform) => {
          expect(fileId).toBe(BOARD_ID);
          const result = transform(board);
          if (result.errors.length > 0) {
            return { status: "failed", error: result.errors[0]! };
          }
          setBoard(result.html);
          onEdited(result.html);
          return { status: "applied" };
        }}
      />
    </QueryClientProvider>
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  mocks.toastError.mockReset();
  // What the server really answers for the board: an empty, read-only file.
  mocks.readSourceFile.mockReset();
  mocks.readSourceFile.mockResolvedValue({
    fileId: BOARD_ID,
    content: "",
    versionHash: "",
    readonly: true,
  });
  mocks.applySourceEdit.mockReset();
  mocks.applySourceEdit.mockRejectedValue(new Error("File not found"));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document
    .querySelectorAll("[data-radix-popper-content-wrapper]")
    .forEach((node) => node.remove());
  vi.unstubAllGlobals();
});

const popover = () =>
  document.querySelector<HTMLElement>(
    '[data-design-chrome-region="right-panel"]',
  )!;
const byLabel = (label: string) =>
  popover().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const nativeDefinitionButton = (slug: string) =>
  popover().querySelector<HTMLButtonElement>(
    `[data-native-shader-panel="fill"] button[aria-label$="definitions.${slug}"]`,
  );

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function openPicker(activeFileId: string, initialBoard?: string) {
  const edited = vi.fn();
  await act(async () =>
    root.render(
      <Host
        activeFileId={activeFileId}
        onEdited={edited}
        initialBoard={initialBoard}
      />,
    ),
  );
  act(() => {
    container
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Open color picker"]',
      )!
      .click();
  });
  return edited;
}

async function pickMeshGradient(activeFileId: string) {
  const edited = await openPicker(activeFileId);
  act(() => byLabel("Shader")!.click());
  await act(async () => nativeDefinitionButton("mesh-anchors")!.click());
  await flush();
  return edited;
}

describe("EditPanel — a native fill shader on a frame drawn on the board", () => {
  it.each([
    ["the board is the active file", BOARD_ID],
    ["another screen is the active file", SCREEN_ID],
  ])(
    "writes the shader into the board's HTML when %s",
    async (_name, active) => {
      const edited = await pickMeshGradient(active);

      expect(mocks.toastError).not.toHaveBeenCalled();
      expect(edited).toHaveBeenCalledTimes(1);
      const html = edited.mock.calls[0]![0] as string;
      const parsed = parseEffectsFromHtml(html);
      expect(parsed.errors).toEqual([]);
      expect(parsed.document?.instances).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            nodeId: FRAME_ID,
            definitionId: "an-native-mesh-anchors",
            placement: "fill",
          }),
        ]),
      );
      // The source actions cannot see the board, so the editor applies one native manifest edit.
      expect(mocks.applySourceEdit).not.toHaveBeenCalled();
      expect(mocks.readSourceFile).not.toHaveBeenCalled();
    },
  );

  it("shows the applied native shader in the board inspector", async () => {
    await pickMeshGradient(BOARD_ID);
    expect(container.textContent).toContain(
      "editPanel.shaders.nativeCatalog.definitions.mesh-anchors",
    );
  });
});

const SAVED_GLSL_BOARD = BOARD_HTML.replace(
  `data-agent-native-node-id="${FRAME_ID}"`,
  `data-agent-native-node-id="${FRAME_ID}" data-an-shader-fill="an-shader-aurora01"`,
).replace(
  "</body>",
  `<script type="application/x-agent-native-shader" data-shader-id="an-shader-aurora01" data-shader-name="Aurora Drift" data-shader-mode="fill">precision highp float;void main(){gl_FragColor=vec4(1.0);}</script></body>`,
);

function expectNoSavedShader(html: string) {
  expect(html).not.toContain('data-an-shader-fill="an-shader-aurora01"');
  expect(html).not.toContain('data-shader-id="an-shader-aurora01"');
}

describe("EditPanel — saved GLSL on a board frame", () => {
  it("shows the saved shader without offering its old editor and removes its mount in one write", async () => {
    const edited = vi.fn();
    await act(async () =>
      root.render(
        <Host
          activeFileId={BOARD_ID}
          onEdited={edited}
          initialBoard={SAVED_GLSL_BOARD}
        />,
      ),
    );
    expect(container.textContent).toContain("Aurora Drift");
    expect(container.querySelector("[data-shader-pane]")).toBeNull();
    expect(container.querySelector('[aria-label="Edit code"]')).toBeNull();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="editPanel.labels.removeLayer"]',
        )!
        .click(),
    );
    await flush();
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(edited).toHaveBeenCalledTimes(1);
    expectNoSavedShader(edited.mock.calls[0]![0] as string);
  });

  it("offers the native catalog and applying a native Fill clears the saved GLSL mount", async () => {
    const edited = await openPicker(BOARD_ID, SAVED_GLSL_BOARD);
    act(() => byLabel("Shader")!.click());
    expect(nativeDefinitionButton("nebula")).not.toBeNull();
    expect(popover().textContent).not.toContain("Aurora Drift");
    await act(async () => nativeDefinitionButton("nebula")!.click());
    await flush();
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(edited).toHaveBeenCalledTimes(1);
    const html = edited.mock.calls[0]![0] as string;
    const parsed = parseEffectsFromHtml(html);
    expect(parsed.errors).toEqual([]);
    expect(parsed.document?.instances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: FRAME_ID,
          definitionId: "an-native-nebula",
          placement: "fill",
        }),
      ]),
    );
    expectNoSavedShader(html);
    expect(mocks.readSourceFile).not.toHaveBeenCalled();
  });
});
