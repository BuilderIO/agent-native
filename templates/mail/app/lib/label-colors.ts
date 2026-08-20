export type LabelStyle = {
  bg: string;
  text: string;
};

const labelColors: Record<string, LabelStyle> = {
  automated: { bg: "bg-pink-500/20", text: "text-pink-700 dark:text-pink-300" },
  social: { bg: "bg-blue-500/20", text: "text-blue-700 dark:text-blue-300" },
  updates: {
    bg: "bg-yellow-500/20",
    text: "text-yellow-700 dark:text-yellow-300",
  },
  promotions: {
    bg: "bg-green-500/20",
    text: "text-green-700 dark:text-green-300",
  },
  forums: {
    bg: "bg-sky-500/20",
    text: "text-sky-700 dark:text-sky-300",
  },
  finance: {
    bg: "bg-emerald-500/20",
    text: "text-emerald-700 dark:text-emerald-300",
  },
  travel: { bg: "bg-cyan-500/20", text: "text-cyan-700 dark:text-cyan-300" },
};

export function getLabelStyle(labelId: string): LabelStyle {
  const normalized = labelId.toLowerCase().replace(/^label:/, "");
  if (labelColors[normalized]) return labelColors[normalized];

  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = normalized.charCodeAt(i) + ((hash << 5) - hash);
  }
  const options = Object.values(labelColors);
  return options[Math.abs(hash) % options.length];
}
