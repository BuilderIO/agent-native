import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  Plugin,
  PluginKey,
  NodeSelection,
  Selection,
  TextSelection,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import { type EditorView } from "@tiptap/pm/view";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import type {
  XmlElement as YXmlElement,
  XmlFragment as YXmlFragment,
  XmlText as YXmlText,
} from "yjs";

export const DEFAULT_DRAG_HANDLE_WRAPPER_SELECTOR = ".visual-editor-wrapper";

// The block menu and drag act while focus is outside the editor. Apps that
// skip unfocused changes nobody marked as the user's (Content's collaborative
// save) would drop these edits without it. Not "drop": that runs paste rules.
export const DRAG_HANDLE_UI_EVENT = "dragHandle";

function markUserAction(tr: Transaction) {
  return tr.setMeta("uiEvent", DRAG_HANDLE_UI_EVENT);
}

export interface DragHandleOptions {
  wrapperSelector: string;
  getDragTransferData?: (context: {
    view: EditorView;
    node: ProseMirrorNode;
    pos: number;
  }) => unknown;
  receiveDragTransferData?: (
    data: unknown,
    context: {
      view: EditorView;
      node: ProseMirrorNode;
      pos: number;
      sourceView: EditorView;
    },
  ) => void;
  handleDrop?: (data: unknown, context: DragHandleDropContext) => boolean;
  /**
   * Opens the app's own block menu in place of the built-in one. Returns a
   * function that closes it, or null to open the built-in menu.
   */
  openMenu?: (request: DragHandleMenuRequest) => (() => void) | null;
}

export type DragHandleMenuRequest = {
  view: EditorView;
  /** The grip's box, or the block's when the grip has none. */
  anchorRect: DOMRect;
  /**
   * The block as it is now, or null once it's gone. In a collaborative
   * editor the menu lets go of its block once anything but `dispatch` changes
   * it, and closes.
   */
  getBlock: () => { node: ProseMirrorNode; pos: number } | null;
  /** Applies the menu's own edit to its block. */
  dispatch: (tr: Transaction) => void;
  duplicate: () => void;
  remove: () => void;
  insertBelow: () => void;
  /** Tells the grip the menu closed. */
  onClose: () => void;
};

const dragHandleKey = new PluginKey("dragHandle");
const HOVER_SIDE_OUTSET_REM = 8;
const SIDE_DROP_ZONE_RATIO = 0.33;
const SIDE_DROP_ZONE_MIN_PX = 56;
const SIDE_DROP_ZONE_MAX_PX = 320;
const SIDE_DROP_ZONE_MAX_WIDTH_FRACTION = 0.45;
const DRAG_HANDLE_MENU_STYLE_ID = "an-rich-md-drag-menu-styles";
const DRAG_HANDLE_MENU_WIDTH = 220;
const DRAG_HANDLE_MENU_GAP = 6;
const DRAG_HANDLE_MENU_VIEWPORT_PADDING = 8;

const tablerIconSvg = (paths: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;

const DRAG_HANDLE_MENU_ICON_DUPLICATE = tablerIconSvg(
  '<path d="M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667l0 -8.666" /><path d="M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1" />',
);
const DRAG_HANDLE_MENU_ICON_DELETE = tablerIconSvg(
  '<path d="M4 7l16 0" /><path d="M10 11l0 6" /><path d="M14 11l0 6" /><path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12" /><path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3" />',
);
const DRAG_HANDLE_MENU_ICON_INSERT = tablerIconSvg(
  '<path d="M12 5l0 14" /><path d="M5 12l14 0" />',
);
const DRAG_HANDLE_GRIP_ICON = tablerIconSvg(
  '<path d="M8 5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /><path d="M8 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /><path d="M8 19a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /><path d="M14 5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /><path d="M14 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /><path d="M14 19a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />',
);

type DropTarget = {
  registration: DragHandleRegistration;
  view: EditorView;
  block: HTMLElement;
  placement: DragHandleDropPlacement;
  pos: number;
  targetPos: number;
  targetNodeSize: number;
  rect: DOMRect;
};

export type DragHandleDropPlacement = "before" | "after" | "left" | "right";

export type DragHandleDropContext = {
  view: EditorView;
  sourceView: EditorView;
  sourceNode: ProseMirrorNode;
  sourcePos: number;
  sourceNodeSize: number;
  targetNode: ProseMirrorNode;
  targetPos: number;
  targetNodeSize: number;
  insertPos: number;
  placement: DragHandleDropPlacement;
};

type DragSession = {
  view: EditorView;
  sourceBlock: HTMLElement;
  sourcePos: number;
  sourceNodeSize: number;
  startX: number;
  startY: number;
  pointerOffsetX: number;
  pointerOffsetY: number;
  dragging: boolean;
  preview: HTMLElement | null;
  dropLine: HTMLElement | null;
  dropTarget: DropTarget | null;
};

type HoverBlock = {
  node: HTMLElement;
  pmPos: number;
  rect: DOMRect;
};

type DragHandleMenuContext = {
  view: EditorView;
  sourceBlock: HTMLElement;
  sourcePos: number;
  sourceNodeSize: number;
  /** The block's Yjs element, when the editor is collaborative. */
  yBlock?: YBlock;
  /** The open menu, whose block the editor tracks without collaboration. */
  menu?: object;
};

type YBlock = {
  /** Null while the block has no element yet. */
  element: YXmlElement | YXmlText | null;
  /** Set once anything but the menu changes the block. */
  changedElsewhere: boolean;
  unwatch: () => void;
};

type YBinding = {
  type: YXmlFragment;
  mapping: Map<unknown, ProseMirrorNode>;
};

function getYBinding(view: EditorView): YBinding | null {
  return ySyncPluginKey.getState(view.state)?.binding ?? null;
}

// In a collaborative editor a block is known by its Yjs element, found by its
// place among the document's elements. A node can't name it: a duplicate
// shares its node with the original, and a peer's update draws every block
// anew, after which ProseMirror can give a deleted block's DOM to the next.
// Nor can the element alone once something else changes it: y-tiptap writes a
// move, whether a peer's or a reload of the saved page, by rewriting elements
// in place, so the element may now hold another block. The menu lets go of
// its block on any change but its own.
//
// A block with no element yet, like a new page's empty first line, is known
// by its DOM until the document changes at all: a loading document can give
// its place to another block.
function watchYBlock(
  view: EditorView,
  pos: number,
  isMenuEdit: () => boolean,
  onChangedElsewhere: () => void,
): YBlock | undefined {
  const binding = getYBinding(view);
  if (!binding) return undefined;
  const index = view.state.doc.resolve(pos).index();
  const candidate = binding.type.get(index);
  const element =
    candidate && binding.mapping.get(candidate) === view.state.doc.child(index)
      ? candidate
      : null;
  const watched = element ?? binding.type;
  const observe = () => {
    if (isMenuEdit() || block.changedElsewhere) return;
    block.changedElsewhere = true;
    onChangedElsewhere();
  };
  const block: YBlock = {
    element,
    changedElsewhere: false,
    unwatch: () => watched.unobserveDeep(observe),
  };
  watched.observeDeep(observe);
  return block;
}

/** The block an open menu acts on, in an editor without collaboration. */
type TrackedBlock = { menu: object; pos: number; node: ProseMirrorNode };

type DragHandleMeta = {
  track?: { menu: object; pos: number };
  menuEdit?: boolean;
};

// Without collaboration the menu follows its block's position through each
// edit, and lets go once anything but the menu touches the block. Its DOM
// can't name it: ProseMirror can hand a deleted block's DOM to the next block.
function trackMenuBlock(
  tr: Transaction,
  tracked: TrackedBlock | null,
): TrackedBlock | null {
  const meta = tr.getMeta(dragHandleKey) as DragHandleMeta | undefined;
  if (meta?.track) {
    const node = tr.doc.nodeAt(meta.track.pos);
    return node ? { ...meta.track, node } : null;
  }
  if (!tracked || !tr.docChanged) return tracked;
  if (meta?.menuEdit) {
    // The menu's own edit can wrap the block, as a list or a quote, or
    // delete it, which leaves the next block where it began.
    const from = tr.mapping.map(tracked.pos, 1);
    const to = tr.mapping.map(tracked.pos + tracked.node.nodeSize, -1);
    if (from >= to) return null;
    const $pos = tr.doc.resolve(tr.mapping.map(tracked.pos, -1));
    const node = tr.doc.maybeChild($pos.index(0));
    return node
      ? { ...tracked, pos: $pos.posAtIndex($pos.index(0), 0), node }
      : null;
  }
  const { pos, deleted } = tr.mapping.mapResult(tracked.pos, 1);
  return !deleted && tr.doc.nodeAt(pos) === tracked.node
    ? { ...tracked, pos }
    : null;
}

/**
 * The block's index, -1 once it is gone or something else changed it, or
 * null while it is known by its DOM.
 */
function findYBlockIndex(view: EditorView, block: YBlock) {
  const binding = getYBinding(view);
  if (!binding || block.changedElsewhere) return -1;
  if (!block.element) return null;
  const index = binding.type.toArray().indexOf(block.element);
  return index !== -1 &&
    binding.mapping.get(block.element) === view.state.doc.maybeChild(index)
    ? index
    : -1;
}

type DragHandleRegistration = {
  view: EditorView;
  wrapperSelector: string;
  getDragTransferData?: DragHandleOptions["getDragTransferData"];
  receiveDragTransferData?: DragHandleOptions["receiveDragTransferData"];
  handleDrop?: DragHandleOptions["handleDrop"];
  canHover?: () => boolean;
  findHoverBlock?: (clientX: number, clientY: number) => HoverBlock | null;
  showHoverBlock?: (block: HoverBlock) => void;
  hideHover?: () => void;
  gripRect?: () => DOMRect | null;
};

const dragHandleRegistrations = new Set<DragHandleRegistration>();
let dragHandleGlobalHoverListeners = 0;
let activeDragRegistration: DragHandleRegistration | null = null;
let activeHoverRegistration: DragHandleRegistration | null = null;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const dragPreviewTransform = ({
  clientX,
  clientY,
  pointerOffsetX,
  pointerOffsetY,
}: {
  clientX: number;
  clientY: number;
  pointerOffsetX: number;
  pointerOffsetY: number;
}) =>
  `translate3d(${clientX - pointerOffsetX}px, ${clientY - pointerOffsetY}px, 0)`;

const collapseAndBlurEditorAfterDrop = (
  view: EditorView,
  preferredPos: number,
) => {
  const pos = clamp(preferredPos, 0, view.state.doc.content.size);
  const selection = TextSelection.near(view.state.doc.resolve(pos), 1);
  if (!view.state.selection.eq(selection)) {
    view.dispatch(view.state.tr.setSelection(selection));
  }

  const nativeSelection = window.getSelection();
  const selectionBelongsToEditor = [
    nativeSelection?.anchorNode,
    nativeSelection?.focusNode,
  ].some((node) => node && (node === view.dom || view.dom.contains(node)));
  if (selectionBelongsToEditor) {
    nativeSelection?.removeAllRanges();
  }
  const activeElement = document.activeElement;
  if (
    activeElement instanceof HTMLElement &&
    (activeElement === view.dom || view.dom.contains(activeElement))
  ) {
    activeElement.blur();
  }
  view.dom.blur();
};

const selectNear = (tr: Transaction, pos: number, bias: -1 | 1) =>
  tr.setSelection(
    TextSelection.near(
      tr.doc.resolve(clamp(pos, 0, tr.doc.content.size)),
      bias,
    ),
  );

const dispatchAndFocus = (view: EditorView, tr: Transaction) => {
  view.dispatch(tr.scrollIntoView());
  view.focus();
};

/**
 * The edit that puts a copy of the block at `pos` right after it and selects
 * the copy, or null when the copy doesn't fit there. A menu asking the page's
 * filters whether it may duplicate must ask about this edit, not a lookalike.
 */
export function duplicateBlockTransaction(
  state: EditorState,
  pos: number,
  node: ProseMirrorNode,
): Transaction | null {
  const insertPos = pos + node.nodeSize;
  const tr = state.tr.insert(insertPos, node);
  if (!tr.docChanged) return null;
  try {
    tr.setSelection(NodeSelection.create(tr.doc, insertPos));
  } catch {
    selectNear(tr, insertPos, 1);
  }
  return markUserAction(tr);
}

/**
 * The edit that deletes the block at `pos` and puts the caret where it was.
 * The page's last block leaves an empty paragraph.
 */
export function deleteBlockTransaction(
  state: EditorState,
  pos: number,
  node: ProseMirrorNode,
): Transaction {
  const end = pos + node.nodeSize;
  const paragraph = state.schema.nodes.paragraph;
  if (state.doc.childCount <= 1 && paragraph) {
    const replacement = paragraph.createAndFill() ?? paragraph.create();
    const tr = state.tr.replaceWith(pos, end, replacement);
    return markUserAction(selectNear(tr, pos + 1, 1));
  }
  const tr = state.tr.delete(pos, end);
  return markUserAction(
    selectNear(tr, pos, pos >= tr.doc.content.size ? -1 : 1),
  );
}

const duplicateNodeAt = (
  view: EditorView,
  pos: number,
  node: ProseMirrorNode,
) => {
  const tr = duplicateBlockTransaction(view.state, pos, node);
  if (tr) dispatchAndFocus(view, tr);
};

// A click on one of these may act on the selected block, so it keeps the
// selection. A click anywhere else on the page lets go of it.
const KEEPS_BLOCK_SELECTION = [
  "button",
  "[role=button]",
  "[role=dialog]",
  "[role=alertdialog]",
  "[role=listbox]",
  "[role=menu]",
  "[role=menubar]",
  "[role=toolbar]",
  "[data-radix-popper-content-wrapper]",
].join(", ");

const editorArea = (registration: DragHandleRegistration) => {
  const rect = registration.view.dom.getBoundingClientRect();
  return rect.width * rect.height;
};

const updateRegisteredHover = (clientX: number, clientY: number) => {
  if (activeDragRegistration) {
    for (const registration of dragHandleRegistrations) {
      registration.hideHover?.();
    }
    activeHoverRegistration = null;
    return;
  }

  const candidates: Array<{
    registration: DragHandleRegistration;
    block: HoverBlock;
  }> = [];

  for (const registration of dragHandleRegistrations) {
    if (!registration.view.dom.isConnected || !registration.canHover?.()) {
      registration.hideHover?.();
      continue;
    }
    const block = registration.findHoverBlock?.(clientX, clientY);
    if (block) {
      candidates.push({ registration, block });
    } else {
      registration.hideHover?.();
    }
  }

  if (activeHoverRegistration) {
    const held = candidates.find(
      (candidate) => candidate.registration === activeHoverRegistration,
    );
    const grip = activeHoverRegistration.gripRect?.();
    if (
      held &&
      grip &&
      clientY >= held.block.rect.top &&
      clientY < held.block.rect.bottom &&
      clientX >= grip.left - 4 &&
      clientX < held.block.rect.left
    ) {
      for (const registration of dragHandleRegistrations) {
        if (registration !== held.registration) registration.hideHover?.();
      }
      held.registration.showHoverBlock?.(held.block);
      return;
    }
  }

  const overContent = candidates.filter(
    (candidate) =>
      clientX >= candidate.block.rect.left &&
      clientX <= candidate.block.rect.right,
  );
  const GRIP_HOVER_ZONE_PX = 28;
  const overGrip = candidates.filter(
    (candidate) =>
      clientX >= candidate.block.rect.left - GRIP_HOVER_ZONE_PX &&
      clientX < candidate.block.rect.left,
  );
  const rightOfLeftEdge = candidates.filter(
    (candidate) => clientX >= candidate.block.rect.left,
  );
  let active: {
    registration: DragHandleRegistration;
    block: HoverBlock;
  } | null;
  const innerPool =
    overContent.length > 0
      ? overContent
      : overGrip.length > 0
        ? overGrip
        : rightOfLeftEdge;
  if (innerPool.length > 0) {
    innerPool.sort(
      (a, b) => editorArea(a.registration) - editorArea(b.registration),
    );
    active = innerPool[0];
  } else {
    candidates.sort(
      (a, b) => editorArea(b.registration) - editorArea(a.registration),
    );
    active = candidates[0] ?? null;
  }

  for (const registration of dragHandleRegistrations) {
    if (registration !== active?.registration) registration.hideHover?.();
  }
  active?.registration.showHoverBlock?.(active.block);
  activeHoverRegistration = active?.registration ?? null;
};

const handleGlobalHoverMove = (event: MouseEvent) => {
  updateRegisteredHover(event.clientX, event.clientY);
};

const retainGlobalHoverListener = () => {
  dragHandleGlobalHoverListeners += 1;
  if (dragHandleGlobalHoverListeners === 1) {
    document.addEventListener("mousemove", handleGlobalHoverMove);
  }
};

const releaseGlobalHoverListener = () => {
  dragHandleGlobalHoverListeners = Math.max(
    0,
    dragHandleGlobalHoverListeners - 1,
  );
  if (dragHandleGlobalHoverListeners === 0) {
    document.removeEventListener("mousemove", handleGlobalHoverMove);
  }
};

const ensureDragHandleMenuStyles = () => {
  if (document.getElementById(DRAG_HANDLE_MENU_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = DRAG_HANDLE_MENU_STYLE_ID;
  style.textContent = `
.an-rich-md-drag-menu {
  position: fixed;
  z-index: 9999;
  width: ${DRAG_HANDLE_MENU_WIDTH}px;
  padding: 4px;
  border: 1px solid hsl(var(--border, 214.3 31.8% 91.4%));
  border-radius: 7px;
  background: hsl(var(--popover, 0 0% 100%));
  color: hsl(var(--popover-foreground, var(--foreground, 222.2 84% 4.9%)));
  box-shadow:
    0 12px 32px rgb(15 23 42 / 0.16),
    0 2px 8px rgb(15 23 42 / 0.08);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.35;
}

.an-rich-md-drag-menu__item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 9px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  letter-spacing: 0;
  padding: 7px 8px;
  text-align: left;
}

.an-rich-md-drag-menu__item:hover,
.an-rich-md-drag-menu__item:focus-visible {
  background: hsl(var(--accent, 210 40% 96.1%));
  color: hsl(var(--accent-foreground, var(--foreground, 222.2 84% 4.9%)));
  outline: none;
}

.an-rich-md-drag-menu__item[data-danger="true"] {
  color: hsl(var(--destructive, 0 84.2% 60.2%));
}

.an-rich-md-drag-menu__item[data-danger="true"]:hover,
.an-rich-md-drag-menu__item[data-danger="true"]:focus-visible {
  background: hsl(var(--destructive, 0 84.2% 60.2%) / 0.1);
}

.an-rich-md-drag-menu__icon {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  color: hsl(var(--muted-foreground, 215.4 16.3% 46.9%));
}

.an-rich-md-drag-menu__item[data-danger="true"] .an-rich-md-drag-menu__icon {
  color: currentColor;
}

.an-rich-md-drag-menu__icon svg {
  width: 17px;
  height: 17px;
}

.an-rich-md-drag-menu__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
`;
  document.head.appendChild(style);
};

export const DragHandle = Extension.create<DragHandleOptions>({
  name: "dragHandle",

  addOptions() {
    return {
      wrapperSelector: DEFAULT_DRAG_HANDLE_WRAPPER_SELECTOR,
      getDragTransferData: undefined,
      receiveDragTransferData: undefined,
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-d": ({ editor }) => {
        const { selection } = editor.state;
        if (!(selection instanceof NodeSelection) || !editor.isEditable) {
          return false;
        }
        duplicateNodeAt(editor.view, selection.from, selection.node);
        // Even a copy the document refuses mustn't open the browser's bookmark
        // dialog over a selected block.
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const wrapperSelector = this.options.wrapperSelector;
    const getDragTransferData = this.options.getDragTransferData;
    const receiveDragTransferData = this.options.receiveDragTransferData;
    const handleDrop = this.options.handleDrop;
    const openHostMenu = this.options.openMenu;
    let handle: HTMLElement | null = null;
    let menu: HTMLElement | null = null;
    let hostMenu: { close: () => void } | null = null;
    let menuContext: DragHandleMenuContext | null = null;
    let menuView: EditorView | null = null;
    // Fingers on the screen while a menu is open: a scroll they drive is a
    // person's pan, not a keyboard opening.
    let menuTouches = 0;
    let menuYBlock: YBlock | null = null;
    let menuEditing = false;
    let currentBlock: HTMLElement | null = null;
    let dragStartPos: number | null = null;
    let dragSession: DragSession | null = null;
    let currentRegistration: DragHandleRegistration | null = null;

    const getHoverSideOutset = () => {
      const rootFontSize = Number.parseFloat(
        getComputedStyle(document.documentElement).fontSize,
      );
      return (
        (Number.isFinite(rootFontSize) ? rootFontSize : 16) *
        HOVER_SIDE_OUTSET_REM
      );
    };

    const getTopLevelBlocks = (editorView: EditorView): HoverBlock[] => {
      const blocks: HoverBlock[] = [];

      editorView.state.doc.forEach((_node, offset) => {
        const dom = editorView.nodeDOM(offset);
        if (!(dom instanceof HTMLElement)) return;

        blocks.push({
          node: dom,
          pmPos: offset,
          rect: dom.getBoundingClientRect(),
        });
      });

      return blocks;
    };

    const registrationForView = (
      editorView: EditorView,
    ): DragHandleRegistration | null => {
      for (const registration of dragHandleRegistrations) {
        if (registration.view === editorView) return registration;
      }
      return null;
    };

    const findForgivingBlock = (
      editorView: EditorView,
      clientX: number,
      clientY: number,
    ): HoverBlock | null => {
      const blocks = getTopLevelBlocks(editorView);
      if (blocks.length === 0) return null;

      const sideOutset = getHoverSideOutset();
      const pageLeft = 0;
      const pageRight = window.visualViewport?.width ?? window.innerWidth;

      for (let index = 0; index < blocks.length; index++) {
        const block = blocks[index];
        const nextBlock = blocks[index + 1];
        const blockBottomGap = nextBlock
          ? Math.max(0, nextBlock.rect.top - block.rect.bottom)
          : 0;
        const zoneLeft = Math.max(pageLeft, block.rect.left - sideOutset);
        const zoneRight = Math.min(pageRight, block.rect.right + sideOutset);
        const zoneTop =
          index === 0
            ? Math.max(0, block.rect.top - blockBottomGap)
            : block.rect.top;
        const zoneBottom = nextBlock ? nextBlock.rect.top : block.rect.bottom;

        if (
          clientX >= zoneLeft &&
          clientX <= zoneRight &&
          clientY >= zoneTop &&
          clientY < zoneBottom
        ) {
          return block;
        }
      }

      return null;
    };

    const showHandleForBlock = (editorView: EditorView, block: HoverBlock) => {
      if (!handle) return;
      currentBlock = block.node;
      dragStartPos = block.pmPos;

      const wrapper = editorView.dom.closest(wrapperSelector);
      if (!wrapper) return;

      if (handle.parentElement !== wrapper) {
        (wrapper as HTMLElement).style.position = "relative";
        wrapper.appendChild(handle);
      }

      const wrapperRect = wrapper.getBoundingClientRect();
      // A phone-width page leaves less than the grip's width beside the block.
      const handleLeft = Math.max(
        block.rect.left - wrapperRect.left - 24,
        -wrapperRect.left,
      );

      handle.style.display = "flex";
      handle.style.top = `${block.rect.top - wrapperRect.top + 2}px`;
      handle.style.left = `${handleLeft}px`;
    };

    const selectBlockAt = (
      editorView: EditorView,
      pos: number,
      menu?: object,
    ) => {
      const tr = editorView.state.tr;
      if (menu) tr.setMeta(dragHandleKey, { track: { menu, pos } });
      try {
        tr.setSelection(NodeSelection.create(tr.doc, pos));
      } catch {
        if (menu) editorView.dispatch(tr);
        return null;
      }
      editorView.dispatch(tr);
      editorView.focus();
      return tr.selection;
    };

    const cleanupDragVisuals = () => {
      dragSession?.preview?.remove();
      dragSession?.dropLine?.remove();
      // Even a class write that changes nothing makes ProseMirror read the
      // block back, which turns the block a click selected into its text.
      if (dragSession?.dragging) {
        dragSession.sourceBlock.classList.remove("notion-block--dragging");
      }
      document.documentElement.classList.remove("notion-editor-is-dragging");
    };

    const createDragPreview = (block: HTMLElement): HTMLElement => {
      const blockRect = block.getBoundingClientRect();
      const preview = document.createElement("div");
      const clone = block.cloneNode(true) as HTMLElement;

      clone.classList.remove(
        "ProseMirror-selectednode",
        "notion-block--dragging",
      );
      clone.removeAttribute("contenteditable");
      clone.style.background = "transparent";
      clone.style.backgroundColor = "transparent";
      clone.querySelectorAll("[contenteditable]").forEach((node) => {
        node.removeAttribute("contenteditable");
      });
      clone.querySelectorAll<HTMLElement>("*").forEach((node) => {
        node.style.background = "transparent";
        node.style.backgroundColor = "transparent";
      });

      preview.className = "notion-drag-preview";
      preview.style.width = `${blockRect.width}px`;
      preview.appendChild(clone);
      document.body.appendChild(preview);

      return preview;
    };

    const createDropLine = (
      registration: DragHandleRegistration,
    ): HTMLElement | null => {
      const wrapper = registration.view.dom.closest(
        registration.wrapperSelector,
      );
      if (!wrapper) return null;

      const line = document.createElement("div");
      line.className = "notion-drop-indicator";
      wrapper.appendChild(line);
      return line;
    };

    const forceHideHandle = () => {
      if (handle) {
        handle.style.display = "none";
        handle.setAttribute("aria-expanded", "false");
      }
      currentBlock = null;
      dragStartPos = null;
    };

    const closeMenu = ({ hideGrip = false }: { hideGrip?: boolean } = {}) => {
      const openHost = hostMenu;
      hostMenu = null;
      openHost?.close();
      menu?.remove();
      menu = null;
      menuContext = null;
      menuView = null;
      menuYBlock?.unwatch();
      menuYBlock = null;
      handle?.setAttribute("aria-expanded", "false");
      document.removeEventListener("mousedown", handleMenuDocumentMouseDown, {
        capture: true,
      });
      document.removeEventListener("keydown", handleMenuKeyDown, {
        capture: true,
      });
      unwatchMenuViewport();
      if (hideGrip) forceHideHandle();
    };

    // An open app menu resolves its block on every render, so this reads no
    // layout. The block is found by its identity, not by position: once the
    // block is gone, its old position holds the next block.
    const resolveMenuContext = (context: DragHandleMenuContext) => {
      if (context.menu) {
        const tracked = dragHandleKey.getState(context.view.state) as
          | TrackedBlock
          | null
          | undefined;
        return tracked?.menu === context.menu
          ? {
              ...context,
              sourcePos: tracked.pos,
              sourceNode: tracked.node,
              sourceNodeSize: tracked.node.nodeSize,
            }
          : null;
      }
      const { doc } = context.view.state;
      const yIndex = context.yBlock
        ? findYBlockIndex(context.view, context.yBlock)
        : null;
      if (yIndex === -1) return null;
      let sourcePos = 0;
      for (let index = 0; index < doc.childCount; index += 1) {
        const sourceNode = doc.child(index);
        if (
          yIndex === null
            ? context.view.nodeDOM(sourcePos) === context.sourceBlock
            : index === yIndex
        ) {
          return {
            ...context,
            sourcePos,
            sourceNode,
            sourceNodeSize: sourceNode.nodeSize,
          };
        }
        sourcePos += sourceNode.nodeSize;
      }
      return null;
    };

    const duplicateBlock = (context: DragHandleMenuContext) => {
      const resolved = resolveMenuContext(context);
      if (!resolved) return;
      duplicateNodeAt(resolved.view, resolved.sourcePos, resolved.sourceNode);
    };

    const deleteBlock = (context: DragHandleMenuContext) => {
      const resolved = resolveMenuContext(context);
      if (!resolved) return;

      const { view, sourcePos, sourceNode } = resolved;
      dispatchAndFocus(
        view,
        deleteBlockTransaction(view.state, sourcePos, sourceNode),
      );
    };

    const insertParagraphBelow = (context: DragHandleMenuContext) => {
      const resolved = resolveMenuContext(context);
      const paragraph = resolved?.view.state.schema.nodes.paragraph;
      if (!resolved || !paragraph) return;

      const insertPos = resolved.sourcePos + resolved.sourceNodeSize;
      const paragraphNode = paragraph.createAndFill() ?? paragraph.create();
      const tr = resolved.view.state.tr.insert(insertPos, paragraphNode);
      tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
      resolved.view.dispatch(markUserAction(tr).scrollIntoView());
      resolved.view.focus();
    };

    const resolveMenuAnchorRect = (
      ...candidates: Array<Element | null | undefined>
    ): DOMRect | null => {
      for (const candidate of candidates) {
        if (!candidate || !candidate.isConnected) continue;
        const rect = candidate.getBoundingClientRect();
        if (rect.width <= 0 && rect.height <= 0) continue;
        return rect;
      }
      return null;
    };

    const positionMenu = (anchorRect: DOMRect) => {
      if (!menu) return;

      const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
      const viewportHeight =
        window.visualViewport?.height ?? window.innerHeight;
      const menuHeight = menu.offsetHeight || 118;
      const preferredLeft = anchorRect.right + DRAG_HANDLE_MENU_GAP;
      const alternateLeft =
        anchorRect.left - DRAG_HANDLE_MENU_WIDTH - DRAG_HANDLE_MENU_GAP;
      const left =
        preferredLeft +
          DRAG_HANDLE_MENU_WIDTH +
          DRAG_HANDLE_MENU_VIEWPORT_PADDING <=
        viewportWidth
          ? preferredLeft
          : alternateLeft;

      menu.style.left = `${clamp(
        left,
        DRAG_HANDLE_MENU_VIEWPORT_PADDING,
        viewportWidth -
          DRAG_HANDLE_MENU_WIDTH -
          DRAG_HANDLE_MENU_VIEWPORT_PADDING,
      )}px`;
      menu.style.top = `${clamp(
        anchorRect.top - 4,
        DRAG_HANDLE_MENU_VIEWPORT_PADDING,
        viewportHeight - menuHeight - DRAG_HANDLE_MENU_VIEWPORT_PADDING,
      )}px`;
    };

    const createMenuItem = (
      label: string,
      iconSvg: string,
      action: (context: DragHandleMenuContext) => void,
      options: { danger?: boolean } = {},
    ) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "an-rich-md-drag-menu__item";
      button.setAttribute("role", "menuitem");
      button.setAttribute("data-plan-interactive", "true");
      if (options.danger) button.setAttribute("data-danger", "true");

      const icon = document.createElement("span");
      icon.className = "an-rich-md-drag-menu__icon";
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = iconSvg;

      const labelElement = document.createElement("span");
      labelElement.className = "an-rich-md-drag-menu__label";
      labelElement.textContent = label;

      button.append(icon, labelElement);
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
      });
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const context = menuContext;
        if (!context) return;
        closeMenu({ hideGrip: true });
        action(context);
      });

      return button;
    };

    const openMenu = (context: DragHandleMenuContext, anchorRect: DOMRect) => {
      const resolved = resolveMenuContext(context);
      if (!resolved) return;

      closeMenu();
      const yBlock = watchYBlock(
        resolved.view,
        resolved.sourcePos,
        () => menuEditing,
        () => closeMenu({ hideGrip: true }),
      );
      menuYBlock = yBlock ?? null;
      menuView = resolved.view;
      const menuToken = yBlock ? undefined : {};
      selectBlockAt(resolved.view, resolved.sourcePos, menuToken);

      const block: DragHandleMenuContext = {
        view: resolved.view,
        sourceBlock: resolved.sourceBlock,
        sourcePos: resolved.sourcePos,
        sourceNodeSize: resolved.sourceNodeSize,
        yBlock,
        menu: menuToken,
      };

      if (openHostMenu) {
        const entry = { close: () => {} };
        const close = openHostMenu({
          view: resolved.view,
          anchorRect,
          getBlock: () => {
            const latest = resolveMenuContext(block);
            return latest
              ? { node: latest.sourceNode, pos: latest.sourcePos }
              : null;
          },
          dispatch: (tr) => {
            menuEditing = true;
            try {
              resolved.view.dispatch(
                tr.setMeta(dragHandleKey, { menuEdit: true }),
              );
            } finally {
              menuEditing = false;
            }
          },
          duplicate: () => duplicateBlock(block),
          remove: () => deleteBlock(block),
          insertBelow: () => insertParagraphBelow(block),
          onClose: () => {
            if (hostMenu !== entry) return;
            hostMenu = null;
            closeMenu({ hideGrip: true });
          },
        });
        if (close) {
          entry.close = close;
          hostMenu = entry;
          handle?.setAttribute("aria-expanded", "true");
          watchMenuViewport();
          return;
        }
      }

      ensureDragHandleMenuStyles();

      const el = document.createElement("div");
      el.className = "an-rich-md-drag-menu";
      el.setAttribute("role", "menu");
      el.setAttribute("aria-label", "Block actions");
      el.setAttribute("data-plan-interactive", "true");

      el.append(
        createMenuItem(
          "Duplicate",
          DRAG_HANDLE_MENU_ICON_DUPLICATE,
          duplicateBlock,
        ),
        createMenuItem("Delete", DRAG_HANDLE_MENU_ICON_DELETE, deleteBlock, {
          danger: true,
        }),
        createMenuItem(
          "Insert block below",
          DRAG_HANDLE_MENU_ICON_INSERT,
          insertParagraphBelow,
        ),
      );

      menu = el;
      menuContext = block;
      document.body.appendChild(el);
      positionMenu(anchorRect);
      handle?.setAttribute("aria-expanded", "true");
      document.addEventListener("mousedown", handleMenuDocumentMouseDown, {
        capture: true,
      });
      document.addEventListener("keydown", handleMenuKeyDown, {
        capture: true,
      });
      watchMenuViewport();

      el.querySelector<HTMLButtonElement>("button")?.focus({
        preventScroll: true,
      });
    };

    const findDropTarget = (
      registration: DragHandleRegistration,
      clientX: number,
      clientY: number,
    ): DropTarget | null => {
      const view = registration.view;
      const block = findForgivingBlock(view, clientX, clientY);
      if (!block) return null;

      const node = view.state.doc.nodeAt(block.pmPos);
      if (!node) return null;

      let placement: DragHandleDropPlacement;
      const withinBlockY =
        clientY >= block.rect.top && clientY <= block.rect.bottom;
      const sideZoneWidth = Math.min(
        clamp(
          block.rect.width * SIDE_DROP_ZONE_RATIO,
          SIDE_DROP_ZONE_MIN_PX,
          SIDE_DROP_ZONE_MAX_PX,
        ),
        block.rect.width * SIDE_DROP_ZONE_MAX_WIDTH_FRACTION,
      );

      if (
        registration.handleDrop &&
        withinBlockY &&
        clientX <= block.rect.left + sideZoneWidth
      ) {
        placement = "left";
      } else if (
        registration.handleDrop &&
        withinBlockY &&
        clientX >= block.rect.right - sideZoneWidth
      ) {
        placement = "right";
      } else {
        placement =
          clientY < block.rect.top ||
          (clientY <= block.rect.bottom &&
            clientY < block.rect.top + block.rect.height / 2)
            ? "before"
            : "after";
      }
      const before = placement === "before" || placement === "left";

      return {
        registration,
        view,
        block: block.node,
        placement,
        pos: before ? block.pmPos : block.pmPos + node.nodeSize,
        targetPos: block.pmPos,
        targetNodeSize: node.nodeSize,
        rect: block.rect,
      };
    };

    const findAnyDropTarget = (
      session: DragSession,
      clientX: number,
      clientY: number,
    ): DropTarget | null => {
      const candidates: DropTarget[] = [];

      for (const registration of dragHandleRegistrations) {
        if (!registration.view.dom.isConnected) continue;
        if (
          registration.view !== session.view &&
          session.sourceBlock.contains(registration.view.dom)
        ) {
          continue;
        }
        const target = findDropTarget(registration, clientX, clientY);
        if (target) candidates.push(target);
      }

      candidates.sort((a, b) => {
        const aRect = a.view.dom.getBoundingClientRect();
        const bRect = b.view.dom.getBoundingClientRect();
        return aRect.width * aRect.height - bRect.width * bRect.height;
      });

      return candidates[0] ?? null;
    };

    const positionDragPreview = (
      session: DragSession,
      clientX: number,
      clientY: number,
    ) => {
      if (!session.preview) return;

      session.preview.style.transform = dragPreviewTransform({
        clientX,
        clientY,
        pointerOffsetX: session.pointerOffsetX,
        pointerOffsetY: session.pointerOffsetY,
      });
    };

    const updateDropLine = (
      session: DragSession,
      target: DropTarget | null,
    ) => {
      const sourceEnd = session.sourcePos + session.sourceNodeSize;
      const isSideDrop =
        target?.placement === "left" || target?.placement === "right";
      if (
        !target ||
        (target.view === session.view &&
          (isSideDrop
            ? target.targetPos === session.sourcePos
            : target.pos === session.sourcePos ||
              target.pos === sourceEnd ||
              (target.pos > session.sourcePos && target.pos < sourceEnd)))
      ) {
        session.dropTarget = null;
        session.dropLine?.remove();
        session.dropLine = null;
        return;
      }

      const wrapper = target.view.dom.closest(
        target.registration.wrapperSelector,
      );
      if (!wrapper) return;

      if (!session.dropLine || session.dropLine.parentElement !== wrapper) {
        session.dropLine?.remove();
        session.dropLine = createDropLine(target.registration);
      }
      if (!session.dropLine) return;

      const wrapperRect = wrapper.getBoundingClientRect();
      const editorRect = target.view.dom.getBoundingClientRect();

      session.dropTarget = target;
      const isColumnDrop =
        target.placement === "left" || target.placement === "right";
      session.dropLine.classList.toggle(
        "notion-drop-indicator--column",
        isColumnDrop,
      );
      if (isColumnDrop) {
        const SIDE_BAR_WIDTH = 4;
        const seam =
          target.placement === "left" ? target.rect.left : target.rect.right;
        session.dropLine.style.left = `${seam - wrapperRect.left - SIDE_BAR_WIDTH / 2}px`;
        session.dropLine.style.top = `${target.rect.top - wrapperRect.top}px`;
        session.dropLine.style.width = `${SIDE_BAR_WIDTH}px`;
        session.dropLine.style.height = `${target.rect.height}px`;
        return;
      }

      const top =
        target.placement === "before" ? target.rect.top : target.rect.bottom;
      session.dropLine.style.left = `${editorRect.left - wrapperRect.left}px`;
      session.dropLine.style.top = `${top - wrapperRect.top}px`;
      session.dropLine.style.width = `${editorRect.width}px`;
      session.dropLine.style.height = "3px";
    };

    const createHandle = () => {
      const el = document.createElement("div");
      el.className = "drag-handle";
      el.contentEditable = "false";
      el.draggable = false;
      el.tabIndex = 0;
      el.setAttribute("role", "button");
      el.setAttribute("aria-label", "Open block menu or drag to reorder");
      el.setAttribute("aria-haspopup", "menu");
      el.setAttribute("aria-expanded", "false");
      el.title = "Open block menu or drag to reorder";
      el.innerHTML = DRAG_HANDLE_GRIP_ICON;
      const gripSvg = el.querySelector("svg");
      if (gripSvg) {
        gripSvg.setAttribute("width", "16");
        gripSvg.setAttribute("height", "16");
        gripSvg.style.pointerEvents = "none";
      }
      return el;
    };

    const hideHandle = () => {
      if (menu || hostMenu) return;
      forceHideHandle();
    };

    const removeDragListeners = () => {
      document.removeEventListener("mousemove", handleDocumentMouseMove);
      document.removeEventListener("mouseup", handleDocumentMouseUp);
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };

    function handleMenuDocumentMouseDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menu?.contains(target) || handle?.contains(target)) return;
      closeMenu({ hideGrip: true });
    }

    function handleMenuKeyDown(event: KeyboardEvent) {
      if (!menu) return;

      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu({ hideGrip: true });
        return;
      }

      if (
        event.key !== "ArrowDown" &&
        event.key !== "ArrowUp" &&
        event.key !== "Home" &&
        event.key !== "End"
      ) {
        return;
      }

      const buttons = Array.from(
        menu.querySelectorAll<HTMLButtonElement>("button"),
      );
      if (buttons.length === 0) return;

      event.preventDefault();
      const activeIndex = buttons.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      let nextIndex = activeIndex < 0 ? 0 : activeIndex;

      if (event.key === "ArrowDown") {
        nextIndex = (nextIndex + 1) % buttons.length;
      } else if (event.key === "ArrowUp") {
        nextIndex = (nextIndex - 1 + buttons.length) % buttons.length;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = buttons.length - 1;
      }

      buttons[nextIndex]?.focus({ preventScroll: true });
    }

    function countMenuTouches(event: TouchEvent) {
      menuTouches = event.touches.length;
    }

    function watchMenuViewport() {
      window.addEventListener("resize", handleMenuViewportChange);
      window.addEventListener("scroll", handleMenuViewportChange, {
        capture: true,
      });
      for (const type of ["touchstart", "touchend", "touchcancel"] as const) {
        document.addEventListener(type, countMenuTouches, {
          capture: true,
          passive: true,
        });
      }
    }

    function unwatchMenuViewport() {
      window.removeEventListener("resize", handleMenuViewportChange);
      window.removeEventListener("scroll", handleMenuViewportChange, {
        capture: true,
      });
      for (const type of ["touchstart", "touchend", "touchcancel"] as const) {
        document.removeEventListener(type, countMenuTouches, { capture: true });
      }
      menuTouches = 0;
    }

    function handleMenuViewportChange(event: Event) {
      // Only a scroll that moves the menu's block closes it: not the menu
      // scrolling its own items, or a sidebar keeping its current row in view.
      if (
        event.target instanceof Element &&
        menuView &&
        !event.target.contains(menuView.dom)
      ) {
        return;
      }
      // A touch screen's keyboard, opening for a field in the menu, resizes
      // the page and scrolls the field into view.
      const active = document.activeElement;
      if (
        menuTouches === 0 &&
        active instanceof Element &&
        active.matches("input, textarea") &&
        active.closest('[role="menu"]') &&
        window.matchMedia?.("(pointer: coarse)").matches
      ) {
        return;
      }
      closeMenu({ hideGrip: true });
    }

    const finishDragSession = (commit: boolean, event?: MouseEvent) => {
      const session = dragSession;
      if (!session) return;

      removeDragListeners();

      if (commit && session.dragging && session.dropTarget) {
        const sourceStart = session.sourcePos;
        const sourceEnd = session.sourcePos + session.sourceNodeSize;
        const target = session.dropTarget;
        const dropPos = target.pos;
        const isSideDrop =
          target.placement === "left" || target.placement === "right";

        if (
          target.view !== session.view ||
          (isSideDrop
            ? target.targetPos !== sourceStart
            : dropPos !== sourceStart &&
              dropPos !== sourceEnd &&
              !(dropPos > sourceStart && dropPos < sourceEnd))
        ) {
          const sourceNode = session.view.state.doc.nodeAt(sourceStart);
          if (sourceNode) {
            let dropCommitted = false;
            const sourceRegistration = registrationForView(session.view);
            const transferData = sourceRegistration?.getDragTransferData?.({
              view: session.view,
              node: sourceNode,
              pos: sourceStart,
            });
            const targetNode = target.view.state.doc.nodeAt(target.targetPos);
            const handled =
              !!targetNode &&
              (target.registration.handleDrop?.(transferData, {
                view: target.view,
                sourceView: session.view,
                sourceNode,
                sourcePos: sourceStart,
                sourceNodeSize: sourceNode.nodeSize,
                targetNode,
                targetPos: target.targetPos,
                targetNodeSize: target.targetNodeSize,
                insertPos: dropPos,
                placement: target.placement,
              }) ??
                false);

            if (handled) {
              dropCommitted = true;
            } else if (target.view === session.view) {
              const insertPos =
                dropPos > sourceStart ? dropPos - sourceNode.nodeSize : dropPos;
              const tr = session.view.state.tr
                .delete(sourceStart, sourceEnd)
                .insert(insertPos, sourceNode);

              session.view.dispatch(markUserAction(tr).scrollIntoView());
              dropCommitted = true;
            } else {
              try {
                const targetNode = target.view.state.schema.nodeFromJSON(
                  sourceNode.toJSON(),
                );
                target.registration.receiveDragTransferData?.(transferData, {
                  view: target.view,
                  node: targetNode,
                  pos: dropPos,
                  sourceView: session.view,
                });
                const insertTr = target.view.state.tr.insert(
                  dropPos,
                  targetNode,
                );
                target.view.dispatch(markUserAction(insertTr).scrollIntoView());

                const deleteTr = session.view.state.tr.delete(
                  sourceStart,
                  sourceEnd,
                );
                session.view.dispatch(markUserAction(deleteTr));
                dropCommitted = true;
              } catch {
                // If the target schema cannot accept this node, leave the
                // source document untouched.
              }
            }

            if (dropCommitted) {
              collapseAndBlurEditorAfterDrop(target.view, dropPos);
              if (target.view !== session.view) {
                collapseAndBlurEditorAfterDrop(session.view, sourceStart);
              }
            }
          }
        }
      } else if (commit && !session.dragging && event) {
        const anchorRect = resolveMenuAnchorRect(
          handle,
          session.sourceBlock,
          session.view.dom,
        );
        if (anchorRect) {
          openMenu(
            {
              view: session.view,
              sourceBlock: session.sourceBlock,
              sourcePos: session.sourcePos,
              sourceNodeSize: session.sourceNodeSize,
            },
            anchorRect,
          );
        }
      }

      cleanupDragVisuals();
      dragSession = null;
      if (activeDragRegistration === currentRegistration) {
        activeDragRegistration = null;
      }
      if (session.dragging || !commit) hideHandle();
    };

    const beginDragSession = (session: DragSession, event: MouseEvent) => {
      session.dragging = true;
      session.preview = createDragPreview(session.sourceBlock);
      session.sourceBlock.classList.add("notion-block--dragging");
      document.documentElement.classList.add("notion-editor-is-dragging");
      positionDragPreview(session, event.clientX, event.clientY);
      updateDropLine(
        session,
        findAnyDropTarget(session, event.clientX, event.clientY),
      );
    };

    function handleDocumentMouseMove(event: MouseEvent) {
      if (!dragSession) return;
      event.preventDefault();

      const movedEnough =
        Math.hypot(
          event.clientX - dragSession.startX,
          event.clientY - dragSession.startY,
        ) > 4;

      if (!dragSession.dragging && movedEnough) {
        beginDragSession(dragSession, event);
      }

      if (!dragSession.dragging) return;

      positionDragPreview(dragSession, event.clientX, event.clientY);
      updateDropLine(
        dragSession,
        findAnyDropTarget(dragSession, event.clientX, event.clientY),
      );
    }

    function handleDocumentMouseUp(event: MouseEvent) {
      event.preventDefault();
      finishDragSession(true, event);
    }

    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      finishDragSession(false);
    }

    return [
      new Plugin({
        key: dragHandleKey,
        state: {
          init: () => null as TrackedBlock | null,
          apply: trackMenuBlock,
        },
        view(editorView) {
          const registration: DragHandleRegistration = {
            view: editorView,
            wrapperSelector,
            getDragTransferData,
            receiveDragTransferData,
            handleDrop,
            canHover: () =>
              !!handle &&
              !menu &&
              !hostMenu &&
              !dragSession &&
              editor.isEditable,
            findHoverBlock: (clientX, clientY) =>
              findForgivingBlock(editorView, clientX, clientY),
            showHoverBlock: (block) => showHandleForBlock(editorView, block),
            hideHover: () => hideHandle(),
            gripRect: () =>
              handle && handle.style.display !== "none"
                ? resolveMenuAnchorRect(handle)
                : null,
          };
          currentRegistration = registration;
          dragHandleRegistrations.add(registration);
          retainGlobalHoverListener();
          handle = createHandle();
          const wrapper = editorView.dom.closest(wrapperSelector);
          if (wrapper) {
            (wrapper as HTMLElement).style.position = "relative";
            wrapper.appendChild(handle);
          }

          handle.addEventListener("mousedown", (e) => {
            e.stopPropagation();
            if (e.button !== 0) return;
            closeMenu();
            if (!editor.isEditable) {
              e.preventDefault();
              return;
            }

            if (!currentBlock || dragStartPos === null) return;

            const sourceNode = editorView.state.doc.nodeAt(dragStartPos);
            if (!sourceNode) return;

            e.preventDefault();
            const sourceRect = currentBlock.getBoundingClientRect();
            dragSession = {
              view: editorView,
              sourceBlock: currentBlock,
              sourcePos: dragStartPos,
              sourceNodeSize: sourceNode.nodeSize,
              startX: e.clientX,
              startY: e.clientY,
              pointerOffsetX: e.clientX - sourceRect.left,
              pointerOffsetY: e.clientY - sourceRect.top,
              dragging: false,
              preview: null,
              dropLine: null,
              dropTarget: null,
            };
            activeDragRegistration = registration;

            document.addEventListener("mousemove", handleDocumentMouseMove);
            document.addEventListener("mouseup", handleDocumentMouseUp);
            document.addEventListener("keydown", handleDocumentKeyDown);
          });

          // A selected block keeps its outline when the editor loses focus,
          // so a click on the page beside it has to let go of it.
          const releaseBlockSelection = (event: PointerEvent) => {
            const { selection } = editorView.state;
            if (event.button !== 0 || !(selection instanceof NodeSelection)) {
              return;
            }
            const target = event.target;
            if (
              !(target instanceof Element) ||
              editorView.dom.contains(target) ||
              handle?.contains(target) ||
              target.closest(KEEPS_BLOCK_SELECTION)
            ) {
              return;
            }
            const caret =
              Selection.findFrom(selection.$from, 1, true) ??
              Selection.findFrom(selection.$from, -1, true);
            if (caret)
              editorView.dispatch(editorView.state.tr.setSelection(caret));
          };
          const ownerDocument = editorView.dom.ownerDocument;
          ownerDocument.addEventListener(
            "pointerdown",
            releaseBlockSelection,
            true,
          );

          handle.addEventListener("keydown", (e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            e.stopPropagation();
            closeMenu();
            if (!editor.isEditable || !currentBlock || dragStartPos === null) {
              return;
            }

            const sourceNode = editorView.state.doc.nodeAt(dragStartPos);
            if (!sourceNode) return;

            const anchorRect = resolveMenuAnchorRect(
              handle,
              currentBlock,
              editorView.dom,
            );
            if (!anchorRect) return;

            openMenu(
              {
                view: editorView,
                sourceBlock: currentBlock,
                sourcePos: dragStartPos,
                sourceNodeSize: sourceNode.nodeSize,
              },
              anchorRect,
            );
          });

          return {
            destroy() {
              ownerDocument.removeEventListener(
                "pointerdown",
                releaseBlockSelection,
                true,
              );
              closeMenu({ hideGrip: true });
              finishDragSession(false);
              releaseGlobalHoverListener();
              dragHandleRegistrations.delete(registration);
              if (activeDragRegistration === registration) {
                activeDragRegistration = null;
              }
              if (activeHoverRegistration === registration) {
                activeHoverRegistration = null;
              }
              handle?.remove();
              handle = null;
              currentRegistration = null;
            },
          };
        },
        props: {
          handleDOMEvents: {
            mousemove(_view, event) {
              updateRegisteredHover(event.clientX, event.clientY);
              return false;
            },
            drop() {
              closeMenu({ hideGrip: true });
              finishDragSession(false);
              hideHandle();
              return false;
            },
          },
        },
      }),
    ];
  },
});
