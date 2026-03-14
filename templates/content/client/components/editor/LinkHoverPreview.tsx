import { useEffect, useState, useRef, forwardRef } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { useLinkPreview } from "@/hooks/use-twitter";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Unlink, AlertTriangle } from "lucide-react";
import type { Editor } from "@tiptap/react";
import { cn } from "@/lib/utils";

interface LinkHoverPreviewProps {
  editor: Editor;
}

export function LinkHoverPreview({ editor }: LinkHoverPreviewProps) {
  const [hoveredLink, setHoveredLink] = useState<{
    url: string;
    rect: DOMRect;
    pos: number;
  } | null>(null);

  const hoverTimer = useRef<NodeJS.Timeout>();
  const leaveTimer = useRef<NodeJS.Timeout>();
  const previewRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const [brokenUrls, setBrokenUrls] = useState<Set<string>>(new Set());

  // Listen to React Query cache to find broken links without mutating DOM directly
  // This prevents infinite loops with Tiptap/ProseMirror
  useEffect(() => {
    const updateBrokenUrls = () => {
      const cache = queryClient.getQueryCache();
      const newBroken = new Set<string>();

      cache.getAll().forEach((query) => {
        if (query.queryKey[0] === "link-preview") {
          const url = query.queryKey[1] as string;
          const data = query.state.data as any;
          const isError = query.state.status === "error";

          if (isError || data?.status === 404 || (data?.status && data.status >= 500)) {
            newBroken.add(url);
          }
        }
      });

      setBrokenUrls(prev => {
        if (prev.size !== newBroken.size) return newBroken;
        let same = true;
        for (const url of newBroken) {
          if (!prev.has(url)) {
            same = false;
            break;
          }
        }
        return same ? prev : newBroken;
      });
    };

    updateBrokenUrls();
    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      updateBrokenUrls();
    });

    return unsubscribe;
  }, [queryClient]);

  // Inject dynamic CSS to style broken links
  useEffect(() => {
    const styleId = "broken-links-style";
    let styleEl = document.getElementById(styleId) as HTMLStyleElement;

    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }

    // Generate CSS rules for each broken URL
    const rules = Array.from(brokenUrls).map(url => {
      const escapedUrl = url.replace(/"/g, '\\"');
      return `a.notion-link[href="${escapedUrl}"] {
        text-decoration: underline wavy !important;
        text-decoration-color: hsl(var(--destructive)) !important;
        color: hsl(var(--muted-foreground)) !important;
      }
      a.notion-link[href="${escapedUrl}"]:hover {
        text-decoration-color: hsl(var(--destructive)) !important;
        color: hsl(var(--foreground)) !important;
      }`;
    }).join('\n');

    styleEl.textContent = rules;

    return () => {
      // Don't remove the style element, just keep it for reuse
    };
  }, [brokenUrls]);

  // Fetch missing previews on mount/update so we don't have to wait for hover
  useEffect(() => {
    if (!editor.view.dom) return;

    // We use a debounce so we don't spam requests while typing
    const timeout = setTimeout(() => {
      const links = editor.view.dom.querySelectorAll("a.notion-link");

      links.forEach((link) => {
        const url = (link as HTMLAnchorElement).href;
        if (!url) return;

        // Check if we already have it in cache or if it's currently fetching
        const state = queryClient.getQueryState(["link-preview", url]);
        if (!state || (state.status !== "success" && state.status !== "error" && state.fetchStatus !== "fetching")) {
          // It's entirely missing or stale, fetch it!
          queryClient.prefetchQuery({
            queryKey: ["link-preview", url],
            queryFn: async () => {
              const res = await authFetch(`/api/twitter/preview?url=${encodeURIComponent(url)}`, {
                signal: AbortSignal.timeout(5000), // 5 second timeout
              });
              if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new Error(body?.error || "Preview fetch failed");
              }
              return res.json();
            },
            staleTime: 600_000, // 10 minutes
            retry: false,
          });
        }
      });
    }, 500);

    return () => clearTimeout(timeout);
  }, [editor.state.doc, queryClient]); // Run whenever document content changes

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // Check if hovering over a link inside the editor
      const target = e.target as HTMLElement;
      const link = target.closest("a.notion-link") as HTMLAnchorElement;

      if (link && editor.view.dom.contains(link)) {
        clearTimeout(leaveTimer.current);
        leaveTimer.current = undefined;
        const url = link.href;

        // Use setImmediate or just update to avoid staleness, but rect changes on scroll.
        // For simplicity, we capture rect on hover.
        const rect = link.getBoundingClientRect();

        // If hovering over the same link, do nothing to avoid resetting timer
        if (hoveredLink?.url === url) return;

        let pos = -1;
        try {
          pos = editor.view.posAtDOM(link, 0);
        } catch (err) {
          // ignore
        }

        clearTimeout(hoverTimer.current);
        hoverTimer.current = setTimeout(() => {
          setHoveredLink({ url, rect, pos });
        }, 300);
      } else {
        // Not hovering over a link
        const isHoveringPreview = previewRef.current?.contains(target);
        if (!isHoveringPreview) {
          clearTimeout(hoverTimer.current);
          if (hoveredLink && !leaveTimer.current) {
            leaveTimer.current = setTimeout(() => {
              setHoveredLink(null);
              leaveTimer.current = undefined;
            }, 300);
          }
        } else {
          // Hovering over preview, cancel any leave timers
          clearTimeout(leaveTimer.current);
          leaveTimer.current = undefined;
        }
      }
    };

    const handleMouseLeave = () => {
      clearTimeout(hoverTimer.current);
      leaveTimer.current = setTimeout(() => {
        setHoveredLink(null);
        leaveTimer.current = undefined;
      }, 300);
    };

    // Use document to capture all mouse movements
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseleave", handleMouseLeave);
      clearTimeout(hoverTimer.current);
      clearTimeout(leaveTimer.current);
    };
  }, [editor, hoveredLink]);

  const handleUpdateUrl = (newUrl: string) => {
    if (hoveredLink && hoveredLink.pos >= 0) {
      if (newUrl.trim()) {
        editor.chain().setTextSelection(hoveredLink.pos).extendMarkRange('link').setLink({ href: newUrl }).run();
        setHoveredLink((prev) => (prev ? { ...prev, url: newUrl } : null));
      } else {
        editor.chain().setTextSelection(hoveredLink.pos).extendMarkRange('link').unsetLink().run();
        setHoveredLink(null);
      }
    }
  };

  const handleRemoveLink = () => {
    if (hoveredLink && hoveredLink.pos >= 0) {
      editor.chain().setTextSelection(hoveredLink.pos).extendMarkRange('link').unsetLink().run();
      setHoveredLink(null);
    }
  };

  if (!hoveredLink) return null;

  return (
    <PreviewCard
      url={hoveredLink.url}
      rect={hoveredLink.rect}
      ref={previewRef}
      onUpdateUrl={handleUpdateUrl}
      onRemoveLink={handleRemoveLink}
      onMouseLeave={() => {
        leaveTimer.current = setTimeout(() => {
          setHoveredLink(null);
          leaveTimer.current = undefined;
        }, 300);
      }}
      onMouseEnter={() => {
        clearTimeout(leaveTimer.current);
        leaveTimer.current = undefined;
      }}
    />
  );
}

const PreviewCard = forwardRef<
  HTMLDivElement,
  {
    url: string;
    rect: DOMRect;
    onMouseLeave: () => void;
    onMouseEnter: () => void;
    onUpdateUrl: (newUrl: string) => void;
    onRemoveLink: () => void;
  }
>(({ url, rect, onMouseLeave, onMouseEnter, onUpdateUrl, onRemoveLink }, ref) => {
  const { data: preview, isLoading, error } = useLinkPreview(url);
  const cardRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: rect.bottom + 8, left: rect.left });
  const [opacity, setOpacity] = useState(0); // Start hidden until positioned

  const [editUrl, setEditUrl] = useState(url);
  const isBroken = preview?.status === 404 || (preview?.status && preview.status >= 500) || !!error;

  useEffect(() => {
    setEditUrl(url);
  }, [url]);

  const [isFocused, setIsFocused] = useState(false);

  // Merge refs
  const setRefs = (node: HTMLDivElement) => {
    cardRef.current = node;
    if (typeof ref === "function") {
      ref(node);
    } else if (ref) {
      ref.current = node;
    }
  };

  useEffect(() => {
    if (!cardRef.current) return;

    // Update position based on actual card size to prevent overflow
    const cardRect = cardRef.current.getBoundingClientRect();
    let top = rect.bottom + 8;

    // If it overflows the bottom, place it above the link
    if (top + cardRect.height > window.innerHeight - 16) {
      top = rect.top - cardRect.height - 8;
    }

    // Keep it within horizontal bounds
    const maxLeft = window.innerWidth - cardRect.width - 16;
    const left = Math.max(16, Math.min(rect.left, maxLeft));

    setPosition({ top, left });
    setOpacity(1); // Show after positioning
  }, [rect, preview]); // Re-calculate if preview data loads and changes height

  const handleMouseLeave = () => {
    if (!isFocused) {
      onMouseLeave();
    }
  };

  return (
    <div
      ref={setRefs}
      onMouseLeave={handleMouseLeave}
      onMouseEnter={onMouseEnter}
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        zIndex: 50,
        opacity,
      }}
      className={cn(
        "w-80 rounded-lg border bg-popover text-popover-foreground shadow-md transition-opacity duration-200 overflow-hidden",
        opacity === 1 ? "animate-in fade-in-0 zoom-in-95" : "",
        isBroken ? "border-destructive/50 ring-1 ring-destructive/20" : ""
      )}
    >
      <div className={cn("flex items-center gap-2 border-b p-2", isBroken ? "bg-destructive/10" : "bg-muted/50")}>
        <input
          type="url"
          className="flex-1 bg-transparent border-none outline-none text-xs text-muted-foreground focus:text-foreground px-1 py-1"
          value={editUrl}
          onChange={(e) => setEditUrl(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={(e) => {
            setIsFocused(false);
            // If the mouse is not over the card, trigger leave
            if (cardRef.current && !cardRef.current.matches(':hover')) {
              onMouseLeave();
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onUpdateUrl(editUrl);
            } else if (e.key === "Escape") {
              setEditUrl(url);
              e.currentTarget.blur();
            }
          }}
          placeholder="https://..."
        />
        {editUrl !== url && (
          <button
            onClick={() => onUpdateUrl(editUrl)}
            className="text-[10px] font-medium text-blue-500 hover:text-blue-600 px-2 py-1 rounded hover:bg-blue-500/10 transition-colors"
          >
            Save
          </button>
        )}
        <button
          onClick={onRemoveLink}
          className="text-muted-foreground hover:text-destructive p-1.5 rounded-md hover:bg-destructive/10 transition-colors"
          title="Remove link"
        >
          <Unlink className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="p-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading preview...</span>
          </div>
        ) : isBroken ? (
          <div className="flex flex-col items-center justify-center gap-3 text-center py-4">
            <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center text-destructive">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-semibold text-destructive">Link Not Found (404)</span>
              <span className="text-xs text-muted-foreground">
                This page may have been moved or deleted.
              </span>
            </div>
          </div>
        ) : error || !preview ? (
          <div className="flex flex-col gap-1">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-blue-500 hover:underline break-all"
            >
              {url}
            </a>
          </div>
        ) : (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col gap-2 group outline-none"
          >
            {preview.image && (
              <div className="relative h-40 w-full overflow-hidden rounded-md bg-muted">
                <img
                  src={preview.image}
                  alt={preview.title}
                  className="object-cover w-full h-full transition-transform group-hover:scale-105"
                />
              </div>
            )}
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {preview.domain}
              </span>
              <h4 className="text-sm font-semibold line-clamp-2 leading-tight group-hover:underline">
                {preview.title}
              </h4>
              {preview.description && (
                <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                  {preview.description}
                </p>
              )}
            </div>
          </a>
        )}
      </div>
    </div>
  );
});
PreviewCard.displayName = "PreviewCard";
