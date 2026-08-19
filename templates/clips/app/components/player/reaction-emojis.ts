export const REACTION_EMOJIS = [
  "👍",
  "❤️",
  "🔥",
  "👏",
  "🎉",
  "😂",
  "🤯",
  "👀",
] as const;

export const REACTION_NAMES: Record<
  (typeof REACTION_EMOJIS)[number],
  string
> = {
  "👍": "thumbs up",
  "❤️": "heart",
  "🔥": "fire",
  "👏": "clap",
  "🎉": "celebrate",
  "😂": "laugh",
  "🤯": "mind blown",
  "👀": "eyes",
};
