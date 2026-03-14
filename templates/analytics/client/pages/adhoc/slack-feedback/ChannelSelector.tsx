import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Hash, Search, ChevronDown, X } from "lucide-react";
import type { SlackChannel } from "./hooks";

interface ChannelSelectorProps {
  channels: SlackChannel[] | undefined;
  isLoading: boolean;
  selected: Map<string, string>; // id -> name
  onChange: (selected: Map<string, string>) => void;
}

export function ChannelSelector({
  channels,
  isLoading,
  selected,
  onChange,
}: ChannelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!channels) return [];
    if (!search) return channels;
    const q = search.toLowerCase();
    return channels.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.purpose?.value?.toLowerCase().includes(q) ||
        c.topic?.value?.toLowerCase().includes(q)
    );
  }, [channels, search]);

  // Reset highlight when filtered list changes
  useEffect(() => {
    setHighlightIdx(0);
  }, [filtered.length, search]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const item = listRef.current.children[highlightIdx] as HTMLElement;
    item?.scrollIntoView({ block: "nearest" });
  }, [highlightIdx, open]);

  const toggleChannel = useCallback(
    (ch: SlackChannel) => {
      const next = new Map(selected);
      if (next.has(ch.id)) {
        next.delete(ch.id);
      } else {
        next.set(ch.id, ch.name);
      }
      onChange(next);
    },
    [selected, onChange]
  );

  const removeChannel = useCallback(
    (id: string) => {
      const next = new Map(selected);
      next.delete(id);
      onChange(next);
    },
    [selected, onChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) {
        if (e.key === "Enter" || e.key === "ArrowDown") {
          e.preventDefault();
          setOpen(true);
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHighlightIdx((i) => Math.min(i + 1, filtered.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlightIdx((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (filtered[highlightIdx]) {
            toggleChannel(filtered[highlightIdx]);
          }
          break;
        case "Escape":
          e.preventDefault();
          setOpen(false);
          setSearch("");
          break;
      }
    },
    [open, filtered, highlightIdx, toggleChannel]
  );

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-2 animate-pulse">
        <div className="h-8 w-[200px] rounded-md bg-muted" />
      </div>
    );
  }

  const totalChannels = channels?.length ?? 0;
  const selectedEntries = [...selected.entries()];

  return (
    <div className="relative" ref={containerRef} onKeyDown={handleKeyDown}>
      {/* Trigger */}
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-card text-sm text-foreground hover:bg-muted/50 transition-colors min-w-[200px] max-w-lg"
      >
        {selectedEntries.length > 0 ? (
          <span className="flex-1 text-left flex items-center gap-1.5 flex-wrap">
            {selectedEntries.map(([id, name]) => (
              <span
                key={id}
                className="inline-flex items-center gap-1 bg-muted rounded px-1.5 py-0.5 text-xs max-w-[160px]"
              >
                <Hash className="h-2.5 w-2.5 text-muted-foreground flex-shrink-0" />
                <span className="truncate">{name}</span>
                <X
                  className="h-2.5 w-2.5 text-muted-foreground hover:text-foreground cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeChannel(id);
                  }}
                />
              </span>
            ))}
          </span>
        ) : (
          <span className="flex-1 text-left text-muted-foreground text-xs">
            Select channels ({totalChannels} available)
          </span>
        )}
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[300px] max-w-lg rounded-lg border border-border bg-card shadow-xl">
          {/* Search */}
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                ref={inputRef}
                type="text"
                placeholder="Search channels..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
                className="w-full pl-8 pr-3 py-1.5 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* Channel list */}
          <div className="max-h-[300px] overflow-y-auto p-1.5" ref={listRef}>
            {filtered.length === 0 && search ? (
              <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                No channels matching &ldquo;{search}&rdquo;
              </div>
            ) : (
              filtered.map((ch, idx) => {
                const isSelected = selected.has(ch.id);
                const isHighlighted = idx === highlightIdx;
                return (
                  <button
                    key={ch.id}
                    onClick={() => toggleChannel(ch)}
                    onMouseEnter={() => setHighlightIdx(idx)}
                    className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs transition-colors ${
                      isSelected
                        ? "bg-primary text-primary-foreground"
                        : isHighlighted
                          ? "bg-muted text-foreground"
                          : "text-foreground hover:bg-muted"
                    }`}
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      <Hash className="h-3 w-3 flex-shrink-0" />
                      {ch.name}
                    </span>
                    <span
                      className={`ml-2 flex-shrink-0 text-[10px] ${
                        isSelected
                          ? "text-primary-foreground/70"
                          : "text-muted-foreground"
                      }`}
                    >
                      {ch.num_members} members
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
