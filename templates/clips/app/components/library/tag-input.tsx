import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";

interface TagInputProps {
  value: string[];
  suggestions?: string[];
  placeholder?: string;
  onChange: (next: string[]) => void;
  className?: string;
}

export function TagInput({
  value,
  suggestions = [],
  placeholder = "Add tag…",
  onChange,
  className,
}: TagInputProps) {
  const [draft, setDraft] = useState("");
  const [showDrop, setShowDrop] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const normalized = draft.trim();

  const filtered = useMemo(() => {
    const lower = normalized.toLowerCase();
    const used = new Set(value);
    return suggestions
      .filter((s) => !used.has(s))
      .filter((s) => !lower || s.toLowerCase().includes(lower))
      .slice(0, 8);
  }, [normalized, suggestions, value]);

  function addTag(tag: string) {
    const t = tag.trim();
    if (!t) return;
    if (value.includes(t)) {
      setDraft("");
      return;
    }
    onChange([...value, t]);
    setDraft("");
  }

  function removeTag(tag: string) {
    onChange(value.filter((t) => t !== tag));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(draft);
    } else if (e.key === "Backspace" && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <Popover open={showDrop && filtered.length > 0} onOpenChange={setShowDrop}>
      <div className={cn("relative", className)}>
        <PopoverTrigger asChild>
          <div
            role="group"
            className="flex flex-wrap items-center gap-1 min-h-[2.25rem] rounded-md border border-input bg-background px-2 py-1 focus-within:ring-1 focus-within:ring-ring"
            onClick={() => inputRef.current?.focus()}
          >
            {value.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary text-xs pl-2 pr-1 py-0.5"
              >
                {tag}
                <button
                  type="button"
                  className="rounded-full hover:bg-primary/20 p-0.5"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeTag(tag);
                  }}
                >
                  <IconX className="h-3 w-3" />
                </button>
              </span>
            ))}
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setShowDrop(true);
              }}
              onFocus={() => setShowDrop(true)}
              onBlur={() => setTimeout(() => setShowDrop(false), 100)}
              onKeyDown={handleKeyDown}
              placeholder={value.length === 0 ? placeholder : ""}
              className="flex-1 min-w-[8rem] bg-transparent text-sm outline-none"
            />
          </div>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          sideOffset={4}
          className="w-[var(--radix-popover-trigger-width)] p-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <ul>
            {filtered.map((s) => (
              <li
                key={s}
                onMouseDown={(e) => {
                  e.preventDefault();
                  addTag(s);
                }}
                className="cursor-pointer px-3 py-1.5 text-sm hover:bg-accent"
              >
                {s}
              </li>
            ))}
          </ul>
        </PopoverContent>
      </div>
    </Popover>
  );
}
