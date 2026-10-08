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
vi.mock("@/components/deck/ExcalidrawSlide", () => ({
  ExcalidrawSlide: () => <div data-excalidraw-canvas="true" />,
  ExcalidrawThumbnail: () => null,
  parseExcalidrawData: (json?: string) => (json ? JSON.parse(json) : null),
}));
vi.mock("@/root", () => ({ enterSelectionMode: vi.fn() }));

type Rect = { left: number; top: number; right: number; bottom: number };

// The clip slide: an unpainted container holding a left column (callout and
// card) and a chart block with a caption, wrapped in unpainted rows.
const CLIP_SLIDE = `
  <div class="fmd-slide" style="position:relative">
    <div id="container" style="display:flex;gap:24px">
      <div id="left" style="display:flex;flex-direction:column">
        <h2 id="h2">A spectrum, not a switch</h2>
        <div id="callout" style="background:#1b1b1b;border-left:3px solid #f97316;padding:12px">Eruption style depends on magma.</div>
        <div id="card" style="background:#14181d;padding:16px">
          <h3 id="cardTitle">Stat</h3><p id="cardBody">Card body copy</p>
        </div>
      </div>
      <div id="chart">
        <div id="row1"><div id="labelA">More fluid</div><div id="labelB">lava can travel farther</div></div>
        <p id="caption">Conceptual tendencies, not a prediction scale</p>
      </div>
    </div>
  </div>`;

const GROUP_SLIDE = `
  <div class="fmd-slide" style="position:relative">
    <div id="group" class="fmd-slide-group" data-slide-group="true" data-slide-object-id="group-1" style="position:absolute;left:100px;top:100px;width:400px;height:120px">
      <div id="memberA" class="fmd-text-box" data-slide-object-id="member-a" style="position:absolute;left:0;top:0;width:180px;font-size:24px">First member</div>
      <div id="memberB" class="fmd-text-box" data-slide-object-id="member-b" style="position:absolute;left:200px;top:0;width:180px;font-size:24px">Second member</div>
    </div>
  </div>`;

// A group whose members are an image and a text box: the group is not a
// rich-text block, so its selection chrome used to carry a full-body mover.
const GROUP_IMAGE_SLIDE = `
  <div class="fmd-slide" style="position:relative">
    <div id="imgGroup" class="fmd-slide-group" data-slide-group="true" data-slide-object-id="group-2" style="position:absolute;left:100px;top:300px;width:400px;height:120px">
      <img id="memberImg" data-slide-object-id="member-img" src="x.png" style="position:absolute;left:0;top:0;width:100px;height:100px">
      <div id="memberC" class="fmd-text-box" data-slide-object-id="member-c" style="position:absolute;left:200px;top:0;width:180px;font-size:24px">Third member</div>
    </div>
  </div>`;

const TABLE_SLIDE = `
  <div class="fmd-slide" style="position:relative">
    <table id="table"><tbody><tr id="tr">
      <td id="cell" style="padding:20px">Cell text</td>
      <td id="emptyCell" style="padding:20px"></td>
    </tr></tbody></table>
  </div>`;

const TEXT_RECTS: Record<string, Rect> = {
  cell: { left: 150, top: 150, right: 250, bottom: 170 },
  memberC: { left: 300, top: 300, right: 450, bottom: 330 },
  h2: { left: 80, top: 150, right: 400, bottom: 180 },
  callout: { left: 95, top: 250, right: 380, bottom: 270 },
  cardTitle: { left: 96, top: 300, right: 140, bottom: 320 },
  cardBody: { left: 96, top: 330, right: 300, bottom: 350 },
  labelA: { left: 500, top: 150, right: 570, bottom: 165 },
  labelB: { left: 780, top: 150, right: 900, bottom: 165 },
  caption: { left: 500, top: 270, right: 800, bottom: 285 },
  memberA: { left: 100, top: 100, right: 250, bottom: 130 },
  memberB: { left: 300, top: 100, right: 450, bottom: 130 },
};

const BOX_RECTS: Record<string, Rect> = {
  table: { left: 100, top: 100, right: 500, bottom: 200 },
  tr: { left: 100, top: 100, right: 500, bottom: 200 },
  cell: { left: 100, top: 100, right: 300, bottom: 200 },
  emptyCell: { left: 300, top: 100, right: 500, bottom: 200 },
  imgGroup: { left: 100, top: 300, right: 500, bottom: 420 },
  memberImg: { left: 100, top: 300, right: 200, bottom: 400 },
  memberC: { left: 300, top: 300, right: 480, bottom: 340 },
  container: { left: 60, top: 120, right: 960, bottom: 520 },
  left: { left: 60, top: 140, right: 460, bottom: 520 },
  chart: { left: 480, top: 140, right: 960, bottom: 520 },
  row1: { left: 480, top: 140, right: 960, bottom: 200 },
  h2: { left: 80, top: 145, right: 440, bottom: 185 },
  callout: { left: 80, top: 235, right: 440, bottom: 285 },
  card: { left: 80, top: 290, right: 440, bottom: 370 },
  cardTitle: { left: 96, top: 296, right: 424, bottom: 324 },
  cardBody: { left: 96, top: 326, right: 424, bottom: 354 },
  caption: { left: 480, top: 262, right: 960, bottom: 292 },
  group: { left: 100, top: 100, right: 500, bottom: 220 },
  memberA: { left: 100, top: 100, right: 280, bottom: 140 },
  memberB: { left: 300, top: 100, right: 480, bottom: 140 },
};

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

let stack: Element[] = [];
const originalOffsets = new Map<string, PropertyDescriptor | undefined>();

beforeEach(() => {
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  vi.mocked(enterSelectionMode).mockClear();
  // happy-dom has no layout, so every geometry the resolver reads is stubbed.
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: () => stack,
  });
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value(this: Range) {
      const owner = this.startContainer.parentElement;
      const rect = owner ? TEXT_RECTS[owner.id] : undefined;
      return rect ? [toDomRect(rect)] : [];
    },
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const rect = BOX_RECTS[this.id];
      if (rect) return toDomRect(rect);
      return isSlideLayer(this)
        ? new DOMRect(0, 0, 1200, 675)
        : new DOMRect(0, 0, 0, 0);
    },
  );
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: () => {},
  });
  // The slide layers are 1200x675; an object sits where its inline left/top say.
  const offsets = {
    offsetWidth: (el: HTMLElement) => (isSlideLayer(el) ? 1200 : 0),
    offsetHeight: (el: HTMLElement) => (isSlideLayer(el) ? 675 : 0),
    offsetLeft: (el: HTMLElement) => Number.parseFloat(el.style.left) || 0,
    offsetTop: (el: HTMLElement) => Number.parseFloat(el.style.top) || 0,
  };
  for (const [property, read] of Object.entries(offsets)) {
    originalOffsets.set(
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
  for (const [property, descriptor] of originalOffsets) {
    if (descriptor) {
      Object.defineProperty(HTMLElement.prototype, property, descriptor);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, property);
    }
  }
  originalOffsets.clear();
  stack = [];
  window.getSelection()?.removeAllRanges();
});

async function mountEditor(
  content: string,
  props: Partial<ComponentProps<typeof SlideEditor>> = {},
) {
  const slide = { id: "slide-pointer", content, layout: "blank" } as Slide;
  const view = render(
    <SlideEditor
      {...props}
      slide={slide}
      onUpdateSlide={props.onUpdateSlide ?? (() => undefined)}
      onGenerateImage={noop}
      onOpenAssetLibrary={noop}
      onUploadImage={noop}
      onToggleObjectFit={noop}
      onChangeObjectPosition={noop}
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
  const init = (
    point: { x: number; y: number },
    extra: Record<string, unknown> = {},
  ) => ({
    button: 0,
    pointerId: 1,
    clientX: point.x,
    clientY: point.y,
    ...extra,
  });
  /** Selector the editor last asked the host to select, as an element. */
  const lastSelected = () => {
    const calls = vi.mocked(enterSelectionMode).mock.calls;
    const selector = (calls[calls.length - 1]?.[1] as { selector?: string })
      ?.selector;
    return selector
      ? view.container.querySelector<HTMLElement>(selector)
      : null;
  };
  const press = (
    id: string,
    point: { x: number; y: number },
    extra: Record<string, unknown> = {},
  ) => {
    stack = chainOf(id);
    fireEvent.pointerDown(el(id), init(point, extra));
  };
  const release = (
    id: string,
    point: { x: number; y: number },
    extra: Record<string, unknown> = {},
  ) => {
    stack = chainOf(id);
    fireEvent.pointerUp(el(id), init(point, extra));
    fireEvent.click(el(id), { ...init(point, extra), detail: 1 });
  };
  const click = (
    id: string,
    point: { x: number; y: number },
    extra: Record<string, unknown> = {},
  ) => {
    press(id, point, extra);
    release(id, point, extra);
  };
  const hover = (id: string, point: { x: number; y: number }) => {
    stack = chainOf(id);
    fireEvent.pointerMove(el(id), { ...init(point), buttons: 0 });
  };
  const hasSelection = () =>
    canvas.closest("[data-slide-element-selected='true']") !== null ||
    view.container.querySelector("[data-slide-element-selected='true']") !==
      null;
  const isEditing = (id: string) =>
    el(id).getAttribute("contenteditable") === "true";
  /** Which stubbed box the hover outline is drawn around. */
  const hoverOutlineOwner = () => {
    const outline = document.querySelector<HTMLElement>(
      "[data-slide-layer-hover-outline='true']",
    );
    if (!outline) return null;
    const top = Number.parseFloat(outline.style.top) + 2;
    const left = Number.parseFloat(outline.style.left) + 2;
    return (
      Object.entries(BOX_RECTS).find(
        ([, rect]) => rect.top === top && rect.left === left,
      )?.[0] ?? null
    );
  };
  /** Top/height of the live (non-parent) selection outline, in stubbed px. */
  const outlineBox = () => {
    const outline = document.querySelector<HTMLElement>(
      "[data-slide-selection-outline='true']:not([data-slide-selection-chrome-parent])",
    );
    return outline
      ? {
          top: Number.parseFloat(outline.style.top) + 2,
          height: Number.parseFloat(outline.style.height) - 4,
        }
      : null;
  };
  return {
    ...view,
    el,
    canvas,
    chainOf,
    outlineBox,
    click,
    press,
    release,
    hover,
    lastSelected,
    hasSelection,
    isEditing,
    hoverOutlineOwner,
    init,
  };
}

describe("SlideEditor pointer pipeline on the clip slide", () => {
  it("treats wrapper whitespace as empty slide at every nesting level", async () => {
    const editor = await mountEditor(CLIP_SLIDE);
    const wrappers = ["row1", "chart", "container", "left"] as const;

    for (const wrapper of wrappers) {
      // Select the card first so a stray wrapper hit would replace it.
      editor.click("card", { x: 85, y: 300 });
      expect(editor.lastSelected()).toBe(editor.el("card"));
      expect(editor.hasSelection()).toBe(true);

      vi.mocked(enterSelectionMode).mockClear();
      editor.hover(wrapper, { x: 700, y: 210 });
      expect(editor.canvas.style.cursor).toBe("");
      expect(editor.hoverOutlineOwner()).toBeNull();

      editor.press(wrapper, { x: 700, y: 210 });
      expect(editor.hasSelection()).toBe(false);
      editor.release(wrapper, { x: 700, y: 210 });
      expect(editor.hasSelection()).toBe(false);
      expect(enterSelectionMode).not.toHaveBeenCalled();
    }
  });

  it("starts a marquee from wrapper whitespace instead of dragging the wrapper", async () => {
    const editor = await mountEditor(CLIP_SLIDE);

    editor.press("chart", { x: 700, y: 210 });
    fireEvent.pointerMove(window, { clientX: 760, clientY: 260, pointerId: 1 });
    expect(
      document.querySelector("[data-slide-marquee='true']"),
    ).not.toBeNull();
    fireEvent.pointerUp(window, { clientX: 760, clientY: 260, pointerId: 1 });
    expect(document.querySelector("[data-slide-marquee='true']")).toBeNull();
    expect(editor.el("chart").style.position).toBe("");
    expect(editor.el("container").style.position).toBe("");
  });

  it("edits the caption at its text while another object is selected", async () => {
    const editor = await mountEditor(CLIP_SLIDE);

    editor.click("card", { x: 85, y: 300 });
    expect(editor.lastSelected()).toBe(editor.el("card"));
    expect(editor.isEditing("cardBody")).toBe(false);

    editor.hover("caption", { x: 600, y: 278 });
    expect(editor.canvas.style.cursor).toBe("text");

    editor.click("caption", { x: 600, y: 278 });
    expect(editor.isEditing("caption")).toBe(true);
    expect(editor.isEditing("card")).toBe(false);
    const selection = window.getSelection()!;
    expect(selection.rangeCount).toBe(1);
    expect(selection.isCollapsed).toBe(true);
    expect(editor.el("caption").contains(selection.anchorNode)).toBe(true);
  });

  it("selects a painted callout from its padding and edits it from its text", async () => {
    const editor = await mountEditor(CLIP_SLIDE);

    editor.hover("callout", { x: 85, y: 262 });
    expect(editor.canvas.style.cursor).toBe("move");
    editor.click("callout", { x: 85, y: 262 });
    expect(editor.lastSelected()).toBe(editor.el("callout"));
    expect(editor.isEditing("callout")).toBe(false);

    editor.hover("callout", { x: 200, y: 260 });
    expect(editor.canvas.style.cursor).toBe("text");
    editor.click("callout", { x: 200, y: 260 });
    expect(editor.isEditing("callout")).toBe(true);
  });

  it("moves only the card when dragged from its padding", async () => {
    const editor = await mountEditor(CLIP_SLIDE);

    editor.press("card", { x: 85, y: 300 });
    fireEvent.pointerMove(window, { clientX: 125, clientY: 330, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 125, clientY: 330, pointerId: 1 });

    const card = editor.el("card");
    expect(card.style.position).toBe("absolute");
    // The object follows the full displacement from the press origin.
    expect(card.style.left).toBe("120px");
    expect(card.style.top).toBe("320px");
    for (const id of ["h2", "callout", "left", "container", "cardBody"]) {
      expect(editor.el(id).style.position, id).not.toBe("absolute");
    }
  });

  it("leaves the card where it was when Escape cancels the drag", async () => {
    const editor = await mountEditor(CLIP_SLIDE);

    editor.press("card", { x: 85, y: 300 });
    fireEvent.pointerMove(window, { clientX: 125, clientY: 330, pointerId: 1 });
    expect(editor.el("card").style.position).toBe("absolute");

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerUp(window, { clientX: 125, clientY: 330, pointerId: 1 });

    expect(editor.el("card").style.position).toBe("");
    expect(editor.el("card").hasAttribute("data-slide-object-id")).toBe(false);
    expect(editor.hasSelection()).toBe(false);
  });

  it("never moves an object from a press on its text", async () => {
    const editor = await mountEditor(CLIP_SLIDE);

    editor.press("caption", { x: 520, y: 278 });
    fireEvent.pointerMove(window, { clientX: 700, clientY: 278, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 700, clientY: 278, pointerId: 1 });

    expect(editor.el("caption").style.position).toBe("");
    expect(editor.el("caption").hasAttribute("data-slide-object-id")).toBe(
      false,
    );
  });

  it("keeps a text drag that ends in another leaf inside the leaf it started in", async () => {
    const editor = await mountEditor(CLIP_SLIDE);
    const caption = editor.el("caption");
    const labelB = editor.el("labelB");

    editor.press("caption", { x: 520, y: 278 });
    // The browser extended its native selection across both leaves.
    window
      .getSelection()!
      .setBaseAndExtent(caption.firstChild!, 3, labelB.firstChild!, 4);
    stack = [editor.el("chart")];
    fireEvent.pointerUp(editor.el("chart"), editor.init({ x: 800, y: 157 }));
    fireEvent.click(editor.el("chart"), {
      ...editor.init({ x: 800, y: 157 }),
      detail: 1,
    });

    expect(editor.isEditing("caption")).toBe(true);
    expect(editor.isEditing("labelB")).toBe(false);
    expect(editor.isEditing("chart")).toBe(false);
    const selection = window.getSelection()!;
    expect(caption.contains(selection.anchorNode)).toBe(true);
    expect(caption.contains(selection.focusNode)).toBe(true);
  });

  it("selects a text object with all of its text on Enter", async () => {
    const editor = await mountEditor(CLIP_SLIDE);

    editor.click("callout", { x: 85, y: 262 });
    expect(editor.isEditing("callout")).toBe(false);

    fireEvent.keyDown(editor.canvas, { key: "Enter" });
    expect(editor.isEditing("callout")).toBe(true);
    expect(window.getSelection()!.toString()).toBe(
      "Eruption style depends on magma.",
    );
  });

  it("nudges only while the slide canvas owns focus", async () => {
    const editor = await mountEditor(CLIP_SLIDE);
    const filmstripThumbnail = document.createElement("button");
    document.body.append(filmstripThumbnail);

    editor.click("callout", { x: 85, y: 262 });
    filmstripThumbnail.focus();
    fireEvent.keyDown(filmstripThumbnail, { key: "ArrowRight" });
    expect(editor.el("callout").style.position).toBe("");

    editor.canvas.focus();
    fireEvent.keyDown(editor.canvas, { key: "ArrowRight" });
    expect(editor.el("callout").style.position).toBe("absolute");
    filmstripThumbnail.remove();
  });

  it("outlines on hover the object a press then selects", async () => {
    const editor = await mountEditor(CLIP_SLIDE);
    const probes: Array<[string, { x: number; y: number }]> = [
      ["card", { x: 85, y: 300 }],
      ["cardBody", { x: 200, y: 340 }],
      ["callout", { x: 85, y: 262 }],
      ["caption", { x: 820, y: 278 }],
    ];

    for (const [id, point] of probes) {
      vi.mocked(enterSelectionMode).mockClear();
      editor.hover(id, point);
      const outlined = editor.hoverOutlineOwner();
      expect(outlined, id).not.toBeNull();
      editor.click(id, point);
      expect(editor.lastSelected(), id).toBe(editor.el(outlined!));
      // Clear for the next probe so the selected object is never re-outlined.
      fireEvent.keyDown(window, { key: "Escape" });
    }
  });
});

describe("SlideEditor pointer pipeline selection and press fixes", () => {
  it("lets presses reach the members of a multi-selection", async () => {
    const editor = await mountEditor(CLIP_SLIDE);
    const moveHandle = () =>
      document.querySelector("[data-slide-group-move-handle]");

    editor.click("callout", { x: 85, y: 262 });
    editor.click("card", { x: 85, y: 300 }, { shiftKey: true });
    // callout 235-285 and card 290-370 share one union outline.
    expect(editor.outlineBox()).toEqual({ top: 235, height: 135 });
    expect(moveHandle()).toBeNull();
    expect(document.querySelector("[data-slide-move-handle]")).not.toBeNull();

    // A plain click on a member without travel keeps the multi-selection.
    editor.click("callout", { x: 85, y: 262 });
    expect(editor.outlineBox()).toEqual({ top: 235, height: 135 });

    // Shift-click on a member removes it, again adds it.
    editor.click("callout", { x: 85, y: 262 }, { shiftKey: true });
    expect(editor.outlineBox()).toEqual({ top: 290, height: 80 });
    editor.click("callout", { x: 85, y: 262 }, { shiftKey: true });
    expect(editor.outlineBox()).toEqual({ top: 235, height: 135 });

    // Empty space inside the union bbox clears it.
    editor.press("left", { x: 200, y: 287 });
    editor.release("left", { x: 200, y: 287 });
    expect(editor.outlineBox()).toBeNull();
  });

  it("gives a selected group edge bands but no full-body mover", async () => {
    const editor = await mountEditor(GROUP_IMAGE_SLIDE);

    editor.click("memberImg", { x: 150, y: 350 });
    expect(editor.lastSelected()).toBe(editor.el("imgGroup"));
    expect(editor.outlineBox()).not.toBeNull();
    expect(document.querySelector("[data-slide-group-move-handle]")).toBeNull();
    expect(document.querySelector("[data-slide-move-handle]")).not.toBeNull();

    // The press goes through the pipeline: the next click drills to the member.
    editor.click("memberImg", { x: 150, y: 350 });
    expect(editor.lastSelected()).toBe(editor.el("memberImg"));
  });

  it("never lifts a table cell out of its table", async () => {
    const editor = await mountEditor(TABLE_SLIDE);

    for (const [id, point] of [
      ["cell", { x: 110, y: 110 }],
      ["emptyCell", { x: 310, y: 110 }],
    ] as const) {
      editor.press(id, point);
      fireEvent.pointerMove(window, {
        clientX: point.x + 40,
        clientY: point.y + 30,
        pointerId: 1,
      });
      fireEvent.pointerUp(window, {
        clientX: point.x + 40,
        clientY: point.y + 30,
        pointerId: 1,
      });
      expect(editor.el(id).style.position, id).toBe("");
      expect(editor.el(id).hasAttribute("data-slide-object-id"), id).toBe(
        false,
      );
      expect(
        document.querySelector("[data-slide-layout-spacer-for]"),
        id,
      ).toBeNull();
    }

    // A click on cell padding still selects the cell for styling.
    editor.click("emptyCell", { x: 310, y: 110 });
    expect(editor.lastSelected()).toBe(editor.el("emptyCell"));
  });

  it.each([
    ["a shape tool", { shapeType: "rectangle" as const }],
    ["the text box tool", { textBoxMode: true }],
    ["pin mode", { pinMode: true }],
    ["draw mode", { drawMode: true }],
  ])(
    "shows no hover outline or object cursor while %s is armed",
    async (_, props) => {
      const editor = await mountEditor(CLIP_SLIDE, props);

      editor.hover("caption", { x: 600, y: 278 });
      expect(editor.canvas.style.cursor).toBe("");
      expect(editor.hoverOutlineOwner()).toBeNull();
    },
  );

  it("edits the first leaf of a multi-leaf card from a double-click or Enter", async () => {
    const editor = await mountEditor(CLIP_SLIDE);

    stack = editor.chainOf("card");
    fireEvent.doubleClick(editor.el("card"), {
      clientX: 85,
      clientY: 300,
      detail: 2,
    });
    expect(editor.isEditing("cardTitle")).toBe(true);
    const selection = window.getSelection()!;
    expect(selection.isCollapsed).toBe(true);
    expect(selection.anchorOffset).toBe(0);
    expect(editor.el("cardTitle").contains(selection.anchorNode)).toBe(true);
    expect(editor.isEditing("cardBody")).toBe(false);
  });

  it("selects all of the first leaf when Enter edits a multi-leaf card", async () => {
    const editor = await mountEditor(CLIP_SLIDE);

    editor.click("card", { x: 85, y: 300 });
    expect(editor.lastSelected()).toBe(editor.el("card"));
    fireEvent.keyDown(editor.canvas, { key: "Enter" });
    expect(editor.isEditing("cardTitle")).toBe(true);
    expect(window.getSelection()!.toString()).toBe("Stat");
  });

  it("keeps the caret when a padding double-click lands inside the block being edited", async () => {
    const editor = await mountEditor(CLIP_SLIDE);
    const caption = editor.el("caption");

    editor.click("caption", { x: 600, y: 278 });
    expect(editor.isEditing("caption")).toBe(true);
    window
      .getSelection()!
      .setBaseAndExtent(caption.firstChild!, 7, caption.firstChild!, 7);

    // Past the line's right edge: the padding of the block being edited.
    stack = editor.chainOf("caption");
    fireEvent.doubleClick(caption, { clientX: 820, clientY: 278, detail: 2 });
    expect(editor.isEditing("caption")).toBe(true);
    expect(window.getSelection()!.anchorOffset).toBe(7);
  });

  it("clamps the native highlight to the press leaf while the button is down", async () => {
    const editor = await mountEditor(CLIP_SLIDE);
    const caption = editor.el("caption");
    const labelB = editor.el("labelB");

    editor.press("caption", { x: 520, y: 278 });
    window
      .getSelection()!
      .setBaseAndExtent(caption.firstChild!, 3, labelB.firstChild!, 4);
    document.dispatchEvent(new Event("selectionchange"));

    const selection = window.getSelection()!;
    expect(caption.contains(selection.anchorNode)).toBe(true);
    expect(caption.contains(selection.focusNode)).toBe(true);

    // Released: later selection changes are the browser's again.
    fireEvent.pointerUp(window, { clientX: 520, clientY: 278, pointerId: 1 });
    selection.setBaseAndExtent(caption.firstChild!, 3, labelB.firstChild!, 4);
    document.dispatchEvent(new Event("selectionchange"));
    expect(labelB.contains(window.getSelection()!.focusNode)).toBe(true);
  });

  it("does not click-select the pressed object when the mouse is released after Escape", async () => {
    const editor = await mountEditor(CLIP_SLIDE);

    editor.press("card", { x: 85, y: 300 });
    fireEvent.pointerMove(window, { clientX: 125, clientY: 330, pointerId: 1 });
    fireEvent.keyDown(window, { key: "Escape" });
    vi.mocked(enterSelectionMode).mockClear();

    editor.release("card", { x: 125, y: 330 });
    expect(editor.hasSelection()).toBe(false);
    expect(enterSelectionMode).not.toHaveBeenCalled();

    // The suppression is spent: the next click selects normally.
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    editor.click("card", { x: 85, y: 300 });
    expect(editor.lastSelected()).toBe(editor.el("card"));
  });
});

describe("SlideEditor pointer pipeline on groups", () => {
  it("drills from the group to a member, clears on one Escape, edits on double-click", async () => {
    const editor = await mountEditor(GROUP_SLIDE);

    editor.click("memberA", { x: 110, y: 140 });
    expect(editor.lastSelected()).toBe(editor.el("group"));

    editor.click("memberA", { x: 110, y: 140 });
    expect(editor.lastSelected()).toBe(editor.el("memberA"));
    expect(editor.isEditing("memberA")).toBe(false);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(editor.hasSelection()).toBe(false);

    stack = [editor.el("memberB"), editor.el("group")];
    fireEvent.doubleClick(editor.el("memberB"), {
      clientX: 350,
      clientY: 115,
      detail: 2,
    });
    expect(editor.isEditing("memberB")).toBe(true);
    expect(editor.isEditing("group")).toBe(false);
  });
});

describe("SlideEditor pointer pipeline Alt-drag of a multi-selection", () => {
  const mountSelectedPair = async () => {
    const updates: string[] = [];
    const editor = await mountEditor(CLIP_SLIDE, {
      onUpdateSlide: (update) => {
        if (typeof update.content === "string") updates.push(update.content);
      },
    });
    editor.click("callout", { x: 85, y: 262 });
    editor.click("card", { x: 85, y: 300 }, { shiftKey: true });
    return { editor, updates };
  };
  const dragTo = (x: number, y: number, extra: Record<string, unknown> = {}) =>
    fireEvent.pointerMove(window, {
      clientX: x,
      clientY: y,
      pointerId: 1,
      ...extra,
    });
  const dropAt = (x: number, y: number, extra: Record<string, unknown> = {}) =>
    fireEvent.pointerUp(window, {
      clientX: x,
      clientY: y,
      pointerId: 1,
      ...extra,
    });
  /** Object id -> left/top of every absolutely positioned object in html. */
  const placements = (html: string) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return Array.from(
      doc.querySelectorAll<HTMLElement>("[data-slide-object-id]"),
    ).map((node) => ({
      id: node.getAttribute("data-slide-object-id"),
      text: (node.textContent ?? "").trim().slice(0, 12),
      left: node.style.left,
      top: node.style.top,
    }));
  };

  it("leaves the originals and drops selected copies at the drag delta", async () => {
    const { editor, updates } = await mountSelectedPair();

    editor.press("callout", { x: 85, y: 262 }, { altKey: true });
    dragTo(125, 292, { altKey: true });
    expect(editor.el("callout").style.left).toBe("80px");
    expect(editor.el("card").style.top).toBe("290px");
    dropAt(125, 292, { altKey: true });

    expect(updates).toHaveLength(1);
    const objects = placements(updates[0]);
    expect(objects).toHaveLength(4);
    expect(new Set(objects.map((object) => object.id)).size).toBe(4);
    // Snapping may trim the delta, but it trims it for both copies alike.
    const copyOffset = (text: string, originalTop: number) => {
      const [original, copy] = objects
        .filter((object) => object.text.startsWith(text))
        .sort((a, b) => Number.parseFloat(a.left) - Number.parseFloat(b.left));
      expect(original).toMatchObject({ left: "80px", top: `${originalTop}px` });
      expect(copy.left).toBe("120px");
      return Number.parseFloat(copy.top) - originalTop;
    };
    const calloutDy = copyOffset("Eruption", 235);
    expect(copyOffset("Stat", 290)).toBe(calloutDy);
    expect(calloutDy).toBeGreaterThan(20);
  });

  it("moves the originals when Alt is released before the drop", async () => {
    const { editor, updates } = await mountSelectedPair();

    editor.press("callout", { x: 85, y: 262 }, { altKey: true });
    dragTo(125, 292, { altKey: true });
    dragTo(125, 292);
    dropAt(125, 292);

    expect(updates).toHaveLength(1);
    const objects = placements(updates[0]);
    expect(objects).toHaveLength(2);
    expect(objects[0]).toMatchObject({ left: "120px", top: "265px" });
    expect(objects[1]).toMatchObject({ left: "120px", top: "320px" });
  });

  it("moves the originals when Alt is released on the drop itself", async () => {
    const { editor, updates } = await mountSelectedPair();

    editor.press("callout", { x: 85, y: 262 }, { altKey: true });
    dragTo(125, 292, { altKey: true });
    dropAt(125, 292);

    const objects = placements(updates[0]);
    expect(objects).toHaveLength(2);
    expect(objects[0]).toMatchObject({ left: "120px", top: "265px" });
  });

  it("removes the copies and persists nothing when Escape cancels", async () => {
    const { editor, updates } = await mountSelectedPair();

    editor.press("callout", { x: 85, y: 262 }, { altKey: true });
    dragTo(125, 292, { altKey: true });
    fireEvent.keyDown(window, { key: "Escape" });
    dropAt(125, 292, { altKey: true });

    expect(updates).toHaveLength(0);
    expect(
      editor.container.querySelectorAll("[data-slide-object-id]"),
    ).toHaveLength(0);
    expect(editor.el("callout").style.position).toBe("");
    expect(editor.hasSelection()).toBe(false);
  });

  it("persists nothing for an Alt press that never crosses the drag threshold", async () => {
    const { editor, updates } = await mountSelectedPair();

    editor.press("callout", { x: 85, y: 262 }, { altKey: true });
    dragTo(86, 262, { altKey: true });
    dropAt(86, 262, { altKey: true });

    expect(updates).toHaveLength(0);
    expect(
      editor.container.querySelectorAll("[data-slide-object-id]"),
    ).toHaveLength(0);
  });
});
