import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { agentNativePath } from "@agent-native/core/client";
import { IconSearch, IconFile } from "@tabler/icons-react";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

interface SearchHit {
  path: string;
  line: number;
  preview: string;
}

interface SearchPanelProps {
  workspaceId: string;
  onOpenHit: (path: string) => void;
}

/**
 * Substring search across the workspace. Debounces on the input value
 * so a fast typist doesn't fire a fetch per keystroke. Results group
 * implicitly by file in display order — the same path can show up many
 * times, one row per line.
 */
export function SearchPanel({ workspaceId, onOpenHit }: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  // Debounce keystrokes to 200ms so /search-files doesn't fire on every input.
  // Plain setTimeout in an effect-free flow works fine here.
  function handleChange(next: string) {
    setQuery(next);
    if (typeof window === "undefined") return;
    window.clearTimeout((window as any).__codeSearchDebounce);
    (window as any).__codeSearchDebounce = window.setTimeout(() => {
      setDebounced(next);
    }, 200);
  }

  const enabled = debounced.trim().length >= 2;
  const results = useQuery<{ hits: SearchHit[]; truncated: boolean }>({
    queryKey: ["code", "search", workspaceId, debounced],
    queryFn: async () => {
      const params = new URLSearchParams({
        workspaceId,
        query: debounced,
        max: "100",
      });
      const res = await fetch(
        agentNativePath(
          `/_agent-native/actions/search-files?${params.toString()}`,
        ),
      );
      if (!res.ok) throw new Error(`search failed (${res.status})`);
      const body = await res.json();
      return {
        hits: Array.isArray(body.hits) ? body.hits : [],
        truncated: Boolean(body.truncated),
      };
    },
    enabled,
    staleTime: 30_000,
  });

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Search
      </div>
      <div className="border-b border-border px-2 py-2">
        <div className="relative">
          <IconSearch
            size={12}
            aria-hidden
            className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="Substring search…"
            className="h-7 pl-7 text-xs"
            autoFocus
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1 py-1">
        {!enabled ? (
          <div className="px-2 py-3 text-xs text-muted-foreground">
            Type at least 2 characters.
          </div>
        ) : results.isPending ? (
          <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
            <Spinner className="size-3" /> Searching…
          </div>
        ) : results.isError ? (
          <div className="px-2 py-2 text-xs text-destructive">
            Search failed.
          </div>
        ) : (results.data?.hits.length ?? 0) === 0 ? (
          <div className="px-2 py-2 text-xs text-muted-foreground">
            No matches.
          </div>
        ) : (
          <>
            <ul className="space-y-0.5">
              {results.data!.hits.map((hit, i) => (
                <li key={`${hit.path}:${hit.line}:${i}`}>
                  <button
                    type="button"
                    onClick={() => onOpenHit(hit.path)}
                    className="flex w-full cursor-pointer flex-col items-start gap-0.5 rounded px-2 py-1 text-left hover:bg-accent/50"
                  >
                    <span className="flex w-full items-center gap-1 text-xs">
                      <IconFile
                        size={11}
                        className="shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate font-mono">
                        {hit.path}
                      </span>
                      <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
                        :{hit.line}
                      </span>
                    </span>
                    <span className="line-clamp-1 w-full break-all pl-4 font-mono text-[10px] text-muted-foreground">
                      {hit.preview}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {results.data!.truncated ? (
              <div className="px-2 py-2 text-[10px] text-muted-foreground">
                Showing first 100 hits.
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
