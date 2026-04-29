import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { IconX, IconSearch, IconLoader2 } from "@tabler/icons-react";

interface SearchResult {
  url: string;
  thumbnail: string;
  title: string;
}

interface ImageSearchPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectImage?: (url: string) => void;
}

export default function ImageSearchPanel({
  open,
  onOpenChange,
  onSelectImage,
}: ImageSearchPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [open, onOpenChange]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/image-search?q=${encodeURIComponent(query)}`,
      );
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Search failed");
        setResults([]);
      } else {
        setResults(await res.json());
      }
    } catch {
      setError("Search failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (url: string) => {
    onSelectImage?.(url);
    onOpenChange(false);
  };

  if (!open) return null;

  return createPortal(
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 9999,
      }}
      className="w-[min(24rem,calc(100vw-24px))] max-h-[480px] bg-popover border border-border rounded-xl shadow-2xl shadow-black/60 overflow-hidden flex flex-col"
    >
      <div className="px-4 pt-3 pb-2 flex items-center justify-between flex-shrink-0">
        <h3 className="text-sm font-semibold text-foreground">Search Images</h3>
        <button
          onClick={() => onOpenChange(false)}
          className="text-muted-foreground/70 hover:text-muted-foreground transition-colors"
          aria-label="Close"
        >
          <IconX className="w-4 h-4" />
        </button>
      </div>

      <div className="px-4 pb-3 flex-shrink-0">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/70" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch();
              }}
              placeholder="Search for images..."
              className="w-full pl-8 pr-3 py-1.5 bg-muted border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground/70 outline-none focus:border-[#609FF8]/50"
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={loading || !query.trim()}
            className="px-3 py-1.5 rounded-lg bg-[#609FF8] hover:bg-[#7AB2FA] disabled:opacity-50 text-black text-xs font-medium transition-colors"
          >
            {loading ? (
              <IconLoader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              "Search"
            )}
          </button>
        </div>
      </div>

      <div className="px-4 pb-4 overflow-y-auto flex-1">
        {error && (
          <div className="text-center py-4 text-red-400/70 text-xs">
            {error}
          </div>
        )}
        {!loading && results.length === 0 && !error && (
          <div className="text-center py-8 text-muted-foreground text-xs">
            Search for logos, images, icons...
          </div>
        )}
        {loading && (
          <div className="flex items-center justify-center py-8">
            <IconLoader2 className="w-4 h-4 text-muted-foreground animate-spin" />
          </div>
        )}
        {results.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {results.map((result, i) => (
              <button
                key={i}
                onClick={() => handleSelect(result.url)}
                className="aspect-square rounded-md overflow-hidden border border-border bg-muted hover:ring-2 hover:ring-[#609FF8]/50 transition-all"
                title={result.title}
              >
                <img
                  src={result.thumbnail}
                  alt={result.title}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
