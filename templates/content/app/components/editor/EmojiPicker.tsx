import { useState, useMemo, useRef, useEffect } from "react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { IconMoodSmile } from "@tabler/icons-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const EMOJI_CATEGORIES: { name: string; emojis: string[] }[] = [
  {
    name: "Smileys",
    emojis: [
      "😀",
      "😃",
      "😄",
      "😁",
      "😆",
      "😅",
      "🤣",
      "😂",
      "🙂",
      "😊",
      "😇",
      "🥰",
      "😍",
      "🤩",
      "😘",
      "😋",
      "😛",
      "🤔",
      "🤗",
      "🤫",
      "😎",
      "🥳",
      "😤",
      "😱",
      "🥺",
      "😈",
      "💀",
      "👻",
      "👽",
      "🤖",
      "💩",
      "🎃",
    ],
  },
  {
    name: "People",
    emojis: [
      "👋",
      "🤚",
      "✋",
      "🖖",
      "🫱",
      "🫲",
      "👌",
      "🤌",
      "✌️",
      "🤞",
      "🫰",
      "🤙",
      "👈",
      "👉",
      "👆",
      "👇",
      "☝️",
      "👍",
      "👎",
      "✊",
      "👊",
      "🤛",
      "🤜",
      "👏",
      "🙌",
      "🫶",
      "👐",
      "🤝",
      "🙏",
      "💪",
      "🧠",
      "👀",
    ],
  },
  {
    name: "Nature",
    emojis: [
      "🐶",
      "🐱",
      "🐭",
      "🐹",
      "🐰",
      "🦊",
      "🐻",
      "🐼",
      "🐨",
      "🐯",
      "🦁",
      "🐸",
      "🐵",
      "🐔",
      "🐧",
      "🐦",
      "🦄",
      "🐝",
      "🦋",
      "🐌",
      "🌸",
      "🌺",
      "🌻",
      "🌹",
      "🌿",
      "🍀",
      "🌴",
      "🌲",
      "🌊",
      "🔥",
      "⭐",
      "🌈",
    ],
  },
  {
    name: "Food",
    emojis: [
      "🍎",
      "🍊",
      "🍋",
      "🍌",
      "🍉",
      "🍇",
      "🍓",
      "🫐",
      "🍒",
      "🥝",
      "🍑",
      "🥭",
      "🍔",
      "🍕",
      "🌮",
      "🍣",
      "🍩",
      "🍪",
      "🎂",
      "🍰",
      "☕",
      "🍵",
      "🧃",
      "🍷",
      "🍺",
      "🥤",
      "🧊",
      "🍫",
      "🍿",
      "🥐",
      "🥗",
      "🍜",
    ],
  },
  {
    name: "Activities",
    emojis: [
      "⚽",
      "🏀",
      "🏈",
      "⚾",
      "🎾",
      "🏐",
      "🎱",
      "🏓",
      "🎯",
      "🎮",
      "🕹️",
      "🎲",
      "🧩",
      "🎭",
      "🎨",
      "🎬",
      "🎤",
      "🎧",
      "🎵",
      "🎹",
      "🎸",
      "🥁",
      "🏆",
      "🥇",
      "🏅",
      "🎖️",
      "🏋️",
      "🚴",
      "🧘",
      "🎪",
      "🎡",
      "🎢",
    ],
  },
  {
    name: "Travel",
    emojis: [
      "🚗",
      "🚕",
      "🚌",
      "🚎",
      "🏎️",
      "🚓",
      "🚑",
      "🚒",
      "✈️",
      "🚀",
      "🛸",
      "🚁",
      "⛵",
      "🚢",
      "🏠",
      "🏢",
      "🏗️",
      "🏰",
      "🗽",
      "🗼",
      "⛩️",
      "🕌",
      "🌍",
      "🌎",
      "🌏",
      "🗺️",
      "🏔️",
      "🏝️",
      "🏖️",
      "🌅",
      "🌄",
      "🌉",
    ],
  },
  {
    name: "Objects",
    emojis: [
      "💡",
      "🔦",
      "🕯️",
      "📱",
      "💻",
      "⌨️",
      "🖥️",
      "🖨️",
      "📷",
      "🎥",
      "📺",
      "📻",
      "⏰",
      "🔔",
      "📣",
      "📢",
      "💎",
      "🔑",
      "🗝️",
      "🔒",
      "🔓",
      "📦",
      "📫",
      "✏️",
      "📝",
      "📚",
      "📖",
      "🔗",
      "📎",
      "✂️",
      "🗑️",
      "🧰",
    ],
  },
  {
    name: "Symbols",
    emojis: [
      "❤️",
      "🧡",
      "💛",
      "💚",
      "💙",
      "💜",
      "🖤",
      "🤍",
      "💔",
      "❣️",
      "💕",
      "💞",
      "💓",
      "💗",
      "💖",
      "💘",
      "💝",
      "✅",
      "❌",
      "⭕",
      "❗",
      "❓",
      "💯",
      "🔴",
      "🟠",
      "🟡",
      "🟢",
      "🔵",
      "🟣",
      "⚫",
      "⚪",
      "🏁",
    ],
  },
];

// Flattened for search
const ALL_EMOJI_ENTRIES = EMOJI_CATEGORIES.flatMap((cat) =>
  cat.emojis.map((e) => ({ emoji: e, category: cat.name })),
);

interface EmojiPickerProps {
  icon: string | null;
  onSelect: (emoji: string | null) => void;
}

export function EmojiPicker({ icon, onSelect }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setSearch("");
      // Focus search on open
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  const filteredCategories = useMemo(() => {
    if (!search.trim()) return EMOJI_CATEGORIES;
    const q = search.toLowerCase();
    const matchingEmojis = ALL_EMOJI_ENTRIES.filter((e) =>
      e.category.toLowerCase().includes(q),
    );
    if (matchingEmojis.length === 0) return [];
    // Group back into categories
    const grouped = new Map<string, string[]>();
    for (const e of matchingEmojis) {
      if (!grouped.has(e.category)) grouped.set(e.category, []);
      grouped.get(e.category)!.push(e.emoji);
    }
    return Array.from(grouped, ([name, emojis]) => ({ name, emojis }));
  }, [search]);

  const handleSelect = (emoji: string) => {
    onSelect(emoji);
    setOpen(false);
  };

  const handleRemove = () => {
    onSelect(null);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {icon ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="text-5xl leading-none cursor-pointer hover:bg-accent/50 rounded-md p-1 -ml-1">
                {icon}
              </button>
            </TooltipTrigger>
            <TooltipContent>Change icon</TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="flex items-center gap-1.5 text-sm text-muted-foreground/60 hover:text-muted-foreground hover:bg-accent/50 rounded-md px-1.5 py-1 -ml-1.5 cursor-pointer opacity-0 group-hover/title:opacity-100 data-[state=open]:opacity-100">
                <IconMoodSmile size={18} />
                <span>Add icon</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>Add icon</TooltipContent>
          </Tooltip>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        {/* Search */}
        <div className="p-2 border-b">
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter..."
            className="w-full px-2.5 py-1.5 text-sm bg-accent/50 rounded-md outline-none placeholder:text-muted-foreground/50"
          />
        </div>

        {/* Emoji grid */}
        <div className="max-h-64 overflow-auto p-2">
          {filteredCategories.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-4">
              No emojis found
            </div>
          ) : (
            filteredCategories.map((category) => (
              <div key={category.name} className="mb-2 last:mb-0">
                <div className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider px-0.5 mb-1">
                  {category.name}
                </div>
                <div className="grid grid-cols-7 gap-0 sm:grid-cols-8">
                  {category.emojis.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => handleSelect(emoji)}
                      className="w-9 h-9 flex items-center justify-center text-lg rounded hover:bg-accent cursor-pointer"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Remove button */}
        {icon && (
          <div className="border-t p-1.5">
            <button
              onClick={handleRemove}
              className="w-full text-left text-sm text-muted-foreground hover:text-foreground hover:bg-accent px-2.5 py-1.5 rounded-md cursor-pointer"
            >
              Remove icon
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
