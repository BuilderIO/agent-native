import {
  CodeBlockLowlight,
  type CodeBlockLowlightOptions,
} from "@tiptap/extension-code-block-lowlight";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
} from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { ReactNodeViewRenderer, type NodeViewRenderer } from "@tiptap/react";
import { common, createLowlight } from "lowlight";

import { MermaidCodeBlockView } from "./MermaidCodeBlockView";

const lowlight = createLowlight(common);

interface ContentCodeBlockOptions extends CodeBlockLowlightOptions {
  /**
   * Draw `mermaid` blocks as their diagrams. Off where document source must
   * never run, like public pages, which keep the plain code block.
   */
  drawMermaid: boolean;
}

export function isMermaidCodeBlock(
  node: ProseMirrorNode | null | undefined,
): boolean {
  return (
    node?.type.name === "codeBlock" &&
    String(node.attrs.language ?? "")
      .trim()
      .toLowerCase() === "mermaid"
  );
}

const ARROW_DIRECTIONS = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
} as const;

/**
 * A drawn Mermaid block at rest hides its source, so the browser's caret
 * would skip over it. Arrowing into one from beside it selects the block
 * instead, where Enter opens the source.
 */
function selectRestingMermaidOnArrow(
  view: EditorView,
  event: KeyboardEvent,
): boolean {
  const dir = ARROW_DIRECTIONS[event.key as keyof typeof ARROW_DIRECTIONS];
  if (!dir || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey)
    return false;
  const { doc, selection } = view.state;
  const forward = dir === "down" || dir === "right";
  let $start;
  if (selection instanceof NodeSelection) {
    $start = forward ? selection.$to : selection.$from;
  } else if (selection.empty && view.endOfTextblock(dir)) {
    const { $head } = selection;
    $start = doc.resolve(forward ? $head.after() : $head.before());
  } else {
    return false;
  }
  const next = Selection.findFrom($start, forward ? 1 : -1, true);
  if (!next || !isMermaidCodeBlock(next.$from.parent)) return false;
  const blockPos = next.$from.before();
  const blockDom = view.nodeDOM(blockPos);
  if (
    !(blockDom instanceof HTMLElement) ||
    !blockDom.querySelector("pre[hidden]")
  )
    return false;
  view.dispatch(
    view.state.tr
      .setSelection(NodeSelection.create(doc, blockPos))
      .scrollIntoView(),
  );
  return true;
}

export const CodeBlock = CodeBlockLowlight.extend<ContentCodeBlockOptions>({
  addOptions() {
    return {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      ...this.parent!(),
      drawMermaid: true,
    };
  },

  addNodeView() {
    if (!this.options.drawMermaid) return null;
    const drawn = ReactNodeViewRenderer(MermaidCodeBlockView, {
      // A block that stops being Mermaid goes back to the plain code block.
      update: ({ newNode, updateProps }) => {
        if (!isMermaidCodeBlock(newNode)) return false;
        updateProps();
        return true;
      },
      // The drawing and the header buttons are the view's own controls.
      stopEvent: ({ event }) =>
        event.target instanceof Element &&
        event.target.closest("[data-mermaid-control]") !== null,
    });
    // ProseMirror draws the plain code block when a factory returns nothing.
    const view: NodeViewRenderer = (props) =>
      isMermaidCodeBlock(props.node) ? drawn(props) : (null as never);
    return view;
  },

  addKeyboardShortcuts() {
    const parentShortcuts = this.parent?.() ?? {};
    return {
      ...parentShortcuts,
      Tab: ({ editor }) => {
        if (editor.isActive("codeBlock")) {
          editor.commands.insertContent("\t");
          return true;
        }
        return false;
      },
      // Like a table cell, the first Escape from a Mermaid source only closes
      // it, leaving the drawing selected; the next one leaves the editor.
      Escape: ({ editor }) => {
        if (!this.options.drawMermaid) return false;
        const { selection } = editor.state;
        if (
          !(selection instanceof TextSelection) ||
          !isMermaidCodeBlock(selection.$from.parent)
        )
          return false;
        return editor.commands.setNodeSelection(selection.$from.before());
      },
      Enter: (props) => {
        const { selection } = props.editor.state;
        if (
          this.options.drawMermaid &&
          selection instanceof NodeSelection &&
          isMermaidCodeBlock(selection.node)
        ) {
          return props.editor.commands.setTextSelection(selection.to - 1);
        }
        return parentShortcuts.Enter?.(props) ?? false;
      },
    };
  },

  addProseMirrorPlugins() {
    const plugins = this.parent?.() ?? [];
    if (!this.options.drawMermaid) return plugins;
    return [
      ...plugins,
      new Plugin({
        key: new PluginKey("mermaidArrowSelect"),
        props: { handleKeyDown: selectRestingMermaidOnArrow },
      }),
    ];
  },
}).configure({
  lowlight,
  HTMLAttributes: { class: "content-code-block" },
  defaultLanguage: null,
});
