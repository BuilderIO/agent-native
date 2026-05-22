import { Extension } from "@tiptap/react";
import { Plugin, PluginKey, NodeSelection } from "@tiptap/pm/state";
import { type EditorView } from "@tiptap/pm/view";

const dragHandleKey = new PluginKey("dragHandle");
const HOVER_SIDE_OUTSET_REM = 8;

type DropTarget = {
  block: HTMLElement;
  before: boolean;
  pos: number;
  rect: DOMRect;
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
  dropPos: number | null;
};

type HoverBlock = {
  node: HTMLElement;
  pmPos: number;
  rect: DOMRect;
};

export const DragHandle = Extension.create({
  name: "dragHandle",

  addProseMirrorPlugins() {
    const editor = this.editor;
    let handle: HTMLElement | null = null;
    let currentBlock: HTMLElement | null = null;
    let dragStartPos: number | null = null;
    let dragSession: DragSession | null = null;

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

      const wrapper = editorView.dom.closest(".visual-editor-wrapper");
      if (!wrapper) return;

      const wrapperRect = wrapper.getBoundingClientRect();

      handle.style.display = "flex";
      handle.style.top = `${block.rect.top - wrapperRect.top + 2}px`;
      handle.style.left = "-24px";
    };

    const selectCurrentBlock = (editorView: EditorView) => {
      if (dragStartPos === null) return null;

      try {
        const sel = NodeSelection.create(editorView.state.doc, dragStartPos);
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

    const createDropLine = (view: EditorView): HTMLElement | null => {
      const wrapper = view.dom.closest(".visual-editor-wrapper");
      if (!wrapper) return null;

      const line = document.createElement("div");
      line.className = "notion-drop-indicator";
      wrapper.appendChild(line);
      return line;
    };

    const findDropTarget = (
      view: EditorView,
      clientX: number,
      clientY: number,
    ): DropTarget | null => {
      const block = findForgivingBlock(view, clientX, clientY);
      if (!block) return null;

      const node = view.state.doc.nodeAt(block.pmPos);
      if (!node) return null;

      const dropBefore =
        clientY < block.rect.top ||
        (clientY <= block.rect.bottom &&
          clientY < block.rect.top + block.rect.height / 2);

      return {
        block: block.node,
        before: dropBefore,
        pos: dropBefore ? block.pmPos : block.pmPos + node.nodeSize,
        rect: block.rect,
      };
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
      if (
        !target ||
        target.pos === session.sourcePos ||
        target.pos === sourceEnd ||
        (target.pos > session.sourcePos && target.pos < sourceEnd)
      ) {
        session.dropPos = null;
        session.dropLine?.remove();
        session.dropLine = null;
        return;
      }

      if (!session.dropLine) session.dropLine = createDropLine(session.view);
      if (!session.dropLine) return;

      const wrapper = session.view.dom.closest(".visual-editor-wrapper");
      if (!wrapper) return;

      const wrapperRect = wrapper.getBoundingClientRect();
      const editorRect = session.view.dom.getBoundingClientRect();
      const top = target.before ? target.rect.top : target.rect.bottom;

      session.dropPos = target.pos;
      session.dropLine.style.left = `${editorRect.left - wrapperRect.left}px`;
      session.dropLine.style.top = `${top - wrapperRect.top}px`;
      session.dropLine.style.width = `${editorRect.width}px`;
    };

    const createHandle = () => {
      const el = document.createElement("div");
      el.className = "drag-handle";
      el.contentEditable = "false";
      el.draggable = false;
      el.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        <circle cx="5.5" cy="3" r="1.5"/><circle cx="10.5" cy="3" r="1.5"/>
        <circle cx="5.5" cy="8" r="1.5"/><circle cx="10.5" cy="8" r="1.5"/>
        <circle cx="5.5" cy="13" r="1.5"/><circle cx="10.5" cy="13" r="1.5"/>
      </svg>`;
      return el;
    };

    const hideHandle = () => {
      if (handle) handle.style.display = "none";
      currentBlock = null;
    };

    const removeDragListeners = () => {
      document.removeEventListener("mousemove", handleDocumentMouseMove);
      document.removeEventListener("mouseup", handleDocumentMouseUp);
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };

    const createDocumentHoverMove = (editorView: EditorView) => {
      return (event: MouseEvent) => {
        if (!handle || dragSession) return;
        if (!editor.isEditable) {
          hideHandle();
          return;
        }

        const block = findForgivingBlock(
          editorView,
          event.clientX,
          event.clientY,
        );

        if (!block) {
          hideHandle();
          return;
        }

        showHandleForBlock(editorView, block);
      };
    };

    const finishDragSession = (commit: boolean) => {
      const session = dragSession;
      if (!session) return;

      removeDragListeners();

      if (commit && session.dragging && session.dropPos !== null) {
        const sourceStart = session.sourcePos;
        const sourceEnd = session.sourcePos + session.sourceNodeSize;
        const dropPos = session.dropPos;

        if (
          dropPos !== sourceStart &&
          dropPos !== sourceEnd &&
          !(dropPos > sourceStart && dropPos < sourceEnd)
        ) {
          const sourceNode = session.view.state.doc.nodeAt(sourceStart);
          if (sourceNode) {
            const insertPos =
              dropPos > sourceStart ? dropPos - sourceNode.nodeSize : dropPos;
            const tr = session.view.state.tr
              .delete(sourceStart, sourceEnd)
              .insert(insertPos, sourceNode);

            tr.setSelection(NodeSelection.create(tr.doc, insertPos));

            session.view.dispatch(tr.scrollIntoView());
            session.view.focus();
          }
        }
      } else if (!session.dragging) {
        selectCurrentBlock(session.view);
      }

      cleanupDragVisuals();
      dragSession = null;
      hideHandle();
    };

    const beginDragSession = (session: DragSession, event: MouseEvent) => {
      session.dragging = true;
      session.preview = createDragPreview(session.sourceBlock);
      session.sourceBlock.classList.add("notion-block--dragging");
      document.documentElement.classList.add("notion-editor-is-dragging");
      positionDragPreview(session, event.clientX, event.clientY);
      updateDropLine(
        session,
        findDropTarget(session.view, event.clientX, event.clientY),
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
        findDropTarget(dragSession.view, event.clientX, event.clientY),
      );
    }

    function handleDocumentMouseUp(event: MouseEvent) {
      event.preventDefault();
      finishDragSession(true);
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
          handle = createHandle();
          const handleDocumentHoverMove = createDocumentHoverMove(editorView);
          const wrapper = editorView.dom.closest(".visual-editor-wrapper");
          if (wrapper) {
            (wrapper as HTMLElement).style.position = "relative";
            wrapper.appendChild(handle);
          }

          document.addEventListener("mousemove", handleDocumentHoverMove);

          handle.addEventListener("mousedown", (e) => {
            e.stopPropagation();
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
              dropPos: null,
            };

            document.addEventListener("mousemove", handleDocumentMouseMove);
            document.addEventListener("mouseup", handleDocumentMouseUp);
            document.addEventListener("keydown", handleDocumentKeyDown);
          });

          return {
            destroy() {
              document.removeEventListener(
                "mousemove",
                handleDocumentHoverMove,
              );
              finishDragSession(false);
              handle?.remove();
              handle = null;
            },
          };
        },
        props: {
          handleDOMEvents: {
            mousemove(view, event) {
              if (!handle) return false;
              if (!editor.isEditable) {
                hideHandle();
                return false;
              }
              if (dragSession) return false;

              const block = findForgivingBlock(
                view,
                event.clientX,
                event.clientY,
              );
              if (!block) {
                hideHandle();
                return false;
              }

              if (block.node === currentBlock) return false;
              showHandleForBlock(view, block);

              return false;
            },
            drop() {
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
