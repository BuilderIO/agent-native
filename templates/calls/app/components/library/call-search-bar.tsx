import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { IconSearch, IconX, IconHistory } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

const RECENT_KEY = "calls:recent-searches";
const MAX_RECENT = 6;

function loadRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function saveRecent(list: string[]) {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

interface CallSearchBarProps {
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
}

export function CallSearchBar({
  className,
  placeholder = "Search calls, transcripts, trackers…",
  autoFocus,
}: CallSearchBarProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRecent(loadRecent());
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        inputRef.current?.focus();
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

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function submit(value: string) {
    const q = value.trim();
    if (!q) return;
    const next = [q, ...recent.filter((r) => r !== q)].slice(0, MAX_RECENT);
    setRecent(next);
    saveRecent(next);
    setOpen(false);
    navigate(`/search?q=${encodeURIComponent(q)}`);
  }

  function clearRecent() {
    setRecent([]);
    saveRecent([]);
  }

  return (
    <div ref={boxRef} className={cn("relative w-full max-w-xl", className)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(query);
        }}
      >
        <div className="relative">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            autoFocus={autoFocus}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder={placeholder}
            className="w-full h-9 rounded-md border border-border bg-background pl-9 pr-16 text-sm outline-none focus:ring-2 focus:ring-ring/30"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent"
              aria-label="Clear search"
            >
              <IconX className="h-3.5 w-3.5" />
            </button>
          ) : (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              /
            </span>
          )}
        </div>
      </form>

      {open && (query.length === 0 ? recent.length > 0 : true) && (
        <div className="absolute z-40 mt-1 w-full rounded-md border border-border bg-popover shadow-lg overflow-hidden">
          {query.length === 0 && recent.length > 0 && (
            <div>
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Recent searches
                </span>
                <button
                  type="button"
                  onClick={clearRecent}
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              </div>
              <ul className="max-h-[50vh] overflow-y-auto py-1">
                {recent.map((r) => (
                  <li key={r}>
                    <button
                      type="button"
                      onClick={() => submit(r)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-accent"
                    >
                      <IconHistory className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="truncate">{r}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {query.length > 0 && (
            <button
              type="button"
              onClick={() => submit(query)}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
            >
              <IconSearch className="h-3.5 w-3.5 text-muted-foreground" />
              <span>
                Search for <span className="font-medium">{query}</span>
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
