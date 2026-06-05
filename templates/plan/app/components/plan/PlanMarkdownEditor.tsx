import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  IconBold,
  IconDeviceFloppy,
  IconH2,
  IconItalic,
  IconList,
  IconListCheck,
  IconPencil,
  IconQuote,
  IconX,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type MarkdownFormat =
  | "heading"
  | "bullet"
  | "todo"
  | "quote"
  | "bold"
  | "italic";

type PlanMarkdownEditorProps = {
  markdown: string;
  renderPreview: () => ReactNode;
  onSave: (markdown: string) => Promise<void> | void;
  editable?: boolean;
  className?: string;
};

export function PlanMarkdownEditor({
  markdown,
  renderPreview,
  onSave,
  editable = true,
  className,
}: PlanMarkdownEditorProps) {
  const textareaId = useId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(markdown);
  const [saving, setSaving] = useState(false);
  const hasChanges = draft !== markdown;

  useEffect(() => {
    if (!editing) setDraft(markdown);
  }, [editing, markdown]);

  useEffect(() => {
    if (!editing) return;
    const raf = window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(raf);
  }, [editing]);

  const closeEditor = () => {
    setDraft(markdown);
    setEditing(false);
  };

  const formatDraft = (format: MarkdownFormat) => {
    const textarea = textareaRef.current;
    const selection = textarea
      ? {
          start: textarea.selectionStart,
          end: textarea.selectionEnd,
        }
      : undefined;
    const next = applyMarkdownFormat(draft, format, selection);
    setDraft(next.markdown);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(
        next.selectionStart,
        next.selectionEnd,
      );
    });
  };

  const saveDraft = async () => {
    if (saving) return;
    if (!hasChanges) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className={cn("group/editor relative", className)}>
        <div className="plan-prose mt-4">{renderPreview()}</div>
        {editable && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute -right-2 top-0 size-8 opacity-0 transition-opacity hover:bg-plan-block/70 focus-visible:opacity-100 group-hover/editor:opacity-100"
                data-plan-interactive
                aria-label="Edit markdown block"
                onClick={() => {
                  setDraft(markdown);
                  setEditing(true);
                }}
              >
                <IconPencil className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Edit markdown</TooltipContent>
          </Tooltip>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "mt-4 rounded-lg border border-plan-line bg-plan-block/60 p-3 shadow-sm",
        className,
      )}
      data-plan-interactive
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <FormatButton
            label="Heading"
            onClick={() => formatDraft("heading")}
            icon={<IconH2 className="size-4" />}
          />
          <FormatButton
            label="Bullet list"
            onClick={() => formatDraft("bullet")}
            icon={<IconList className="size-4" />}
          />
          <FormatButton
            label="Checklist"
            onClick={() => formatDraft("todo")}
            icon={<IconListCheck className="size-4" />}
          />
          <FormatButton
            label="Quote"
            onClick={() => formatDraft("quote")}
            icon={<IconQuote className="size-4" />}
          />
          <FormatButton
            label="Bold"
            onClick={() => formatDraft("bold")}
            icon={<IconBold className="size-4" />}
          />
          <FormatButton
            label="Italic"
            onClick={() => formatDraft("italic")}
            icon={<IconItalic className="size-4" />}
          />
        </div>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Cancel markdown edits"
                onClick={closeEditor}
                disabled={saving}
              >
                <IconX className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Cancel</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                className="size-8"
                aria-label="Save markdown block"
                onClick={() => void saveDraft()}
                disabled={saving || !hasChanges}
              >
                <IconDeviceFloppy className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{saving ? "Saving" : "Save"}</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <label htmlFor={textareaId} className="sr-only">
        Markdown source
      </label>
      <Textarea
        id={textareaId}
        ref={textareaRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            void saveDraft();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            closeEditor();
          }
        }}
        className="min-h-56 resize-y rounded-md border-plan-line bg-plan-document font-mono text-sm leading-6 text-plan-text"
        spellCheck
      />
      <div className="mt-2 flex justify-end text-xs text-plan-muted">
        <span>
          {saving ? "Saving..." : hasChanges ? "Unsaved changes" : "Saved"}
        </span>
      </div>
    </div>
  );
}

function FormatButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={label}
          onClick={onClick}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function applyMarkdownFormat(
  value: string,
  format: MarkdownFormat,
  selection?: { start: number; end: number },
): { markdown: string; selectionStart: number; selectionEnd: number } {
  const start = selection?.start ?? value.length;
  const end = selection?.end ?? value.length;

  if (format === "bold") return wrapSelection(value, start, end, "**");
  if (format === "italic") return wrapSelection(value, start, end, "_");

  const prefix =
    format === "heading"
      ? "## "
      : format === "bullet"
        ? "- "
        : format === "todo"
          ? "- [ ] "
          : "> ";
  return prefixSelectedLines(value, start, end, prefix);
}

function wrapSelection(
  value: string,
  start: number,
  end: number,
  marker: string,
) {
  const selected = value.slice(start, end) || "text";
  const markdown =
    value.slice(0, start) + marker + selected + marker + value.slice(end);
  const selectionStart = start + marker.length;
  const selectionEnd = selectionStart + selected.length;
  return { markdown, selectionStart, selectionEnd };
}

function prefixSelectedLines(
  value: string,
  start: number,
  end: number,
  prefix: string,
) {
  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const lineEnd =
    end === value.length
      ? value.length
      : value.indexOf("\n", end) === -1
        ? value.length
        : value.indexOf("\n", end);
  const selected = value.slice(lineStart, lineEnd);
  const lines = selected.length > 0 ? selected.split("\n") : [""];
  const replacement = lines.map((line) => `${prefix}${line}`).join("\n");
  const markdown =
    value.slice(0, lineStart) + replacement + value.slice(lineEnd);
  return {
    markdown,
    selectionStart: start + prefix.length,
    selectionEnd: end + prefix.length * lines.length,
  };
}
