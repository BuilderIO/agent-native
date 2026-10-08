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
  <div id="slide" class="fmd-slide" style="position:relative">
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

const TABLE_NOTE_SLIDE = `
  <div id="slide" class="fmd-slide" style="position:relative">
    <table id="table"><tbody><tr id="tr">
      <td id="cell" style="padding:20px">Cell text</td>
      <td id="emptyCell" style="padding:20px"></td>
    </tr></tbody></table>
    <div id="note" class="fmd-text-box" data-slide-object-id="note-1" style="position:absolute;left:600px;top:100px;width:200px;height:40px;font-size:24px">Note</div>
  </div>`;

// A table positioned inside a slide group; the group is taller than the table
// so the selection outline tells which of the two was selected.
const GROUPED_TABLE_SLIDE = `
  <div id="slide" class="fmd-slide" style="position:relative">
    <div id="tableGroup" class="fmd-slide-group" data-slide-group="true" data-slide-object-id="group-3" style="position:absolute;left:100px;top:100px;width:400px;height:160px">
      <table id="groupedTable" style="position:absolute;left:0;top:0"><tbody><tr id="groupedRow">
        <td id="groupedCell" style="padding:20px">Grouped cell</td>
      </tr></tbody></table>
    </div>
    <div id="note" class="fmd-text-box" data-slide-object-id="note-1" style="position:absolute;left:600px;top:100px;width:200px;height:40px;font-size:24px">Note</div>
  </div>`;

const TEXT_RECTS: Record<string, Rect> = {
  note: { left: 600, top: 100, right: 700, bottom: 120 },
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
  note: { left: 600, top: 100, right: 800, bottom: 140 },
  table: { left: 100, top: 100, right: 500, bottom: 200 },
  tr: { left: 100, top: 100, right: 500, bottom: 200 },
  cell: { left: 100, top: 100, right: 300, bottom: 200 },
  emptyCell: { left: 300, top: 100, right: 500, bottom: 200 },
  tableGroup: { left: 100, top: 100, right: 500, bottom: 260 },
  groupedTable: { left: 100, top: 100, right: 500, bottom: 200 },
  groupedRow: { left: 100, top: 100, right: 500, bottom: 200 },
  groupedCell: { left: 100, top: 100, right: 500, bottom: 200 },
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
    const height = Number.parseFloat(outline.style.height) - 4;
    return (
      Object.entries(BOX_RECTS).find(
        ([, rect]) =>
          rect.top === top &&
          rect.left === left &&
          rect.bottom - rect.top === height,
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
  /** How many objects the multi-selection chip counts (0 when it is hidden). */
  const selectedCount = () =>
    Number(
      document.querySelector("[data-multi-select-chip] span")?.textContent ?? 0,
    );
  return {
    ...view,
    el,
    canvas,
    chainOf,
    outlineBox,
    selectedCount,
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

  it("keeps the direction of a backward text drag that ends in another leaf", async () => {
    const editor = await mountEditor(CLIP_SLIDE);
    const caption = editor.el("caption");
    const labelB = editor.el("labelB");

    editor.press("caption", { x: 700, y: 278 });
    // Dragged up and to the left: the focus sits in the earlier leaf.
    window
      .getSelection()!
      .setBaseAndExtent(caption.firstChild!, 20, labelB.firstChild!, 4);
    stack = [editor.el("chart")];
    fireEvent.pointerUp(editor.el("chart"), editor.init({ x: 800, y: 157 }));
    fireEvent.click(editor.el("chart"), {
      ...editor.init({ x: 800, y: 157 }),
      detail: 1,
    });

    expect(editor.isEditing("caption")).toBe(true);
    const selection = window.getSelection()!;
    expect(selection.anchorNode).toBe(caption.firstChild);
    expect(selection.anchorOffset).toBe(20);
    expect(selection.focusNode).toBe(caption);
    expect(selection.focusOffset).toBe(0);
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

  it("keeps the browser from selecting text while a multi-selection member is dragged", async () => {
    const editor = await mountEditor(CLIP_SLIDE);
    const outer = { x: 200, y: 260 };
    const nativeRanges = () => window.getSelection()?.rangeCount ?? 0;

    editor.click("callout", { x: 85, y: 262 });
    editor.click("card", { x: 85, y: 300 }, { shiftKey: true });
    expect(editor.outlineBox()).toEqual({ top: 235, height: 135 });

    // The press on a text member of the group must not start a native
    // selection that competes with the move.
    stack = editor.chainOf("callout");
    const notPrevented = fireEvent.pointerDown(
      editor.el("callout"),
      editor.init(outer),
    );
    expect(notPrevented).toBe(false);

    window.getSelection()?.selectAllChildren(editor.el("callout"));
    expect(nativeRanges()).toBe(1);
    fireEvent.pointerMove(window, {
      clientX: outer.x + 40,
      clientY: outer.y + 30,
      pointerId: 1,
    });
    expect(nativeRanges()).toBe(0);
    fireEvent.pointerUp(window, {
      clientX: outer.x + 40,
      clientY: outer.y + 30,
      pointerId: 1,
    });

    // A click without travel keeps the multi-selection.
    editor.click("callout", outer);
    expect(editor.outlineBox()).toEqual({ top: 235, height: 135 });

    // An additive press stays free to toggle on click.
    expect(
      fireEvent.pointerDown(
        editor.el("callout"),
        editor.init(outer, { shiftKey: true }),
      ),
    ).toBe(true);
    editor.release("callout", outer, { shiftKey: true });
    expect(editor.outlineBox()).toEqual({ top: 290, height: 80 });
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

  describe("a table joining a multi-selection", () => {
    const memberPoint = { x: 780, y: 130 };

    const dragNote = (editor: Awaited<ReturnType<typeof mountEditor>>) => {
      editor.press("note", memberPoint);
      fireEvent.pointerMove(window, {
        clientX: memberPoint.x + 40,
        clientY: memberPoint.y + 30,
        pointerId: 1,
      });
      fireEvent.pointerUp(window, {
        clientX: memberPoint.x + 40,
        clientY: memberPoint.y + 30,
        pointerId: 1,
      });
    };

    const expectTableMovedWhole = (
      editor: Awaited<ReturnType<typeof mountEditor>>,
    ) => {
      for (const id of ["cell", "emptyCell", "tr"]) {
        expect(editor.el(id).style.position, id).toBe("");
        expect(editor.el(id).hasAttribute("data-slide-object-id"), id).toBe(
          false,
        );
      }
      expect(editor.el("table").style.position).toBe("absolute");
    };

    it("moves the table, not the cell, when a cell is shift-clicked into a selection", async () => {
      const editor = await mountEditor(TABLE_NOTE_SLIDE);

      editor.click("note", memberPoint);
      editor.click("cell", { x: 110, y: 110 }, { shiftKey: true });
      dragNote(editor);
      expectTableMovedWhole(editor);
    });

    it("toggles the whole table when one of its cells is shift-clicked again", async () => {
      const editor = await mountEditor(TABLE_NOTE_SLIDE);

      editor.click("note", memberPoint);
      editor.click("cell", { x: 110, y: 110 }, { shiftKey: true });
      editor.click("emptyCell", { x: 310, y: 110 }, { shiftKey: true });
      dragNote(editor);
      expect(editor.el("table").style.position).toBe("");
      expect(editor.el("cell").style.position).toBe("");
      expect(editor.el("note").style.left).not.toBe("600px");
    });

    it("nudges the table, not the cell, with the arrow keys", async () => {
      const onUpdateSlide = vi.fn();
      const editor = await mountEditor(TABLE_NOTE_SLIDE, { onUpdateSlide });

      editor.click("note", memberPoint);
      editor.click("cell", { x: 110, y: 110 }, { shiftKey: true });
      editor.canvas.focus();
      fireEvent.keyDown(editor.canvas, { key: "ArrowRight" });

      const saved = new DOMParser().parseFromString(
        (onUpdateSlide.mock.calls.at(-1)?.[0] as { content: string }).content,
        "text/html",
      );
      expect(saved.querySelector("#table")?.getAttribute("style")).toContain(
        "position: absolute",
      );
      expect(saved.querySelector("td")?.style.position).toBe("");
      expect(
        saved.querySelector("td")?.hasAttribute("data-slide-object-id"),
      ).toBe(false);
    });

    it("never nudges a selected cell out of its table", async () => {
      const onUpdateSlide = vi.fn();
      const editor = await mountEditor(TABLE_SLIDE, { onUpdateSlide });

      editor.click("emptyCell", { x: 310, y: 110 });
      expect(editor.lastSelected()).toBe(editor.el("emptyCell"));
      editor.canvas.focus();
      fireEvent.keyDown(editor.canvas, { key: "ArrowRight" });
      expect(onUpdateSlide).not.toHaveBeenCalled();
      expect(editor.el("emptyCell").style.position).toBe("");
    });

    it("moves the table, not its cells, when a marquee sweeps over it", async () => {
      const editor = await mountEditor(TABLE_NOTE_SLIDE);

      editor.press("slide", { x: 900, y: 500 });
      fireEvent.pointerMove(window, { clientX: 90, clientY: 90, pointerId: 1 });
      fireEvent.pointerUp(window, { clientX: 90, clientY: 90, pointerId: 1 });
      dragNote(editor);
      expectTableMovedWhole(editor);
    });

    it("drags the whole selection from a press on a cell of a selected table", async () => {
      const editor = await mountEditor(TABLE_NOTE_SLIDE);
      const cellPoint = { x: 110, y: 110 };

      editor.click("note", memberPoint);
      editor.click("cell", cellPoint, { shiftKey: true });
      editor.press("cell", cellPoint);
      fireEvent.pointerMove(window, {
        clientX: cellPoint.x + 40,
        clientY: cellPoint.y + 30,
        pointerId: 1,
      });
      fireEvent.pointerUp(window, {
        clientX: cellPoint.x + 40,
        clientY: cellPoint.y + 30,
        pointerId: 1,
      });

      expectTableMovedWhole(editor);
      expect(editor.el("note").style.left).not.toBe("600px");
    });

    it("keeps the multi-selection on a plain click of a cell of a selected table", async () => {
      const editor = await mountEditor(TABLE_NOTE_SLIDE);
      const cellPoint = { x: 110, y: 110 };

      editor.click("note", memberPoint);
      editor.click("cell", cellPoint, { shiftKey: true });
      vi.mocked(enterSelectionMode).mockClear();
      editor.click("cell", cellPoint);

      expect(enterSelectionMode).not.toHaveBeenCalled();
      expect(editor.outlineBox()).toEqual({ top: 100, height: 100 });
      expect(editor.isEditing("cell")).toBe(false);
    });

    it("selects a plain table from a marquee", async () => {
      const editor = await mountEditor(TABLE_NOTE_SLIDE);

      editor.press("slide", { x: 550, y: 500 });
      fireEvent.pointerMove(window, { clientX: 90, clientY: 90, pointerId: 1 });
      fireEvent.pointerUp(window, { clientX: 90, clientY: 90, pointerId: 1 });

      expect(editor.outlineBox()).toEqual({ top: 100, height: 100 });
      expect(editor.selectedCount()).toBe(1);
    });
  });

  describe("a table inside a slide group", () => {
    const cellPoint = { x: 110, y: 110 };

    it("selects the group, not the table, from a marquee", async () => {
      const editor = await mountEditor(GROUPED_TABLE_SLIDE);

      editor.press("slide", { x: 550, y: 500 });
      fireEvent.pointerMove(window, { clientX: 90, clientY: 90, pointerId: 1 });
      fireEvent.pointerUp(window, { clientX: 90, clientY: 90, pointerId: 1 });

      expect(editor.outlineBox()).toEqual({ top: 100, height: 160 });
      expect(editor.selectedCount()).toBe(1);
    });

    it("toggles the group when one of its cells is shift-clicked", async () => {
      const editor = await mountEditor(GROUPED_TABLE_SLIDE);

      editor.click("note", { x: 780, y: 130 });
      editor.click("groupedCell", cellPoint, { shiftKey: true });
      expect(editor.outlineBox()).toEqual({ top: 100, height: 160 });
      expect(editor.selectedCount()).toBe(2);
      editor.click("groupedCell", cellPoint, { shiftKey: true });
      expect(editor.outlineBox()).toEqual({ top: 100, height: 40 });
      expect(editor.selectedCount()).toBe(1);
    });

    it("adds the group, not its table, when a drilled cell is the selection", async () => {
      const editor = await mountEditor(GROUPED_TABLE_SLIDE);

      editor.click("groupedCell", cellPoint);
      expect(editor.lastSelected()).toBe(editor.el("tableGroup"));
      editor.click("groupedCell", cellPoint);
      expect(editor.lastSelected()).toBe(editor.el("groupedCell"));
      editor.click("note", { x: 780, y: 130 }, { shiftKey: true });

      expect(editor.outlineBox()).toEqual({ top: 100, height: 160 });
      expect(editor.selectedCount()).toBe(2);
    });
  });

  it("offers no resize or rotate handles on a selected table cell", async () => {
    const editor = await mountEditor(TABLE_SLIDE);
    const html = () => editor.el("table").outerHTML;
    const before = html();

    editor.click("emptyCell", { x: 310, y: 110 });
    expect(editor.lastSelected()).toBe(editor.el("emptyCell"));
    expect(editor.outlineBox()).not.toBeNull();
    expect(document.querySelector("[data-slide-resize-handle]")).toBeNull();
    expect(document.querySelector("[data-slide-rotate-handle]")).toBeNull();
    expect(html()).toBe(before);
    expect(document.querySelector("[data-slide-layout-spacer-for]")).toBeNull();

    // The table itself is a normal object and keeps its handles.
    editor.click("table", { x: 105, y: 195 });
    expect(editor.lastSelected()).toBe(editor.el("table"));
    expect(document.querySelectorAll("[data-slide-resize-handle]").length).toBe(
      8,
    );
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

  describe("when the release after Escape never arrives", () => {
    const cancelDrag = async (beforeEscape?: () => void) => {
      const editor = await mountEditor(CLIP_SLIDE);
      beforeEscape?.();
      editor.press("card", { x: 85, y: 300 });
      fireEvent.pointerMove(window, {
        clientX: 125,
        clientY: 330,
        pointerId: 1,
      });
      fireEvent.keyDown(window, { key: "Escape" });
      vi.mocked(enterSelectionMode).mockClear();
      return editor;
    };

    it("lets the next press click-select", async () => {
      const editor = await cancelDrag();

      editor.click("card", { x: 85, y: 300 });
      expect(editor.lastSelected()).toBe(editor.el("card"));
    });

    it("lets a click through once the window lost focus", async () => {
      const editor = await cancelDrag();

      fireEvent.blur(window);
      fireEvent.click(editor.el("card"), { clientX: 85, clientY: 300 });
      expect(editor.lastSelected()).toBe(editor.el("card"));
    });

    it("stops swallowing clicks after a timeout once no button is down", async () => {
      // Fake timers go in after mounting, which waits on real ones.
      const editor = await cancelDrag(() => vi.useFakeTimers());
      try {
        act(() => vi.advanceTimersByTime(5000));
        fireEvent.pointerMove(window, {
          clientX: 125,
          clientY: 330,
          pointerId: 1,
          buttons: 0,
        });
      } finally {
        vi.useRealTimers();
      }
      fireEvent.click(editor.el("card"), { clientX: 85, clientY: 300 });
      expect(editor.lastSelected()).toBe(editor.el("card"));
    });

    it("keeps swallowing the release click while the button is held past the timeout", async () => {
      const editor = await cancelDrag(() => vi.useFakeTimers());
      try {
        act(() => vi.advanceTimersByTime(5000));
        fireEvent.pointerMove(window, {
          clientX: 130,
          clientY: 335,
          pointerId: 1,
          buttons: 1,
        });
        act(() => vi.advanceTimersByTime(5000));
        editor.release("card", { x: 130, y: 335 });
      } finally {
        vi.useRealTimers();
      }
      expect(enterSelectionMode).not.toHaveBeenCalled();
    });
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

  it("selects the group from just outside a text-box member, then drills to that member", async () => {
    const editor = await mountEditor(GROUP_SLIDE);

    // 4 px left of memberA, outside the group's bounds.
    editor.hover("slide", { x: 96, y: 120 });
    expect(editor.canvas.style.cursor).toBe("move");
    expect(editor.hoverOutlineOwner()).toBe("group");

    editor.click("slide", { x: 96, y: 120 });
    expect(editor.lastSelected()).toBe(editor.el("group"));

    editor.click("slide", { x: 96, y: 120 });
    expect(editor.lastSelected()).toBe(editor.el("memberA"));

    // 4 px right of memberA, in the gap inside the group's bounds.
    fireEvent.keyDown(window, { key: "Escape" });
    editor.click("slide", { x: 284, y: 120 });
    expect(editor.lastSelected()).toBe(editor.el("group"));
    editor.click("slide", { x: 284, y: 120 });
    expect(editor.lastSelected()).toBe(editor.el("memberA"));
  });

  it("selects nothing from 6 px outside a text-box member", async () => {
    const editor = await mountEditor(GROUP_SLIDE);

    editor.hover("slide", { x: 94, y: 120 });
    expect(editor.canvas.style.cursor).toBe("");
    expect(editor.hoverOutlineOwner()).toBeNull();

    editor.click("slide", { x: 94, y: 120 });
    expect(editor.hasSelection()).toBe(false);
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

  it("recreates the copies when Alt is pressed again after a release", async () => {
    const { editor, updates } = await mountSelectedPair();

    editor.press("callout", { x: 85, y: 262 }, { altKey: true });
    dragTo(125, 292, { altKey: true });
    dragTo(125, 292);
    expect(
      editor.container.querySelectorAll("[data-slide-object-id]"),
    ).toHaveLength(2);
    dragTo(135, 302, { altKey: true });
    dropAt(135, 302, { altKey: true });

    const objects = placements(updates[0]);
    expect(objects).toHaveLength(4);
    expect(objects.filter((object) => object.left === "80px")).toHaveLength(2);
  });

  it("appends the copies after their siblings so child-index paths hold", async () => {
    const { editor, updates } = await mountSelectedPair();

    editor.press("callout", { x: 85, y: 262 }, { altKey: true });
    dragTo(125, 292, { altKey: true });
    dropAt(125, 292, { altKey: true });

    const doc = new DOMParser().parseFromString(updates[0], "text/html");
    const children = Array.from(doc.querySelector(".fmd-slide")!.children);
    // The original wrapper keeps index 0 (animations address it by path) and
    // both copies trail it.
    expect(children[0].id).toBe("container");
    expect(children).toHaveLength(3);
    expect(
      children.slice(1).map((copy) => copy.textContent?.trim().slice(0, 4)),
    ).toEqual(["Erup", "Stat"]);
  });

  it("keeps the preserved flow spacers on the originals, not the copies", async () => {
    const { editor, updates } = await mountSelectedPair();

    editor.press("callout", { x: 85, y: 262 }, { altKey: true });
    dragTo(125, 292, { altKey: true });
    dropAt(125, 292, { altKey: true });

    const doc = new DOMParser().parseFromString(updates[0], "text/html");
    const originalIds = ["callout", "card"].map(
      (id) => doc.getElementById(id)!.getAttribute("data-slide-object-id")!,
    );
    const spacerOwners = Array.from(
      doc.querySelectorAll("[data-slide-layout-spacer-for]"),
    ).map((spacer) => spacer.getAttribute("data-slide-layout-spacer-for"));
    expect(spacerOwners.sort()).toEqual([...originalIds].sort());
  });

  it("keeps the selection outline when a pointercancel follows a move within a frame", async () => {
    const { editor, updates } = await mountSelectedPair();
    const outline = () =>
      document.querySelector("[data-slide-selection-outline='true']");

    editor.press("callout", { x: 85, y: 262 }, { altKey: true });
    dragTo(125, 292, { altKey: true });
    fireEvent.pointerCancel(window, { pointerId: 1 });
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));

    expect(updates).toHaveLength(0);
    expect(
      editor.container.querySelectorAll("[data-slide-object-id]"),
    ).toHaveLength(0);
    expect(outline()).not.toBeNull();
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
