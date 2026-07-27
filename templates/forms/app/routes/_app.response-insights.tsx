import messages from "@/i18n/en-US";
import { ResponseInsightsPage } from "@/pages/ResponseInsightsPage";

export function meta() {
  return [
    { title: messages.routeTitles.responseInsightsForms },
    {
      name: "description",
      content: messages.routeDescriptions.responseInsights,
    },
  ];
}

export default function ResponseInsightsRoute() {
  return <ResponseInsightsPage />;
}
