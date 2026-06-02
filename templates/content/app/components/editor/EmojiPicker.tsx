import { useState, useMemo, useRef, useEffect, type ReactNode } from "react";
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

type EmojiCategory = { name: string; emojis: string[] };

const EMOJI_CATEGORIES: EmojiCategory[] = [
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

const EMOJI_SEARCH_ALIASES: Record<string, string[]> = {
  "😀": ["grinning", "grin", "smile", "happy"],
  "😃": ["smiley", "smile", "happy"],
  "😄": ["smile", "laugh", "happy"],
  "😁": ["beaming", "grin", "smile"],
  "😆": ["laugh", "squinting", "happy"],
  "😅": ["sweat smile", "relief", "nervous"],
  "🤣": ["rolling on the floor laughing", "rofl", "lol"],
  "😂": ["joy", "tears", "laugh", "lol"],
  "🙂": ["slightly smiling", "smile"],
  "😊": ["blush", "smile", "happy"],
  "😇": ["angel", "innocent", "halo"],
  "🥰": ["hearts", "love", "adore"],
  "😍": ["heart eyes", "love"],
  "🤩": ["star eyes", "excited"],
  "😘": ["kiss", "love"],
  "😋": ["yum", "delicious", "tasty"],
  "😛": ["tongue", "silly"],
  "🤔": ["thinking", "think", "hmm"],
  "🤗": ["hug", "hugs"],
  "🤫": ["shush", "quiet", "secret"],
  "😎": ["sunglasses", "cool"],
  "🥳": ["party", "celebrate", "birthday"],
  "😤": ["triumph", "frustrated"],
  "😱": ["scream", "shocked", "scared"],
  "🥺": ["pleading", "puppy eyes"],
  "😈": ["devil", "mischief"],
  "💀": ["skull", "dead"],
  "👻": ["ghost"],
  "👽": ["alien"],
  "🤖": ["robot", "bot"],
  "💩": ["poop", "pile of poo"],
  "🎃": ["pumpkin", "jack o lantern", "halloween"],
  "👋": ["wave", "hello", "hi"],
  "🤚": ["raised back hand", "hand"],
  "✋": ["raised hand", "high five", "stop"],
  "🖖": ["vulcan", "spock"],
  "🫱": ["rightwards hand", "right hand"],
  "🫲": ["leftwards hand", "left hand"],
  "👌": ["ok", "okay", "perfect"],
  "🤌": ["pinched fingers", "chef kiss"],
  "✌️": ["victory", "peace"],
  "🤞": ["crossed fingers", "luck"],
  "🫰": ["finger heart", "love"],
  "🤙": ["call me", "shaka"],
  "👈": ["point left", "back"],
  "👉": ["point right", "next"],
  "👆": ["point up", "up"],
  "👇": ["point down", "down"],
  "☝️": ["index up", "one"],
  "👍": ["thumbs up", "thumb up", "thumbsup", "+1", "like", "yes", "approve"],
  "👎": ["thumbs down", "thumb down", "thumbsdown", "-1", "dislike", "no"],
  "✊": ["raised fist", "fist", "solidarity"],
  "👊": ["fist bump", "punch"],
  "🤛": ["left fist", "fist bump"],
  "🤜": ["right fist", "fist bump"],
  "👏": ["clap", "applause", "bravo"],
  "🙌": ["raised hands", "celebrate", "praise"],
  "🫶": ["heart hands", "love"],
  "👐": ["open hands"],
  "🤝": ["handshake", "deal", "agreement"],
  "🙏": ["pray", "please", "thanks", "thank you"],
  "💪": ["muscle", "strong", "flex"],
  "🧠": ["brain", "smart"],
  "👀": ["eyes", "look", "watch"],
  "🐶": ["dog", "puppy"],
  "🐱": ["cat", "kitten"],
  "🐭": ["mouse"],
  "🐹": ["hamster"],
  "🐰": ["rabbit", "bunny"],
  "🦊": ["fox"],
  "🐻": ["bear"],
  "🐼": ["panda"],
  "🐨": ["koala"],
  "🐯": ["tiger"],
  "🦁": ["lion"],
  "🐸": ["frog"],
  "🐵": ["monkey"],
  "🐔": ["chicken", "hen"],
  "🐧": ["penguin"],
  "🐦": ["bird"],
  "🦄": ["unicorn"],
  "🐝": ["bee", "honeybee"],
  "🦋": ["butterfly"],
  "🐌": ["snail"],
  "🌸": ["cherry blossom", "flower", "spring"],
  "🌺": ["hibiscus", "flower"],
  "🌻": ["sunflower", "flower"],
  "🌹": ["rose", "flower"],
  "🌿": ["herb", "leaf", "plant"],
  "🍀": ["clover", "luck"],
  "🌴": ["palm tree", "tree", "tropical"],
  "🌲": ["evergreen", "tree"],
  "🌊": ["wave", "ocean", "water"],
  "🔥": ["fire", "flame", "hot"],
  "⭐": ["star", "favorite"],
  "🌈": ["rainbow"],
  "🍎": ["apple", "fruit"],
  "🍊": ["orange", "fruit"],
  "🍋": ["lemon", "fruit"],
  "🍌": ["banana", "fruit"],
  "🍉": ["watermelon", "fruit"],
  "🍇": ["grapes", "fruit"],
  "🍓": ["strawberry", "fruit"],
  "🫐": ["blueberries", "blueberry", "fruit"],
  "🍒": ["cherries", "cherry", "fruit"],
  "🥝": ["kiwi", "fruit"],
  "🍑": ["peach", "fruit"],
  "🥭": ["mango", "fruit"],
  "🍔": ["burger", "hamburger"],
  "🍕": ["pizza"],
  "🌮": ["taco"],
  "🍣": ["sushi"],
  "🍩": ["donut", "doughnut"],
  "🍪": ["cookie"],
  "🎂": ["cake", "birthday"],
  "🍰": ["shortcake", "cake", "dessert"],
  "☕": ["coffee", "tea", "hot drink"],
  "🍵": ["tea", "green tea"],
  "🧃": ["juice", "box"],
  "🍷": ["wine"],
  "🍺": ["beer"],
  "🥤": ["cup", "soda", "drink"],
  "🧊": ["ice", "cold"],
  "🍫": ["chocolate"],
  "🍿": ["popcorn"],
  "🥐": ["croissant", "bread"],
  "🥗": ["salad"],
  "🍜": ["ramen", "noodles"],
  "⚽": ["soccer", "football", "ball"],
  "🏀": ["basketball", "ball"],
  "🏈": ["american football", "football"],
  "⚾": ["baseball"],
  "🎾": ["tennis"],
  "🏐": ["volleyball"],
  "🎱": ["pool", "8 ball", "billiards"],
  "🏓": ["ping pong", "table tennis"],
  "🎯": ["target", "dart", "bullseye"],
  "🎮": ["video game", "controller", "gaming"],
  "🕹️": ["joystick", "arcade", "game"],
  "🎲": ["dice", "die", "random"],
  "🧩": ["puzzle", "jigsaw"],
  "🎭": ["theater", "mask", "drama"],
  "🎨": ["art", "palette", "paint"],
  "🎬": ["movie", "film", "clapper"],
  "🎤": ["microphone", "mic", "sing"],
  "🎧": ["headphones", "music", "audio"],
  "🎵": ["music", "note"],
  "🎹": ["piano", "keyboard", "music"],
  "🎸": ["guitar", "music"],
  "🥁": ["drum", "music"],
  "🏆": ["trophy", "winner"],
  "🥇": ["gold medal", "first place"],
  "🏅": ["medal"],
  "🎖️": ["military medal", "award"],
  "🏋️": ["weightlifting", "lifting", "gym"],
  "🚴": ["biking", "cycling", "bike"],
  "🧘": ["yoga", "meditation"],
  "🎪": ["circus", "tent"],
  "🎡": ["ferris wheel"],
  "🎢": ["roller coaster"],
  "🚗": ["car", "auto"],
  "🚕": ["taxi", "cab"],
  "🚌": ["bus"],
  "🚎": ["trolleybus"],
  "🏎️": ["race car", "racing"],
  "🚓": ["police car"],
  "🚑": ["ambulance"],
  "🚒": ["fire truck"],
  "✈️": ["airplane", "plane", "flight"],
  "🚀": ["rocket", "launch", "ship"],
  "🛸": ["ufo", "flying saucer"],
  "🚁": ["helicopter"],
  "⛵": ["sailboat", "boat"],
  "🚢": ["ship", "boat"],
  "🏠": ["house", "home"],
  "🏢": ["office", "building"],
  "🏗️": ["construction", "crane"],
  "🏰": ["castle"],
  "🗽": ["statue of liberty", "liberty"],
  "🗼": ["tower", "tokyo tower"],
  "⛩️": ["shrine", "torii"],
  "🕌": ["mosque"],
  "🌍": ["earth", "globe", "world", "europe africa"],
  "🌎": ["earth", "globe", "world", "americas"],
  "🌏": ["earth", "globe", "world", "asia australia"],
  "🗺️": ["map", "world map"],
  "🏔️": ["mountain", "snow"],
  "🏝️": ["island", "beach"],
  "🏖️": ["beach", "umbrella"],
  "🌅": ["sunrise"],
  "🌄": ["sunrise over mountains", "mountains"],
  "🌉": ["bridge", "night"],
  "💡": ["light bulb", "lightbulb", "idea", "hint"],
  "🔦": ["flashlight", "torch"],
  "🕯️": ["candle"],
  "📱": ["phone", "mobile", "iphone"],
  "💻": ["laptop", "computer"],
  "⌨️": ["keyboard"],
  "🖥️": ["desktop", "monitor", "computer"],
  "🖨️": ["printer"],
  "📷": ["camera", "photo"],
  "🎥": ["video camera", "movie"],
  "📺": ["tv", "television"],
  "📻": ["radio"],
  "⏰": ["alarm clock", "clock", "time"],
  "🔔": ["bell", "notification"],
  "📣": ["megaphone", "announcement"],
  "📢": ["loudspeaker", "announcement"],
  "💎": ["diamond", "gem"],
  "🔑": ["key"],
  "🗝️": ["old key"],
  "🔒": ["lock", "locked"],
  "🔓": ["unlock", "unlocked"],
  "📦": ["package", "box"],
  "📫": ["mailbox", "mail"],
  "✏️": ["pencil", "edit"],
  "📝": ["memo", "note", "write"],
  "📚": ["books", "library"],
  "📖": ["book", "read"],
  "🔗": ["link", "chain"],
  "📎": ["paperclip", "attachment"],
  "✂️": ["scissors", "cut"],
  "🗑️": ["trash", "delete", "bin"],
  "🧰": ["toolbox", "tools"],
  "❤️": ["red heart", "heart", "love"],
  "🧡": ["orange heart", "heart", "love"],
  "💛": ["yellow heart", "heart", "love"],
  "💚": ["green heart", "heart", "love"],
  "💙": ["blue heart", "heart", "love"],
  "💜": ["purple heart", "heart", "love"],
  "🖤": ["black heart", "heart", "love"],
  "🤍": ["white heart", "heart", "love"],
  "💔": ["broken heart", "heartbreak"],
  "❣️": ["heart exclamation"],
  "💕": ["two hearts", "love"],
  "💞": ["revolving hearts", "love"],
  "💓": ["beating heart", "love"],
  "💗": ["growing heart", "love"],
  "💖": ["sparkling heart", "love"],
  "💘": ["cupid", "heart", "love"],
  "💝": ["gift heart", "heart"],
  "✅": ["check", "checkmark", "done", "yes"],
  "❌": ["x", "cross", "no", "cancel"],
  "⭕": ["circle", "o"],
  "❗": ["exclamation", "important"],
  "❓": ["question", "help"],
  "💯": ["hundred", "100", "perfect"],
  "🔴": ["red circle"],
  "🟠": ["orange circle"],
  "🟡": ["yellow circle"],
  "🟢": ["green circle"],
  "🔵": ["blue circle"],
  "🟣": ["purple circle"],
  "⚫": ["black circle"],
  "⚪": ["white circle"],
  "🏁": ["checkered flag", "finish"],
};

// Flattened for search
const ALL_EMOJI_ENTRIES = EMOJI_CATEGORIES.flatMap((cat) =>
  cat.emojis.map((emoji) => ({
    emoji,
    category: cat.name,
    searchText: buildEmojiSearchText(emoji, cat.name),
  })),
);

function normalizeEmojiSearchText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\ufe0f/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildEmojiSearchText(emoji: string, category: string) {
  const normalized = normalizeEmojiSearchText(
    [emoji, category, ...(EMOJI_SEARCH_ALIASES[emoji] ?? [])].join(" "),
  );
  return `${normalized} ${normalized.replace(/\s+/g, "")}`;
}

export function filterEmojiCategories(search: string): EmojiCategory[] {
  const normalizedQuery = normalizeEmojiSearchText(search);
  if (!normalizedQuery) return EMOJI_CATEGORIES;

  const compactQuery = normalizedQuery.replace(/\s+/g, "");
  const queryParts = normalizedQuery.split(" ");
  const matchingEmojis = ALL_EMOJI_ENTRIES.filter((entry) => {
    return (
      entry.searchText.includes(normalizedQuery) ||
      entry.searchText.includes(compactQuery) ||
      queryParts.every((part) => entry.searchText.includes(part))
    );
  });

  if (matchingEmojis.length === 0) return [];

  // Group back into categories
  const grouped = new Map<string, string[]>();
  for (const entry of matchingEmojis) {
    if (!grouped.has(entry.category)) grouped.set(entry.category, []);
    grouped.get(entry.category)!.push(entry.emoji);
  }

  return Array.from(grouped, ([name, emojis]) => ({ name, emojis }));
}

interface EmojiPickerProps {
  icon: string | null;
  onSelect: (emoji: string | null) => void;
  defaultIcon?: ReactNode;
  defaultIconLabel?: string;
  variant?: "page" | "compact";
  portalled?: boolean;
}

export function EmojiPicker({
  icon,
  onSelect,
  defaultIcon,
  defaultIconLabel = "page",
  variant = "page",
  portalled = true,
}: EmojiPickerProps) {
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
    return filterEmojiCategories(search);
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
      <Tooltip>
        <PopoverTrigger asChild>
          <TooltipTrigger asChild>
            {icon ? (
              <button
                type="button"
                aria-label="Change page icon"
                className={
                  variant === "compact"
                    ? "flex size-9 shrink-0 items-center justify-center rounded-md text-xl leading-none hover:bg-accent/50"
                    : "text-5xl leading-none cursor-pointer hover:bg-accent/50 rounded-md p-1 -ml-1"
                }
              >
                {icon}
              </button>
            ) : defaultIcon ? (
              <button
                type="button"
                aria-label={`Change ${defaultIconLabel} icon`}
                className={
                  variant === "compact"
                    ? "flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50"
                    : "flex size-14 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 -ml-1"
                }
              >
                {defaultIcon}
              </button>
            ) : (
              <button
                type="button"
                aria-label="Add page icon"
                className={
                  variant === "compact"
                    ? "flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-accent/50 hover:text-muted-foreground data-[state=open]:bg-accent/50"
                    : "flex items-center gap-1.5 text-sm text-muted-foreground/60 hover:text-muted-foreground hover:bg-accent/50 rounded-md px-1.5 py-1 -ml-1.5 cursor-pointer opacity-0 group-hover/title:opacity-100 data-[state=open]:opacity-100"
                }
              >
                <IconMoodSmile size={18} />
                {variant === "page" ? <span>Add icon</span> : null}
              </button>
            )}
          </TooltipTrigger>
        </PopoverTrigger>
        <TooltipContent>
          {icon || defaultIcon ? "Change icon" : "Add icon"}
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-80 p-0" portalled={portalled}>
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
                      type="button"
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
              type="button"
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
