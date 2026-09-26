export const EMOJI_CATEGORIES = [
  "smileys-emotion",
  "people-body",
  "animals-nature",
  "food-drink",
  "travel-places",
  "activities",
  "objects",
  "symbols",
  "flags",
] as const;

export type EmojiCategory = (typeof EMOJI_CATEGORIES)[number];

export interface EmojiCatalogEntry {
  emoji: string;
  label: string;
  search: string;
  category: EmojiCategory;
  order: number;
  skinTone?: number | number[];
}

interface EmojibaseEntry {
  emoji?: string;
  label?: string;
  tags?: string[];
  group?: number;
  order?: number;
  tone?: number | number[];
  skins?: EmojibaseEntry[];
}

type ViteImportMeta = ImportMeta & { env: { SSR: boolean; MODE: string } };

let emojiCatalogPromise: Promise<EmojiCatalogEntry[]> | undefined;

export function loadEmojiCatalog(): Promise<EmojiCatalogEntry[]> {
  if (
    (import.meta as ViteImportMeta).env.SSR &&
    (import.meta as ViteImportMeta).env.MODE !== "test"
  ) {
    throw new Error("Emoji catalog is available only in the browser");
  }
  emojiCatalogPromise ??= import("emojibase-data/en/data.json")
    .then((module) => {
      const rows = (module.default ?? module) as EmojibaseEntry[];
      return rows
        .flatMap((row) => {
          // Components (including regional letters) are not standalone emoji choices.
          if (
            row.group === undefined ||
            row.group === 2 ||
            row.order === undefined
          ) {
            return [];
          }
          const category =
            EMOJI_CATEGORIES[row.group > 2 ? row.group - 1 : row.group];
          if (!category) throw new Error(`Unknown emoji group: ${row.group}`);
          const variants = [row, ...(row.skins ?? [])];
          return variants.flatMap((variant) => {
            if (!variant.emoji) return [];
            const label = variant.label ?? row.label ?? variant.emoji;
            return [
              {
                emoji: variant.emoji,
                label,
                search: [label, ...(row.tags ?? [])].join(" ").toLowerCase(),
                category,
                order: variant.order ?? row.order!,
                ...(variant.tone === undefined
                  ? {}
                  : { skinTone: variant.tone }),
              },
            ];
          });
        })
        .sort((left, right) => left.order - right.order);
    })
    .catch((error) => {
      emojiCatalogPromise = undefined;
      throw error;
    });
  return emojiCatalogPromise;
}
