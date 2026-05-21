import { Extension } from "@tiptap/react";
import { Plugin, PluginKey, NodeSelection } from "@tiptap/pm/state";
import { type EditorView } from "@tiptap/pm/view";

const dragHandleKey = new PluginKey("dragHandle");

function getTopLevelBlockAt(
  view: EditorView,
  pos: number,
): { node: HTMLElement; pmPos: number } | null {
  const resolved = view.state.doc.resolve(pos);
  let depth = resolved.depth;
  while (depth > 1) depth--;
  if (depth < 1) return null;

  const pmPos = resolved.before(depth);
  const dom = view.nodeDOM(pmPos);
  if (!dom || !(dom instanceof HTMLElement)) return null;
  return { node: dom, pmPos };
}

export const DragHandle = Extension.create({
  name: "dragHandle",

  addProseMirrorPlugins() {
    const editor = this.editor;
    let handle: HTMLElement | null = null;
    let currentBlock: HTMLElement | null = null;
    let dragStartPos: number | null = null;

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

    const getDragText = () => currentBlock?.textContent?.trim() || " ";

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

    return [
      new Plugin({
        key: dragHandleKey,
        view(editorView) {
          handle = createHandle();
          const wrapper = editorView.dom.closest(".visual-editor-wrapper");
          if (wrapper) {
            (wrapper as HTMLElement).style.position = "relative";
            wrapper.appendChild(handle);
          }

          // On mousedown, select the block node
          handle.addEventListener("mousedown", (e) => {
            e.stopPropagation();
            if (!editor.isEditable) {
              e.preventDefault();
              return;
            }

            selectCurrentBlock(editorView);
          });

          // On dragstart, set up ProseMirror's drag state
          handle.addEventListener("dragstart", (e) => {
            e.stopPropagation();
            if (!editor.isEditable) {
              e.preventDefault();
              return;
            }
            if (!e.dataTransfer) {
              e.preventDefault();
              return;
            }

            const sel = selectCurrentBlock(editorView);
            if (!sel) {
              e.preventDefault();
              return;
            }

            const slice = sel.content();
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", getDragText());
            e.dataTransfer.setData(
              "text/html",
              currentBlock?.outerHTML ?? getDragText(),
            );

            // Tell ProseMirror this is an internal move, including the source
            // node so the drop handler deletes the original block reliably.
            (editorView as any).dragging = { slice, move: true, node: sel };
          });

          handle.addEventListener("dragend", () => {
            const dragging = (editorView as any).dragging;
            window.setTimeout(() => {
              if ((editorView as any).dragging === dragging) {
                (editorView as any).dragging = null;
              }
            }, 50);
            hideHandle();
          });

          handle.addEventListener("mouseleave", () => {
            window.setTimeout(() => {
              if (
                !handle?.matches(":hover") &&
                !editorView.dom.matches(":hover")
              ) {
                hideHandle();
              }
            }, 100);
          });

          return {
            destroy() {
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
                handle.draggable = false;
                hideHandle();
                return false;
              }

              const pos = view.posAtCoords({
                left: event.clientX,
                top: event.clientY,
              });
              if (!pos) {
                hideHandle();
                return false;
              }

              const block = getTopLevelBlockAt(view, pos.pos);
              if (!block) {
                hideHandle();
                return false;
              }

              if (block.node === currentBlock) return false;
              currentBlock = block.node;
              dragStartPos = block.pmPos;

              const wrapper = view.dom.closest(".visual-editor-wrapper");
              if (!wrapper) return false;
              const wrapperRect = wrapper.getBoundingClientRect();
              const blockRect = block.node.getBoundingClientRect();

              handle.style.display = "flex";
              handle.draggable = true;
              handle.style.top = `${blockRect.top - wrapperRect.top + 2}px`;
              handle.style.left = "-24px";

              return false;
            },
            mouseleave(_view, event) {
              if (
                event.relatedTarget instanceof Node &&
                handle?.contains(event.relatedTarget)
              ) {
                return false;
              }

              setTimeout(() => {
                if (!handle?.matches(":hover")) {
                  hideHandle();
                }
              }, 100);
              return false;
            },
            drop() {
              hideHandle();
              return false;
            },
          },
        },
      }),
    ];
  },
});
