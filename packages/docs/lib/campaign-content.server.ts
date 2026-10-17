import {
  parseCampaignContent,
  type CampaignContent,
  type CampaignSources,
} from "./campaign-content";

const bundledSources: CampaignSources = {
  useCases: import.meta.glob<string>("../content/use-cases/*.yaml", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
  articles: import.meta.glob<string>("../content/articles/*.md", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
};

export function loadCampaignContent(): CampaignContent {
  return parseCampaignContent(bundledSources);
}
