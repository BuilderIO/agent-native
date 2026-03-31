import { Link } from "react-router";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import type { Deck } from "@/context/DeckContext";
import SlideRenderer from "./SlideRenderer";

interface DeckCardProps {
  deck: Deck;
  onDelete: (id: string) => void;
}

export default function DeckCard({ deck, onDelete }: DeckCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const firstSlide = deck.slides[0];

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
          <h3 className="font-medium text-sm text-white/90 truncate">
            {deck.title}
          </h3>
          <div className="text-xs text-white/40 mt-1">
            {deck.slides.length} slide{deck.slides.length !== 1 ? "s" : ""}
          </div>
        </div>
      </Link>

      {/* Menu Button */}
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setShowMenu(!showMenu);
          }}
          className="p-1.5 rounded-md bg-black/60 backdrop-blur-sm border border-white/10 hover:bg-black/80 transition-colors"
          aria-label="Deck options"
        >
          <MoreHorizontal className="w-3.5 h-3.5 text-white/70" />
        </button>

        {showMenu && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setShowMenu(false)}
            />
            <div className="absolute right-0 top-9 z-50 w-36 rounded-lg border border-white/[0.08] bg-[hsl(240,5%,10%)] shadow-xl py-1">
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDelete(deck.id);
                  setShowMenu(false);
                }}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-400 hover:bg-white/5 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
