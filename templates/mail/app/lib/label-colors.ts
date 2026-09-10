export type LabelStyle = {
  bg: string;
  text: string;
};

const labelColors: Record<string, LabelStyle> = {
  automated: {
    bg: "bg-[hsl(var(--mail-label-automated-bg))]",
    text: "text-[hsl(var(--mail-label-automated-text))]",
  },
  social: {
    bg: "bg-[hsl(var(--mail-label-social-bg))]",
    text: "text-[hsl(var(--mail-label-social-text))]",
  },
  updates: {
    bg: "bg-[hsl(var(--mail-label-updates-bg))]",
    text: "text-[hsl(var(--mail-label-updates-text))]",
  },
  promotions: {
    bg: "bg-[hsl(var(--mail-label-promotions-bg))]",
    text: "text-[hsl(var(--mail-label-promotions-text))]",
  },
  forums: {
    bg: "bg-[hsl(var(--mail-label-forums-bg))]",
    text: "text-[hsl(var(--mail-label-forums-text))]",
  },
  finance: {
    bg: "bg-[hsl(var(--mail-label-finance-bg))]",
    text: "text-[hsl(var(--mail-label-finance-text))]",
  },
  travel: {
    bg: "bg-[hsl(var(--mail-label-travel-bg))]",
    text: "text-[hsl(var(--mail-label-travel-text))]",
  },
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
