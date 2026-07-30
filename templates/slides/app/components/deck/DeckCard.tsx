import { useT } from "@agent-native/core/client/i18n";
import { CreativeContextShareSheet } from "@agent-native/creative-context/client";
import { VisibilityBadge } from "@agent-native/toolkit/sharing";
import {
  IconBuildingCommunity,
  IconDots,
  IconTrash,
  IconCopy,
  IconPencil,
  IconPalette,
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

import SlideRenderer from "./SlideRenderer";

interface DeckCardProps {
  deck: Deck;
  onDelete: (id: string) => void;
  onRename: (id: string, newTitle: string) => void;
  onDuplicate: (id: string) => void;
  onToggleStar: (id: string, starred: boolean) => void;
  isDuplicating?: boolean;
  designSystemTitle?: string | null;
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
  isDuplicating = false,
  designSystemTitle,
  isWorkspaceDefault = false,
  canSetWorkspaceDefault = false,
  onSetWorkspaceDefault,
}: DeckCardProps) {
  const t = useT();
  const firstSlide = deck.slides?.[0];
  const [isRenaming, setIsRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(deck.title);
  const [contextOpen, setContextOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingRenameRef = useRef(false);
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
        className="block rounded-xl border border-border bg-card hover:border-border transition-all duration-200 overflow-hidden hover:shadow-lg hover:shadow-[#609FF8]/5"
        onClick={(e) => {
          if (isRenaming) e.preventDefault();
        }}
      >
        {/* Slide Preview */}
        <div className="overflow-hidden relative">
          {firstSlide && (
            <SlideRenderer
              slide={firstSlide}
              className="rounded-none"
              aspectRatio={deck.aspectRatio}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[hsl(240,5%,8%)] via-transparent to-transparent opacity-60" />
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
          <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span className="shrink-0 whitespace-nowrap">
              {deck.slides.length} slide{deck.slides.length !== 1 ? "s" : ""}
            </span>
            {isWorkspaceDefault && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded border border-[#609FF8]/40 px-1.5 py-0.5 text-[10px] text-[#609FF8]">
                <IconBuildingCommunity className="h-3 w-3 shrink-0" />
                {t("home.workspaceDefaultBadge")}
              </span>
            )}
            {deck.designSystemId && (
              <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground/80">
                <IconPalette className="h-3 w-3 shrink-0 text-[#609FF8]" />
                <span className="max-w-28 truncate">
                  {designSystemTitle || "Design system"}
                </span>
              </span>
            )}
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
              deck.starred ? "" : "sm:opacity-0 sm:group-hover:opacity-100"
            }`}
            aria-label={
              deck.starred ? t("home.unstarDeck") : t("home.starDeck")
            }
            aria-pressed={Boolean(deck.starred)}
          >
            {deck.starred ? (
              <IconStarFilled className="h-3.5 w-3.5 text-[#F5C451]" />
            ) : (
              <IconStar className="h-3.5 w-3.5 text-foreground/70" />
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
              className="p-2 sm:p-1.5 rounded-md bg-black/60 backdrop-blur-sm border border-border hover:bg-black/80 sm:opacity-0 sm:group-hover:opacity-100"
              aria-label={t("raw.deckOptions")}
            >
              <IconDots className="w-3.5 h-3.5 text-foreground/70" />
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
            <DropdownMenuItem
              onSelect={() => {
                if (isDuplicating) return;
                onDuplicate(deck.id);
              }}
              disabled={isDuplicating}
            >
              <IconCopy className="w-3.5 h-3.5 me-2" />
              {isDuplicating ? "Duplicating..." : "Duplicate"}
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
              onSelect={() => {
                onDelete(deck.id);
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
