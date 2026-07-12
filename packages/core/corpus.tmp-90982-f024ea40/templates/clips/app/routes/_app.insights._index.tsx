import { InsightsHub } from "@/components/workspace/insights-hub";
import enMessages from "@/i18n/en-US";

export function meta() {
  return [{ title: enMessages.clipsFinalRaw.insightsPageTitle }];
}

export default function InsightsIndexRoute() {
  return <InsightsHub />;
}
