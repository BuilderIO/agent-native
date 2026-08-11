import { useT } from "@agent-native/core/client/i18n";
import { CreativeContextShareSheet } from "@agent-native/creative-context/client";
import { VisibilityBadge } from "@agent-native/toolkit/sharing";
import {
  IconBuildingCommunity,
  IconDots,
  IconTrash,
  IconCopy,
  IconPencil,
  IconPlus,
  IconStar,
  IconStarFilled,
} from "@tabler/icons-react";
import { useState, useRef, useEffect } from "react";
import { Link } from "react-router";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { Deck } from "@/context/DeckContext";
import { getDeckListingPreviewFrameStyle } from "@/lib/deck-preview-frame";

import SlideRenderer from "./SlideRenderer";

interface DeckCardProps {
  deck: Deck;
  onDelete: (id: string) => void;
  onRename: (id: string, newTitle: string) => void;
  onDuplicate: (id: string) => void;
  onToggleStar: (id: string, starred: boolean) => void;
  isWorkspaceDefault?: boolean;
  canSetWorkspaceDefault?: boolean;
  onSetWorkspaceDefault?: (id: string, isDefault: boolean) => void;
}

export default function DeckCard({
  deck,
  onDelete,
  onRename,
  onDuplicate,
  onToggleStar,
  isWorkspaceDefault = false,
  canSetWorkspaceDefault = false,
  onSetWorkspaceDefault,
}: DeckCardProps) {
  const t = useT();
  const firstSlide = deck.slides?.[0];
  const previewFrameStyle = getDeckListingPreviewFrameStyle(deck.aspectRatio);
  const [isRenaming, setIsRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(deck.title);
  const [contextOpen, setContextOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingRenameRef = useRef(false);
  const pendingDeleteRef = useRef(false);
  const pendingWorkspaceDefaultRef = useRef(false);

  useEffect(() => {
    if (isRenaming) {
      setRenameValue(deck.title);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    }
  }, [isRenaming, deck.title]);

  const commitRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== deck.title) {
      onRename(deck.id, trimmed);
    }
    setIsRenaming(false);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      commitRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setIsRenaming(false);
    }
  };

  const startRename = () => {
    pendingRenameRef.current = true;
    setMenuOpen(false);
  };

  return (
    <div className="group relative">
      <Link
        to={`/deck/${deck.id}`}
        className="block overflow-hidden rounded-xl bg-card transition-[box-shadow,background-color] duration-200 hover:bg-accent/30 hover:shadow-lg hover:shadow-[#609FF8]/5"
        onClick={(e) => {
          if (isRenaming) e.preventDefault();
        }}
      >
        {/* Slide Preview */}
        <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-muted/30">
          {firstSlide && (
            <div className="relative overflow-hidden" style={previewFrameStyle}>
              <SlideRenderer
                slide={firstSlide}
                className="rounded-none"
                aspectRatio={deck.aspectRatio}
              />
            </div>
          )}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[hsl(240,5%,8%)] via-transparent to-transparent opacity-60" />
        </div>

        {/* Info */}
        <div className="p-4">
          <div className="flex items-center gap-2 min-w-0">
            {isRenaming ? (
              <input
                ref={inputRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={handleRenameKeyDown}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className="flex-1 min-w-0 bg-transparent border-b border-border text-sm font-medium text-foreground outline-none"
              />
            ) : (
              <h3 className="font-medium text-sm text-foreground truncate flex-1">
                {deck.title}
              </h3>
            )}
            <VisibilityBadge visibility={deck.visibility} />
          </div>
        </div>
      </Link>

      {/* Star + menu buttons - always visible on touch devices */}
      <div className="absolute top-2 end-2 flex items-center gap-1">
        {deck.createdByMe !== false && (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleStar(deck.id, !deck.starred);
            }}
            className={`rounded-md border border-border bg-black/60 p-2 backdrop-blur-sm hover:bg-black/80 sm:p-1.5 ${
              deck.starred
                ? ""
                : "sm:invisible sm:pointer-events-none sm:opacity-0 sm:group-hover:visible sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:group-focus-within:visible sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100"
            }`}
            aria-label={
              deck.starred ? t("home.unstarDeck") : t("home.starDeck")
            }
            aria-pressed={Boolean(deck.starred)}
          >
            {deck.starred ? (
              <IconStarFilled className="h-3.5 w-3.5 text-[#F5C451]" />
            ) : (
              <IconStar className="h-3.5 w-3.5 text-white/70" />
            )}
          </button>
        )}
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              className={`rounded-md border border-border bg-black/60 p-2 backdrop-blur-sm hover:bg-black/80 sm:p-1.5 ${
                menuOpen
                  ? "sm:visible sm:pointer-events-auto sm:opacity-100"
                  : "sm:invisible sm:pointer-events-none sm:opacity-0 sm:group-hover:visible sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:group-focus-within:visible sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100"
              }`}
              aria-label={t("raw.deckOptions")}
            >
              <IconDots className="w-3.5 h-3.5 text-white/70" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-40"
            onCloseAutoFocus={(e) => {
              if (pendingRenameRef.current) {
                e.preventDefault();
                pendingRenameRef.current = false;
                setIsRenaming(true);
              }
              // Opening a modal dialog while this menu is still tearing down
              // leaves `pointer-events: none` stuck on <body>: two dismissable
              // layers overlap and the survivor never restores the style. Wait
              // for the menu to finish closing, and keep focus off the trigger
              // so the dialog owns it.
              if (pendingWorkspaceDefaultRef.current) {
                e.preventDefault();
                pendingWorkspaceDefaultRef.current = false;
                onSetWorkspaceDefault?.(deck.id, !isWorkspaceDefault);
              }
              if (pendingDeleteRef.current) {
                e.preventDefault();
                pendingDeleteRef.current = false;
                setTimeout(() => onDelete(deck.id), 0);
              }
            }}
          >
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                startRename();
              }}
            >
              <IconPencil className="w-3.5 h-3.5 me-2" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onDuplicate(deck.id)}>
              <IconCopy className="w-3.5 h-3.5 me-2" />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                setMenuOpen(false);
                setContextOpen(true);
              }}
            >
              <IconPlus className="w-3.5 h-3.5 me-2" />
              {t("creativeContext.addToContext" /* i18n-key-ignore */)}
            </DropdownMenuItem>
            {canSetWorkspaceDefault && onSetWorkspaceDefault && (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  pendingWorkspaceDefaultRef.current = true;
                  setMenuOpen(false);
                }}
              >
                <IconBuildingCommunity className="w-3.5 h-3.5 me-2" />
                {isWorkspaceDefault
                  ? t("home.clearWorkspaceDefault")
                  : t("home.setWorkspaceDefault")}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                pendingDeleteRef.current = true;
                setMenuOpen(false);
              }}
              className="text-red-400 focus:text-red-400"
            >
              <IconTrash className="w-3.5 h-3.5 me-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <CreativeContextShareSheet
        open={contextOpen}
        onOpenChange={setContextOpen}
        resource={{
          appId: "slides",
          resourceType: "deck",
          resourceId: deck.id,
          title: deck.title,
          updatedAt: deck.updatedAt,
          visibility: deck.visibility,
          preview: { kind: "document", label: "Deck" },
        }}
        canManage={deck.createdByMe}
      />
    </div>
  );
}
