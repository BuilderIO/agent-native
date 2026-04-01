import { useEditor, EditorContent } from "@tiptap/react";
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
import { useEffect, useRef } from "react";
import { BubbleToolbar } from "./BubbleToolbar";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { LinkHoverPreview } from "./LinkHoverPreview";
import { TableHoverControls } from "./TableHoverControls";
import { ImageNode } from "./extensions/ImageNode";
import { toast } from "sonner";

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
          return "Type '/' for commands...";
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
      Markdown.configure({
        html: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content,
    editorProps: {
      attributes: {
        class: "notion-editor",
      },
    },
    onUpdate: ({ editor }) => {
      if (isSettingContent.current) return;
      try {
        const md = (editor.storage as any).markdown.getMarkdown();
        onChangeRef.current(md);
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
    const currentMd = (editor.storage as any).markdown.getMarkdown();
    if (currentMd !== content) {
      // Skip sync when editor is focused UNLESS the document changed —
      // during navigation we must force content replacement
      if (editor.isFocused && !docChanged) return;
      isSettingContent.current = true;
      editor.commands.setContent(content);
      isSettingContent.current = false;
    }
  }, [content, editor, documentId]);

  if (!editor) return null;

  return (
    <div className="visual-editor-wrapper">
      <BubbleToolbar editor={editor} />
      <SlashCommandMenu editor={editor} />
      <LinkHoverPreview editor={editor} />
      <TableHoverControls editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
