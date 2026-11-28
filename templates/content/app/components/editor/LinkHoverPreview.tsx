import { useT } from "@agent-native/core/client/i18n";
import { IconUnlink, IconExternalLink, IconPencil } from "@tabler/icons-react";
import type { Editor } from "@tiptap/react";
import { useEffect, useState, useRef } from "react";
import { flushSync } from "react-dom";

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
    link: HTMLAnchorElement;
  } | null>(null);
  const [editing, setEditing] = useState(false);
  const [editUrl, setEditUrl] = useState("");

  const hoverTimer = useRef<NodeJS.Timeout>(undefined);
  const leaveTimer = useRef<NodeJS.Timeout>(undefined);
  const previewRef = useRef<HTMLDivElement>(null);
  const pointerLink = useRef<HTMLAnchorElement | null>(null);
  const dismissedLink = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const found = target.closest<HTMLAnchorElement>("a.content-link");
      const link = found && editor.view.dom.contains(found) ? found : null;
      pointerLink.current = link;
      if (editing) return;

      if (link) {
        clearTimeout(leaveTimer.current);
        leaveTimer.current = undefined;
        if (hoveredLink?.link === link || dismissedLink.current === link) {
          clearTimeout(hoverTimer.current);
          return;
        }
        dismissedLink.current = null;
        const url = link.href;

        clearTimeout(hoverTimer.current);
        hoverTimer.current = setTimeout(() => {
          setHoveredLink({ url, link });
        }, 300);
      } else {
        const isHoveringPreview = previewRef.current?.contains(target);
        if (!isHoveringPreview) {
          dismissedLink.current = null;
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
      pointerLink.current = null;
      dismissedLink.current = null;
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

  useEffect(() => {
    if (!hoveredLink) return;
    const close = () => {
      setEditing(false);
      setEditUrl("");
      setHoveredLink(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        previewRef.current?.contains(document.activeElement)
      )
        return;
      clearTimeout(hoverTimer.current);
      clearTimeout(leaveTimer.current);
      leaveTimer.current = undefined;
      dismissedLink.current = pointerLink.current;
      flushSync(close);
    };
    const closeIfDetached = () => {
      if (!editor.view.dom.contains(hoveredLink.link)) close();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    editor.on("update", closeIfDetached);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      editor.off("update", closeIfDetached);
    };
  }, [editor, hoveredLink]);

  const linkPosition = () => {
    const link = hoveredLink?.link;
    if (!link || !editor.view.dom.contains(link)) return null;
    return editor.view.posAtDOM(link, 0);
  };

  const handleRemoveLink = () => {
    const pos = linkPosition();
    if (pos !== null) {
      editor
        .chain()
        .setTextSelection(pos)
        .extendMarkRange("link")
        .unsetLink()
        .run();
    }
    setHoveredLink(null);
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
    const pos = linkPosition();
    if (pos === null) {
      handleCancelEdit();
      return;
    }
    const next = editUrl.trim();
    const chain = editor.chain().setTextSelection(pos).extendMarkRange("link");
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
    <Popover
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) handleCancelEdit();
      }}
    >
      <PopoverAnchor virtualRef={{ current: hoveredLink.link }} />
      <PopoverContent
        ref={previewRef}
        side="bottom"
        align="start"
        sideOffset={8}
        collisionPadding={8}
        hideWhenDetached
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onFocusOutside={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => {
          if (
            event.target instanceof Node &&
            hoveredLink.link.contains(event.target)
          )
            event.preventDefault();
        }}
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
        className="max-w-[calc(100vw-1rem)] overflow-hidden p-0"
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
              className="text-xs font-medium text-info hover:text-info/80 px-2 py-1 cursor-pointer"
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
              className="flex-1 text-xs text-info hover:underline truncate"
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
      </PopoverContent>
    </Popover>
  );
}
