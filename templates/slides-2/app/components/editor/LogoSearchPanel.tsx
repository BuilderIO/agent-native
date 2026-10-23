import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconX, IconSearch, IconLoader2 } from "@tabler/icons-react";
import { useState, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface LogoResult {
  name: string;
  domain: string;
  logoUrl?: string;
}

interface LogoSearchPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectLogo?: (url: string) => void;
}

export default function LogoSearchPanel({
  open,
  onOpenChange,
  onSelectLogo,
}: LogoSearchPanelProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LogoResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [brandfetchId, setBrandfetchId] = useState<string | null>(null);
  const [logoDevToken, setLogoDevToken] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: logoConfigData } = useActionQuery("logo-config");
  useEffect(() => {
    if (logoConfigData?.brandfetchId) {
      setBrandfetchId(logoConfigData.brandfetchId);
    }
    setLogoDevToken(logoConfigData?.logoDevToken ?? null);
  }, [logoConfigData]);

  useEffect(() => {
    if (open) {
      const timeout = window.setTimeout(() => inputRef.current?.focus(), 50);
      setResults([]);
      setError(null);
      setSelectedDomain(null);
      return () => window.clearTimeout(timeout);
    }
  }, [open]);

  const handleSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    setResults([]);
    setSelectedDomain(null);
    try {
      const data = await callAction("search-logos", { q }, { method: "GET" });
      if (data.length === 0) {
        setError(t("raw.noLogosFound"));
      } else {
        setResults(data);
      }
    } catch {
      setError(t("raw.searchFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (url: string) => {
    onSelectLogo?.(url);
    onOpenChange(false);
  };

  const variations = selectedDomain
    ? buildVariations(selectedDomain, brandfetchId, logoDevToken, t)
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        onOpenAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          if (selectedDomain) {
            event.preventDefault();
            setSelectedDomain(null);
          }
        }}
        className="flex max-h-[min(560px,calc(100dvh-32px))] w-[min(460px,calc(100vw-24px))] max-w-none flex-col gap-0 overflow-hidden rounded-xl p-0 shadow-2xl shadow-black/60"
      >
        <div className="px-4 pt-3 pb-2 flex items-center justify-between flex-shrink-0">
          <DialogTitle className="text-sm font-semibold leading-normal tracking-normal text-foreground">
            {selectedDomain ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSelectedDomain(null)}
                className="h-auto justify-start gap-1.5 p-0 text-sm font-semibold hover:bg-transparent hover:text-foreground active:scale-100"
              >
                <span className="text-muted-foreground">&larr;</span>
                {selectedDomain}
              </Button>
            ) : (
              t("raw.logoSearchTitle")
            )}
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

        {!selectedDomain && (
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
                  placeholder={t("raw.searchCompanyPlaceholder")}
                  size="sm"
                  className="rounded-lg bg-muted py-1.5 pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:ring-[hsl(var(--slides-accent)/0.5)]"
                />
              </div>
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={handleSearch}
                disabled={loading || !query.trim()}
                className="rounded-lg bg-[hsl(var(--slides-accent))] px-3 text-xs text-[hsl(var(--slides-accent-foreground))] hover:bg-[hsl(var(--slides-accent-hover))]"
              >
                {loading ? (
                  <IconLoader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  t("raw.search")
                )}
              </Button>
            </div>
          </div>
        )}

        <div className="px-4 pb-4 overflow-y-auto flex-1">
          {error && (
            <div className="text-center py-4 text-destructive/70 text-xs">
              {error}
            </div>
          )}

          {/* IconSearch results */}
          {!selectedDomain && !loading && results.length === 0 && !error && (
            <div className="text-center py-6 text-muted-foreground text-xs">
              {t("raw.searchCompanyLogo")}
            </div>
          )}

          {!selectedDomain && loading && (
            <div className="flex items-center justify-center py-8">
              <IconLoader2 className="w-4 h-4 text-muted-foreground animate-spin" />
            </div>
          )}

          {!selectedDomain && results.length > 0 && (
            <div className="space-y-1.5">
              {results.map((r) => (
                <Button
                  key={r.domain}
                  type="button"
                  variant="ghost"
                  onClick={() => setSelectedDomain(r.domain)}
                  className="h-auto w-full justify-start gap-3 rounded-lg border border-border bg-muted p-2.5 text-left font-normal transition-colors hover:ring-2 hover:ring-[hsl(var(--slides-accent)/0.5)] active:scale-100"
                >
                  <LogoPreview
                    src={`https://cdn.brandfetch.io/${r.domain}/icon.png`}
                    alt={r.name}
                    className="w-10 h-10"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-foreground/90 font-medium">
                      {r.name}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {r.domain}
                    </div>
                  </div>
                  <span className="text-[10px] text-muted-foreground/70">
                    &rsaquo;
                  </span>
                </Button>
              ))}
            </div>
          )}

          {/* Logo variations grid */}
          {selectedDomain && variations.length > 0 && (
            <div className="space-y-3">
              {variations.map((group) => (
                <div key={group.label}>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 px-0.5">
                    {group.label}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {group.items.map((v) => (
                      <Button
                        key={v.label}
                        type="button"
                        variant="ghost"
                        onClick={() => handleSelect(v.url)}
                        className="h-auto w-full flex-col items-center gap-1.5 rounded-lg border border-border p-2 font-normal transition-colors hover:ring-2 hover:ring-[hsl(var(--slides-accent)/0.5)] active:scale-100"
                        style={{ backgroundColor: v.bg }}
                      >
                        <div
                          className="w-full aspect-[3/2] rounded flex items-center justify-center overflow-hidden"
                          style={{ backgroundColor: v.bg }}
                        >
                          <img
                            src={v.url}
                            alt={v.label}
                            className="max-w-[90%] max-h-[90%] object-contain"
                            loading="lazy"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.opacity =
                                "0.15";
                            }}
                          />
                        </div>
                        <span className="text-[9px] text-muted-foreground leading-tight text-center">
                          {v.label}
                        </span>
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LogoPreview({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  return (
    <div
      className={`flex-shrink-0 rounded-md bg-accent flex items-center justify-center overflow-hidden ${className}`}
    >
      <img
        src={src}
        alt={alt}
        className="w-4/5 h-4/5 object-contain"
        loading="lazy"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
    </div>
  );
}

interface LogoVariation {
  label: string;
  url: string;
  bg: string;
}

interface VariationGroup {
  label: string;
  items: LogoVariation[];
}

function buildVariations(
  domain: string,
  _brandfetchId: string | null,
  logoDevToken: string | null,
  t: ReturnType<typeof useT>,
): VariationGroup[] {
  const bf = (path: string) => `https://cdn.brandfetch.io/${domain}/${path}`;
  const groups: VariationGroup[] = [
    {
      label: "Logo",
      items: [
        { label: "Default", url: bf("logo.png"), bg: "hsl(var(--muted))" },
        { label: t("raw.onDark"), url: bf("theme/dark/logo.png"), bg: "#111" }, // guard:allow-raw-color — this is a fixed dark contrast sample for the returned logo asset.
        { label: "SVG", url: bf("logo.svg"), bg: "hsl(var(--muted))" },
      ],
    },
    {
      label: t("raw.symbolIcon"),
      items: [
        {
          label: "Symbol",
          url: bf("symbol.png"),
          bg: "hsl(var(--muted))",
        },
        {
          label: t("raw.symbolDark"),
          url: bf("theme/dark/symbol.png"),
          bg: "#111", // guard:allow-raw-color — fixed dark contrast sample for the returned logo asset.
        },
        { label: "Icon", url: bf("icon.png"), bg: "hsl(var(--muted))" },
      ],
    },
  ];
  if (logoDevToken) {
    const ld = (params: string) =>
      `https://img.logo.dev/${domain}?token=${encodeURIComponent(logoDevToken)}&${params}`;
    groups.push({
      label: "Logo.dev",
      items: [
        {
          label: "Default",
          url: ld("size=400&format=png&retina=true"),
          bg: "hsl(var(--muted))",
        },
        {
          label: t("raw.forDarkBg"),
          url: ld("size=400&format=png&retina=true&theme=light"),
          bg: "#111", // guard:allow-raw-color — fixed dark contrast sample for the returned logo asset.
        },
        {
          label: "Greyscale",
          url: ld("size=400&format=png&retina=true&greyscale=true"),
          bg: "hsl(var(--muted))",
        },
      ],
    });
  }
  return groups;
}
