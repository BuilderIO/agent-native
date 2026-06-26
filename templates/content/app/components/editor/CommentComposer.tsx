import {
  useEffect,
  useRef,
  useState,
  forwardRef,
  type KeyboardEvent,
} from "react";

import type { MentionMember } from "@/hooks/use-mention-members";

export interface MentionEntry {
  email: string;
  name: string;
}

/** Display label used for a member in the composer and stored mention. */
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
  rows?: number;
  className?: string;
}

/**
 * A comment text input with Notion-style `@mention` autocomplete. Typing `@`
 * opens a filtered list of organization members; selecting one inserts the
 * member's name and reports it via `onMentionAdd`. Enter submits (unless the
 * mention menu is open, where it picks the highlighted member).
 */
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
    rows = 2,
    className,
  },
  ref,
) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);

  const setRefs = (el: HTMLTextAreaElement | null) => {
    innerRef.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) (ref as { current: HTMLTextAreaElement | null }).current = el;
  };

  useEffect(() => {
    if (autoFocus) setTimeout(() => innerRef.current?.focus(), 50);
  }, [autoFocus]);

  const filtered =
    query === null
      ? []
      : members
          .filter((m) => {
            const q = query.toLowerCase();
            return (
              !q ||
              (m.name ?? "").toLowerCase().includes(q) ||
              m.email.toLowerCase().includes(q)
            );
          })
          .slice(0, 6);

  // Detect an in-progress `@query` immediately before the caret.
  const refreshQuery = (el: HTMLTextAreaElement) => {
    const caret = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, caret);
    const match = before.match(/(?:^|\s)@([^\s@]*)$/);
    setQuery(match ? match[1] : null);
    setHighlight(0);
  };

  const selectMember = (member: MentionMember) => {
    const el = innerRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const match = before.match(/(?:^|\s)@([^\s@]*)$/);
    if (!match) return;
    const label = mentionLabel(member);
    const atStart = caret - match[1].length - 1;
    const next = `${value.slice(0, atStart)}@${label} ${value.slice(caret)}`;
    onChange(next);
    onMentionAdd({ email: member.email, name: label });
    setQuery(null);
    // Restore the caret just after the inserted mention.
    const nextCaret = atStart + label.length + 2;
    requestAnimationFrame(() => {
      const node = innerRef.current;
      if (node) {
        node.focus();
        node.setSelectionRange(nextCaret, nextCaret);
      }
    });
  };

  const menuOpen = query !== null && filtered.length > 0;

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => (h + 1) % filtered.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => (h - 1 + filtered.length) % filtered.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        selectMember(filtered[highlight]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setQuery(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
      return;
    }
    if (e.key === "Escape") {
      onEscape?.();
    }
  };

  return (
    <div className="relative">
      <textarea
        ref={setRefs}
        value={value}
        rows={rows}
        onChange={(e) => {
          onChange(e.target.value);
          refreshQuery(e.target);
        }}
        onKeyUp={(e) => refreshQuery(e.currentTarget)}
        onClick={(e) => refreshQuery(e.currentTarget)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Defer so a mention click registers before the menu unmounts.
          setTimeout(() => setQuery(null), 120);
          onBlur?.();
        }}
        placeholder={placeholder}
        className={
          className ??
          "w-full resize-none bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
        }
      />
      {menuOpen && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-border bg-popover py-1 shadow-md">
          {filtered.map((member, i) => (
            <button
              key={member.email}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                selectMember(member);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] ${
                i === highlight ? "bg-accent" : "hover:bg-accent/60"
              }`}
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
      )}
    </div>
  );
});
