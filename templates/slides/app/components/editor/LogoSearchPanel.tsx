import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { IconX, IconSearch, IconLoader2 } from "@tabler/icons-react";
import { useActionQuery } from "@agent-native/core/client";

const LOGO_DEV_PK = "pk_VwOyCAOgT0aBNpecT2qO-A";

interface LogoResult {
  name: string;
  domain: string;
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
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LogoResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [brandfetchId, setBrandfetchId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch Brandfetch client ID from server config
  const { data: logoConfigData } = useActionQuery("logo-config");
  useEffect(() => {
    if (logoConfigData?.brandfetchId) {
      setBrandfetchId(logoConfigData.brandfetchId);
    }
  }, [logoConfigData]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (selectedDomain) {
          setSelectedDomain(null);
        } else {
          onOpenChange(false);
        }
      }
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
  }, [open, onOpenChange, selectedDomain]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setResults([]);
      setError(null);
      setSelectedDomain(null);
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
      const res = await fetch(
        `/_agent-native/actions/search-logos?q=${encodeURIComponent(q)}`,
      );
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Search failed");
        return;
      }
      const data: LogoResult[] = await res.json();
      if (data.length === 0) {
        setError("No logos found");
      } else {
        setResults(data);
      }
    } catch {
      setError("Search failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (url: string) => {
    onSelectLogo?.(url);
    onOpenChange(false);
  };

  if (!open) return null;

  // Build variations for the selected domain
  const variations = selectedDomain
    ? buildVariations(selectedDomain, brandfetchId)
    : [];

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
      className="w-[min(460px,calc(100vw-24px))] max-h-[560px] bg-popover border border-border rounded-xl shadow-2xl shadow-black/60 overflow-hidden flex flex-col"
    >
      <div className="px-4 pt-3 pb-2 flex items-center justify-between flex-shrink-0">
        <h3 className="text-sm font-semibold text-foreground">
          {selectedDomain ? (
            <button
              onClick={() => setSelectedDomain(null)}
              className="flex items-center gap-1.5 hover:text-foreground transition-colors"
            >
              <span className="text-muted-foreground">&larr;</span>
              {selectedDomain}
            </button>
          ) : (
            "Logo Search"
          )}
        </h3>
        <button
          onClick={() => onOpenChange(false)}
          className="text-muted-foreground/70 hover:text-muted-foreground transition-colors"
          aria-label="Close"
        >
          <IconX className="w-4 h-4" />
        </button>
      </div>

      {!selectedDomain && (
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
                placeholder="Search company name (e.g. Intuit)"
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
      )}

      <div className="px-4 pb-4 overflow-y-auto flex-1">
        {error && (
          <div className="text-center py-4 text-red-400/70 text-xs">
            {error}
          </div>
        )}

        {/* IconSearch results */}
        {!selectedDomain && !loading && results.length === 0 && !error && (
          <div className="text-center py-6 text-muted-foreground text-xs">
            Search for a company to find their logo
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
              <button
                key={r.domain}
                onClick={() => setSelectedDomain(r.domain)}
                className="w-full flex items-center gap-3 p-2.5 rounded-lg border border-border bg-muted hover:ring-2 hover:ring-[#609FF8]/50 transition-all text-left"
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
              </button>
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
                    <button
                      key={v.label}
                      onClick={() => handleSelect(v.url)}
                      className="flex flex-col items-center gap-1.5 p-2 rounded-lg border border-border hover:ring-2 hover:ring-[#609FF8]/50 transition-all"
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
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Small logo preview with fallback handling */
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
): VariationGroup[] {
  // Brandfetch CDN works without client ID for free tier
  const bf = (path: string) => `https://cdn.brandfetch.io/${domain}/${path}`;
  const ld = (params: string) =>
    `https://img.logo.dev/${domain}?token=${LOGO_DEV_PK}&${params}`;

  return [
    {
      label: "Logo",
      items: [
        { label: "Default", url: bf("logo.png"), bg: "rgba(255,255,255,0.03)" },
        { label: "On dark", url: bf("theme/dark/logo.png"), bg: "#111" },
        { label: "SVG", url: bf("logo.svg"), bg: "rgba(255,255,255,0.03)" },
      ],
    },
    {
      label: "Symbol / Icon",
      items: [
        {
          label: "Symbol",
          url: bf("symbol.png"),
          bg: "rgba(255,255,255,0.03)",
        },
        { label: "Symbol dark", url: bf("theme/dark/symbol.png"), bg: "#111" },
        { label: "Icon", url: bf("icon.png"), bg: "rgba(255,255,255,0.03)" },
      ],
    },
    {
      label: "Logo.dev",
      items: [
        {
          label: "Default",
          url: ld("size=400&format=png&retina=true"),
          bg: "rgba(255,255,255,0.03)",
        },
        {
          label: "For dark bg",
          url: ld("size=400&format=png&retina=true&theme=light"),
          bg: "#111",
        },
        {
          label: "Greyscale",
          url: ld("size=400&format=png&retina=true&greyscale=true"),
          bg: "rgba(255,255,255,0.03)",
        },
      ],
    },
  ];
}
