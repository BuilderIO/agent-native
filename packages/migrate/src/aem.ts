import type { AemSourceMode } from "./types.js";

export const AEM_SOURCE_MODES: AemSourceMode[] = [
  {
    id: "crawl",
    label: "Crawl",
    description:
      "Inventory live URLs, sitemap, screenshots, SEO metadata, and redirect candidates when repository or AEM access is unavailable.",
  },
  {
    id: "api",
    label: "API",
    description:
      "Extract AEM GraphQL Content Fragments and DAM metadata when headless APIs are available.",
  },
  {
    id: "package",
    label: "Package",
    description:
      "Parse Vault/JCR content packages for pages, content nodes, assets, and metadata.",
  },
  {
    id: "code",
    label: "Code",
    description:
      "Analyze HTL components, dialogs, templates, policies, and Sling model references.",
  },
  {
    id: "enterprise",
    label: "Enterprise",
    description:
      "Combine all available AEM modes and emit confidence reports for gaps that need human mapping.",
  },
];
