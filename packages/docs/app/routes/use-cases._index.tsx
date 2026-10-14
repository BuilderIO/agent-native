import { useLoaderData } from "react-router";

import { USE_CASES_BASE } from "../../lib/campaign-content";
import { loadCampaignContent } from "../../lib/campaign-content.server";
import { publicUseCase } from "../components/campaign/public-content";
import { UseCasesIndex } from "../components/campaign/use-cases";
import enUS from "../i18n/en-US";
import { campaignMeta } from "../lib/campaign-seo";

export const meta = () =>
  campaignMeta(
    enUS.campaign.useCases,
    enUS.campaign.useCasesIntro,
    USE_CASES_BASE,
  );
export function loader() {
  return { items: loadCampaignContent().useCases.map(publicUseCase) };
}
export default function UseCasesRoute() {
  const { items } = useLoaderData<typeof loader>();
  return <UseCasesIndex items={items} />;
}
