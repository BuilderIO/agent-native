import { Extension } from "@tiptap/core";
import {
  Plugin,
  PluginKey,
  NodeSelection,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { type EditorView } from "@tiptap/pm/view";

/**
 * Default editor-wrapper CSS selector the drag handle scopes itself to.
 *
 * The handle, the drop indicator, and the `position: relative` anchor are all
 * appended to / measured against the closest ancestor matching this selector.
 * Content's editor wraps its ProseMirror DOM in a `.visual-editor-wrapper`
 * element, so that is the historical default. Other apps (e.g. the plan editor)
 * pass their own wrapper selector via {@link DragHandleOptions.wrapperSelector}.
 */
export const DEFAULT_DRAG_HANDLE_WRAPPER_SELECTOR = ".visual-editor-wrapper";

export interface DragHandleOptions {
  /**
   * CSS selector for the editor wrapper element the handle is anchored to.
   *
   * Must match an ancestor of the ProseMirror editor DOM. The wrapper gets
   * `position: relative` so the absolutely-positioned grip and drop indicator
   * can be placed relative to it. Defaults to
   * {@link DEFAULT_DRAG_HANDLE_WRAPPER_SELECTOR} so Content keeps working
   * unchanged.
   */
  wrapperSelector: string;
  /**
   * Optional source-side payload for a cross-editor block move. The editor doc
   * carries ProseMirror node content, but app-owned side-map data (for example a
   * plan `diagram` block's HTML/CSS) can live outside the doc; this lets the
   * host carry that data to the receiving editor before the node is inserted.
   */
  getDragTransferData?: (context: {
    view: EditorView;
    node: ProseMirrorNode;
    pos: number;
  }) => unknown;
  /**
   * Optional target-side receiver for cross-editor transfer data. Called before
   * the node is inserted into the target editor so the target's serializer can
   * resolve app-owned data during the synchronous ProseMirror update.
   */
  receiveDragTransferData?: (
    data: unknown,
    context: {
      view: EditorView;
      node: ProseMirrorNode;
      pos: number;
      sourceView: EditorView;
    },
  ) => void;
  /**
   * Optional host-level drop handler for document-specific structure changes.
   * Returning true tells the shared drag handle that the host fully handled the
   * move and no ProseMirror insert/delete should run. This is used for
   * Notion-style side drops where dropping a block to the left/right creates or
   * inserts into a column layout rather than inserting into the target editor.
   */
  handleDrop?: (data: unknown, context: DragHandleDropContext) => boolean;
}

const dragHandleKey = new PluginKey("dragHandle");
const HOVER_SIDE_OUTSET_REM = 8;
const SIDE_DROP_ZONE_RATIO = 0.28;
const SIDE_DROP_ZONE_MIN_PX = 48;
const SIDE_DROP_ZONE_MAX_PX = 140;
const DRAG_HANDLE_MENU_STYLE_ID = "an-rich-md-drag-menu-styles";
const DRAG_HANDLE_MENU_WIDTH = 220;
const DRAG_HANDLE_MENU_GAP = 6;
const DRAG_HANDLE_MENU_VIEWPORT_PADDING = 8;

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
};

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
};

const dragHandleRegistrations = new Set<DragHandleRegistration>();
let dragHandleGlobalHoverListeners = 0;
let activeDragRegistration: DragHandleRegistration | null = null;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const editorArea = (registration: DragHandleRegistration) => {
  const rect = registration.view.dom.getBoundingClientRect();
  return rect.width * rect.height;
};

const updateRegisteredHover = (clientX: number, clientY: number) => {
  if (activeDragRegistration) {
    for (const registration of dragHandleRegistrations) {
      registration.hideHover?.();
    }
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

  // Pick which editor owns the grip when several register a hover block at this
  // point. Nested region editors (e.g. each column inside a `columns` block) tile
  // their container's whole footprint AND extend a wide forgiving zone
  // (HOVER_SIDE_OUTSET_REM) into its left-margin gutter, so a pure
  // "smallest editor wins" rule lets an inner block beat the container everywhere
  // and leaves the container itself impossible to grab. Split candidates by where
  // the cursor sits relative to each block:
  //   - Over a block's body (clientX at/after its left edge) the innermost
  //     (smallest) editor wins, so nested blocks stay grabbable from their content.
  //   - In the shared left-margin gutter (clientX left of every candidate's
  //     content, where the grip lives) the outermost (largest) editor wins, so the
  //     container block can be picked up and reordered.
  // Prefer the candidate whose block actually sits UNDER the cursor
  // horizontally. Without this, a left column's forgiving side zone reaches
  // across the inter-column gap, ties the right column's editor on area, and
  // wins — so hovering a right-column block shows the grip for the LEFT block
  // (and right-column blocks appear to have no grip at all). `overContent`
  // restricts to blocks the cursor is genuinely within; `rightOfLeftEdge` keeps
  // the gutter-grab behaviour; fully left of every block → the container wins.
  const overContent = candidates.filter(
    (candidate) =>
      clientX >= candidate.block.rect.left &&
      clientX <= candidate.block.rect.right,
  );
  // The grip renders in a narrow band just LEFT of each block (≈24px). A block
  // must OWN that band so moving the cursor onto its grip keeps showing (and
  // lets you press) that block's grip — otherwise, for a column block whose grip
  // sits in the gutter/inter-column gap, the "gutter → largest editor" rule
  // below would flip the hover to the columns container and the grip would
  // vanish out from under the cursor, making inner column blocks impossible to
  // drag. The band is narrow, so it does not collide with the neighbouring
  // column's content (the right column's grip lives in the inter-column gap,
  // left of its own content but right of the left column's content).
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
  position: relative;
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  color: hsl(var(--muted-foreground, 215.4 16.3% 46.9%));
}

.an-rich-md-drag-menu__item[data-danger="true"] .an-rich-md-drag-menu__icon {
  color: currentColor;
}

.an-rich-md-drag-menu__icon::before,
.an-rich-md-drag-menu__icon::after {
  content: "";
  position: absolute;
  box-sizing: border-box;
}

.an-rich-md-drag-menu__icon--duplicate::before,
.an-rich-md-drag-menu__icon--duplicate::after {
  width: 11px;
  height: 11px;
  border: 1.5px solid currentColor;
  border-radius: 2px;
}

.an-rich-md-drag-menu__icon--duplicate::before {
  left: 6px;
  top: 2px;
  opacity: 0.55;
}

.an-rich-md-drag-menu__icon--duplicate::after {
  left: 2px;
  top: 6px;
  background: hsl(var(--popover, 0 0% 100%));
}

.an-rich-md-drag-menu__icon--insert::before {
  left: 3px;
  top: 8px;
  width: 12px;
  height: 1.5px;
  border-radius: 999px;
  background: currentColor;
}

.an-rich-md-drag-menu__icon--insert::after {
  left: 8px;
  top: 3px;
  width: 1.5px;
  height: 12px;
  border-radius: 999px;
  background: currentColor;
}

.an-rich-md-drag-menu__icon--delete::before {
  left: 4px;
  top: 7px;
  width: 10px;
  height: 11px;
  border: 1.5px solid currentColor;
  border-top: 0;
  border-radius: 0 0 2px 2px;
}

.an-rich-md-drag-menu__icon--delete::after {
  left: 3px;
  top: 4px;
  width: 12px;
  height: 1.5px;
  border-radius: 999px;
  background: currentColor;
  box-shadow: 3px -2.5px 0 -0.4px currentColor;
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

/**
 * App-agnostic Tiptap extension providing a Notion-style left-margin drag grip
 * (the `::` handle), block selection, and drag-to-reorder over top-level block
 * nodes.
 *
 * Behavior:
 * - On hover over any top-level block, a `.drag-handle` grip appears in the left
 *   margin (forgiving hit zone extends {@link HOVER_SIDE_OUTSET_REM}rem to the
 *   sides and into the gap above/between blocks).
 * - Single-clicking the grip selects the block and opens a block action menu.
 *   Dragging past a small threshold starts a reorder, showing a floating clone
 *   preview (`.notion-drag-preview`) and a `.notion-drop-indicator` line.
 *   `Escape` cancels.
 * - While dragging, the source block carries `.notion-block--dragging` and the
 *   document element carries `.notion-editor-is-dragging` so apps can style the
 *   in-flight state. Apps own all of these CSS class names.
 * - Works for ANY top-level node ProseMirror renders as a direct child of the
 *   editor — including `group: "block"`, `draggable: true` atoms such as the
 *   plan editor's `planBlock`.
 *
 * The only app-specific coupling — the editor wrapper element the handle and
 * drop indicator are anchored to — is configurable via
 * {@link DragHandleOptions.wrapperSelector}, defaulting to
 * {@link DEFAULT_DRAG_HANDLE_WRAPPER_SELECTOR} (`.visual-editor-wrapper`) so the
 * Content editor keeps working byte-identically. The plan editor passes its own
 * wrapper selector via `DragHandle.configure({ wrapperSelector })`.
 */
export const DragHandle = Extension.create<DragHandleOptions>({
  name: "dragHandle",

  addOptions() {
    return {
      wrapperSelector: DEFAULT_DRAG_HANDLE_WRAPPER_SELECTOR,
      getDragTransferData: undefined,
      receiveDragTransferData: undefined,
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const wrapperSelector = this.options.wrapperSelector;
    const getDragTransferData = this.options.getDragTransferData;
    const receiveDragTransferData = this.options.receiveDragTransferData;
    const handleDrop = this.options.handleDrop;
    let handle: HTMLElement | null = null;
    let menu: HTMLElement | null = null;
    let menuContext: DragHandleMenuContext | null = null;
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

      // Lazily (re)attach the grip the first time a wrapper is actually
      // available. At plugin `view()` init the editor DOM may not yet be mounted
      // inside the wrapper (React mounts `EditorContent` after the EditorView is
      // constructed), so the init-time append can silently no-op and leave the
      // grip orphaned. Re-home it here once the wrapper exists.
      if (handle.parentElement !== wrapper) {
        (wrapper as HTMLElement).style.position = "relative";
        wrapper.appendChild(handle);
      }

      const wrapperRect = wrapper.getBoundingClientRect();

      handle.style.display = "flex";
      handle.style.top = `${block.rect.top - wrapperRect.top + 2}px`;
      handle.style.left = "-24px";
    };

    const selectBlockAt = (editorView: EditorView, pos: number) => {
      try {
        const sel = NodeSelection.create(editorView.state.doc, pos);
        editorView.dispatch(editorView.state.tr.setSelection(sel));
        editorView.focus();
        return sel;
      } catch {
        return null;
      }
    };

    const cleanupDragVisuals = () => {
      dragSession?.preview?.remove();
      dragSession?.dropLine?.remove();
      dragSession?.sourceBlock.classList.remove("notion-block--dragging");
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
      menu?.remove();
      menu = null;
      menuContext = null;
      handle?.setAttribute("aria-expanded", "false");
      document.removeEventListener("mousedown", handleMenuDocumentMouseDown, {
        capture: true,
      });
      document.removeEventListener("keydown", handleMenuKeyDown, {
        capture: true,
      });
      window.removeEventListener("resize", handleMenuViewportChange);
      window.removeEventListener("scroll", handleMenuViewportChange, {
        capture: true,
      });
      if (hideGrip) forceHideHandle();
    };

    const resolveMenuContext = (context: DragHandleMenuContext) => {
      const latestBlock = getTopLevelBlocks(context.view).find(
        (block) => block.node === context.sourceBlock,
      );
      const sourcePos = latestBlock?.pmPos ?? context.sourcePos;
      const sourceNode = context.view.state.doc.nodeAt(sourcePos);
      if (!sourceNode) return null;

      return {
        ...context,
        sourcePos,
        sourceNode,
        sourceNodeSize: sourceNode.nodeSize,
      };
    };

    const focusSelectionNear = (
      view: EditorView,
      tr: Transaction,
      pos: number,
      bias: -1 | 1,
    ) => {
      tr.setSelection(
        TextSelection.near(
          tr.doc.resolve(clamp(pos, 0, tr.doc.content.size)),
          bias,
        ),
      );
      view.dispatch(tr.scrollIntoView());
      view.focus();
    };

    const duplicateBlock = (context: DragHandleMenuContext) => {
      const resolved = resolveMenuContext(context);
      if (!resolved) return;

      const insertPos = resolved.sourcePos + resolved.sourceNodeSize;
      const tr = resolved.view.state.tr.insert(insertPos, resolved.sourceNode);

      try {
        tr.setSelection(NodeSelection.create(tr.doc, insertPos));
        resolved.view.dispatch(tr.scrollIntoView());
        resolved.view.focus();
      } catch {
        focusSelectionNear(resolved.view, tr, insertPos, 1);
      }
    };

    const deleteBlock = (context: DragHandleMenuContext) => {
      const resolved = resolveMenuContext(context);
      if (!resolved) return;

      const { view, sourcePos, sourceNodeSize } = resolved;
      const paragraph = view.state.schema.nodes.paragraph;
      const sourceEnd = sourcePos + sourceNodeSize;

      if (view.state.doc.childCount <= 1 && paragraph) {
        const replacement = paragraph.createAndFill() ?? paragraph.create();
        const tr = view.state.tr.replaceWith(sourcePos, sourceEnd, replacement);
        focusSelectionNear(view, tr, sourcePos + 1, 1);
        return;
      }

      const tr = view.state.tr.delete(sourcePos, sourceEnd);
      const selectionBias = sourcePos >= tr.doc.content.size ? -1 : 1;
      focusSelectionNear(view, tr, sourcePos, selectionBias);
    };

    const insertParagraphBelow = (context: DragHandleMenuContext) => {
      const resolved = resolveMenuContext(context);
      const paragraph = resolved?.view.state.schema.nodes.paragraph;
      if (!resolved || !paragraph) return;

      const insertPos = resolved.sourcePos + resolved.sourceNodeSize;
      const paragraphNode = paragraph.createAndFill() ?? paragraph.create();
      const tr = resolved.view.state.tr.insert(insertPos, paragraphNode);
      tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
      resolved.view.dispatch(tr.scrollIntoView());
      resolved.view.focus();
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
      iconModifier: string,
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
      icon.className = `an-rich-md-drag-menu__icon an-rich-md-drag-menu__icon--${iconModifier}`;
      icon.setAttribute("aria-hidden", "true");

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
      selectBlockAt(resolved.view, resolved.sourcePos);
      ensureDragHandleMenuStyles();

      const el = document.createElement("div");
      el.className = "an-rich-md-drag-menu";
      el.setAttribute("role", "menu");
      el.setAttribute("aria-label", "Block actions");
      el.setAttribute("data-plan-interactive", "true");

      el.append(
        createMenuItem("Duplicate", "duplicate", duplicateBlock),
        createMenuItem("Delete", "delete", deleteBlock, { danger: true }),
        createMenuItem("Insert block below", "insert", insertParagraphBelow),
      );

      menu = el;
      menuContext = {
        view: resolved.view,
        sourceBlock: resolved.sourceBlock,
        sourcePos: resolved.sourcePos,
        sourceNodeSize: resolved.sourceNodeSize,
      };
      document.body.appendChild(el);
      positionMenu(anchorRect);
      handle?.setAttribute("aria-expanded", "true");
      document.addEventListener("mousedown", handleMenuDocumentMouseDown, {
        capture: true,
      });
      document.addEventListener("keydown", handleMenuKeyDown, {
        capture: true,
      });
      window.addEventListener("resize", handleMenuViewportChange);
      window.addEventListener("scroll", handleMenuViewportChange, {
        capture: true,
      });

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
      const withinSideDropBand =
        clientY >= block.rect.top + block.rect.height * 0.2 &&
        clientY <= block.rect.bottom - block.rect.height * 0.2;
      const sideZoneWidth = clamp(
        block.rect.width * SIDE_DROP_ZONE_RATIO,
        SIDE_DROP_ZONE_MIN_PX,
        SIDE_DROP_ZONE_MAX_PX,
      );

      if (
        registration.handleDrop &&
        withinBlockY &&
        withinSideDropBand &&
        clientX <= block.rect.left + sideZoneWidth
      ) {
        placement = "left";
      } else if (
        registration.handleDrop &&
        withinBlockY &&
        withinSideDropBand &&
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

      session.preview.style.transform = `translate3d(${clientX + 12}px, ${clientY + 10}px, 0)`;
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
            ? // A side drop only ever builds columns; the ProseMirror seam
              // position is irrelevant. The only no-op is dropping a block on
              // ITS OWN side — adjacent *different* blocks must still form
              // columns (otherwise dropping onto an immediate neighbour's
              // facing edge silently does nothing, which reads as "side drop
              // works sometimes").
              target.targetPos === session.sourcePos
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
      if (target.placement === "left" || target.placement === "right") {
        const left =
          target.placement === "left" ? target.rect.left : target.rect.right;
        session.dropLine.style.left = `${left - wrapperRect.left}px`;
        session.dropLine.style.top = `${target.rect.top - wrapperRect.top}px`;
        session.dropLine.style.width = "3px";
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
      // The icon must not be its own hit target: a real mouse-down inside a
      // nested editor (a column) lands on the SVG, and a container block's
      // capture-phase block-select handler (RegistryBlockNode) only spares the
      // grip DIV — so a press on the icon gets swallowed and the block can't be
      // dragged out of / between columns. `pointer-events:none` makes every
      // press in the grip area resolve to the DIV instead.
      el.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="pointer-events:none">
        <circle cx="5.5" cy="3" r="1.5"/><circle cx="10.5" cy="3" r="1.5"/>
        <circle cx="5.5" cy="8" r="1.5"/><circle cx="10.5" cy="8" r="1.5"/>
        <circle cx="5.5" cy="13" r="1.5"/><circle cx="10.5" cy="13" r="1.5"/>
      </svg>`;
      return el;
    };

    const hideHandle = () => {
      if (menu) return;
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

    function handleMenuViewportChange() {
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
            ? // Side drop (column build): proceed for any block that isn't the
              // source itself, including the source's immediate neighbour.
              target.targetPos !== sourceStart
            : dropPos !== sourceStart &&
              dropPos !== sourceEnd &&
              !(dropPos > sourceStart && dropPos < sourceEnd))
        ) {
          const sourceNode = session.view.state.doc.nodeAt(sourceStart);
          if (sourceNode) {
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
              target.view.focus();
            } else if (target.view === session.view) {
              const insertPos =
                dropPos > sourceStart ? dropPos - sourceNode.nodeSize : dropPos;
              const tr = session.view.state.tr
                .delete(sourceStart, sourceEnd)
                .insert(insertPos, sourceNode);

              tr.setSelection(NodeSelection.create(tr.doc, insertPos));

              session.view.dispatch(tr.scrollIntoView());
              session.view.focus();
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
                insertTr.setSelection(
                  NodeSelection.create(insertTr.doc, dropPos),
                );
                target.view.dispatch(insertTr.scrollIntoView());

                const deleteTr = session.view.state.tr.delete(
                  sourceStart,
                  sourceEnd,
                );
                session.view.dispatch(deleteTr);
                target.view.focus();
              } catch {
                // If the target schema cannot accept this node, leave the
                // source document untouched.
              }
            }
          }
        }
      } else if (commit && !session.dragging && event) {
        openMenu(
          {
            view: session.view,
            sourceBlock: session.sourceBlock,
            sourcePos: session.sourcePos,
            sourceNodeSize: session.sourceNodeSize,
          },
          handle?.getBoundingClientRect() ??
            session.sourceBlock.getBoundingClientRect(),
        );
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
        view(editorView) {
          const registration: DragHandleRegistration = {
            view: editorView,
            wrapperSelector,
            getDragTransferData,
            receiveDragTransferData,
            handleDrop,
            canHover: () =>
              !!handle && !menu && !dragSession && editor.isEditable,
            findHoverBlock: (clientX, clientY) =>
              findForgivingBlock(editorView, clientX, clientY),
            showHoverBlock: (block) => showHandleForBlock(editorView, block),
            hideHover: () => hideHandle(),
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
            dragSession = {
              view: editorView,
              sourceBlock: currentBlock,
              sourcePos: dragStartPos,
              sourceNodeSize: sourceNode.nodeSize,
              startX: e.clientX,
              startY: e.clientY,
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

            openMenu(
              {
                view: editorView,
                sourceBlock: currentBlock,
                sourcePos: dragStartPos,
                sourceNodeSize: sourceNode.nodeSize,
              },
              handle?.getBoundingClientRect() ??
                currentBlock.getBoundingClientRect(),
            );
          });

          return {
            destroy() {
              closeMenu({ hideGrip: true });
              finishDragSession(false);
              releaseGlobalHoverListener();
              dragHandleRegistrations.delete(registration);
              if (activeDragRegistration === registration) {
                activeDragRegistration = null;
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
