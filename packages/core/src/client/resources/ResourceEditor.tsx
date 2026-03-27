import React, { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../utils.js";
import type { Resource } from "./use-resources.js";

export interface ResourceEditorProps {
  resource: Resource;
  onSave: (content: string) => void;
}

const CONTROL_STYLE = { fontSize: 12, lineHeight: 1 } as const;

export function ResourceEditor({ resource, onSave }: ResourceEditorProps) {
  const [content, setContent] = useState(resource.content);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
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

  // Markdown files get edit/preview tabs
  if (isMarkdown) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-border px-3">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setTab("edit")}
              className={cn(
                "rounded-md px-2 py-1.5 text-[12px] leading-none",
                tab === "edit"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
              style={CONTROL_STYLE}
            >
              Edit
            </button>
            <button
              onClick={() => setTab("preview")}
              className={cn(
                "rounded-md px-2 py-1.5 text-[12px] leading-none",
                tab === "preview"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
              style={CONTROL_STYLE}
            >
              Preview
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
        {tab === "edit" ? (
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
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto p-3">
            <div className="prose prose-sm dark:prose-invert max-w-none text-[13px]">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content}
              </ReactMarkdown>
            </div>
          </div>
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
