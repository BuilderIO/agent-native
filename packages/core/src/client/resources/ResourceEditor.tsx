import React, { useState, useRef, useEffect, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { cn } from "../utils.js";
import type { Resource } from "./use-resources.js";

export interface ResourceEditorProps {
  resource: Resource;
  onSave: (content: string) => void;
}

const CONTROL_STYLE = { fontSize: 12, lineHeight: 1 } as const;

const VIEW_PREF_KEY = "resource-editor-view";

function getViewPref(): "visual" | "code" {
  try {
    const v = localStorage.getItem(VIEW_PREF_KEY);
    if (v === "code") return "code";
  } catch {}
  return "visual";
}

function setViewPref(v: "visual" | "code") {
  try {
    localStorage.setItem(VIEW_PREF_KEY, v);
  } catch {}
}

function VisualMarkdownEditor({
  content,
  onChange,
}: {
  content: string;
  onChange: (md: string) => void;
}) {
  const isSettingContent = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: {},
        dropcursor: { color: "hsl(var(--ring))", width: 2 },
      }),
      Placeholder.configure({
        placeholder: "Start writing...",
        showOnlyWhenEditable: true,
        showOnlyCurrent: true,
      }),
      Markdown.configure({
        html: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content,
    onUpdate: ({ editor }) => {
      if (isSettingContent.current) return;
      try {
        const md = (editor.storage as any).markdown.getMarkdown();
        onChangeRef.current(md);
      } catch (err) {
        console.error("Markdown serialization error:", err);
      }
    },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const currentMd = (editor.storage as any).markdown.getMarkdown();
    if (currentMd !== content) {
      if (editor.isFocused) return;
      isSettingContent.current = true;
      editor.commands.setContent(content);
      isSettingContent.current = false;
    }
  }, [content, editor]);

  useEffect(() => {
    return () => {
      editor?.destroy();
    };
  }, [editor]);

  if (!editor) return null;

  return <EditorContent editor={editor} />;
}

export function ResourceEditor({ resource, onSave }: ResourceEditorProps) {
  const [content, setContent] = useState(resource.content);
  const [view, setView] = useState<"visual" | "code">(getViewPref);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevIdRef = useRef(resource.id);

  // Reset content when resource changes
  useEffect(() => {
    if (prevIdRef.current !== resource.id) {
      setContent(resource.content);
      setSaveStatus("idle");
      prevIdRef.current = resource.id;
    }
  }, [resource.id, resource.content]);

  const handleChange = useCallback(
    (newContent: string) => {
      setContent(newContent);
      setSaveStatus("idle");
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setSaveStatus("saving");
        onSave(newContent);
        setTimeout(() => setSaveStatus("saved"), 300);
      }, 1000);
    },
    [onSave],
  );

  const switchView = useCallback((v: "visual" | "code") => {
    setView(v);
    setViewPref(v);
  }, []);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const isMarkdown =
    resource.mimeType === "text/markdown" || resource.path.endsWith(".md");
  const isImage = resource.mimeType.startsWith("image/");

  // Image preview
  if (isImage) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-[12px] text-muted-foreground">
            {resource.path}
          </span>
        </div>
        <div className="flex flex-1 items-center justify-center overflow-auto p-4">
          <img
            src={`/api/resources/${resource.id}`}
            alt={resource.path}
            className="max-h-full max-w-full object-contain"
          />
        </div>
      </div>
    );
  }

  // Markdown files get visual/code toggle
  if (isMarkdown) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="flex items-center gap-1">
            <button
              onClick={() => switchView("visual")}
              className={cn(
                "rounded-md px-2 py-1.5 text-[12px] leading-none",
                view === "visual"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
              style={CONTROL_STYLE}
            >
              Visual
            </button>
            <button
              onClick={() => switchView("code")}
              className={cn(
                "rounded-md px-2 py-1.5 text-[12px] leading-none",
                view === "code"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
              style={CONTROL_STYLE}
            >
              Code
            </button>
          </div>
          <span className="text-[11px] text-muted-foreground/60">
            {saveStatus === "saving"
              ? "Saving..."
              : saveStatus === "saved"
                ? "Saved"
                : ""}
          </span>
        </div>
        {view === "visual" ? (
          <div
            className={cn(
              "flex-1 min-h-0 overflow-y-auto p-3",
              "[&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-full",
              "[&_.ProseMirror_p]:my-1 [&_.ProseMirror_p]:text-[13px] [&_.ProseMirror_p]:leading-relaxed",
              "[&_.ProseMirror_h1]:text-lg [&_.ProseMirror_h1]:font-semibold [&_.ProseMirror_h1]:mt-4 [&_.ProseMirror_h1]:mb-1",
              "[&_.ProseMirror_h2]:text-base [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h2]:mt-3 [&_.ProseMirror_h2]:mb-1",
              "[&_.ProseMirror_h3]:text-sm [&_.ProseMirror_h3]:font-semibold [&_.ProseMirror_h3]:mt-2 [&_.ProseMirror_h3]:mb-1",
              "[&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-5 [&_.ProseMirror_ul]:my-1",
              "[&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-5 [&_.ProseMirror_ol]:my-1",
              "[&_.ProseMirror_li]:text-[13px]",
              "[&_.ProseMirror_code]:rounded [&_.ProseMirror_code]:bg-accent [&_.ProseMirror_code]:px-1 [&_.ProseMirror_code]:py-0.5 [&_.ProseMirror_code]:text-[12px] [&_.ProseMirror_code]:font-mono",
              "[&_.ProseMirror_pre]:rounded-md [&_.ProseMirror_pre]:bg-accent [&_.ProseMirror_pre]:p-3 [&_.ProseMirror_pre]:my-2 [&_.ProseMirror_pre]:text-[12px] [&_.ProseMirror_pre]:font-mono [&_.ProseMirror_pre]:overflow-x-auto",
              "[&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:border-border [&_.ProseMirror_blockquote]:pl-3 [&_.ProseMirror_blockquote]:my-2 [&_.ProseMirror_blockquote]:text-muted-foreground",
              "[&_.ProseMirror_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.ProseMirror_.is-editor-empty:first-child::before]:text-muted-foreground/50 [&_.ProseMirror_.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_.is-editor-empty:first-child::before]:h-0 [&_.ProseMirror_.is-editor-empty:first-child::before]:pointer-events-none",
            )}
            key={resource.id + "-visual"}
          >
            <VisualMarkdownEditor content={content} onChange={handleChange} />
          </div>
        ) : (
          <textarea
            value={content}
            onChange={(e) => handleChange(e.target.value)}
            className="flex-1 min-h-0 resize-none bg-transparent p-3 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50"
            style={{
              fontFamily:
                'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
              lineHeight: 1.6,
            }}
            spellCheck={false}
          />
        )}
      </div>
    );
  }

  // Non-markdown text files: plain textarea
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-[12px] text-muted-foreground">
          {resource.path}
        </span>
        <span className="text-[11px] text-muted-foreground/60">
          {saveStatus === "saving"
            ? "Saving..."
            : saveStatus === "saved"
              ? "Saved"
              : ""}
        </span>
      </div>
      <textarea
        value={content}
        onChange={(e) => handleChange(e.target.value)}
        className="flex-1 min-h-0 resize-none bg-transparent p-3 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50"
        style={{
          fontFamily:
            'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
          lineHeight: 1.6,
        }}
        spellCheck={false}
      />
    </div>
  );
}
