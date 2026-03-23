import { useEffect, useState, useRef, forwardRef } from "react";
import { Unlink, ExternalLink } from "lucide-react";
import type { Editor } from "@tiptap/react";

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

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const link = target.closest("a.notion-link") as HTMLAnchorElement;

      if (link && editor.view.dom.contains(link)) {
        clearTimeout(leaveTimer.current);
        leaveTimer.current = undefined;
        const url = link.href;
        const rect = link.getBoundingClientRect();

        if (hoveredLink?.url === url) return;

        let pos = -1;
        try {
          pos = editor.view.posAtDOM(link, 0);
        } catch {
          // ignore
        }

        clearTimeout(hoverTimer.current);
        hoverTimer.current = setTimeout(() => {
          setHoveredLink({ url, rect, pos });
        }, 300);
      } else {
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

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseleave", handleMouseLeave);
      clearTimeout(hoverTimer.current);
      clearTimeout(leaveTimer.current);
    };
  }, [editor, hoveredLink]);

  const handleRemoveLink = () => {
    if (hoveredLink && hoveredLink.pos >= 0) {
      editor
        .chain()
        .setTextSelection(hoveredLink.pos)
        .extendMarkRange("link")
        .unsetLink()
        .run();
      setHoveredLink(null);
    }
  };

  if (!hoveredLink) return null;

  const domain = (() => {
    try {
      return new URL(hoveredLink.url).hostname;
    } catch {
      return hoveredLink.url;
    }
  })();

  return (
    <div
      ref={previewRef}
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
      style={{
        position: "fixed",
        top: hoveredLink.rect.bottom + 8,
        left: Math.max(16, hoveredLink.rect.left),
        zIndex: 50,
      }}
      className="w-72 rounded-lg border bg-popover text-popover-foreground shadow-md overflow-hidden animate-in fade-in-0 zoom-in-95"
    >
      <div className="flex items-center gap-2 p-2">
        <a
          href={hoveredLink.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 text-xs text-blue-500 hover:underline truncate"
        >
          {domain}
        </a>
        <a
          href={hoveredLink.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-accent"
          title="Open link"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <button
          onClick={handleRemoveLink}
          className="text-muted-foreground hover:text-destructive p-1 rounded hover:bg-destructive/10"
          title="Remove link"
        >
          <Unlink className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
