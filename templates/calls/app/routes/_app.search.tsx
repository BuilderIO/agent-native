import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { IconSearch, IconClock } from "@tabler/icons-react";
import { useActionQuery } from "@agent-native/core/client";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FilterBar,
  EMPTY_FILTER,
  type FilterState,
} from "@/components/library/filter-bar";

export function meta() {
  return [{ title: "Search · Calls" }];
}

const RECENT_KEY = "calls-recent-searches";

interface SearchResult {
  callId: string;
  title: string;
  snippet: string;
  matchStartMs?: number;
  speakerName?: string;
}

function loadRecent(): string[] {
  try {
    const raw = sessionStorage.getItem(RECENT_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr)
      ? (arr.filter((s) => typeof s === "string") as string[])
      : [];
  } catch {
    return [];
  }
}

function saveRecent(q: string) {
  if (!q.trim()) return;
  try {
    const prev = loadRecent().filter((x) => x !== q);
    const next = [q, ...prev].slice(0, 8);
    sessionStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {}
}

export default function SearchRoute() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initial = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(initial);
  const [debounced, setDebounced] = useState(initial);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTER);
  const [recent, setRecent] = useState<string[]>(() => loadRecent());
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const h = setTimeout(() => {
      setDebounced(query);
      if (query) {
        setSearchParams({ q: query }, { replace: true });
        saveRecent(query);
        setRecent(loadRecent());
      } else {
        setSearchParams({}, { replace: true });
      }
    }, 250);
    return () => clearTimeout(h);
  }, [query, setSearchParams]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (e.key === "/") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const enabled = debounced.trim().length > 0;
  const queryArgs = useMemo(
    () => ({ query: debounced, ...filters }),
    [debounced, filters],
  );
  const { data, isFetching } = useActionQuery<{ results: SearchResult[] }>(
    "search-calls",
    queryArgs,
    { enabled },
  );

  const results = data?.results ?? [];

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="px-6 py-4 border-b border-border shrink-0 space-y-3">
        <h1 className="text-2xl font-semibold">Search</h1>
        <div className="relative">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search transcripts, titles, accounts…"
            autoFocus
            className="pl-9 h-10"
          />
        </div>
        <FilterBar value={filters} onChange={setFilters} />
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        {!enabled ? (
          <RecentSearches
            recent={recent}
            onPick={(q) => {
              setQuery(q);
              inputRef.current?.focus();
            }}
          />
        ) : isFetching && results.length === 0 ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-md" />
            ))}
          </div>
        ) : results.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No matches for "{debounced}"
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-border rounded-md border border-border overflow-hidden">
            {results.map((r, i) => (
              <ResultRow
                key={`${r.callId}-${i}`}
                result={r}
                query={debounced}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ResultRow({ result, query }: { result: SearchResult; query: string }) {
  const to =
    typeof result.matchStartMs === "number"
      ? `/calls/${result.callId}?t=${Math.floor(result.matchStartMs / 1000)}`
      : `/calls/${result.callId}`;
  return (
    <Link
      to={to}
      className="flex flex-col gap-1 p-4 hover:bg-accent transition-none"
    >
      <div className="flex items-center gap-2">
        <span className="font-medium text-sm truncate">{result.title}</span>
        {result.speakerName ? (
          <span className="text-xs text-muted-foreground">
            · {result.speakerName}
          </span>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground line-clamp-2">
        <Highlight text={result.snippet} query={query} />
      </p>
      {typeof result.matchStartMs === "number" ? (
        <span className="text-xs text-[#625DF5]">
          Jump to {formatMs(result.matchStartMs)}
        </span>
      ) : null}
    </Link>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const q = query.trim();
  if (!q) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escapeRegExp(q)})`, "gi"));
  return (
    <>
      {parts.map((p, i) =>
        p.toLowerCase() === q.toLowerCase() ? (
          <mark
            key={i}
            className="bg-[#625DF5]/20 text-foreground rounded px-0.5"
          >
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatMs(ms: number) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function RecentSearches({
  recent,
  onPick,
}: {
  recent: string[];
  onPick: (q: string) => void;
}) {
  if (recent.length === 0) {
    return (
      <div className="py-12 text-center">
        <IconSearch className="mx-auto h-10 w-10 text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">
          Type to search across all your calls. Press{" "}
          <kbd className="rounded bg-muted px-1.5 py-0.5 text-xs">/</kbd> any
          time.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground px-2">
        Recent
      </div>
      <div className="flex flex-col rounded-md border border-border overflow-hidden">
        {recent.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onPick(q)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-accent transition-none"
          >
            <IconClock className="h-4 w-4 text-muted-foreground" />
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
