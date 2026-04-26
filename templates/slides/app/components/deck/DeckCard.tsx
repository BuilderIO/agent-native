import { Link } from "react-router";
import { IconDots, IconTrash } from "@tabler/icons-react";
import type { Deck } from "@/context/DeckContext";
import SlideRenderer from "./SlideRenderer";
import { VisibilityBadge } from "@agent-native/core/client";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

interface DeckCardProps {
  deck: Deck;
  onDelete: (id: string) => void;
}

export default function DeckCard({ deck, onDelete }: DeckCardProps) {
  const firstSlide = deck.slides?.[0];

  return (
    <div className="group relative">
      <Link
        to={`/deck/${deck.id}`}
        className="block rounded-xl border border-white/[0.06] bg-[hsl(240,5%,8%)] hover:border-white/[0.12] transition-all duration-200 overflow-hidden hover:shadow-lg hover:shadow-[#609FF8]/5"
      >
        {/* Slide Preview */}
        <div className="aspect-video overflow-hidden relative">
          {firstSlide && (
            <div className="w-full h-full">
              <SlideRenderer slide={firstSlide} className="rounded-none" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[hsl(240,5%,8%)] via-transparent to-transparent opacity-60" />
        </div>

        {/* Info */}
        <div className="p-4">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="font-medium text-sm text-white/90 truncate flex-1">
              {deck.title}
            </h3>
            <VisibilityBadge visibility={deck.visibility} />
          </div>
          <div className="text-xs text-white/40 mt-1">
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
              className="p-2 sm:p-1.5 rounded-md bg-black/60 backdrop-blur-sm border border-white/10 hover:bg-black/80"
              aria-label="Deck options"
            >
              <IconDots className="w-3.5 h-3.5 text-white/70" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
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
