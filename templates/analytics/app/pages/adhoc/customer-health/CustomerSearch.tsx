import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Search, Loader2 } from "lucide-react";
import { useMetricsQuery } from "@/lib/query-metrics";
import { searchCompaniesQuery } from "./queries";

interface CustomerSearchProps {
  onSelect: (companyName: string) => void;
  selectedCompany: string | null;
}

export function CustomerSearch({
  onSelect,
  selectedCompany,
}: CustomerSearchProps) {
  const [input, setInput] = useState(selectedCompany ?? "");
  const [debouncedInput, setDebouncedInput] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const hasSelected = useRef(!!selectedCompany);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedInput(input.trim()), 300);
    return () => clearTimeout(timer);
  }, [input]);

  const sql = useMemo(
    () =>
      debouncedInput.length >= 2 ? searchCompaniesQuery(debouncedInput) : "",
    [debouncedInput],
  );

  const { data, isLoading } = useMetricsQuery(
    ["customer-search", debouncedInput],
    sql,
    { enabled: sql.length > 0 },
  );

  const results = data?.rows ?? [];

  // Reset highlight to first item when results change
  useEffect(() => {
    setHighlightIndex(0);
  }, [results]);

  useEffect(() => {
    if (
      results.length > 0 &&
      debouncedInput.length >= 2 &&
      !hasSelected.current
    )
      setOpen(true);
  }, [results, debouncedInput]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = useCallback(
    (company: string) => {
      hasSelected.current = true;
      setOpen(false);
      setInput(company);
      setDebouncedInput("");
      onSelect(company);
    },
    [onSelect],
  );

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-item]");
    items[highlightIndex]?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex, open]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open || results.length === 0) {
      // If dropdown is closed but we have results, open on arrow down
      if (e.key === "ArrowDown" && results.length > 0) {
        e.preventDefault();
        setOpen(true);
        setHighlightIndex(0);
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightIndex((prev) => (prev + 1) % results.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightIndex(
          (prev) => (prev - 1 + results.length) % results.length,
        );
        break;
      case "Enter":
        e.preventDefault();
        if (results[highlightIndex]) {
          handleSelect(String(results[highlightIndex].company));
        }
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        break;
    }
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-lg">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by company name..."
          value={input}
          onChange={(e) => {
            hasSelected.current = false;
            setInput(e.target.value);
            if (selectedCompany) onSelect("");
          }}
          onFocus={() => {
            if (results.length > 0 && debouncedInput.length >= 2) setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          className="w-full rounded-lg border border-border bg-background pl-10 pr-10 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        {isLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
          </div>
        )}
      </div>

      {open && results.length > 0 && (
        <div
          ref={listRef}
          className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-popover shadow-lg max-h-64 overflow-y-auto"
        >
          {results.map((row, i) => {
            const company = String(row.company);
            const count = Number(row.user_count);
            return (
              <button
                key={company}
                data-item
                onClick={() => handleSelect(company)}
                onMouseEnter={() => setHighlightIndex(i)}
                className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between ${
                  i === highlightIndex ? "bg-accent" : "hover:bg-accent"
                }`}
              >
                <span className="truncate">{company}</span>
                <span className="text-xs text-muted-foreground ml-2 shrink-0">
                  {count} user{count !== 1 ? "s" : ""}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {open &&
        debouncedInput.length >= 2 &&
        !isLoading &&
        results.length === 0 && (
          <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-popover shadow-lg px-4 py-3">
            <p className="text-sm text-muted-foreground">No companies found</p>
          </div>
        )}
    </div>
  );
}
