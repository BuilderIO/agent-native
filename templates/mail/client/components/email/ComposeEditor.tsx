import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import { Markdown } from "tiptap-markdown";
import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { ComposeSlashMenu } from "./ComposeSlashMenu";
import { ComposeBubbleToolbar } from "./ComposeBubbleToolbar";
import { CodeBlockLangPicker } from "./CodeBlockLangPicker";

const lowlight = createLowlight(common);

export interface ComposeEditorHandle {
  toggleBold: () => void;
  toggleItalic: () => void;
  setLink: () => void;
  isActive: (name: string) => boolean;
  getEditor: () => Editor | null;
}

interface ComposeEditorProps {
  content: string;
  onChange: (markdown: string) => void;
  onGenerate: () => void;
  onSend: () => void;
  onClose: () => void;
  onFlush: () => Promise<unknown> | undefined;
  isGenerating: boolean;
  sendToAgent: (opts: {
    message: string;
    context?: string;
    submit?: boolean;
  }) => void;
}

export const ComposeEditor = forwardRef<
  ComposeEditorHandle,
  ComposeEditorProps
>(function ComposeEditor(
  {
    content,
    onChange,
    onGenerate,
    onSend,
    onClose,
    onFlush,
    isGenerating,
    sendToAgent,
  },
  ref,
) {
  const isSettingContent = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false,
        dropcursor: { color: "hsl(220 10% 40%)", width: 2 },
      }),
      CodeBlockLowlight.configure({
        lowlight,
        HTMLAttributes: { class: "compose-code-block" },
      }),
      Image.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: { class: "compose-image" },
      }),
      Placeholder.configure({
        placeholder: "Write your message...",
        showOnlyWhenEditable: true,
        showOnlyCurrent: true,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: "compose-link" },
      }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content,
    editorProps: {
      attributes: {
        class: "compose-editor",
      },
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          onSend();
          return true;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      if (isSettingContent.current) return;
      try {
        const md = (editor.storage as any).markdown.getMarkdown();
        onChangeRef.current(md);
      } catch {
        // ignore serialization errors
      }
    },
  });

  // Sync content from outside (when agent updates compose.json)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const currentMd = (editor.storage as any).markdown.getMarkdown();
    if (currentMd !== content) {
      if (editor.isFocused) {
        return;
      }
      isSettingContent.current = true;
      editor.commands.setContent(content);
      isSettingContent.current = false;
    }
  }, [content, editor]);

  useImperativeHandle(ref, () => ({
    toggleBold: () => {
      editor?.chain().focus().toggleBold().run();
    },
    toggleItalic: () => {
      editor?.chain().focus().toggleItalic().run();
    },
    setLink: () => {
      if (!editor) return;
      if (editor.isActive("link")) {
        editor.chain().focus().unsetLink().run();
        return;
      }
      const url = window.prompt("Enter URL:");
      if (url) {
        editor
          .chain()
          .focus()
          .extendMarkRange("link")
          .setLink({ href: url })
          .run();
      }
    },
    isActive: (name: string) => editor?.isActive(name) ?? false,
    getEditor: () => editor,
  }));

  if (!editor) return null;

  return (
    <div className="compose-editor-wrapper" style={{ position: "relative" }}>
      <ComposeBubbleToolbar
        editor={editor}
        onFlush={onFlush}
        isGenerating={isGenerating}
        sendToAgent={sendToAgent}
      />
      <ComposeSlashMenu editor={editor} onGenerate={onGenerate} />
      <CodeBlockLangPicker editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
});
