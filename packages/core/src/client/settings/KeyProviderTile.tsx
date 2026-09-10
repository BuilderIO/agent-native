/**
 * <KeyProviderTile /> — one provider tile in the API keys empty state: a
 * logo well and short name, click to open that key's row.
 */

import { mcpIntegrationLogo } from "../resources/mcp-integration-logos.js";
import { McpIntegrationLogo } from "../resources/McpIntegrationLogo.js";

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

/** Env-var prefix → logo id in the `LOGOS` map, longest/most-specific first. */
const PREFIX_LOGO_IDS: Array<[string, string]> = [
  ["OPENAI_", "openai"],
  ["ANTHROPIC_", "anthropic"],
  ["OPENROUTER_", "openrouter"],
  ["GOOGLE_GENERATIVE_AI_", "google-gemini"],
  ["GOOGLE_", "google-workspace"],
  ["GROQ_", "groq"],
  ["MISTRAL_", "mistral"],
  ["COHERE_", "cohere"],
  ["GITHUB_", "github"],
  ["FIGMA_", "figma"],
  ["NOTION_", "notion"],
  ["SLACK_", "slack"],
  ["SENTRY_", "sentry"],
  ["STRIPE_", "stripe"],
  ["HUBSPOT_", "hubspot"],
  ["SALESFORCE_", "salesforce"],
  ["JIRA_", "jira"],
  ["POSTHOG_", "posthog"],
  ["BRAVE_SEARCH_", "brave"],
  ["TAVILY_", "tavily"],
  ["EXA_", "exa"],
  ["FIRECRAWL_", "firecrawl"],
];

export function providerLogoForKey(
  secretKey: string,
): { id: string; logoUrl: string } | null {
  const match = PREFIX_LOGO_IDS.find(([prefix]) =>
    secretKey.startsWith(prefix),
  );
  if (!match) return null;
  const [, id] = match;
  const logoUrl = mcpIntegrationLogo(id);
  if (!logoUrl) return null;
  return { id, logoUrl };
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
  const provider = providerLogoForKey(secretKey);

  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-border bg-background px-2 py-2.5 flex flex-col items-center gap-1.5 text-[10px] text-muted-foreground hover:bg-accent/40 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <McpIntegrationLogo
        name={name}
        logoUrl={provider?.logoUrl ?? ""}
        integrationId={provider?.id}
        className="size-9"
      />
      <span className="w-full truncate text-center">{name}</span>
    </button>
  );
}
