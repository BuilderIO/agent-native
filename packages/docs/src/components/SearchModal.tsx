import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { createPortal } from "react-dom";
import { searchIndex, type SearchEntry } from "./searchIndex";

function highlightMatch(text: string, query: string) {
  if (!query.trim()) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + query.length + 60);
  const before = (start > 0 ? "..." : "") + text.slice(start, idx);
  const match = text.slice(idx, idx + query.length);
  const after =
    text.slice(idx + query.length, end) + (end < text.length ? "..." : "");
  return (
    <>
      <span className="text-[var(--fg-secondary)]">{before}</span>
      <mark className="rounded-sm bg-[var(--accent)]/20 px-0.5 text-[var(--accent)]">
        {match}
      </mark>
      <span className="text-[var(--fg-secondary)]">{after}</span>
    </>
  );
}

function search(query: string): SearchEntry[] {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);

  const scored = searchIndex
    .map((entry) => {
      const textLower = entry.text.toLowerCase();
      const sectionLower = entry.section.toLowerCase();
      const pageLower = entry.page.toLowerCase();

      let score = 0;
      for (const word of words) {
        if (sectionLower.includes(word)) score += 10;
        if (pageLower.includes(word)) score += 5;
        if (textLower.includes(word)) score += 3;
      }
      // exact phrase bonus
      if (textLower.includes(q)) score += 20;
      if (sectionLower.includes(q)) score += 30;

      return { entry, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  return scored.map((r) => r.entry);
}

export function useSearchModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return { open, setOpen };
}

export function SearchModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const results = search(query);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  const go = useCallback(
    (entry: SearchEntry) => {
      navigate({ to: entry.path as any, hash: entry.sectionId });
      onClose();
    },
    [navigate, onClose],
  );

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && results[activeIdx]) {
        go(results[activeIdx]);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, results, activeIdx, go, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]"
      onClick={onClose}
    >
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/40" />

      {/* modal */}
      <div
        className="relative w-full max-w-[600px] mx-4 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* search input */}
        <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--fg-secondary)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search documentation..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 border-0 bg-transparent text-base text-[var(--fg)] outline-none placeholder:text-[var(--fg-secondary)]"
          />
          <kbd className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--fg-secondary)]">
            Esc
          </kbd>
        </div>

        {/* results */}
        <div className="max-h-[400px] overflow-y-auto">
          {query.trim() === "" ? (
            <div className="px-4 py-8 text-center text-sm text-[var(--fg-secondary)]">
              Type to search across all documentation
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-[var(--fg-secondary)]">
              No results found for "{query}"
            </div>
          ) : (
            <div className="py-2">
              {results.map((entry, i) => (
                <button
                  key={`${entry.path}-${entry.sectionId}`}
                  onClick={() => go(entry)}
                  onMouseEnter={() => setActiveIdx(i)}
                  className={`flex w-full flex-col gap-1 px-4 py-3 text-left transition ${
                    i === activeIdx
                      ? "bg-[var(--accent)]/10"
                      : "hover:bg-[var(--bg-secondary)]"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={
                        i === activeIdx
                          ? "var(--accent)"
                          : "var(--fg-secondary)"
                      }
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="shrink-0"
                    >
                      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                      <polyline points="13 2 13 9 20 9" />
                    </svg>
                    <span className="text-xs text-[var(--fg-secondary)]">
                      {entry.page}
                    </span>
                    <span className="text-xs text-[var(--fg-secondary)]">
                      ›
                    </span>
                    <span
                      className={`text-sm font-medium ${i === activeIdx ? "text-[var(--accent)]" : "text-[var(--fg)]"}`}
                    >
                      {entry.section}
                    </span>
                    {i === activeIdx && (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--fg-secondary)"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="ml-auto shrink-0"
                      >
                        <polyline points="9 10 4 15 9 20" />
                        <path d="M20 4v7a4 4 0 0 1-4 4H4" />
                      </svg>
                    )}
                  </div>
                  <div className="pl-[22px] text-xs leading-relaxed">
                    {highlightMatch(entry.text, query)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* footer */}
        {results.length > 0 && (
          <div className="flex items-center gap-4 border-t border-[var(--border)] px-4 py-2 text-[10px] text-[var(--fg-secondary)]">
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-[var(--border)] px-1 py-0.5">
                ↑
              </kbd>
              <kbd className="rounded border border-[var(--border)] px-1 py-0.5">
                ↓
              </kbd>
              navigate
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-[var(--border)] px-1 py-0.5">
                ↵
              </kbd>
              open
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-[var(--border)] px-1 py-0.5">
                esc
              </kbd>
              close
            </span>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
