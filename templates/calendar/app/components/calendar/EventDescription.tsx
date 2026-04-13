import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import {
  isHtml,
  linkifyText,
  sanitizeHtml,
  stripGcalInviteHtml,
} from "@/lib/sanitize-description";
import { cn } from "@/lib/utils";

const COLLAPSED_MAX_CHARS = 600;

/**
 * Render an event description as sanitized HTML with clickable links and
 * optional "Show more"/"Show less" collapse when the content is very long.
 */
export function RenderedDescription({
  description,
  onClick,
  editable = false,
  className,
}: {
  description: string;
  onClick?: () => void;
  editable?: boolean;
  className?: string;
}) {
  const descIsHtml = isHtml(description);
  const html = descIsHtml
    ? stripGcalInviteHtml(sanitizeHtml(description))
    : linkifyText(description);
  const plainText = descIsHtml ? html.replace(/<[^>]*>/g, "") : description;
  const shouldCollapse = plainText.trim().length > COLLAPSED_MAX_CHARS;

  const [expanded, setExpanded] = useState(false);
  const isCollapsed = shouldCollapse && !expanded;

  if (!plainText.trim()) return null;

  return (
    <div className="flex-1 min-w-0 space-y-1">
      <div
        onClick={onClick}
        className={cn(
          "text-sm leading-relaxed text-foreground/80 whitespace-pre-wrap break-words prose prose-sm dark:prose-invert prose-p:my-1 prose-a:text-primary prose-a:underline",
          editable && "cursor-text rounded -mx-1 px-1 hover:bg-muted/30",
          isCollapsed && "line-clamp-6",
          className,
        )}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {shouldCollapse && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {expanded ? (
            <>
              Show less <IconChevronUp className="h-3 w-3" />
            </>
          ) : (
            <>
              Show more <IconChevronDown className="h-3 w-3" />
            </>
          )}
        </button>
      )}
    </div>
  );
}

/**
 * Textarea that auto-grows to fit its content — no fixed row count, no
 * inner scrollbar. Use for the edit mode of event descriptions.
 */
export function AutoGrowTextarea({
  value,
  onChange,
  onBlur,
  onEscape,
  onSubmit,
  autoFocus,
  placeholder = "Add description",
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  onEscape?: () => void;
  onSubmit?: () => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  useEffect(() => {
    if (!autoFocus) return;
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    });
  }, [autoFocus]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onEscape?.();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      onSubmit?.();
    }
    e.stopPropagation();
  };

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      rows={1}
      className="flex-1 w-full bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground/40 focus:ring-0 resize-none overflow-hidden"
    />
  );
}
