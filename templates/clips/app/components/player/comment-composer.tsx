import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import type { CommentMention } from "../../../shared/comment-mentions";
import type { MentionMember } from "../../hooks/use-mention-members";

export type MentionEntry = CommentMention;

export function mentionLabel(member: MentionMember): string {
  return member.name?.trim() || member.email.split("@")[0];
}

interface CommentComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onMentionAdd: (entry: MentionEntry) => void;
  onEscape?: () => void;
  onBlur?: () => void;
  members: MentionMember[];
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  rows?: number;
  className?: string;
  submitOnEnter?: boolean;
  "aria-label"?: string;
}

export const CommentComposer = forwardRef<
  HTMLTextAreaElement,
  CommentComposerProps
>(function CommentComposer(
  {
    value,
    onChange,
    onSubmit,
    onMentionAdd,
    onEscape,
    onBlur,
    members,
    placeholder,
    autoFocus,
    disabled = false,
    rows = 2,
    className,
    submitOnEnter = false,
    "aria-label": ariaLabel,
  },
  ref,
) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);

  const setRefs = (element: HTMLTextAreaElement | null) => {
    innerRef.current = element;
    if (typeof ref === "function") ref(element);
    else if (ref) {
      (ref as { current: HTMLTextAreaElement | null }).current = element;
    }
  };

  useEffect(() => {
    if (autoFocus) innerRef.current?.focus();
  }, [autoFocus]);

  useLayoutEffect(() => {
    const element = innerRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [rows, value]);

  const filtered =
    query === null
      ? []
      : members
          .filter((member) => {
            const q = query.toLowerCase();
            return (
              !q ||
              (member.name ?? "").toLowerCase().includes(q) ||
              member.email.toLowerCase().includes(q)
            );
          })
          .slice(0, 6);

  const refreshQuery = (element: HTMLTextAreaElement) => {
    const caret = element.selectionStart ?? element.value.length;
    const match = element.value.slice(0, caret).match(/(?:^|\s)@([^\s@]*)$/);
    setQuery(match ? match[1] : null);
    setHighlight(0);
  };

  const selectMember = (member: MentionMember) => {
    const element = innerRef.current;
    if (!element) return;
    const caret = element.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const match = before.match(/(?:^|\s)@([^\s@]*)$/);
    if (!match) return;
    const label = mentionLabel(member);
    const atStart = caret - match[1].length - 1;
    const next = `${value.slice(0, atStart)}@${label} ${value.slice(caret)}`;
    onChange(next);
    onMentionAdd({ email: member.email, name: label });
    setQuery(null);
    requestAnimationFrame(() => {
      const current = innerRef.current;
      if (!current) return;
      current.focus();
      const nextCaret = atStart + label.length + 2;
      current.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const applyMarkdownShortcut = (
    event: KeyboardEvent<HTMLTextAreaElement>,
  ): boolean => {
    if (
      event.nativeEvent.isComposing ||
      (!event.metaKey && !event.ctrlKey) ||
      event.altKey
    ) {
      return false;
    }

    const key = event.key.toLowerCase();
    const marker =
      key === "b"
        ? "**"
        : key === "i"
          ? "*"
          : key === "`"
            ? "`"
            : key === "x" && event.shiftKey
              ? "~~"
              : null;
    if (!marker) return false;

    const element = innerRef.current;
    if (!element) return false;
    event.preventDefault();
    const start = element.selectionStart ?? value.length;
    const end = element.selectionEnd ?? start;
    const selected = value.slice(start, end);
    const before = value.slice(0, start);
    const after = value.slice(end);
    const wrapped = before.endsWith(marker) && after.startsWith(marker);
    const nextValue = wrapped
      ? `${before.slice(0, -marker.length)}${selected}${after.slice(marker.length)}`
      : `${before}${marker}${selected}${marker}${after}`;
    const nextStart = wrapped ? start - marker.length : start + marker.length;
    const nextEnd = wrapped ? end - marker.length : nextStart + selected.length;
    onChange(nextValue);
    requestAnimationFrame(() => {
      const current = innerRef.current;
      if (!current) return;
      current.focus();
      current.setSelectionRange(nextStart, nextEnd);
    });
    return true;
  };

  const menuOpen = query !== null && filtered.length > 0;

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlight((current) => (current + 1) % filtered.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlight(
          (current) => (current - 1 + filtered.length) % filtered.length,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        selectMember(filtered[highlight]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setQuery(null);
        return;
      }
    }

    if (applyMarkdownShortcut(event)) return;

    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      (submitOnEnter || event.metaKey || event.ctrlKey)
    ) {
      event.preventDefault();
      onSubmit();
      return;
    }
    if (event.key === "Escape") onEscape?.();
  };

  return (
    <Popover
      open={menuOpen}
      onOpenChange={(open) => {
        if (!open) setQuery(null);
      }}
    >
      <PopoverAnchor asChild>
        <div className="relative min-w-0 flex-1">
          <Textarea
            ref={setRefs}
            value={value}
            disabled={disabled}
            rows={rows}
            aria-label={ariaLabel}
            onChange={(event) => {
              onChange(event.target.value);
              refreshQuery(event.target);
            }}
            onKeyUp={(event) => refreshQuery(event.currentTarget)}
            onClick={(event) => refreshQuery(event.currentTarget)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              setTimeout(() => setQuery(null), 120);
              onBlur?.();
            }}
            placeholder={placeholder}
            className={cn(
              "w-full resize-none overflow-y-hidden bg-transparent placeholder:text-muted-foreground focus:outline-none",
              className,
            )}
          />
        </div>
      </PopoverAnchor>
      {!disabled && menuOpen ? (
        <PopoverContent
          side="bottom"
          align="start"
          portalled={false}
          className="w-80 max-w-[calc(100vw-2rem)] p-1"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div role="listbox">
            {filtered.map((member, index) => (
              <button
                key={member.email}
                type="button"
                role="option"
                aria-selected={index === highlight}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => selectMember(member)}
                onMouseEnter={() => setHighlight(index)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-[13px]",
                  index === highlight ? "bg-accent" : "hover:bg-accent/60",
                )}
              >
                <span className="font-medium text-foreground">
                  {mentionLabel(member)}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {member.email}
                </span>
              </button>
            ))}
          </div>
        </PopoverContent>
      ) : null}
    </Popover>
  );
});
