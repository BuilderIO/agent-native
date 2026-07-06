import { useT } from "@agent-native/core/client";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@agent-native/toolkit/ui/tooltip";
import { IconUnlink, IconExternalLink, IconPencil } from "@tabler/icons-react";
import type { Editor } from "@tiptap/react";
import { useEffect, useState, useRef } from "react";

interface LinkHoverPreviewProps {
  editor: Editor;
  editable?: boolean;
}

export function LinkHoverPreview({
  editor,
  editable = true,
}: LinkHoverPreviewProps) {
  const t = useT();
  const [hoveredLink, setHoveredLink] = useState<{
    url: string;
    rect: DOMRect;
    pos: number;
  } | null>(null);
  const [editing, setEditing] = useState(false);
  const [editUrl, setEditUrl] = useState("");

  const hoverTimer = useRef<NodeJS.Timeout>(undefined);
  const leaveTimer = useRef<NodeJS.Timeout>(undefined);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (editing) return;
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
      if (editing) return;
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
  }, [editor, hoveredLink, editing]);

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

  const handleStartEdit = () => {
    if (!hoveredLink) return;
    setEditUrl(hoveredLink.url);
    setEditing(true);
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setEditUrl("");
    setHoveredLink(null);
  };

  const handleApplyEdit = () => {
    if (!hoveredLink || hoveredLink.pos < 0) return;
    const next = editUrl.trim();
    const chain = editor
      .chain()
      .setTextSelection(hoveredLink.pos)
      .extendMarkRange("link");
    if (next) {
      chain.setLink({ href: next }).run();
    } else {
      chain.unsetLink().run();
    }
    setEditing(false);
    setEditUrl("");
    setHoveredLink(null);
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
        if (editing) return;
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
      {editing ? (
        <div className="flex items-center gap-1 p-1.5">
          <input
            autoFocus
            type="url"
            value={editUrl}
            onChange={(e) => setEditUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleApplyEdit();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                handleCancelEdit();
              }
            }}
            placeholder={t("editor.pasteLink")}
            className="flex-1 bg-transparent border-none outline-none text-xs px-2 py-1 placeholder:text-muted-foreground"
          />
          <button
            onClick={handleApplyEdit}
            className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 px-2 py-1 cursor-pointer"
          >
            {t("editor.apply")}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 p-2">
          <a
            href={hoveredLink.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 text-xs text-blue-600 dark:text-blue-400 hover:underline truncate"
          >
            {domain}
          </a>
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href={hoveredLink.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-accent cursor-pointer"
              >
                <IconExternalLink className="h-3.5 w-3.5" />
              </a>
            </TooltipTrigger>
            <TooltipContent>{t("editor.openLink")}</TooltipContent>
          </Tooltip>
          {editable ? (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleStartEdit}
                    className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-accent cursor-pointer"
                  >
                    <IconPencil className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t("editor.editLink")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleRemoveLink}
                    className="text-muted-foreground hover:text-destructive p-1 rounded hover:bg-destructive/10 cursor-pointer"
                  >
                    <IconUnlink className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t("editor.removeLink")}</TooltipContent>
              </Tooltip>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
