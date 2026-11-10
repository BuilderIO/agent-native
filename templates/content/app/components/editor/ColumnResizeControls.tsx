import { useT } from "@agent-native/core/client/i18n";
import {
  effectiveColumnRatios,
  MIN_COLUMN_RATIO,
  parseColumnRatio,
  resizeColumnPair,
  seamPairRatio,
} from "@shared/column-ratios";
import type { EditorView } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { cn } from "@/lib/utils";

import { COLUMNS_NODE } from "./extensions/column-sets";

const SET_SELECTOR = "div[data-notion-columns]";
const HANDLE_SELECTOR = "[data-column-resize-handle]";
const HANDLE_HIT_WIDTH = 12;
/** How far an arrow key moves a seam, in percent of the row. */
const KEYBOARD_STEP = 5;

function getMountedEditorView(editor: Editor): EditorView | null {
  if (editor.isDestroyed) return null;
  try {
    const { view } = editor;
    return view.dom.isConnected ? view : null;
    // coercion-ok: Tiptap throws on an unmounted editor's view; there is nothing to draw yet.
  } catch {
    return null;
  }
}

export function columnElements(set: HTMLElement): HTMLElement[] {
  return Array.from(set.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.hasAttribute("data-notion-column"),
  );
}

/** Where a drawn set starts in the document, or null when it isn't one. */
function setPosition(view: EditorView, set: HTMLElement): number | null {
  if (!set.isConnected || !view.dom.contains(set)) return null;
  try {
    const pos = view.posAtDOM(set, 0) - 1;
    return view.state.doc.nodeAt(pos)?.type.name === COLUMNS_NODE ? pos : null;
    // coercion-ok: an element ProseMirror can't place is not a set; draw no handles for it.
  } catch {
    return null;
  }
}

function writtenRatios(view: EditorView, pos: number): (number | null)[] {
  const ratios: (number | null)[] = [];
  view.state.doc
    .nodeAt(pos)
    ?.forEach((column) => ratios.push(parseColumnRatio(column.attrs.ratio)));
  return ratios;
}

/** The innermost column set the selection is in, as drawn. */
function selectedSet(view: EditorView): HTMLElement | null {
  const { $from } = view.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name !== COLUMNS_NODE) continue;
    const dom = view.nodeDOM($from.before(depth));
    return dom instanceof HTMLElement ? dom : null;
  }
  return null;
}

/**
 * How a row turns ratios into widths. Every column's flex basis is zero, so
 * each is its padding and border plus its ratio's share of the row the gaps
 * and those leave.
 */
interface RowGeometry {
  frame: number;
  free: number;
  gap: number;
  minWidth: number;
}

/**
 * A computed length in pixels. Chrome leaves a `min()` such as
 * `min(100%, 128px)` unresolved, so each `px` and `%` (of `basis`) term is read
 * and the smallest one, or the largest in a `max()`, is the length.
 */
export function resolveCssLength(value: string, basis: number): number {
  const terms = [...value.matchAll(/(-?\d*\.?\d+)(px|%)/g)].map(
    ([, amount, unit]) =>
      unit === "%" ? (Number(amount) / 100) * basis : Number(amount),
  );
  if (terms.length === 0) return 0;
  return value.trimStart().startsWith("max(")
    ? Math.max(...terms)
    : Math.min(...terms);
}

function rowGeometry(
  set: HTMLElement,
  columns: HTMLElement[],
): RowGeometry | null {
  if (!columns[0]) return null;
  const style = getComputedStyle(columns[0]);
  const px = (value: string) => Number.parseFloat(value) || 0;
  const frame =
    px(style.paddingLeft) +
    px(style.paddingRight) +
    px(style.borderLeftWidth) +
    px(style.borderRightWidth);
  const gap = px(getComputedStyle(set).columnGap);
  const free =
    set.clientWidth - columns.length * frame - (columns.length - 1) * gap;
  if (!(free > 0)) return null;
  return {
    frame,
    free,
    gap,
    minWidth: resolveCssLength(style.minWidth, set.clientWidth),
  };
}

/** A width in pixels as a percentage of the row, as a column's ratio. */
function ratioOfWidth(geometry: RowGeometry, width: number) {
  return ((width - geometry.frame) / geometry.free) * 100;
}

/** The narrowest a column may get: its CSS minimum, and never under 10%. */
function minimumRatio(geometry: RowGeometry | null) {
  return geometry
    ? Math.max(MIN_COLUMN_RATIO, ratioOfWidth(geometry, geometry.minWidth))
    : MIN_COLUMN_RATIO;
}

/** A wrapped or stacked set has no seam to drag. */
function isOneRow(columns: HTMLElement[]) {
  const top = columns[0]?.offsetTop;
  return columns.every((column) => column.offsetTop === top);
}

interface Seam {
  index: number;
  left: number;
  top: number;
  height: number;
}

/** The seam right of each column but the last, relative to `origin`. */
function seamsOf(set: HTMLElement, origin: DOMRect): Seam[] {
  const columns = columnElements(set);
  if (columns.length < 2 || !isOneRow(columns)) return [];
  const seams: Seam[] = [];
  let previous: DOMRect | null = null;
  for (const column of columns) {
    const rect = column.getBoundingClientRect();
    if (previous) {
      const top = Math.min(previous.top, rect.top);
      seams.push({
        index: seams.length,
        left: (previous.right + rect.left) / 2 - origin.left,
        top: top - origin.top,
        height: Math.max(previous.bottom, rect.bottom) - top,
      });
    }
    previous = rect;
  }
  return seams;
}

/** Puts each column back to the width its saved ratio gives it. */
function showSavedRatios(set: HTMLElement) {
  for (const column of columnElements(set)) {
    const saved = column.getAttribute("data-ratio");
    if (saved === null) column.style.removeProperty("flex-grow");
    else column.style.flexGrow = saved;
  }
}

interface ColumnDrag {
  pointerId: number;
  set: HTMLElement;
  index: number;
  ratios: (number | null)[];
  next: number[] | null;
}

/**
 * The handle on each seam of the column set under the pointer, or the one the
 * caret is in. Dragging it draws the two columns' new widths as it moves and
 * saves them as one edit when it lets go; with the handle focused, the arrow
 * keys move the seam.
 */
export function ColumnResizeControls({ editor }: { editor: Editor }) {
  const t = useT();
  const [activeSet, setActiveSet] = useState<HTMLElement | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [previewRatios, setPreviewRatios] = useState<number[] | null>(null);
  const [, setGeometryRevision] = useState(0);
  const dragRef = useRef<ColumnDrag | null>(null);
  const focusedSetRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const view = getMountedEditorView(editor);
    if (!view) return;
    const pickSet = (target: EventTarget | null) => {
      if (dragRef.current) return;
      const element = target instanceof Element ? target : null;
      if (element?.closest(HANDLE_SELECTOR)) return;
      const hovered = element?.closest<HTMLElement>(SET_SELECTOR) ?? null;
      setActiveSet(
        (hovered && view.dom.contains(hovered) ? hovered : null) ??
          (focusedSetRef.current?.isConnected ? focusedSetRef.current : null) ??
          selectedSet(view),
      );
    };
    // Touch has no hover; a finger's set is the one its tap put the caret in.
    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "touch") pickSet(event.target);
    };
    const handleSelectionUpdate = () => {
      if (dragRef.current) return;
      setActiveSet((current) =>
        current?.isConnected && current.matches(":hover")
          ? current
          : (focusedSetRef.current ?? selectedSet(view)),
      );
    };
    const handleGeometryChange = () =>
      setGeometryRevision((revision) => revision + 1);
    const observer = new ResizeObserver(handleGeometryChange);
    observer.observe(view.dom);
    document.addEventListener("pointermove", handlePointerMove, true);
    editor.on("selectionUpdate", handleSelectionUpdate);
    editor.on("update", handleGeometryChange);
    window.addEventListener("resize", handleGeometryChange);
    window.addEventListener("scroll", handleGeometryChange, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("pointermove", handlePointerMove, true);
      editor.off("selectionUpdate", handleSelectionUpdate);
      editor.off("update", handleGeometryChange);
      window.removeEventListener("resize", handleGeometryChange);
      window.removeEventListener("scroll", handleGeometryChange, true);
    };
  }, [editor]);

  // Escape during a drag puts the widths back. A press on the handle doesn't
  // move focus to it, so the key is heard wherever focus is.
  useEffect(() => {
    if (draggingIndex === null) return;
    const cancelOnEscape = (event: KeyboardEvent) => {
      const drag = dragRef.current;
      if (event.key !== "Escape" || !drag) return;
      event.preventDefault();
      event.stopPropagation();
      dragRef.current = null;
      setDraggingIndex(null);
      setPreviewRatios(null);
      showSavedRatios(drag.set);
    };
    document.addEventListener("keydown", cancelOnEscape, true);
    return () => document.removeEventListener("keydown", cancelOnEscape, true);
  }, [draggingIndex]);

  const saveRatios = (
    set: HTMLElement,
    ratios: readonly number[],
    uiEvent: "pointer" | "keydown",
  ) => {
    const view = getMountedEditorView(editor);
    const pos = view ? setPosition(view, set) : null;
    const node = view && pos !== null ? view.state.doc.nodeAt(pos) : null;
    if (!view || pos === null || node?.childCount !== ratios.length) {
      showSavedRatios(set);
      return;
    }
    const tr = view.state.tr;
    node.forEach((column, offset, index) => {
      if (parseColumnRatio(column.attrs.ratio) !== ratios[index])
        tr.setNodeAttribute(pos + 1 + offset, "ratio", ratios[index]);
    });
    if (!tr.docChanged) {
      showSavedRatios(set);
      return;
    }
    // The handle has focus, not the editor; the event marks it as the
    // person's edit so it saves.
    view.dispatch(tr.setMeta("uiEvent", uiEvent));
  };

  const finishDrag = (save: boolean) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDraggingIndex(null);
    setPreviewRatios(null);
    if (!drag) return;
    if (save && drag.next) saveRatios(drag.set, drag.next, "pointer");
    else showSavedRatios(drag.set);
  };

  const handlePointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
    index: number,
  ) => {
    if (event.button !== 0 || !activeSet) return;
    const view = getMountedEditorView(editor);
    const pos = view ? setPosition(view, activeSet) : null;
    if (!view || pos === null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      set: activeSet,
      index,
      ratios: writtenRatios(view, pos),
      next: null,
    };
    setDraggingIndex(index);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const columns = columnElements(drag.set);
    const geometry = rowGeometry(drag.set, columns);
    // Another tab can take a column away mid-drag; the seam needs both sides.
    const column = columns.find((_, index) => index === drag.index);
    if (!geometry || !column || drag.index + 1 >= columns.length) return;
    const left = column.getBoundingClientRect().left;
    const pair = seamPairRatio(effectiveColumnRatios(drag.ratios), drag.index);
    const wanted = ratioOfWidth(
      geometry,
      event.clientX - left - geometry.gap / 2,
    );
    const next = resizeColumnPair(
      drag.ratios,
      drag.index,
      wanted / pair,
      minimumRatio(geometry),
    );
    drag.next = next;
    columns.forEach((column, index) => {
      column.style.flexGrow = String(next[index]);
    });
    setPreviewRatios(next);
  };

  const handleKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>,
    index: number,
  ) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const view = getMountedEditorView(editor);
    const pos = view && activeSet ? setPosition(view, activeSet) : null;
    if (!view || !activeSet || pos === null) return;
    event.preventDefault();
    const ratios = writtenRatios(view, pos);
    const current = effectiveColumnRatios(ratios);
    const pair = seamPairRatio(current, index);
    const step = event.key === "ArrowLeft" ? -KEYBOARD_STEP : KEYBOARD_STEP;
    // Arrow keys stop at the same CSS minimum a drag does.
    const geometry = rowGeometry(activeSet, columnElements(activeSet));
    saveRatios(
      activeSet,
      resizeColumnPair(
        ratios,
        index,
        ((current[index] ?? 0) + step) / pair,
        minimumRatio(geometry),
      ),
      "keydown",
    );
  };

  const view = getMountedEditorView(editor);
  if (!view || !activeSet?.isConnected) return null;
  const wrapper = view.dom.closest(
    ".visual-editor-wrapper",
  ) as HTMLElement | null;
  const wrapperRect = wrapper?.getBoundingClientRect();
  const pos = setPosition(view, activeSet);
  if (!wrapperRect || pos === null) return null;
  const seams = seamsOf(activeSet, wrapperRect);
  const ratios =
    previewRatios ?? effectiveColumnRatios(writtenRatios(view, pos));

  return (
    <>
      {seams.map((seam) => (
        <div
          aria-label={t("editor.resizeColumns")}
          aria-orientation="vertical"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.round(ratios[seam.index] ?? 0)}
          className={cn(
            "group absolute z-40 flex cursor-col-resize touch-none justify-center opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none",
            draggingIndex === seam.index && "opacity-100",
          )}
          data-column-resize-handle
          data-testid="column-resize-handle"
          key={seam.index}
          onBlur={() => {
            focusedSetRef.current = null;
          }}
          onFocus={() => {
            focusedSetRef.current = activeSet;
          }}
          onKeyDown={(event) => handleKeyDown(event, seam.index)}
          onLostPointerCapture={() => finishDrag(true)}
          onPointerCancel={() => finishDrag(false)}
          onPointerDown={(event) => handlePointerDown(event, seam.index)}
          onPointerMove={handlePointerMove}
          onPointerUp={() => finishDrag(true)}
          role="separator"
          style={{
            height: seam.height,
            left: seam.left - HANDLE_HIT_WIDTH / 2,
            top: seam.top,
            width: HANDLE_HIT_WIDTH,
          }}
          tabIndex={0}
        >
          <span className="block h-full w-0.75 rounded-full bg-primary/60 transition-colors group-hover:bg-primary group-focus-visible:bg-primary" />
        </div>
      ))}
    </>
  );
}
