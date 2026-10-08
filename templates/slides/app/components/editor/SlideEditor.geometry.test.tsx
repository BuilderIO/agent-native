// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { Slide } from "@/context/DeckContext";
import { enterSelectionMode } from "@/root";

import SlideEditor from "./SlideEditor";

vi.mock("@agent-native/core/client/labs", () => ({
  useLabState: () => ({
    enabled: false,
    isLoading: false,
    isError: false,
    isSuccess: true,
  }),
}));
const t = (key: string) => key;
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useT: () => t,
}));
const { setClientAppState } = vi.hoisted(() => ({
  setClientAppState: vi.fn(() => Promise.resolve()),
}));
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  setClientAppState,
}));
vi.mock("@/components/deck/ExcalidrawSlide", () => ({
  ExcalidrawSlide: () => <div data-excalidraw-canvas="true" />,
  ExcalidrawThumbnail: () => null,
  parseExcalidrawData: (json?: string) => (json ? JSON.parse(json) : null),
}));
vi.mock("@/root", () => ({ enterSelectionMode: vi.fn() }));

type Rect = { left: number; top: number; right: number; bottom: number };

const FIT_SLIDE = `
  <div class="fmd-slide" style="position:relative">
    <div id="box" class="fmd-text-box" data-slide-object-id="box-1" style="position:absolute;left:100px;top:100px;width:300px;font-size:24px">Hello</div>
  </div>`;

const MIN_SLIDE = `
  <div class="fmd-slide" style="position:relative">
    <div id="box" class="fmd-text-box" data-slide-object-id="box-1" style="position:absolute;left:100px;top:200px;width:300px;min-height:120px;font-size:24px">Hello</div>
  </div>`;

const FLOW_SLIDE = `
  <div class="fmd-slide" style="position:relative">
    <div id="left" style="display:flex;flex-direction:column">
      <h2 id="h2">A spectrum, not a switch</h2>
      <div id="card" style="background:#14181d;padding:16px">
        <p id="cardBody">Card body copy</p>
      </div>
      <div id="after">Following block</div>
    </div>
  </div>`;

// Flow geometry; a promoted object takes its rect from its inline position.
const FLOW_RECTS: Record<string, Rect> = {
  left: { left: 60, top: 140, right: 460, bottom: 520 },
  h2: { left: 80, top: 145, right: 440, bottom: 185 },
  card: { left: 80, top: 290, right: 440, bottom: 370 },
  cardBody: { left: 96, top: 296, right: 424, bottom: 324 },
  after: { left: 80, top: 380, right: 440, bottom: 410 },
};
const TEXT_RECTS: Record<string, Rect> = {
  h2: { left: 80, top: 145, right: 400, bottom: 185 },
  cardBody: { left: 96, top: 296, right: 300, bottom: 324 },
  box: { left: 100, top: 100, right: 160, bottom: 131 },
};
// Rendered heights of objects whose height comes from their content.
const DEFAULT_CONTENT_HEIGHTS: Record<string, number> = {
  box: 31,
  h2: 40,
  card: 80,
};
let contentHeights: Record<string, number> = {};
// Text taller than a size-contained block: reported by scrollHeight only.
const overflowHeights = new Map<string, number>();

const noop = () => {};

function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}

function isSlideLayer(element: HTMLElement) {
  return (
    element.classList.contains("fmd-slide") ||
    element.classList.contains("fmd-autofit-scale")
  );
}

function toDomRect({ left, top, right, bottom }: Rect): DOMRect {
  return new DOMRect(left, top, right - left, bottom - top);
}

const px = (value: string) => Number.parseFloat(value) || 0;

function renderedHeight(element: HTMLElement) {
  const inline = element.style.getPropertyValue("height");
  if (inline && inline !== "auto") return px(inline);
  return Math.max(
    px(element.style.getPropertyValue("min-height")),
    contentHeights[element.id] ?? 0,
  );
}

function layoutRect(element: HTMLElement): Rect | null {
  if (isSlideLayer(element))
    return { left: 0, top: 0, right: 1200, bottom: 675 };
  if (element.style.position === "absolute") {
    const left = px(element.style.left);
    const top = px(element.style.top);
    return {
      left,
      top,
      right: left + px(element.style.width),
      bottom: top + renderedHeight(element),
    };
  }
  return FLOW_RECTS[element.id] ?? null;
}

let stack: Element[] = [];
const originalGetters = new Map<string, PropertyDescriptor | undefined>();

beforeEach(() => {
  contentHeights = { ...DEFAULT_CONTENT_HEIGHTS };
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  vi.mocked(enterSelectionMode).mockClear();
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: () => stack,
  });
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value(this: Range) {
      const owner = this.startContainer.parentElement ?? this.startContainer;
      const rect =
        owner instanceof HTMLElement ? TEXT_RECTS[owner.id] : undefined;
      return rect ? [toDomRect(rect)] : [];
    },
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const rect = layoutRect(this);
      return rect ? toDomRect(rect) : new DOMRect(0, 0, 0, 0);
    },
  );
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: () => {},
  });
  const getters = {
    offsetWidth: (el: HTMLElement) => {
      const rect = layoutRect(el);
      return rect ? rect.right - rect.left : 0;
    },
    offsetHeight: (el: HTMLElement) => {
      const rect = layoutRect(el);
      return rect ? rect.bottom - rect.top : 0;
    },
    offsetLeft: (el: HTMLElement) => px(el.style.left),
    offsetTop: (el: HTMLElement) => px(el.style.top),
    scrollHeight: (el: HTMLElement) => {
      const rect = layoutRect(el);
      return Math.max(
        overflowHeights.get(el.id) ?? 0,
        rect ? rect.bottom - rect.top : 0,
      );
    },
  };
  for (const [property, read] of Object.entries(getters)) {
    originalGetters.set(
      property,
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, property),
    );
    Object.defineProperty(HTMLElement.prototype, property, {
      configurable: true,
      get(this: HTMLElement) {
        return read(this);
      },
    });
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "elementsFromPoint");
  Reflect.deleteProperty(Range.prototype, "getClientRects");
  Reflect.deleteProperty(HTMLElement.prototype, "setPointerCapture");
  for (const [property, descriptor] of originalGetters) {
    if (descriptor) {
      Object.defineProperty(HTMLElement.prototype, property, descriptor);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, property);
    }
  }
  originalGetters.clear();
  overflowHeights.clear();
  stack = [];
  window.getSelection()?.removeAllRanges();
});

async function mountEditor(
  content: string,
  props: Partial<ComponentProps<typeof SlideEditor>> = {},
) {
  const onUpdateSlide = vi.fn();
  const slide = { id: "slide-geometry", content, layout: "blank" } as Slide;
  const view = render(
    <SlideEditor
      slide={slide}
      onUpdateSlide={onUpdateSlide}
      onGenerateImage={noop}
      onOpenAssetLibrary={noop}
      onUploadImage={noop}
      onToggleObjectFit={noop}
      onChangeObjectPosition={noop}
      {...props}
    />,
    { wrapper: Providers },
  );
  await act(() => new Promise((resolve) => setTimeout(resolve, 60)));

  const el = (id: string) =>
    view.container.querySelector<HTMLElement>(`#${id}`)!;
  const canvas = view.container.querySelector<HTMLElement>(
    "[data-slide-canvas-focus='true']",
  )!;
  const chainOf = (id: string) => {
    const chain: Element[] = [];
    for (
      let current: Element | null = el(id);
      current;
      current = current.parentElement
    ) {
      chain.push(current);
    }
    return chain;
  };
  const init = (point: { x: number; y: number }) => ({
    button: 0,
    pointerId: 1,
    clientX: point.x,
    clientY: point.y,
  });
  const click = (id: string, point: { x: number; y: number }) => {
    stack = chainOf(id);
    fireEvent.pointerDown(el(id), init(point));
    fireEvent.pointerUp(el(id), init(point));
    fireEvent.click(el(id), { ...init(point), detail: 1 });
  };
  const outline = () =>
    document.querySelector<HTMLElement>("[data-slide-selection-outline]");
  const handle = (name: string) =>
    document.querySelector<HTMLElement>(`[data-slide-resize-handle="${name}"]`);
  /** Re-renders with the content a draft capture just wrote back to the slide. */
  const rerenderWithContent = (
    nextContent: string,
    nextProps: Partial<ComponentProps<typeof SlideEditor>> = {},
  ) =>
    view.rerender(
      <SlideEditor
        slide={{ ...slide, content: nextContent }}
        onUpdateSlide={onUpdateSlide}
        onGenerateImage={noop}
        onOpenAssetLibrary={noop}
        onUploadImage={noop}
        onToggleObjectFit={noop}
        onChangeObjectPosition={noop}
        {...props}
        {...nextProps}
      />,
    );
  const slideHtml = () =>
    view.container.querySelector<HTMLElement>(".fmd-slide")!.innerHTML;
  return {
    ...view,
    el,
    canvas,
    click,
    outline,
    handle,
    rerenderWithContent,
    slideHtml,
    init,
    onUpdateSlide,
  };
}

/** Presses a handle, drags the pointer by (dx, dy) and releases. */
function dragHandle(
  handle: HTMLElement,
  from: { x: number; y: number },
  delta: { dx: number; dy: number },
) {
  fireEvent.pointerDown(handle, {
    button: 0,
    pointerId: 1,
    clientX: from.x,
    clientY: from.y,
  });
  fireEvent.pointerMove(window, {
    pointerId: 1,
    clientX: from.x + delta.dx,
    clientY: from.y + delta.dy,
  });
  fireEvent.pointerUp(window, {
    pointerId: 1,
    clientX: from.x + delta.dx,
    clientY: from.y + delta.dy,
  });
}

const wait = (ms: number) =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

/** The element as the last write persisted it. */
function savedElement(
  onUpdateSlide: ReturnType<typeof vi.fn>,
  id: string,
): HTMLElement {
  const content = (onUpdateSlide.mock.calls.at(-1)?.[0] as { content: string })
    .content;
  const saved = new DOMParser()
    .parseFromString(content, "text/html")
    .querySelector<HTMLElement>(`#${id}`);
  if (!saved) throw new Error(`#${id} missing from the saved slide`);
  return saved;
}

/** Types like a browser: the session may take the input, or let it through. */
function type(target: HTMLElement, text: string) {
  for (const data of text) {
    const event = new InputEvent("beforeinput", {
      inputType: "insertText",
      data,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    if (!event.defaultPrevented) {
      const range = window.getSelection()!.getRangeAt(0);
      const node = range.startContainer as Text;
      node.insertData(range.startOffset, data);
      window.getSelection()!.collapse(node, range.startOffset + data.length);
    }
    target.dispatchEvent(
      new InputEvent("input", { inputType: "insertText", data, bubbles: true }),
    );
  }
}

describe("fit text box handles", () => {
  it.each([
    ["e", { dx: 50, dy: 20 }, { left: "100px", top: "100px", width: "350px" }],
    ["w", { dx: -40, dy: 20 }, { left: "60px", top: "100px", width: "340px" }],
    ["s", { dx: 0, dy: 60 }, { left: "100px", top: "100px", width: "300px" }],
    ["n", { dx: 0, dy: -30 }, { left: "100px", top: "70px", width: "300px" }],
    ["se", { dx: 30, dy: 50 }, { left: "100px", top: "100px", width: "330px" }],
    ["nw", { dx: -20, dy: -10 }, { left: "80px", top: "90px", width: "320px" }],
  ])(
    "%s writes width and top edge but never a height",
    async (name, delta, expected) => {
      const editor = await mountEditor(FIT_SLIDE);
      editor.click("box", { x: 420, y: 110 });

      dragHandle(editor.handle(name)!, { x: 250, y: 115 }, delta);

      const box = editor.el("box");
      expect({
        left: box.style.left,
        top: box.style.top,
        width: box.style.width,
      }).toEqual(expected);
      expect(box.style.height).toBe("");
      expect(box.style.minHeight).toBe("");
      const saved = savedElement(editor.onUpdateSlide, "box");
      expect(saved.style.height).toBe("");
      expect(saved.style.width).toBe(expected.width);
    },
  );

  it("edits min-height from the top and bottom edges, never below the text", async () => {
    const editor = await mountEditor(MIN_SLIDE);
    editor.click("box", { x: 420, y: 210 });
    const box = editor.el("box");

    dragHandle(editor.handle("s")!, { x: 250, y: 320 }, { dx: 0, dy: 40 });
    expect(box.style.minHeight).toBe("160px");
    expect(box.style.top).toBe("200px");

    dragHandle(editor.handle("n")!, { x: 250, y: 200 }, { dx: 0, dy: -30 });
    expect(box.style.minHeight).toBe("190px");
    expect(box.style.top).toBe("170px");

    dragHandle(editor.handle("s")!, { x: 250, y: 360 }, { dx: 0, dy: -400 });
    expect(box.style.minHeight).toBe("31px");
    expect(box.style.height).toBe("");
    expect(savedElement(editor.onUpdateSlide, "box").style.height).toBe("");
  });
});

describe("handle presses on a flow object", () => {
  it.each([
    ["resize", "s"],
    ["rotate", "rotate"],
  ])(
    "a %s press under the drag threshold leaves the slide untouched",
    async (_, name) => {
      const editor = await mountEditor(FLOW_SLIDE);
      editor.click("card", { x: 85, y: 300 });
      const handle =
        name === "rotate"
          ? document.querySelector<HTMLElement>("[data-slide-rotate-handle]")!
          : editor.handle(name)!;
      const before = editor.slideHtml();
      editor.onUpdateSlide.mockClear();

      dragHandle(handle, { x: 250, y: 370 }, { dx: 2, dy: 1 });

      expect(editor.slideHtml()).toBe(before);
      expect(editor.onUpdateSlide).not.toHaveBeenCalled();
      expect(editor.container.querySelector(".fmd-layout-spacer")).toBeNull();
    },
  );

  it("promotes the card on the first move past the threshold", async () => {
    const editor = await mountEditor(FLOW_SLIDE);
    editor.click("card", { x: 85, y: 300 });
    const before = editor.el("after").getBoundingClientRect().top;

    dragHandle(editor.handle("s")!, { x: 250, y: 370 }, { dx: 0, dy: 30 });

    const card = editor.el("card");
    expect(card.style.position).toBe("absolute");
    expect(card.style.height).toBe("110px");
    const spacer =
      editor.container.querySelector<HTMLElement>(".fmd-layout-spacer")!;
    expect(spacer.style.height).toBe("80px");
    // The slot stays reserved, so the following block does not move.
    expect(editor.el("after").getBoundingClientRect().top).toBe(before);
  });
});

describe("promotion from flow", () => {
  it("keeps a text leaf fit and gives a painted card a min-height", async () => {
    const editor = await mountEditor(FLOW_SLIDE);

    editor.click("h2", { x: 420, y: 165 });
    editor.canvas.focus();
    fireEvent.keyDown(editor.canvas, { key: "ArrowRight" });
    const h2 = editor.el("h2");
    expect(h2.style.position).toBe("absolute");
    expect({
      left: h2.style.left,
      top: h2.style.top,
      width: h2.style.width,
    }).toEqual({ left: "81px", top: "145px", width: "360px" });
    expect(h2.style.height).toBe("");
    expect(h2.style.minHeight).toBe("");
    expect(savedElement(editor.onUpdateSlide, "h2").style.height).toBe("");

    editor.click("card", { x: 85, y: 300 });
    editor.canvas.focus();
    fireEvent.keyDown(editor.canvas, { key: "ArrowRight" });
    const card = editor.el("card");
    expect(card.style.position).toBe("absolute");
    expect(card.style.minHeight).toBe("80px");
    expect(card.style.height).toBe("");
    const saved = savedElement(editor.onUpdateSlide, "card");
    expect(saved.style.minHeight).toBe("80px");
    expect(saved.style.height).toBe("");

    const spacerHeights = Array.from(
      editor.container.querySelectorAll<HTMLElement>(".fmd-layout-spacer"),
    ).map((spacer) => spacer.style.height);
    expect(spacerHeights).toEqual(["40px", "80px"]);
  });

  it("keeps the selection on the dragged object after the spacer shifts its index", async () => {
    const editor = await mountEditor(FLOW_SLIDE);
    editor.click("card", { x: 85, y: 300 });

    stack = [editor.el("card"), editor.el("left")];
    fireEvent.pointerDown(editor.el("card"), editor.init({ x: 85, y: 300 }));
    fireEvent.pointerMove(window, { clientX: 125, clientY: 330, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 125, clientY: 330, pointerId: 1 });

    const card = editor.el("card");
    expect(card.style.left).toBe("120px");
    expect(card.style.top).toBe("320px");
    const outline = editor.outline()!;
    expect(outline.style.left).toBe("118px");
    expect(outline.style.top).toBe("318px");
  });
});

describe("text box creation", () => {
  const draw = (
    editor: Awaited<ReturnType<typeof mountEditor>>,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) => {
    contentHeights[""] = 31;
    fireEvent.pointerDown(editor.canvas, editor.init(from));
    fireEvent.pointerMove(editor.canvas, editor.init(to));
    fireEvent.pointerUp(editor.canvas, editor.init(to));
    return editor.container.querySelector<HTMLElement>(".fmd-text-box")!;
  };

  it("keeps the drawn height as a minimum, not a fixed height", async () => {
    const editor = await mountEditor(FLOW_SLIDE, { textBoxMode: true });

    const box = draw(editor, { x: 100, y: 100 }, { x: 400, y: 220 });

    expect(box.style.minHeight).toBe("120px");
    expect(box.style.width).toBe("300px");
    expect(box.style.height).toBe("");
  });

  it("gives a click-placed box neither height nor min-height", async () => {
    const editor = await mountEditor(FLOW_SLIDE, { textBoxMode: true });

    const box = draw(editor, { x: 100, y: 100 }, { x: 101, y: 100 });

    expect(box.style.height).toBe("");
    expect(box.style.minHeight).toBe("");
  });
});

describe("outline while typing", () => {
  const FIXED_SLIDE = FIT_SLIDE.replace(
    "width:300px",
    "width:300px;height:60px",
  );

  it("follows a fit text box as it wraps, without contain or height", async () => {
    const editor = await mountEditor(FIT_SLIDE);
    editor.click("box", { x: 110, y: 110 });
    const box = editor.el("box");
    expect(editor.outline()!.style.height).toBe("35px");

    window.getSelection()!.collapse(box.firstChild!, 5);
    // Layout is current when the input event fires, so the outline has to be
    // too: no frame or timer may sit between the grown box and its outline.
    contentHeights.box = 93;
    type(box, " and more words");

    const outline = editor.outline()!;
    expect(outline.style.top).toBe("98px");
    expect(outline.style.height).toBe("97px");
    expect(box.style.height).toBe("");
    expect(box.style.getPropertyValue("contain")).toBe("");

    await wait(320);
    const saved = savedElement(editor.onUpdateSlide, "box");
    expect(saved.style.height).toBe("");
    expect(saved.getAttribute("style")).not.toContain("contain");
    expect(saved.getAttribute("style")).not.toMatch(/(?<![\w-])height\s*:/);
  });

  it("coalesces application-state writes while typing into one burst per pause", async () => {
    const editor = await mountEditor(FIT_SLIDE);
    editor.click("box", { x: 110, y: 110 });
    const box = editor.el("box");
    // A double-click starts the edit; the selection write that follows is immediate.
    window.getSelection()!.collapse(box.firstChild!, 5);
    type(box, "!");
    await wait(320);
    setClientAppState.mockClear();

    for (let key = 0; key < 12; key += 1) {
      contentHeights.box = 31 + key;
      type(box, "x");
      document.dispatchEvent(new Event("selectionchange"));
    }
    expect(setClientAppState).not.toHaveBeenCalled();

    await wait(320);
    const writes = setClientAppState.mock.calls.length;
    expect(writes).toBeGreaterThan(0);
    // One selection write is the two slides-selection keys plus the two
    // generic ones.
    expect(writes).toBe(4);
  });

  it("keeps the outline up after a draft capture changes the slide content", async () => {
    const editor = await mountEditor(FIT_SLIDE);
    editor.click("box", { x: 110, y: 110 });
    const box = editor.el("box");
    window.getSelection()!.collapse(box.firstChild!, 5);
    type(box, "!");
    await wait(320);

    const written = (
      editor.onUpdateSlide.mock.calls.at(-1)?.[0] as { content: string }
    ).content;
    editor.rerenderWithContent(written);
    await wait(60);

    expect(editor.outline()).not.toBeNull();
  });

  it("reads the content height of an in-flow block that keeps its slot", async () => {
    const editor = await mountEditor(FLOW_SLIDE);
    editor.click("h2", { x: 100, y: 165 });
    const h2 = editor.el("h2");
    expect(editor.outline()!.style.height).toBe("44px");

    window.getSelection()!.collapse(h2.firstChild!, 3);
    overflowHeights.set("h2", 100);
    type(h2, "x");

    expect(editor.outline()!.style.height).toBe("104px");
  });

  it("keeps the authored frame of a fixed-height object", async () => {
    const editor = await mountEditor(FIXED_SLIDE);
    editor.click("box", { x: 110, y: 110 });
    const box = editor.el("box");

    window.getSelection()!.collapse(box.firstChild!, 5);
    type(box, "x");
    overflowHeights.set("box", 200);
    await wait(40);

    expect(editor.outline()!.style.height).toBe("64px");
  });

  it("keeps the authored frame of a fixed-height block that stays in flow", async () => {
    const editor = await mountEditor(
      FLOW_SLIDE.replace(
        '<h2 id="h2">',
        '<h2 id="h2" style="height:44px;overflow:visible">',
      ),
    );
    editor.click("h2", { x: 100, y: 165 });
    const h2 = editor.el("h2");
    expect(editor.outline()!.style.height).toBe("44px");

    window.getSelection()!.collapse(h2.firstChild!, 3);
    overflowHeights.set("h2", 100);
    type(h2, "x");
    await wait(40);

    expect(editor.outline()!.style.height).toBe("44px");
  });
});

describe("selection outline in a new text box", () => {
  it("survives the parent leaving text box mode once the box is placed", async () => {
    const editor = await mountEditor(FLOW_SLIDE, { textBoxMode: true });
    contentHeights[""] = 0;
    fireEvent.pointerDown(editor.canvas, editor.init({ x: 100, y: 100 }));
    fireEvent.pointerMove(editor.canvas, editor.init({ x: 101, y: 100 }));
    fireEvent.pointerUp(editor.canvas, editor.init({ x: 101, y: 100 }));
    const box = editor.container.querySelector<HTMLElement>(".fmd-text-box")!;
    box.id = "fresh";
    await wait(40);
    expect(editor.outline()).not.toBeNull();

    // The real parent ends the tool as soon as the box exists.
    editor.rerenderWithContent(FLOW_SLIDE, { textBoxMode: false });
    await wait(40);

    expect(editor.container.querySelector("[data-editing-block]")).toBe(box);
    expect(editor.outline()).not.toBeNull();
  });

  it("is visible during the first edit session and follows the typed text", async () => {
    const editor = await mountEditor(FLOW_SLIDE, { textBoxMode: true });
    // An empty box is zero tall, as in a browser.
    contentHeights[""] = 0;
    fireEvent.pointerDown(editor.canvas, editor.init({ x: 100, y: 100 }));
    fireEvent.pointerMove(editor.canvas, editor.init({ x: 101, y: 100 }));
    fireEvent.pointerUp(editor.canvas, editor.init({ x: 101, y: 100 }));
    fireEvent.click(editor.canvas, {
      ...editor.init({ x: 101, y: 100 }),
      detail: 1,
    });
    const box = editor.container.querySelector<HTMLElement>(".fmd-text-box")!;
    box.id = "fresh";
    await wait(40);

    expect(editor.container.querySelector("[data-editing-block]")).toBe(box);

    contentHeights.fresh = 31;
    window.getSelection()!.collapse(box.firstChild ?? box, 0);
    type(box, "Hello");
    await wait(40);

    expect(editor.outline()).not.toBeNull();
    expect(editor.outline()!.style.height).toBe("35px");

    await wait(320);
    const written = (
      editor.onUpdateSlide.mock.calls.at(-1)?.[0] as { content: string }
    ).content;
    editor.rerenderWithContent(written);
    await wait(60);
    expect(editor.outline()).not.toBeNull();
  });
});

describe("explicit and anchored heights", () => {
  const painted = (style: string) => `
    <div class="fmd-slide" style="position:relative">
      <div id="rect" data-slide-object-id="rect-1" style="position:absolute;left:100px;top:100px;width:320px;background:#e8743b;padding:16px;font-size:18px;${style}">Painted rectangle</div>
    </div>`;

  it("keeps the explicit height of a painted rectangle on an E/W drag", async () => {
    const editor = await mountEditor(painted("height:200px"));
    editor.click("rect", { x: 110, y: 110 });

    dragHandle(editor.handle("e")!, { x: 420, y: 200 }, { dx: -60, dy: 0 });

    const rect = editor.el("rect");
    expect(rect.style.width).toBe("260px");
    expect(rect.style.height).toBe("200px");
    expect(savedElement(editor.onUpdateSlide, "rect").style.height).toBe(
      "200px",
    );
  });

  it("keeps a card's min-height instead of pinning its reflowed height on an E/W drag", async () => {
    const editor = await mountEditor(painted("min-height:120px"));
    contentHeights.rect = 150;
    editor.click("rect", { x: 110, y: 110 });

    dragHandle(editor.handle("w")!, { x: 100, y: 200 }, { dx: 40, dy: 0 });

    const rect = editor.el("rect");
    expect(rect.style.width).toBe("280px");
    expect(rect.style.minHeight).toBe("120px");
    expect(rect.style.height).toBe("");
  });

  it("keeps the height of a bottom-anchored footer when it is nudged", async () => {
    const editor = await mountEditor(`
      <div class="fmd-slide" style="position:relative">
        <p id="footer" data-slide-object-id="footer-1" style="position:absolute;left:60px;bottom:40px;width:300px;font-size:16px">Footer</p>
      </div>`);
    contentHeights.footer = 24;
    editor.click("footer", { x: 70, y: 100 });
    editor.canvas.focus();

    fireEvent.keyDown(editor.canvas, { key: "ArrowRight" });

    const footer = editor.el("footer");
    expect(footer.style.left).toBe("61px");
    // With top written and bottom kept, an auto height would stretch it.
    expect(footer.style.height).toBe("24px");
  });

  it("never gives a rotated fit text box a height when it is resized", async () => {
    const editor = await mountEditor(`
      <div class="fmd-slide" style="position:relative">
        <div id="box" class="fmd-text-box" data-slide-object-id="box-1" style="position:absolute;left:100px;top:100px;width:300px;font-size:24px;transform:matrix(0, 1, -1, 0, 0, 0)">Hello</div>
      </div>`);
    editor.click("box", { x: 110, y: 110 });

    dragHandle(editor.handle("s")!, { x: 250, y: 140 }, { dx: 30, dy: 0 });
    dragHandle(editor.handle("e")!, { x: 400, y: 120 }, { dx: 0, dy: 40 });

    const box = editor.el("box");
    // The E drag travels along the rotated box's width axis.
    expect(box.style.width).not.toBe("300px");
    expect(box.style.height).toBe("");
    expect(box.style.minHeight).toBe("");
    expect(savedElement(editor.onUpdateSlide, "box").style.height).toBe("");
  });
});

describe("duplicating a flow object", () => {
  it("sizes a pasted text leaf by its own content and a card by a minimum", async () => {
    const editor = await mountEditor(FLOW_SLIDE);
    const duplicate = (id: string, point: { x: number; y: number }) => {
      editor.click(id, point);
      editor.canvas.focus();
      fireEvent.keyDown(editor.canvas, { key: "d", metaKey: true });
    };

    duplicate("h2", { x: 420, y: 165 });
    const headings = Array.from(
      editor.container.querySelectorAll<HTMLElement>("h2"),
    );
    expect(headings).toHaveLength(2);
    const pastedHeading = headings.find((heading) => heading.id !== "h2")!;
    expect(pastedHeading.style.position).toBe("absolute");
    expect(pastedHeading.style.height).toBe("");
    expect(pastedHeading.style.minHeight).toBe("");

    duplicate("card", { x: 85, y: 300 });
    const pastedCard = Array.from(
      editor.container.querySelectorAll<HTMLElement>(
        ".fmd-freeform-object, div",
      ),
    ).find(
      (element) =>
        element.id !== "card" &&
        element.style.position === "absolute" &&
        element.textContent?.includes("Card body copy"),
    )!;
    expect(pastedCard).toBeDefined();
    expect(pastedCard.style.height).toBe("");
  });
});
