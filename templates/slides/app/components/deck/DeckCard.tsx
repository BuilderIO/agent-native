import { Link } from "react-router";
import { IconDots, IconTrash, IconCopy, IconPencil } from "@tabler/icons-react";
import { useState, useRef, useEffect } from "react";
import type { Deck } from "@/context/DeckContext";
import SlideRenderer from "./SlideRenderer";
import { VisibilityBadge } from "@agent-native/core/client";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

interface DeckCardProps {
  deck: Deck;
  onDelete: (id: string) => void;
  onRename: (id: string, newTitle: string) => void;
  onDuplicate: (id: string) => void;
}

export default function DeckCard({
  deck,
  onDelete,
  onRename,
  onDuplicate,
}: DeckCardProps) {
  const firstSlide = deck.slides?.[0];
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(deck.title);
  const inputRef = useRef<HTMLInputElement>(null);

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
    if (e.key === "Enter") commitRename();
    else if (e.key === "Escape") setIsRenaming(false);
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
                onClick={(e) => e.preventDefault()}
                className="flex-1 min-w-0 bg-transparent border-b border-border text-sm font-medium text-foreground outline-none"
              />
            ) : (
              <h3 className="font-medium text-sm text-foreground truncate flex-1">
                {deck.title}
              </h3>
            )}
            <VisibilityBadge visibility={deck.visibility} />
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {deck.slides.length} slide{deck.slides.length !== 1 ? "s" : ""}
          </div>
        </div>
      </Link>

      {/* Menu Button - always visible on touch devices */}
      <div className="absolute top-2 right-2 sm:opacity-0 sm:group-hover:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              className="p-2 sm:p-1.5 rounded-md bg-black/60 backdrop-blur-sm border border-border hover:bg-black/80"
              aria-label="Deck options"
            >
              <IconDots className="w-3.5 h-3.5 text-foreground/70" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsRenaming(true);
              }}
            >
              <IconPencil className="w-3.5 h-3.5 mr-2" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDuplicate(deck.id);
              }}
            >
              <IconCopy className="w-3.5 h-3.5 mr-2" />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete(deck.id);
              }}
              className="text-red-400 focus:text-red-400"
            >
              <IconTrash className="w-3.5 h-3.5 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
