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
    let handle: HTMLElement | null = null;
    let currentBlock: HTMLElement | null = null;
    let dragStartPos: number | null = null;

    const createHandle = () => {
      const el = document.createElement("div");
      el.className = "drag-handle";
      el.contentEditable = "false";
      el.draggable = true;
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
            e.preventDefault();
            if (dragStartPos === null) return;
            const sel = NodeSelection.create(
              editorView.state.doc,
              dragStartPos,
            );
            editorView.dispatch(editorView.state.tr.setSelection(sel));
            editorView.focus();
          });

          // On dragstart, set up ProseMirror's drag state
          handle.addEventListener("dragstart", (e) => {
            if (dragStartPos === null || !e.dataTransfer) return;

            const sel = NodeSelection.create(
              editorView.state.doc,
              dragStartPos,
            );
            editorView.dispatch(editorView.state.tr.setSelection(sel));

            const slice = sel.content();
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", "");

            // Tell ProseMirror this is an internal drag
            (editorView as any).dragging = { slice, move: true };
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
              handle.style.top = `${blockRect.top - wrapperRect.top + 2}px`;
              handle.style.left = "-28px";

              return false;
            },
            mouseleave() {
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
