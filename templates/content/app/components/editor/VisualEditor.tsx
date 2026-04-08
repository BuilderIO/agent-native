import { useEditor, EditorContent, Extension } from "@tiptap/react";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import type { Doc as YDoc } from "yjs";
import { Awareness } from "y-protocols/awareness";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table as BaseTable } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Markdown } from "tiptap-markdown";
import { defaultMarkdownSerializer } from "@tiptap/pm/markdown";
import {
  Plugin,
  PluginKey,
  TextSelection,
  AllSelection,
} from "@tiptap/pm/state";
import { useEffect, useRef, useMemo } from "react";
import { BubbleToolbar } from "./BubbleToolbar";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { LinkHoverPreview } from "./LinkHoverPreview";
import { TableHoverControls } from "./TableHoverControls";
import { ImageNode } from "./extensions/ImageNode";
import { notionEditorExtensions } from "./extensions/NotionExtensions";
import { DragHandle } from "./extensions/DragHandle";
import { CodeBlock } from "./extensions/CodeBlockNode";
import { toast } from "sonner";
import {
  parseNfmForEditor,
  serializeEditorToNfm,
} from "@shared/notion-markdown";

/**
 * Override the paragraph node's markdown serialization so that empty
 * paragraphs survive round-trips. Without this, prosemirror-markdown
 * silently drops empty paragraphs and they disappear from the document.
 *
 * On the parse side, the updateDOM hook strips &nbsp; from paragraphs
 * so TipTap creates truly empty paragraph nodes (no visible space).
 *
 * Directly patches the MarkdownSerializer instance's `nodes` getter
 * rather than trying to modify extension storage, which is fragile
 * across tiptap-markdown versions.
 */
const EmptyLineParagraph = Extension.create({
  name: "emptyLineParagraph",
  addStorage() {
    return {
      markdown: {
        serialize: null as any,
        parse: {
          updateDOM(element: HTMLElement) {
            for (const p of element.querySelectorAll("p")) {
              if (
                p.childNodes.length === 1 &&
                p.firstChild?.nodeType === 3 &&
                p.firstChild.textContent === "\u00A0"
              ) {
                p.innerHTML = "";
              }
            }
          },
        },
      },
    };
  },
  onCreate() {
    // Patch the serializer's nodes getter directly on the instance.
    // This is more robust than patching extension storage because
    // tiptap-markdown's getMarkdownSpec merges default and instance
    // specs in ways that can silently drop our override.
    const serializer = (this.editor.storage as any).markdown?.serializer;
    if (!serializer) return;

    const proto = Object.getPrototypeOf(serializer);
    const desc = Object.getOwnPropertyDescriptor(proto, "nodes");
    if (!desc?.get) return;

    const origGet = desc.get;

    Object.defineProperty(serializer, "nodes", {
      get() {
        const nodes = origGet.call(this);
        const origParagraph = nodes.paragraph;
        nodes.paragraph = (
          state: any,
          node: any,
          parent: any,
          index: number,
        ) => {
          if (node.childCount === 0) {
            state.write("&nbsp;");
            state.closeBlock(node);
          } else if (origParagraph) {
            origParagraph(state, node, parent, index);
          } else {
            defaultMarkdownSerializer.nodes.paragraph(
              state,
              node,
              parent,
              index,
            );
          }
        };
        return nodes;
      },
      configurable: true,
    });
  },
});

/**
 * Detects whether plain text looks like markdown by checking for common
 * markdown patterns (headings, lists, bold/italic, links, code blocks, etc.).
 * When pasting, the clipboard often has both HTML and plain text — TipTap
 * prefers the HTML, which renders markdown syntax literally. This regex-based
 * heuristic lets us intercept and parse the plain text as markdown instead.
 */
const MARKDOWN_PATTERNS = [
  /^#{1,6}\s+\S/m, // headings
  /^\s*[-*+]\s+\S/m, // unordered lists
  /^\s*\d+\.\s+\S/m, // ordered lists
  /^\s*[-*_]{3,}\s*$/m, // horizontal rules
  /^\s*>\s+\S/m, // blockquotes
  /^\s*```/m, // code fences
  /\*\*\S.*?\S\*\*/m, // bold
  /\*\S.*?\S\*/m, // italic
  /\[.+?\]\(.+?\)/m, // links
  /^\s*- \[[ x]\]\s/m, // task lists
  /\|.+\|.+\|/m, // tables
];

function looksLikeMarkdown(text: string): boolean {
  // Need at least 2 matching patterns to avoid false positives
  let matches = 0;
  for (const pattern of MARKDOWN_PATTERNS) {
    if (pattern.test(text)) {
      matches++;
      if (matches >= 2) return true;
    }
  }
  // Single heading at the start is a strong enough signal on its own
  if (matches === 1 && /^#{1,6}\s+\S/m.test(text)) return true;
  return false;
}

/**
 * ProseMirror plugin that intercepts paste events and converts markdown
 * plain text into rich editor content, similar to Notion's paste behavior.
 * When the clipboard has HTML (e.g. from a code editor), TipTap normally
 * uses that HTML — which renders markdown syntax literally. This plugin
 * detects markdown in the plain text and parses it as rich content instead.
 */
const MarkdownPasteDetection = Extension.create({
  name: "markdownPasteDetection",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("markdownPasteDetection"),
        props: {
          handlePaste(view, event) {
            const clipboardData = event.clipboardData;
            if (!clipboardData) return false;

            const html = clipboardData.getData("text/html");
            const plainText = clipboardData.getData("text/plain");

            // Only intercept when there's both HTML and plain text,
            // and the plain text looks like markdown. If there's no HTML,
            // tiptap-markdown's transformPastedText handles it already.
            if (!html || !plainText || !looksLikeMarkdown(plainText)) {
              return false;
            }

            // Check if the HTML already has rich structure (from a rich text
            // source like Google Docs) — if so, let TipTap handle it normally.
            const div = document.createElement("div");
            div.innerHTML = html;
            const hasRichStructure = div.querySelector(
              "h1, h2, h3, h4, h5, h6, ul, ol, blockquote, table",
            );
            // But allow interception if the HTML is just a code/pre wrapper
            // (from code editors or terminals)
            const isCodeWrapper =
              div.querySelector("pre, code") !== null && !hasRichStructure;

            if (hasRichStructure && !isCodeWrapper) {
              return false;
            }

            // Prevent default paste and insert markdown as content —
            // tiptap-markdown will parse it into rich nodes
            event.preventDefault();
            editor.commands.insertContent(
              (editor.storage as any).markdown.parser.parse(plainText),
            );
            return true;
          },
        },
      }),
    ];
  },
});

const ARROW_REPLACEMENTS: [string, string][] = [
  ["->", "→"],
  ["<-", "←"],
  ["=>", "⇒"],
];

const TypographyReplacements = Extension.create({
  name: "typographyReplacements",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("typographyReplacements"),
        props: {
          handleTextInput(view, from, to, text) {
            const { state } = view;
            for (const [trigger, replacement] of ARROW_REPLACEMENTS) {
              const lastChar = trigger[trigger.length - 1];
              if (text !== lastChar) continue;
              const prefix = trigger.slice(0, -1);
              const start = from - prefix.length;
              if (start < 0) continue;
              const before = state.doc.textBetween(start, from, "");
              if (before !== prefix) continue;
              view.dispatch(state.tr.insertText(replacement, start, to));
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});

/**
 * Two-stage Cmd+A: first press selects the current block,
 * second press (when block is already fully selected) selects the whole document.
 */
const SelectAllBlock = Extension.create({
  name: "selectAllBlock",
  addKeyboardShortcuts() {
    return {
      "Mod-a": ({ editor }) => {
        const { state } = editor;
        const { selection, doc } = state;

        // Find the nearest top-level block node containing the cursor
        const $from = selection.$from;
        let blockStart: number | null = null;
        let blockEnd: number | null = null;

        // Walk up to find the top-level (depth 1) block
        for (let depth = $from.depth; depth >= 1; depth--) {
          if (depth === 1) {
            blockStart = $from.before(depth);
            blockEnd = $from.after(depth);
            break;
          }
        }

        if (blockStart == null || blockEnd == null) {
          // Fallback: select all
          editor.commands.setTextSelection({ from: 0, to: doc.content.size });
          return true;
        }

        // Check if the current block is already fully selected
        const blockContentStart = blockStart + 1;
        const blockContentEnd = blockEnd - 1;
        const isBlockSelected =
          selection.from <= blockContentStart &&
          selection.to >= blockContentEnd;

        if (isBlockSelected) {
          // Second Cmd+A: select entire document
          editor.commands.setTextSelection({ from: 0, to: doc.content.size });
        } else {
          // First Cmd+A: select current block content
          editor.commands.setTextSelection({
            from: blockContentStart,
            to: blockContentEnd,
          });
        }

        return true;
      },
    };
  },
});

const CustomTable = BaseTable.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.inTable = true;
          node.forEach((row: any, _p: number, i: number) => {
            state.write("| ");
            row.forEach((col: any, _p: number, j: number) => {
              if (j) {
                state.write(" | ");
              }
              col.forEach((child: any, _offset: number, index: number) => {
                if (index > 0) state.write("<br>");

                if (child.type.name === "image") {
                  const src = child.attrs.src || "";
                  const alt = child.attrs.alt || "";
                  const title = child.attrs.title || "";
                  const escapedTitle = title
                    ? ` "${title.replace(/"/g, '\\"')}"`
                    : "";
                  state.write(
                    `![${state.esc(alt)}](${state.esc(src)}${escapedTitle})`,
                  );
                } else if (child.isTextblock) {
                  const oldWrite = state.write;
                  state.write = function (str?: string) {
                    if (str === undefined) {
                      oldWrite.call(this);
                    } else {
                      oldWrite.call(this, str.replace(/\n/g, "<br>"));
                    }
                  };
                  state.renderInline(child);
                  state.write = oldWrite;
                } else {
                  state.write(
                    state.esc(child.textContent || "").replace(/\n/g, " "),
                  );
                }
              });
            });
            state.write(" |");
            state.ensureNewLine();

            if (i === 0) {
              const delimiterRow = Array.from({ length: row.childCount })
                .map(() => "---")
                .join(" | ");
              state.write(`| ${delimiterRow} |`);
              state.ensureNewLine();
            }
          });
          state.closeBlock(node);
          state.inTable = false;
        },
        parse: {},
      },
    };
  },
});

interface VisualEditorProps {
  documentId?: string;
  content: string;
  onChange: (markdown: string) => void;
  /** Yjs document for collaborative editing. */
  ydoc?: YDoc | null;
  /** Current user info for cursor labels. */
  user?: { name: string; color: string };
  editable?: boolean;
  /** Called when user selects text and clicks "Comment" in bubble toolbar. */
  onComment?: (quotedText: string) => void;
}

export function VisualEditor({
  documentId,
  content,
  onChange,
  ydoc,
  user,
  editable = true,
  onComment,
}: VisualEditorProps) {
  const isSettingContent = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const prevDocIdRef = useRef(documentId);

  // Create Awareness instance locally (same module as CollaborationCursor uses)
  const localAwareness = useMemo(() => {
    if (!ydoc) return null;
    const a = new Awareness(ydoc);
    if (user) {
      a.setLocalStateField("user", user);
    }
    return a;
  }, [ydoc]);

  // Update user info when it changes
  useEffect(() => {
    if (localAwareness && user) {
      localAwareness.setLocalStateField("user", user);
    }
  }, [localAwareness, user?.name, user?.color]);

  // Clean up awareness on unmount
  useEffect(() => {
    return () => {
      localAwareness?.destroy();
    };
  }, [localAwareness]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false,
        horizontalRule: {},
        dropcursor: { color: "hsl(243 75% 59%)", width: 2 },
        // Disable built-in history when Collaboration is active (Yjs tracks undo)
        ...(ydoc ? { history: false } : {}),
      }),
      CodeBlock,
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === "heading") {
            const level = node.attrs.level;
            if (level === 1) return "Heading 1";
            if (level === 2) return "Heading 2";
            return "Heading 3";
          }
          return "Type /generate to generate...";
        },
        showOnlyWhenEditable: true,
        showOnlyCurrent: true,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: "notion-link" },
      }),
      TaskList.configure({
        HTMLAttributes: { class: "notion-task-list" },
      }),
      TaskItem.configure({
        nested: true,
      }),
      ImageNode.configure({
        HTMLAttributes: { class: "notion-image" },
      }),
      CustomTable.configure({
        resizable: false,
        HTMLAttributes: { class: "notion-table" },
      }),
      TableRow,
      TableHeader,
      TableCell,
      ...notionEditorExtensions,
      EmptyLineParagraph,
      DragHandle,
      TypographyReplacements,
      MarkdownPasteDetection,
      SelectAllBlock,
      Markdown.configure({
        html: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
      // Collaborative editing via Y.XmlFragment
      ...(ydoc ? [Collaboration.configure({ document: ydoc })] : []),
      // Multi-user cursor awareness (live cursor positions + names)
      ...(localAwareness
        ? [
            CollaborationCaret.configure({
              provider: { awareness: localAwareness },
              user: user ?? { name: "Anonymous", color: "#999" },
            }),
          ]
        : []),
    ],
    content: parseNfmForEditor(content),
    editorProps: {
      attributes: {
        class: "notion-editor",
      },
    },
    onUpdate: ({ editor }) => {
      if (isSettingContent.current) return;
      try {
        const md = (editor.storage as any).markdown.getMarkdown();
        const normalized = serializeEditorToNfm(md);
        // Don't save empty content when Collaboration hasn't seeded yet —
        // this prevents overwriting DB content with empty string
        if (!normalized.trim() && ydoc) return;
        onChangeRef.current(normalized);
      } catch (err: any) {
        toast.error("Markdown serialization error: " + err.message);
        console.error("Markdown serialization error:", err);
      }
    },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(editable);
  }, [editor, editable]);

  // Seed Y.XmlFragment from content prop on first load.
  // The Collaboration extension does NOT auto-seed from the content prop —
  // we must do it manually when the fragment is empty.
  const seededDocRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editor || editor.isDestroyed || !ydoc || !content) return;
    // Skip if already seeded for this document
    if (seededDocRef.current === documentId) return;
    const fragment = ydoc.getXmlFragment("default");
    if (fragment.length === 0) {
      isSettingContent.current = true;
      editor.commands.setContent(parseNfmForEditor(content));
      isSettingContent.current = false;
    }
    seededDocRef.current = documentId ?? null;
  }, [editor, ydoc, content, documentId]);

  // Sync content from outside (only when NOT using Collaboration).
  // When ydoc is bound, ySyncPlugin handles all content updates.
  useEffect(() => {
    if (!editor || editor.isDestroyed || ydoc) return;
    const docChanged = documentId !== prevDocIdRef.current;
    if (docChanged) prevDocIdRef.current = documentId;
    const nextEditorContent = parseNfmForEditor(content);
    const currentMd = serializeEditorToNfm(
      (editor.storage as any).markdown.getMarkdown(),
    );
    if (currentMd !== serializeEditorToNfm(nextEditorContent)) {
      // Skip sync when editor is focused UNLESS the document changed —
      // during navigation we must force content replacement
      if (editor.isFocused && !docChanged) return;
      isSettingContent.current = true;
      // Use addToHistory: false so cmd+z doesn't erase loaded content.
      // External content changes (load, sync) should never be undoable.
      editor
        .chain()
        .command(({ tr }) => {
          tr.setMeta("addToHistory", false);
          return true;
        })
        .setContent(nextEditorContent)
        .run();
      isSettingContent.current = false;
    }
  }, [content, editor, documentId]);

  if (!editor) return null;

  return (
    <div className="visual-editor-wrapper">
      <BubbleToolbar editor={editor} onComment={onComment} />
      <SlashCommandMenu editor={editor} documentId={documentId} />
      <LinkHoverPreview editor={editor} />
      <TableHoverControls editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
