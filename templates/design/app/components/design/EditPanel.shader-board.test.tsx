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

import { applyShaderToHtml } from "@shared/shader-fills";
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
  await act(async () => byLabel("Mesh Gradient")!.click());
  await flush();
  return edited;
}

describe("EditPanel — a shader preset on a frame drawn on the board", () => {
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
      expect(html).toContain('type="application/x-agent-native-shader"');
      expect(html).toContain('data-shader-name="Mesh Gradient"');
      expect(html).toMatch(
        new RegExp(
          `data-agent-native-node-id="${FRAME_ID}"[^>]*data-an-shader-fill="an-shader-`,
        ),
      );
      // The source actions cannot see the board, so they are not asked to.
      expect(mocks.applySourceEdit).not.toHaveBeenCalled();
    },
  );

  it("switches the pane to the picked shader's controls", async () => {
    await pickMeshGradient(BOARD_ID);
    expect(
      popover().querySelector('button[aria-label="editPanel.shaders.more"]'),
    ).not.toBeNull();
    expect(byLabel("Glowing Wave")).toBeNull();
  });
});

// A shader the agent wrote for this design, applied to another frame on the board.
const AI_GLSL = `precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_speed;
uniform vec3 u_tint;
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  gl_FragColor = vec4(u_tint * (0.5 + 0.5 * sin(u_time * u_speed + uv.x)), 1.0);
}`;
const AI_DEF = {
  id: "an-shader-aurora01",
  name: "Aurora Drift",
  mode: "fill" as const,
  glsl: AI_GLSL,
  uniforms: {
    u_speed: {
      type: "float" as const,
      value: 1,
      min: 0,
      max: 4,
      step: 0.01,
      label: "Speed",
    },
    u_tint: { type: "color" as const, value: "#4f2d8f", label: "Base" },
  },
};
const OTHER_FRAME_ID = "frame-0a1b2c3d-0000-4000-8000-000000000001";
const TWO_FRAMES = BOARD_HTML.replace(
  "</body>",
  `<div data-agent-native-node-id="${OTHER_FRAME_ID}" data-an-primitive="frame"></div></body>`,
);

describe("EditPanel — Created by you on the board", () => {
  it("lists the shader the agent made for another frame, so it can be applied to this one", async () => {
    const withAi = applyShaderToHtml(TWO_FRAMES, {
      nodeId: OTHER_FRAME_ID,
      def: AI_DEF,
      fallbackColor: "#4f2d8f",
    }).html;
    const edited = await openPicker(BOARD_ID, withAi);
    act(() => byLabel("Shader")!.click());

    expect(byLabel("Aurora Drift")).not.toBeNull();

    await act(async () => byLabel("Aurora Drift")!.click());
    await flush();
    const html = edited.mock.calls[0]![0] as string;
    expect(html).toMatch(
      new RegExp(
        `data-agent-native-node-id="${FRAME_ID}"[^>]*data-an-shader-fill="${AI_DEF.id}"`,
      ),
    );
  });
});

// The frame itself carries the agent's shader.
const SHADER_ON_FRAME = applyShaderToHtml(BOARD_HTML, {
  nodeId: FRAME_ID,
  def: AI_DEF,
  fallbackColor: "#4f2d8f",
}).html;

/** What a removal must take out of the board: the definition, the runtime, the reference. */
function expectNoShaderLeft(html: string) {
  expect(html).not.toContain("application/x-agent-native-shader");
  expect(html).not.toContain("data-agent-native-shader-runtime");
  expect(html).not.toContain("data-an-shader-fill");
}

async function openShaderMenu() {
  const trigger = byLabel("editPanel.shaders.more")!;
  await act(async () => {
    trigger.focus();
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  return document.querySelector<HTMLElement>('[role="menu"]')!;
}

describe("EditPanel — removing a shader from a frame on the board", () => {
  it("Remove shader in the menu takes the agent's shader out of the board's HTML", async () => {
    const edited = await openPicker(BOARD_ID, SHADER_ON_FRAME);
    const menu = await openShaderMenu();
    await act(async () =>
      Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'))
        .find((item) => item.textContent === "editPanel.shaders.removeShader")!
        .click(),
    );
    await flush();

    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(edited).toHaveBeenCalledTimes(1);
    expectNoShaderLeft(edited.mock.calls[0]![0] as string);
  });

  it("removing the fill row takes the shader with it, in one write", async () => {
    const edited = vi.fn();
    await act(async () =>
      root.render(
        <Host
          activeFileId={BOARD_ID}
          onEdited={edited}
          initialBoard={SHADER_ON_FRAME}
        />,
      ),
    );

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
    const html = edited.mock.calls[0]![0] as string;
    expectNoShaderLeft(html);
    // The frame keeps no fill behind: the fallback color went too.
    expect(html).not.toContain("#4f2d8f");
  });

  it("switching the paint away from Shader takes it off the frame", async () => {
    const edited = await openPicker(BOARD_ID, SHADER_ON_FRAME);

    await act(async () => byLabel("Solid")!.click());
    await flush();

    expect(edited).toHaveBeenCalledTimes(1);
    expectNoShaderLeft(edited.mock.calls[0]![0] as string);
  });
});

const shaderPane = () =>
  popover().querySelector<HTMLElement>("[data-shader-pane]")?.dataset
    .shaderPane;

describe("EditPanel — reopening the picker on a frame on the board", () => {
  it("opens on the Shader paint with the controls of the shader the frame has", async () => {
    await openPicker(BOARD_ID, SHADER_ON_FRAME);

    expect(byLabel("Shader")!.getAttribute("aria-pressed")).toBe("true");
    expect(shaderPane()).toBe("controls");
    // The controls, not the browser.
    expect(popover().textContent).not.toContain(
      "editPanel.shaders.createWithAi",
    );
    expect(
      popover().querySelector(
        'input[aria-label="editPanel.shaders.searchShaders"]',
      ),
    ).toBeNull();
    // The agent's shader: a Custom preset select, and the uniforms it declares.
    expect(popover().querySelector('[role="combobox"]')?.textContent).toBe(
      "editPanel.shaders.custom",
    );
    expect(
      popover().querySelector('input[aria-label="Base hex"]'),
    ).not.toBeNull();
    expect(
      popover().querySelector('[aria-label="Speed"] [role="slider"]'),
    ).not.toBeNull();
    expect(byLabel("editPanel.shaders.more")).not.toBeNull();
  });

  it("shows the browser, not controls, for a frame without a shader", async () => {
    await openPicker(BOARD_ID);
    expect(byLabel("Solid")!.getAttribute("aria-pressed")).toBe("true");

    act(() => byLabel("Shader")!.click());

    expect(shaderPane()).toBe("browse");
    expect(popover().textContent).toContain("editPanel.shaders.createWithAi");
    expect(byLabel("Mesh Gradient")).not.toBeNull();
    expect(popover().querySelector('[role="combobox"]')).toBeNull();
  });
});
