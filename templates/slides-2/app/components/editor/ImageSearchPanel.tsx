import { callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconX, IconSearch, IconLoader2 } from "@tabler/icons-react";
import { useState, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
  const t = useT();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const timeout = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(timeout);
  }, [open]);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await callAction(
        "search-images",
        { q: query.trim() },
        { method: "GET" },
      );
      setResults(data);
    } catch (error) {
      setError(error instanceof Error ? error.message : t("raw.searchFailed"));
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (url: string) => {
    onSelectImage?.(url);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="flex max-h-[min(480px,calc(100dvh-32px))] w-[min(24rem,calc(100vw-24px))] max-w-none flex-col gap-0 overflow-hidden rounded-xl p-0 shadow-2xl shadow-black/60"
      >
        <div className="px-4 pt-3 pb-2 flex items-center justify-between flex-shrink-0">
          <DialogTitle className="text-sm font-semibold leading-normal tracking-normal text-foreground">
            {t("raw.imageSearchTitle")}
          </DialogTitle>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => onOpenChange(false)}
            className="size-6 p-0 text-muted-foreground/70 transition-colors hover:text-muted-foreground active:scale-100 [&_svg]:size-4"
            aria-label={t("comments.close")}
          >
            <IconX className="size-4" />
          </Button>
        </div>

        <div className="px-4 pb-3 flex-shrink-0">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/70" />
              <Input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSearch();
                }}
                placeholder={t("raw.searchImagesPlaceholder")}
                size="sm"
                className="rounded-lg bg-muted py-1.5 pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground/70"
              />
            </div>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={handleSearch}
              disabled={loading || !query.trim()}
              className="rounded-lg px-3 text-xs"
            >
              {loading ? (
                <IconLoader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                t("raw.search")
              )}
            </Button>
          </div>
        </div>

        <div className="px-4 pb-4 overflow-y-auto flex-1">
          {error && (
            <div className="text-center py-4 text-destructive/70 text-xs">
              {error}
            </div>
          )}
          {!loading && results.length === 0 && !error && (
            <div className="text-center py-8 text-muted-foreground text-xs">
              {t("raw.searchForLogosImagesIcons")}
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
                <Tooltip key={i}>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => handleSelect(result.url)}
                      className="aspect-square h-auto w-full overflow-hidden rounded-md border border-border bg-muted p-0 transition-colors hover:ring-2 hover:ring-primary/50 active:scale-100"
                    >
                      <img
                        src={result.thumbnail}
                        alt={result.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{result.title}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
