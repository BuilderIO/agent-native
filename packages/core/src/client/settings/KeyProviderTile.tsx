/**
 * <KeyProviderTile /> — one provider tile in the API keys empty state: a
 * logo well and short name, click to open that key's row.
 */

import {
  IconBrandFigma,
  IconBrandGithub,
  IconBrandGoogle,
  IconBrandNotion,
  IconBrandSentry,
  IconBrandSlack,
  IconBrandStripe,
  IconBrandOpenai,
} from "@tabler/icons-react";

const NAME_SUFFIXES = [
  " project API key",
  " access token",
  " API key",
  " token",
];

export function shortProviderName(label: string): string {
  const lower = label.toLowerCase();
  for (const suffix of NAME_SUFFIXES) {
    if (lower.endsWith(suffix.toLowerCase())) {
      return label.slice(0, label.length - suffix.length);
    }
  }
  return label;
}

function brandIcon(secretKey: string) {
  if (secretKey.startsWith("OPENAI_")) return IconBrandOpenai;
  if (secretKey.startsWith("GITHUB_")) return IconBrandGithub;
  if (secretKey.startsWith("FIGMA_")) return IconBrandFigma;
  if (secretKey.startsWith("GOOGLE_")) return IconBrandGoogle;
  if (secretKey.startsWith("NOTION_")) return IconBrandNotion;
  if (secretKey.startsWith("SLACK_")) return IconBrandSlack;
  if (secretKey.startsWith("SENTRY_")) return IconBrandSentry;
  if (secretKey.startsWith("STRIPE_")) return IconBrandStripe;
  return null;
}

export interface KeyProviderTileProps {
  label: string;
  secretKey: string;
  onClick: () => void;
}

export function KeyProviderTile({
  label,
  secretKey,
  onClick,
}: KeyProviderTileProps) {
  const name = shortProviderName(label);
  const Icon = brandIcon(secretKey);

  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-border bg-background px-2 py-2.5 flex flex-col items-center gap-1.5 text-[10px] text-muted-foreground hover:bg-accent/40 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="size-7 rounded-md bg-accent/60 flex items-center justify-center text-foreground">
        {Icon ? (
          <Icon size={16} />
        ) : (
          <span className="text-[11px] font-semibold">
            {name.charAt(0).toUpperCase()}
          </span>
        )}
      </span>
      <span className="w-full truncate text-center">{name}</span>
    </button>
  );
}
