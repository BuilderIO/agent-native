import {
  parseSiteContent,
  type SiteContent,
  type SiteContentSources,
} from "./site-content";

const bundledSources: SiteContentSources = {
  useCases: import.meta.glob<string>("../content/use-cases/*.yaml", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
  useCaseTranslations: import.meta.glob<string>(
    "../content/use-cases/*/*.yaml",
    { query: "?raw", import: "default", eager: true },
  ),
  articles: import.meta.glob<string>("../content/articles/*.md", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
  articleTranslations: import.meta.glob<string>("../content/articles/*/*.md", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
};

export function loadSiteContent(): SiteContent {
  return parseSiteContent(bundledSources);
}
