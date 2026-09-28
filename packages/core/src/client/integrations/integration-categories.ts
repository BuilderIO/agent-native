import type { DefaultMcpIntegration } from "../resources/mcp-integration-catalog.js";

/** Catalog groups on the Integrations page, in page order (spec §5.4). */
export const INTEGRATION_CATEGORIES = [
  "engineering",
  "design",
  "productivity",
  "sales",
  "support",
  "analytics",
  "finance",
  "other",
] as const;

export type IntegrationCategory = (typeof INTEGRATION_CATEGORIES)[number];

// Keyed by catalog id. An id missing here (a template's own preset) lands in
// "other" rather than disappearing from the page.
const CATEGORY_BY_ID: Record<string, IntegrationCategory> = {
  github: "engineering",
  gitlab: "engineering",
  linear: "engineering",
  atlassian: "engineering",
  sentry: "engineering",
  semgrep: "engineering",
  vercel: "engineering",
  netlify: "engineering",
  cloudflare: "engineering",
  supabase: "engineering",
  neon: "engineering",
  grafana: "engineering",
  context7: "engineering",
  figma: "design",
  canva: "design",
  webflow: "design",
  notion: "productivity",
  slack: "productivity",
  asana: "productivity",
  monday: "productivity",
  box: "productivity",
  granola: "productivity",
  zapier: "productivity",
  exa: "productivity",
  hubspot: "sales",
  apollo: "sales",
  gong: "sales",
  "common-room": "sales",
  intercom: "support",
  pylon: "support",
  amplitude: "analytics",
  fullstory: "analytics",
  sigma: "analytics",
  stripe: "finance",
  paypal: "finance",
};

/** Tiles a category shows before "See {A}, {B}, and more". */
export const INTEGRATION_CATEGORY_PREVIEW_COUNT = 4;

export function integrationCategory(id: string): IntegrationCategory {
  return CATEGORY_BY_ID[id.toLowerCase()] ?? "other";
}

export interface IntegrationCategoryGroup {
  category: IntegrationCategory;
  integrations: DefaultMcpIntegration[];
}

/** Non-empty categories in page order, each keeping the catalog's order. */
export function groupIntegrationsByCategory(
  integrations: readonly DefaultMcpIntegration[],
): IntegrationCategoryGroup[] {
  const byCategory = new Map<IntegrationCategory, DefaultMcpIntegration[]>();
  for (const integration of integrations) {
    const category = integrationCategory(integration.id);
    const list = byCategory.get(category);
    if (list) list.push(integration);
    else byCategory.set(category, [integration]);
  }
  return INTEGRATION_CATEGORIES.flatMap((category) => {
    const list = byCategory.get(category);
    return list ? [{ category, integrations: list }] : [];
  });
}

export function matchesIntegrationQuery(
  integration: DefaultMcpIntegration,
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) return true;
  return [
    integration.name,
    integration.provider,
    integration.description,
    integration.useCase,
    ...(integration.keywords ?? []),
    ...(integration.aliases ?? []),
    ...(integration.brandAliases ?? []),
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}
