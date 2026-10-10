// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { Slide } from "@/context/DeckContext";
import { enterSelectionMode } from "@/root";

import { readSlideObjectRotation } from "./slide-object-interactions";
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
// The hull a transformed flow object paints, which is what getBoundingClientRect
// reports for it; its layout box (FLOW_RECTS) stays what offsetWidth reads.
const paintedHulls = new Map<string, Rect>();

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
      const rect =
        (this.style.position !== "absolute" && paintedHulls.get(this.id)) ||
        layoutRect(this);
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
  paintedHulls.clear();
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
    "%s writes width and top edge but never a height (oracle H.1, oracle H.2, oracle H.3, oracle H.4, oracle H.5, oracle H.7)",
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

  describe("a card painted through its own transform", () => {
    const CARD = FLOW_RECTS.card!;
    const rotation = (degrees: number) => {
      const radians = (degrees * Math.PI) / 180;
      return [
        Math.cos(radians),
        Math.sin(radians),
        -Math.sin(radians),
        Math.cos(radians),
        0,
        0,
      ];
    };
    /** The hull `matrix` paints for the card's box about `origin` (box px). */
    const hullOf = (
      [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0]: number[],
      [ox, oy]: [number, number],
    ): Rect => {
      const width = CARD.right - CARD.left;
      const height = CARD.bottom - CARD.top;
      const points = [
        [0, 0],
        [width, 0],
        [0, height],
        [width, height],
      ].map(([x = 0, y = 0]) => ({
        x: CARD.left + ox + a * (x - ox) + c * (y - oy) + e,
        y: CARD.top + oy + b * (x - ox) + d * (y - oy) + f,
      }));
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      return {
        left: Math.min(...xs),
        top: Math.min(...ys),
        right: Math.max(...xs),
        bottom: Math.max(...ys),
      };
    };

    it.each([
      [
        "transform: rotate(20deg); transform-origin: top left",
        rotation(20),
        [0, 0],
      ],
      [
        "transform: rotate(20deg); transform-origin: top",
        rotation(20),
        [180, 0],
      ],
      ["rotate: 20deg; transform-origin: top left", rotation(20), [0, 0]],
      [
        "rotate: 20deg; transform-origin: right bottom",
        rotation(20),
        [360, 80],
      ],
      ["translate: 30px 10px", [1, 0, 0, 1, 30, 10], [180, 40]],
      ["scale: 1.4", [1.4, 0, 0, 1.4, 0, 0], [180, 40]],
    ] as [string, number[], [number, number]][])(
      "promotes the card with `%s` to its layout box",
      async (declarations, matrix, origin) => {
        paintedHulls.set("card", hullOf(matrix, origin));
        const editor = await mountEditor(
          FLOW_SLIDE.replace(
            'id="card" style="',
            `id="card" style="${declarations};`,
          ),
        );

        editor.click("card", { x: 85, y: 300 });
        editor.canvas.focus();
        fireEvent.keyDown(editor.canvas, { key: "ArrowRight" });

        const card = editor.el("card");
        expect(card.style.position).toBe("absolute");
        expect(Number.parseFloat(card.style.left)).toBeCloseTo(
          CARD.left + 1,
          2,
        );
        expect(Number.parseFloat(card.style.top)).toBeCloseTo(CARD.top, 2);
      },
    );
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

  it("gives a click-placed box neither height nor min-height (oracle G.textbox-new-resize-to-fit)", async () => {
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

  it("follows a fit text box as it wraps, without contain or height (oracle T.3, oracle T.4, oracle T.5)", async () => {
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

  it("drops a pending application-state write when the editor unmounts", async () => {
    const editor = await mountEditor(FIT_SLIDE);
    editor.click("box", { x: 110, y: 110 });
    const box = editor.el("box");
    window.getSelection()!.collapse(box.firstChild!, 5);
    type(box, "!");
    await wait(320);
    setClientAppState.mockClear();

    type(box, "x");
    document.dispatchEvent(new Event("selectionchange"));
    expect(setClientAppState).not.toHaveBeenCalled();

    editor.unmount();
    await wait(320);
    expect(setClientAppState).not.toHaveBeenCalled();
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

  it("keeps the authored frame of a fixed-height object (oracle T.8)", async () => {
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

describe("the rotation field of the style inspector", () => {
  const ROTATED_BY_PROPERTY = `
    <div class="fmd-slide" style="position:relative">
      <div id="box" class="fmd-text-box" data-slide-object-id="box-1" style="position:absolute;left:100px;top:100px;width:300px;font-size:24px;rotate:20deg">Hello</div>
    </div>`;

  async function openRotationField(
    editor: Awaited<ReturnType<typeof mountEditor>>,
  ) {
    editor.click("box", { x: 120, y: 110 });
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
    fireEvent.click(
      document.querySelector<HTMLElement>(
        '[aria-label="styleInspector.controls"]',
      )!,
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
    const label = Array.from(document.querySelectorAll("label")).find(
      (candidate) => candidate.textContent === "styleInspector.rotation",
    )!;
    return document.getElementById(label.htmlFor) as HTMLInputElement;
  }

  it("shows the rotation an object gets from the rotate property", async () => {
    const editor = await mountEditor(ROTATED_BY_PROPERTY);

    expect((await openRotationField(editor)).value).toBe("20°");
  });

  it("sets the rotation of an object that has a rotate property instead of adding to it", async () => {
    const editor = await mountEditor(ROTATED_BY_PROPERTY);
    const field = await openRotationField(editor);

    field.focus();
    fireEvent.change(field, { target: { value: "45" } });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.blur(field);
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));

    expect(readSlideObjectRotation(editor.el("box"))).toBeCloseTo(45, 6);
  });

  it.each([
    ["a rotate property with an axis", "rotate:x 20deg"],
    [
      "a transform that is not planar",
      "transform:matrix3d(1,0,0,0,0,1,0,0,0,0,1,0.001,0,0,0,1)",
    ],
  ])(
    "shows the rotation of an object with %s as unavailable and writes nothing",
    async (_name, declaration) => {
      const editor = await mountEditor(
        ROTATED_BY_PROPERTY.replace("rotate:20deg", declaration),
      );
      const field = await openRotationField(editor);
      const style = editor.el("box").getAttribute("style");
      const updates = editor.onUpdateSlide.mock.calls.length;

      expect(field.value).toBe("styleInspector.mixed");
      expect(field.disabled).toBe(true);
      field.focus();
      fireEvent.focus(field);
      fireEvent.blur(field);
      await act(() => new Promise((resolve) => setTimeout(resolve, 60)));

      expect(editor.el("box").getAttribute("style")).toBe(style);
      expect(editor.onUpdateSlide.mock.calls).toHaveLength(updates);
    },
  );

  it.each([
    ["transform:rotate(200deg)", "200°"],
    ["transform:rotate(-30deg)", "330°"],
    ["transform:rotate(370deg)", "10°"],
    ["rotate:-90deg", "270°"],
  ])(
    "shows `%s` as %s, the one range the field reads in",
    async (declaration, shown) => {
      const editor = await mountEditor(
        ROTATED_BY_PROPERTY.replace("rotate:20deg", declaration),
      );

      expect((await openRotationField(editor)).value).toBe(shown);
    },
  );

  it.each([
    ["370", 10],
    ["450", 90],
    ["-400", 320],
    ["360", 0],
  ])(
    "wraps %s typed into the field into the range it reads in",
    async (typed, expected) => {
      const editor = await mountEditor(ROTATED_BY_PROPERTY);
      const field = await openRotationField(editor);

      field.focus();
      fireEvent.change(field, { target: { value: typed } });
      fireEvent.keyDown(field, { key: "Enter" });
      fireEvent.blur(field);
      await act(() => new Promise((resolve) => setTimeout(resolve, 60)));

      expect(readSlideObjectRotation(editor.el("box"))).toBeCloseTo(
        expected,
        6,
      );
    },
  );

  it("steps by the whole step across the turn", async () => {
    const editor = await mountEditor(
      ROTATED_BY_PROPERTY.replace("rotate:20deg", "rotate:355deg"),
    );
    const field = await openRotationField(editor);

    field.focus();
    fireEvent.keyDown(field, { key: "ArrowUp", shiftKey: true });
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));

    expect(readSlideObjectRotation(editor.el("box"))).toBeCloseTo(5, 6);
  });

  it("sets the rotation of a scaled and translated object without dropping either", async () => {
    const editor = await mountEditor(
      ROTATED_BY_PROPERTY.replace(
        "rotate:20deg",
        "transform:matrix(2,0,0,2,10,20)",
      ),
    );
    const field = await openRotationField(editor);

    field.focus();
    fireEvent.change(field, { target: { value: "45" } });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.blur(field);
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));

    const [a = 0, b = 0, , , tx, ty] = (editor
      .el("box")
      .style.transform.match(/^matrix\((.+)\)$/)?.[1]
      ?.split(",")
      .map(Number) ?? []) as number[];
    expect(Math.hypot(a, b)).toBeCloseTo(2, 6);
    expect([tx, ty]).toEqual([10, 20]);
    expect(readSlideObjectRotation(editor.el("box"))).toBeCloseTo(45, 6);
  });

  it("sets the rotation of an object whose rotate property comes from a stylesheet", async () => {
    const style = document.createElement("style");
    style.textContent = ".inspector-rotated { rotate: 20deg; }";
    document.head.append(style);
    try {
      const editor = await mountEditor(
        ROTATED_BY_PROPERTY.replace(";rotate:20deg", "").replace(
          'class="fmd-text-box"',
          'class="fmd-text-box inspector-rotated"',
        ),
      );
      const field = await openRotationField(editor);
      expect(field.value).toBe("20°");

      field.focus();
      fireEvent.change(field, { target: { value: "45" } });
      fireEvent.keyDown(field, { key: "Enter" });
      fireEvent.blur(field);
      await act(() => new Promise((resolve) => setTimeout(resolve, 60)));

      expect(readSlideObjectRotation(editor.el("box"))).toBeCloseTo(45, 6);
    } finally {
      style.remove();
    }
  });

  it("shows the rotation an object paints again when a stylesheet !important transform refuses the edit", async () => {
    const style = document.createElement("style");
    style.textContent =
      ".inspector-pinned { transform: rotate(50deg) !important; }";
    document.head.append(style);
    try {
      const editor = await mountEditor(
        ROTATED_BY_PROPERTY.replace(
          ";rotate:20deg",
          ";transform:rotate(10deg)",
        ).replace(
          'class="fmd-text-box"',
          'class="fmd-text-box inspector-pinned"',
        ),
      );
      const field = await openRotationField(editor);
      expect(field.value).toBe("50°");
      const inline = editor.el("box").getAttribute("style");

      field.focus();
      fireEvent.change(field, { target: { value: "90" } });
      fireEvent.keyDown(field, { key: "Enter" });
      fireEvent.blur(field);
      await act(() => new Promise((resolve) => setTimeout(resolve, 60)));

      expect(editor.el("box").getAttribute("style")).toBe(inline);
      expect(readSlideObjectRotation(editor.el("box"))).toBeCloseTo(50, 6);
      // The field starts over, so it is not the element that was typed into.
      const label = Array.from(document.querySelectorAll("label")).find(
        (candidate) => candidate.textContent === "styleInspector.rotation",
      )!;
      expect(
        (document.getElementById(label.htmlFor) as HTMLInputElement).value,
      ).toBe("50°");
    } finally {
      style.remove();
    }
  });
});

describe("starting to crop an image", () => {
  const painted = (element: HTMLElement) =>
    ["transform", "translate", "rotate", "scale"].map((property) =>
      element.style.getPropertyValue(property),
    );

  it.each([
    ["transform", "transform:rotate(20deg);transform-origin:top left"],
    ["rotate", "rotate:20deg"],
    ["scale", "scale:1.3"],
    ["translate", "translate:40px 10px"],
  ])(
    "moves the image's %s onto the crop frame so nothing shifts (oracle 3.6)",
    async (_name, declaration) => {
      const editor = await mountEditor(`
        <div class="fmd-slide" style="position:relative">
          <img id="pic" data-slide-object-id="pic-1" src="x.png" style="position:absolute;left:200px;top:100px;width:160px;height:90px;${declaration}">
        </div>`);
      const image = editor.el("pic");
      const [transform, translate, rotate, scale] = painted(image);

      stack = [
        image,
        ...Array.from(editor.container.querySelectorAll(".fmd-slide")),
      ];
      fireEvent.doubleClick(image, { clientX: 220, clientY: 120, detail: 2 });
      await act(() => new Promise((resolve) => setTimeout(resolve, 60)));

      const frame = image.closest<HTMLElement>(".fmd-pptx-image")!;
      expect(frame).not.toBeNull();
      expect(painted(frame)).toEqual([transform, translate, rotate, scale]);
      expect(image.style.transform).toBe("none");
      expect(image.style.getPropertyValue("translate")).not.toMatch(/\d/);
      expect(image.style.getPropertyValue("rotate")).not.toMatch(/\d/);
      expect(image.style.getPropertyValue("scale")).not.toMatch(/\d/);
    },
  );

  describe("an image painted through a stylesheet rule", () => {
    const IMAGE_STYLE =
      "position:absolute;left:200px;top:100px;width:160px;height:90px";
    const startCrop = async (
      editor: Awaited<ReturnType<typeof mountEditor>>,
    ) => {
      const image = editor.el("pic");
      stack = [
        image,
        ...Array.from(editor.container.querySelectorAll(".fmd-slide")),
      ];
      fireEvent.doubleClick(image, { clientX: 220, clientY: 120, detail: 2 });
      await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
      return image.closest<HTMLElement>(".fmd-pptx-image");
    };
    const withRule = async (rule: string, run: () => Promise<void>) => {
      const sheet = document.createElement("style");
      sheet.textContent = rule;
      document.head.append(sheet);
      try {
        await run();
      } finally {
        sheet.remove();
      }
    };

    it.each([
      [
        "transform",
        ".ruled { transform: rotate(20deg); transform-origin: top left; }",
      ],
      ["rotate", ".ruled { rotate: 20deg; }"],
      ["scale", ".ruled { scale: 1.3; }"],
      ["translate", ".ruled { translate: 40px 10px; }"],
    ])(
      "moves the %s the rule gives the image onto the crop frame",
      async (property, rule) => {
        await withRule(rule, async () => {
          const editor = await mountEditor(`
            <div class="fmd-slide" style="position:relative">
              <img id="pic" class="ruled" data-slide-object-id="pic-1" src="x.png" style="${IMAGE_STYLE}">
            </div>`);
          const image = editor.el("pic");
          const effective = window
            .getComputedStyle(image)
            .getPropertyValue(property);
          expect(effective).not.toBe("");

          const frame = await startCrop(editor);

          expect(frame).not.toBeNull();
          expect(frame!.style.getPropertyValue(property)).toBe(effective);
          expect(
            window.getComputedStyle(image).getPropertyValue(property),
          ).toBe("none");
          expect(image.style.getPropertyPriority(property)).toBe("important");
          expect(frame!.style.transformOrigin).toBe(
            property === "transform" ? "top left" : "",
          );
        });
      },
    );

    it("puts the image back exactly as it was when the crop ends unchanged (oracle 3.6)", async () => {
      await withRule(
        ".ruled { transform: rotate(20deg); rotate: 5deg; }",
        async () => {
          const editor = await mountEditor(`
            <div class="fmd-slide" style="position:relative">
              <img id="pic" class="ruled" data-slide-object-id="pic-1" src="x.png" style="${IMAGE_STYLE}">
            </div>`);
          const originalImage = editor.el("pic");
          const original = originalImage.outerHTML;

          expect(await startCrop(editor)).not.toBeNull();
          fireEvent.keyDown(window, { key: "Escape" });
          await act(() => new Promise((resolve) => setTimeout(resolve, 60)));

          expect(editor.el("pic")).toBe(originalImage);
          expect(editor.el("pic").outerHTML).toBe(original);
          expect(editor.container.querySelector(".fmd-pptx-image")).toBeNull();
        },
      );
    });

    it("leaves a transform on the image's wrapper with the wrapper", async () => {
      await withRule(".ruled { transform: rotate(20deg); }", async () => {
        const editor = await mountEditor(`
          <div class="fmd-slide" style="position:relative">
            <div id="wrap" class="ruled" style="position:absolute;left:100px;top:50px;width:300px;height:200px">
              <img id="pic" data-slide-object-id="pic-1" src="x.png" style="position:absolute;left:20px;top:10px;width:160px;height:90px">
            </div>
          </div>`);

        const frame = await startCrop(editor);

        expect(frame?.parentElement).toBe(editor.el("wrap"));
        expect(frame!.style.transform).toBe("");
        expect(frame!.style.transformOrigin).toBe("");
        expect(editor.el("wrap").style.transform).toBe("");
      });
    });
  });
});

describe("releasing the press of a gesture Escape cancelled", () => {
  const HELD = 7;
  const PAIR_SLIDE = `
    <div class="fmd-slide" style="position:relative">
      <div id="box" class="fmd-text-box" data-slide-object-id="box-1" style="position:absolute;left:100px;top:100px;width:300px;height:40px;font-size:24px">Hello</div>
      <div id="other" class="fmd-text-box" data-slide-object-id="box-2" style="position:absolute;left:100px;top:300px;width:300px;height:40px;font-size:24px">World</div>
    </div>`;
  type Editor = Awaited<ReturnType<typeof mountEditor>>;

  const press = (target: HTMLElement, point: { x: number; y: number }) =>
    fireEvent.pointerDown(target, {
      button: 0,
      pointerId: HELD,
      clientX: point.x,
      clientY: point.y,
    });
  const chainOf = (element: HTMLElement) => {
    const chain: Element[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      chain.push(node);
    }
    return chain;
  };
  const selectBoth = (editor: Editor) => {
    editor.click("box", { x: 110, y: 110 });
    stack = chainOf(editor.el("other"));
    const point = editor.init({ x: 110, y: 310 });
    fireEvent.pointerDown(editor.el("other"), { ...point, shiftKey: true });
    fireEvent.pointerUp(editor.el("other"), { ...point, shiftKey: true });
    fireEvent.click(editor.el("other"), {
      ...point,
      shiftKey: true,
      detail: 1,
    });
  };

  it.each<
    [
      string,
      Partial<ComponentProps<typeof SlideEditor>>,
      (editor: Editor) => void,
    ]
  >([
    [
      "an element drag",
      {},
      (editor) => {
        editor.click("box", { x: 110, y: 110 });
        press(
          document.querySelector<HTMLElement>("[data-slide-move-handle]")!,
          { x: 250, y: 100 },
        );
      },
    ],
    [
      "an element resize",
      {},
      (editor) => {
        editor.click("box", { x: 110, y: 110 });
        press(editor.handle("e")!, { x: 400, y: 120 });
      },
    ],
    [
      "a rotation",
      {},
      (editor) => {
        editor.click("box", { x: 110, y: 110 });
        press(
          document.querySelector<HTMLElement>("[data-slide-rotate-handle]")!,
          { x: 250, y: 60 },
        );
      },
    ],
    [
      "a group resize",
      {},
      (editor) => {
        selectBoth(editor);
        press(editor.handle("e")!, { x: 400, y: 220 });
      },
    ],
    [
      "a group drag",
      {},
      (editor) => {
        selectBoth(editor);
        stack = chainOf(editor.el("box"));
        press(editor.el("box"), { x: 110, y: 110 });
      },
    ],
    [
      "a shape placement",
      { shapeType: "rectangle" },
      (editor) => {
        stack = chainOf(editor.el("box"));
        press(editor.el("box"), { x: 600, y: 400 });
      },
    ],
    [
      "a text box placement",
      { textBoxMode: true },
      (editor) => {
        stack = chainOf(editor.el("box"));
        press(editor.el("box"), { x: 600, y: 400 });
      },
    ],
  ])(
    "swallows the release click of the pointer that began %s (oracle 4.7)",
    async (_name, props, begin) => {
      const editor = await mountEditor(PAIR_SLIDE, props);
      begin(editor);
      fireEvent.pointerMove(window, {
        pointerId: HELD,
        clientX: 650,
        clientY: 450,
        buttons: 1,
      });
      fireEvent.keyDown(window, { key: "Escape" });
      vi.mocked(enterSelectionMode).mockClear();

      stack = chainOf(editor.el("box"));
      fireEvent.pointerUp(window, {
        pointerId: HELD,
        clientX: 650,
        clientY: 450,
      });
      fireEvent(
        editor.el("box"),
        new PointerEvent("click", {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: HELD,
          clientX: 650,
          clientY: 450,
          detail: 1,
        }),
      );

      expect(enterSelectionMode).not.toHaveBeenCalled();
      expect(
        document.querySelector("[data-slide-selection-outline]"),
      ).toBeNull();
    },
  );
});
