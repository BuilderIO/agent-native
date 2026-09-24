// @vitest-environment node

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const requireFromDesign = createRequire(
  path.resolve(process.cwd(), "package.json"),
);
const { chromium } = requireFromDesign("@playwright/test");
const { transformSync } = requireFromDesign("esbuild");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE =
  process.env.SPACE_DESIGN_EDITOR_SOURCE ||
  path.resolve(HERE, "../DesignEditor.tsx");
const TOOL_STATE = path.join(HERE, "tool-state.ts");
const START = "const handleWindowKeyDown = (event: KeyboardEvent) => {";
const END = 'window.addEventListener("keydown", handleWindowKeyDown';
const HELPER_START = "export function resolveSpaceForwardTransition(";
const HELPER_END = "export function isSingleScreenAnnotationTool";

function extractHandlers(sourcePath: string): string {
  const source = readFileSync(sourcePath, "utf8");
  const start = source.indexOf(START);
  const end = source.indexOf(END, start);
  if (start < 0 || end < 0)
    throw new Error(`Space handlers not found in ${sourcePath}`);
  return transformSync(source.slice(start, end), { loader: "tsx" }).code;
}

function loadTransitionHelper(sourcePath: string) {
  const source = readFileSync(sourcePath, "utf8");
  const start = source.indexOf(HELPER_START);
  const end = source.indexOf(HELPER_END, start);
  if (start < 0 || end < 0)
    throw new Error(`Transition helper not found in ${sourcePath}`);
  const code = transformSync(source.slice(start, end), {
    loader: "ts",
    format: "cjs",
  }).code;
  const moduleObject: { exports: Record<string, unknown> } = { exports: {} };
  new Function("module", "exports", code)(moduleObject, moduleObject.exports);
  return moduleObject.exports.resolveSpaceForwardTransition as (
    ...args: unknown[]
  ) => unknown;
}

describe("DesignEditor Space source handler", () => {
  let browser: any;
  let page: any;
  let handlerSource: string;
  let transitionHelper: (...args: unknown[]) => unknown;

  beforeAll(async () => {
    handlerSource = extractHandlers(SOURCE);
    transitionHelper = loadTransitionHelper(TOOL_STATE);
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  });

  afterAll(async () => browser?.close());

  async function run(
    events: Array<{
      type: string;
      repeat?: boolean;
      drag?: boolean;
      target?: "layer-row";
    }>,
    canEditDesign = true,
  ) {
    return page.evaluate(
      ({
        handlerSource,
        helperSource,
        events,
        canEditDesign,
      }: {
        handlerSource: string;
        helperSource: string;
        events: Array<{
          type: string;
          repeat?: boolean;
          drag?: boolean;
          target?: "layer-row";
        }>;
        canEditDesign: boolean;
      }) => {
        const spaceForwardArmedRef = { current: false };
        const activeEditorDragRef = { current: false };
        const canEditDesignRef = { current: canEditDesign };
        const spacePanStashedToolRef: { current: string | null } = {
          current: null,
        };
        const activeToolRef = { current: "move" };
        const broadcasts: boolean[] = [];
        let spacePanActive = false;
        const setSpacePanActive = (value: boolean) => {
          spacePanActive = value;
        };
        const setActiveTool = (
          value: string | ((current: string) => string),
        ) => {
          activeToolRef.current =
            typeof value === "function" ? value(activeToolRef.current) : value;
        };
        const broadcastSpaceHeldToIframes = (held: boolean) =>
          broadcasts.push(held);
        const isDesignHotkeyEditableTarget = () => false;
        const rowButton = document.createElement("button");
        rowButton.setAttribute("data-layer-row-button", "");
        document.body.append(rowButton);
        const isNativeKeyboardActivationTarget = (target: EventTarget | null) =>
          target instanceof Element &&
          Boolean(
            target.closest("a[href], button, input, select, textarea, summary"),
          );
        const resolveSpaceForwardTransition = new Function(
          `return (${helperSource});`,
        )();
        const handlers = new Function(
          "window",
          "resolveSpaceForwardTransition",
          "spaceForwardArmedRef",
          "activeEditorDragRef",
          "canEditDesignRef",
          "spacePanStashedToolRef",
          "activeToolRef",
          "setActiveTool",
          "setSpacePanActive",
          "broadcastSpaceHeldToIframes",
          "isDesignHotkeyEditableTarget",
          "isNativeKeyboardActivationTarget",
          `${handlerSource}\nreturn { handleWindowKeyDown, handleWindowKeyUp, handleWindowBlur };`,
        )(
          window,
          resolveSpaceForwardTransition,
          spaceForwardArmedRef,
          activeEditorDragRef,
          canEditDesignRef,
          spacePanStashedToolRef,
          activeToolRef,
          setActiveTool,
          setSpacePanActive,
          broadcastSpaceHeldToIframes,
          isDesignHotkeyEditableTarget,
          isNativeKeyboardActivationTarget,
        );
        window.addEventListener("keydown", handlers.handleWindowKeyDown, {
          capture: true,
        });
        window.addEventListener("keyup", handlers.handleWindowKeyUp, {
          capture: true,
        });
        window.addEventListener("blur", handlers.handleWindowBlur);
        const prevented: boolean[] = [];
        for (const step of events) {
          if (step.drag !== undefined) activeEditorDragRef.current = step.drag;
          const event = new KeyboardEvent(step.type, {
            key: " ",
            code: "Space",
            bubbles: true,
            cancelable: true,
            repeat: step.repeat ?? false,
          });
          (step.target === "layer-row" ? rowButton : window).dispatchEvent(
            event,
          );
          prevented.push(event.defaultPrevented);
        }
        rowButton.remove();
        const result = {
          broadcasts,
          prevented,
          armed: spaceForwardArmedRef.current,
          stashedTool: spacePanStashedToolRef.current,
          activeTool: activeToolRef.current,
          spacePanActive,
        };
        window.removeEventListener("keydown", handlers.handleWindowKeyDown, {
          capture: true,
        });
        window.removeEventListener("keyup", handlers.handleWindowKeyUp, {
          capture: true,
        });
        window.removeEventListener("blur", handlers.handleWindowBlur);
        return result;
      },
      {
        handlerSource,
        helperSource: transitionHelper.toString(),
        events,
        canEditDesign,
      },
    );
  }

  it("keeps a forwarded hold through mouseup and a duplicate nonrepeat keydown", async () => {
    const result = await run([
      { type: "keydown", drag: true },
      { type: "keydown", drag: false },
      { type: "keydown", repeat: true },
      { type: "keyup" },
    ]);
    expect(result.broadcasts).toEqual([true, false]);
    expect(result.prevented).toEqual([true, true, false, true]);
    expect(result.armed).toBe(false);
    expect(result.stashedTool).toBeNull();
    expect(result.activeTool).toBe("move");
    expect(result.spacePanActive).toBe(false);
  });

  it("ignores an ordinary repeated Space keydown", async () => {
    const result = await run([{ type: "keydown", repeat: true, drag: false }]);
    expect(result.broadcasts).toEqual([]);
    expect(result.prevented).toEqual([false]);
    expect(result.stashedTool).toBeNull();
    expect(result.activeTool).toBe("move");
  });

  it("uses and restores the temporary hand tool outside a drag", async () => {
    const result = await run([
      { type: "keydown", drag: false },
      { type: "keyup" },
    ]);
    expect(result.broadcasts).toEqual([]);
    expect(result.prevented).toEqual([true, true]);
    expect(result.activeTool).toBe("move");
    expect(result.stashedTool).toBeNull();
    expect(result.spacePanActive).toBe(false);
  });

  it("lets public viewers Space-pan without forwarding edit hotkeys", async () => {
    const result = await run([{ type: "keydown" }, { type: "keyup" }], false);
    expect(result.broadcasts).toEqual([]);
    expect(result.prevented).toEqual([true, true]);
    expect(result.armed).toBe(false);
    expect(result.stashedTool).toBeNull();
    expect(result.activeTool).toBe("move");
    expect(result.spacePanActive).toBe(false);
  });

  it("does not arm canvas Space-pan while a layer-row button owns activation", async () => {
    const result = await run([
      { type: "keydown", target: "layer-row" },
      { type: "keyup", target: "layer-row" },
    ]);
    expect(result.prevented).toEqual([false, false]);
    expect(result.broadcasts).toEqual([]);
    expect(result.activeTool).toBe("move");
    expect(result.spacePanActive).toBe(false);
  });

  it("keeps iframe reorder forwarding gated to design editors", async () => {
    const result = await run([{ type: "keydown", drag: true }], false);
    expect(result.broadcasts).toEqual([]);
    expect(result.prevented).toEqual([true]);
    expect(result.armed).toBe(false);
    expect(result.stashedTool).toBe("move");
    expect(result.activeTool).toBe("hand");
    expect(result.spacePanActive).toBe(true);
  });
  it("sends the matching release on blur after a forwarded drag hold", async () => {
    const result = await run([
      { type: "keydown", drag: true },
      { type: "blur", drag: false },
    ]);
    expect(result.broadcasts).toEqual([true, false]);
    expect(result.armed).toBe(false);
  });
});
