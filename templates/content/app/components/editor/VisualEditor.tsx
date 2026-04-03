import { useEditor, EditorContent, Extension, Node } from "@tiptap/react";
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
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { useEffect, useRef } from "react";
import { BubbleToolbar } from "./BubbleToolbar";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { LinkHoverPreview } from "./LinkHoverPreview";
import { TableHoverControls } from "./TableHoverControls";
import { ImageNode } from "./extensions/ImageNode";
import { notionEditorExtensions } from "./extensions/NotionExtensions";
import { DragHandle } from "./extensions/DragHandle";
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
 */
const EmptyLineParagraph = Node.create({
  name: "paragraph",
  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any, parent: any, index: number) {
          if (node.childCount === 0) {
            state.write("&nbsp;");
            state.closeBlock(node);
          } else {
            defaultMarkdownSerializer.nodes.paragraph(
              state,
              node,
              parent,
              index,
            );
          }
        },
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
  editable?: boolean;
}

export function VisualEditor({
  documentId,
  content,
  onChange,
  editable = true,
}: VisualEditorProps) {
  const isSettingContent = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const prevDocIdRef = useRef(documentId);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: {
          HTMLAttributes: { class: "notion-code-block" },
        },
        horizontalRule: {},
        dropcursor: { color: "hsl(243 75% 59%)", width: 2 },
      }),
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
      Markdown.configure({
        html: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
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
        onChangeRef.current(serializeEditorToNfm(md));
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

  // Sync content from outside
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
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
      editor.commands.setContent(nextEditorContent);
      isSettingContent.current = false;
    }
  }, [content, editor, documentId]);

  if (!editor) return null;

  return (
    <div className="visual-editor-wrapper">
      <BubbleToolbar editor={editor} />
      <SlashCommandMenu editor={editor} documentId={documentId} />
      <LinkHoverPreview editor={editor} />
      <TableHoverControls editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
