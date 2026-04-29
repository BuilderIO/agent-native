import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { IconSearch, IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { useRecordingSearch, type SearchHit } from "@/hooks/use-library";

function highlight(
  text: string,
  query: string,
): (string | React.JSX.Element)[] {
  if (!query) return [text];
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: (string | React.JSX.Element)[] = [];
  let i = 0;
  while (i < text.length) {
    const idx = lower.indexOf(q, i);
    if (idx === -1) {
      parts.push(text.slice(i));
      break;
    }
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(
      <mark
        key={`${idx}-${parts.length}`}
        className="bg-yellow-200 text-foreground rounded-sm px-0.5"
      >
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    i = idx + q.length;
  }
  return parts;
}

interface SearchBarProps {
  className?: string;
}

export function SearchBar({ className }: SearchBarProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data, isFetching } = useRecordingSearch(query);
  const results: SearchHit[] = data?.results ?? [];

  // Cmd+K / Ctrl+K global shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
      if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function pickResult(hit: SearchHit) {
    setOpen(false);
    setQuery("");
    navigate(`/r/${hit.id}`);
  }

  const showPopover = open && query.length >= 2;

  return (
    <Popover open={showPopover} onOpenChange={setOpen}>
      <div className={cn("relative w-full", className)}>
        <PopoverTrigger asChild>
          <div className="relative">
            <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              placeholder="Search recordings…"
              className="w-full h-8 rounded-md border border-border bg-background pl-8 pr-12 text-xs outline-none focus:ring-2 focus:ring-primary/30"
            />
            {query ? (
              <button
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent"
              >
                <IconX className="h-3 w-3" />
              </button>
            ) : (
              <span className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5 rounded border border-border bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground">
                ⌘K
              </span>
            )}
          </div>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          side="right"
          sideOffset={8}
          className="w-[420px] p-0 overflow-hidden"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {isFetching && results.length === 0 && (
            <div className="p-4 text-center text-xs text-muted-foreground">
              Searching…
            </div>
          )}
          {!isFetching && results.length === 0 && (
            <div className="p-4 text-center text-xs text-muted-foreground">
              No matches for <span className="font-medium">{query}</span>
            </div>
          )}
          {results.length > 0 && (
            <ul className="max-h-[60vh] overflow-y-auto divide-y divide-border">
              {results.map((hit) => (
                <li
                  key={hit.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => pickResult(hit)}
                  onKeyDown={(e) => e.key === "Enter" && pickResult(hit)}
                  className="flex items-start gap-3 p-3 hover:bg-accent cursor-pointer"
                >
                  <div className="h-12 w-20 flex-none rounded bg-muted overflow-hidden">
                    {hit.thumbnailUrl && (
                      // eslint-disable-next-line jsx-a11y/alt-text
                      <img
                        src={hit.thumbnailUrl}
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground truncate">
                      {highlight(hit.title, query)}
                    </div>
                    {hit.snippet && (
                      <div className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                        {highlight(hit.snippet, query)}
                      </div>
                    )}
                    <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground/80">
                      <span className="uppercase tracking-wide">
                        {hit.matchType === "transcript"
                          ? "Transcript match"
                          : hit.matchType === "title-transcript"
                            ? "Title + Transcript"
                            : "Title match"}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </PopoverContent>
      </div>
    </Popover>
  );
}
