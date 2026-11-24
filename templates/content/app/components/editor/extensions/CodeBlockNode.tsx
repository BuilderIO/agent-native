import {
  DEFAULT_CODE_LANGUAGES,
  type CodeLanguageOption,
} from "@agent-native/toolkit/editor";
import {
  INTERACTIVE_HTML_LANGUAGE,
  isInteractiveHtmlLanguage,
} from "@shared/interactive-html-language";
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

import { InteractiveHtmlBlockView } from "./InteractiveHtmlBlockView";
import { MermaidCodeBlockView } from "./MermaidCodeBlockView";

const lowlight = createLowlight(common);
lowlight.registerAlias({ xml: [INTERACTIVE_HTML_LANGUAGE] });

const MORE_CODE_LANGUAGES: [value: string, label: string][] = [
  ["shell", "Shell"],
  ["xml", "XML"],
  ["java", "Java"],
  ["kotlin", "Kotlin"],
  ["swift", "Swift"],
  ["c", "C"],
  ["cpp", "C++"],
  ["csharp", "C#"],
  ["ruby", "Ruby"],
  ["php", "PHP"],
  ["lua", "Lua"],
  ["r", "R"],
  ["ini", "INI"],
];

export const CODE_BLOCK_LANGUAGES: CodeLanguageOption[] = [
  ...DEFAULT_CODE_LANGUAGES.map(({ value, label }): [string | null, string] => [
    value,
    label,
  ]),
  ...MORE_CODE_LANGUAGES,
].flatMap(([value, label]) =>
  value && lowlight.registered(value) ? [{ value, label }] : [],
);

export const PLAIN_TEXT_CODE_LANGUAGE = "plaintext";

const CODE_LANGUAGE_ALIASES = new Map([
  ["ts", "typescript"],
  ["js", "javascript"],
  ["py", "python"],
  ["sh", "bash"],
  ["zsh", "bash"],
  ["yml", "yaml"],
  ["md", "markdown"],
  ["rs", "rust"],
  ["golang", "go"],
  ["c++", "cpp"],
  ["cs", "csharp"],
  ["rb", "ruby"],
  ["kt", "kotlin"],
  ["text", PLAIN_TEXT_CODE_LANGUAGE],
  ["txt", PLAIN_TEXT_CODE_LANGUAGE],
]);

export function codeBlockLanguageChoice(language: unknown): string | null {
  const normalized =
    typeof language === "string" ? language.trim().toLowerCase() : "";
  if (!normalized) return null;
  return CODE_LANGUAGE_ALIASES.get(normalized) ?? normalized;
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

export function isInteractiveHtmlCodeBlock(
  node: ProseMirrorNode | null | undefined,
): boolean {
  return (
    node?.type.name === "codeBlock" &&
    isInteractiveHtmlLanguage(node.attrs.language)
  );
}

export function isDrawnCodeBlock(
  node: ProseMirrorNode | null | undefined,
): boolean {
  return isMermaidCodeBlock(node) || isInteractiveHtmlCodeBlock(node);
}

const ARROW_DIRECTIONS = new Map<string, "up" | "down" | "left" | "right">([
  ["ArrowUp", "up"],
  ["ArrowDown", "down"],
  ["ArrowLeft", "left"],
  ["ArrowRight", "right"],
]);

/**
 * A drawn Mermaid block at rest hides its source, so the browser's caret
 * would skip over it. Arrowing into one from beside it selects the block
 * instead, where Enter opens the source.
 */
function selectRestingDrawingOnArrow(
  view: EditorView,
  event: KeyboardEvent,
): boolean {
  const dir = ARROW_DIRECTIONS.get(event.key);
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
  if (!next || !isDrawnCodeBlock(next.$from.parent)) return false;
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

function isSelectedDrawing(view: EditorView): boolean {
  const { selection } = view.state;
  return selection instanceof NodeSelection && isDrawnCodeBlock(selection.node);
}

/**
 * Typing on a selected drawing would replace the whole block, source and all.
 * Like a selected block in Notion, it types nothing; Enter opens the source.
 */
function ignoreTypingOnSelectedDrawing(
  view: EditorView,
  event: KeyboardEvent,
): boolean {
  if (
    event.key.length !== 1 ||
    event.metaKey ||
    (event.ctrlKey && !event.altKey)
  )
    return false;
  return isSelectedDrawing(view);
}

const INTERACTIVE_HTML_ATTR = "data-interactive-html";

export const CodeBlock = CodeBlockLowlight.extend({
  addAttributes() {
    const parent = this.parent?.() ?? {};
    const language = new Map(Object.entries(parent)).get("language");
    return {
      ...parent,
      language: {
        ...language,
        rendered: true,
        parseHTML: (element: HTMLElement) =>
          element.hasAttribute(INTERACTIVE_HTML_ATTR)
            ? INTERACTIVE_HTML_LANGUAGE
            : language?.parseHTML?.(element),
        renderHTML: (attributes: Record<string, unknown>) =>
          isInteractiveHtmlLanguage(attributes.language)
            ? { [INTERACTIVE_HTML_ATTR]: "" }
            : {},
      },
      wrap: {
        default: false,
        parseHTML: (element) => element.getAttribute("data-wrap") === "true",
        renderHTML: (attributes) =>
          attributes.wrap ? { "data-wrap": "true" } : {},
      },
    };
  },
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      Tab: ({ editor }) => {
        if (editor.isActive("codeBlock")) {
          editor.commands.insertContent("	");
          return true;
        }
        return false;
      },
    };
  },
}).configure({
  lowlight,
  HTMLAttributes: { class: "content-code-block" },
  defaultLanguage: null,
});

function drawnBlockRenderer(
  component: Parameters<typeof ReactNodeViewRenderer>[0],
  draws: (node: ProseMirrorNode) => boolean,
): NodeViewRenderer {
  return ReactNodeViewRenderer(component, {
    update: ({ newNode, updateProps }) => {
      if (!draws(newNode)) return false;
      updateProps();
      return true;
    },
    stopEvent: ({ event }) =>
      event.target instanceof Element &&
      event.target.closest(
        "[data-mermaid-control],[data-interactive-html-control]",
      ) !== null,
  });
}

export const DrawingCodeBlock = CodeBlock.extend<
  CodeBlockLowlightOptions & { drawDiagrams: boolean }
>({
  addOptions() {
    const parent = this.parent?.();
    if (!parent) throw new Error("The code block has no options to extend.");
    return { ...parent, drawDiagrams: true };
  },

  addNodeView() {
    const diagram = drawnBlockRenderer(
      MermaidCodeBlockView,
      isMermaidCodeBlock,
    );
    const interactive = drawnBlockRenderer(
      InteractiveHtmlBlockView,
      isInteractiveHtmlCodeBlock,
    );
    // ProseMirror draws the plain code block when a factory returns nothing.
    const view: NodeViewRenderer = (props) => {
      if (isInteractiveHtmlCodeBlock(props.node)) return interactive(props);
      return this.options.drawDiagrams && isMermaidCodeBlock(props.node)
        ? diagram(props)
        : (null as never);
    };
    return view;
  },

  addKeyboardShortcuts() {
    const parentShortcuts = this.parent?.() ?? {};
    const parentEnter =
      "Enter" in parentShortcuts ? parentShortcuts["Enter"] : undefined;
    const parentTab =
      "Tab" in parentShortcuts ? parentShortcuts["Tab"] : undefined;
    return {
      ...parentShortcuts,
      // The code block's Tab types a tab, which would replace a selected
      // drawing as any other typing would.
      Tab: (props) =>
        isSelectedDrawing(props.editor.view) || (parentTab?.(props) ?? false),
      // Like a table cell, the first Escape from a Mermaid source only closes
      // it, leaving the drawing selected; the next one leaves the editor.
      Escape: ({ editor }) => {
        const { selection } = editor.state;
        if (
          !(selection instanceof TextSelection) ||
          !isDrawnCodeBlock(selection.$from.parent)
        )
          return false;
        return editor.commands.setNodeSelection(selection.$from.before());
      },
      Enter: (props) => {
        const { selection } = props.editor.state;
        if (
          selection instanceof NodeSelection &&
          isDrawnCodeBlock(selection.node)
        ) {
          return props.editor.commands.setTextSelection(selection.to - 1);
        }
        return parentEnter?.(props) ?? false;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key: new PluginKey("selectedCodeDrawing"),
        props: {
          handleKeyDown: (view, event) =>
            selectRestingDrawingOnArrow(view, event) ||
            ignoreTypingOnSelectedDrawing(view, event),
          handleTextInput: (view) => isSelectedDrawing(view),
        },
      }),
    ];
  },
});
