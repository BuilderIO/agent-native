import { useT } from "@agent-native/core/client/i18n";
import { IconClock, IconSearch, IconX } from "@tabler/icons-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { msToClock } from "@/components/player/scrubber";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecordingSearch, type SearchHit } from "@/hooks/use-library";
import {
  clearSearchFocusRequest,
  hasSearchFocusRequest,
} from "@/lib/search-focus";
import { cn, shortcutLabel } from "@/lib/utils";

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
        className="bg-highlight/30 text-foreground rounded-sm px-0.5"
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
  side?: "top" | "right" | "bottom" | "left";
}

function matchLabel(hit: SearchHit, t: ReturnType<typeof useT>): string {
  switch (hit.matchType) {
    case "title-transcript":
      return t("searchBar.titleTranscript");
    case "title-comment":
      return t("searchBar.titleComment");
    case "transcript":
      return t("searchBar.transcript");
    case "comment":
      return t("searchBar.comment");
    default:
      return t("searchBar.titleOrDescription");
  }
}

export function SearchBar({ className, side = "right" }: SearchBarProps) {
  const t = useT();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const routeRequestsFocus = hasSearchFocusRequest(searchParams);

  const { data, isFetching } = useRecordingSearch(debouncedQuery);
  const results: SearchHit[] = data?.results ?? [];

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query), 200);
    return () => window.clearTimeout(timeout);
  }, [query]);

  const focusSearchInput = useCallback(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!routeRequestsFocus) return;
    const frame = requestAnimationFrame(() => {
      focusSearchInput();
      setSearchParams(clearSearchFocusRequest, { replace: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusSearchInput, routeRequestsFocus, setSearchParams]);

  // "/" is the inline search shortcut. Cmd+K belongs to the app command menu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        (e.target as HTMLElement)?.tagName?.toLowerCase() !== "input" &&
        (e.target as HTMLElement)?.tagName?.toLowerCase() !== "textarea" &&
        !(e.target as HTMLElement)?.isContentEditable
      ) {
        e.preventDefault();
        focusSearchInput();
      }
      if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusSearchInput]);

  function pickResult(hit: SearchHit) {
    setOpen(false);
    setQuery("");
    const params = new URLSearchParams();
    if (typeof hit.matchMs === "number" && Number.isFinite(hit.matchMs)) {
      params.set("t", Math.max(0, Math.floor(hit.matchMs / 1000)).toString());
    }
    if (hit.matchPanel) params.set("panel", hit.matchPanel);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    void navigate(`/r/${hit.id}${suffix}`);
  }

  const showPopover = open && query.length >= 2;

  return (
    <Popover open={showPopover} onOpenChange={setOpen}>
      <div className={cn("relative w-full", className)}>
        <PopoverAnchor asChild>
          <div className="relative">
            <IconSearch className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              placeholder={t("searchBar.placeholder")}
              aria-label={t("searchBar.placeholder")}
              className="h-9 ps-9 pe-12 text-sm focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 focus-visible:ring-offset-0 [appearance:textfield] [&::-webkit-search-cancel-button]:appearance-none"
            />
            {query ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("searchBar.clear")}
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                className="absolute end-1 top-1/2 size-7 -translate-y-1/2 text-muted-foreground hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:ring-offset-0"
              >
                <IconX className="size-3.5" />
              </Button>
            ) : (
              <Kbd
                aria-hidden="true"
                className="absolute end-1.5 top-1/2 h-5 -translate-y-1/2 px-1 font-mono text-[10px]"
              >
                {shortcutLabel("/")}
              </Kbd>
            )}
          </div>
        </PopoverAnchor>

        <PopoverContent
          align="start"
          side={side}
          sideOffset={8}
          className="w-[min(420px,calc(100vw-2rem))] overflow-hidden p-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Command
            shouldFilter={false}
            aria-busy={isFetching}
            className="rounded-md bg-transparent"
          >
            {isFetching && results.length === 0 ? (
              <div
                className="space-y-1 p-1"
                aria-label={t("searchBar.searching")}
                role="status"
              >
                {Array.from({ length: 3 }, (_, index) => (
                  <div
                    key={index}
                    className="flex items-start gap-3 rounded-md px-2.5 py-2.5"
                  >
                    <Skeleton className="h-12 w-20 shrink-0 rounded-sm" />
                    <div className="min-w-0 flex-1 space-y-2 pt-0.5">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <CommandList className="max-h-[min(60vh,480px)] p-1">
              {!isFetching && results.length === 0 ? (
                <CommandEmpty className="px-3 py-6 text-center text-xs text-muted-foreground">
                  {t("searchBar.noMatchesFor")}{" "}
                  <span className="font-medium text-foreground">{query}</span>
                </CommandEmpty>
              ) : null}
              {results.map((hit) => (
                <CommandItem
                  key={hit.id}
                  value={hit.id}
                  onSelect={() => pickResult(hit)}
                  className="flex items-start gap-3 rounded-md px-2.5 py-2.5"
                >
                  <div className="h-12 w-20 shrink-0 overflow-hidden rounded-sm bg-muted">
                    {hit.thumbnailUrl ? (
                      <img
                        src={hit.thumbnailUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">
                      {highlight(hit.title, query)}
                    </div>
                    {hit.snippet ? (
                      <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {highlight(hit.snippet, query)}
                      </div>
                    ) : null}
                    <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground/80">
                      <span className="uppercase tracking-wide">
                        {matchLabel(hit, t)}
                      </span>
                      {typeof hit.matchMs === "number" ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1 tabular-nums">
                            <IconClock className="size-3" aria-hidden="true" />
                            {msToClock(hit.matchMs)}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </div>
    </Popover>
  );
}
