import { InsightsHub } from "@/components/workspace/insights-hub";

export function meta() {
  return [{ title: "Insights · Clips" }];
}

export default function InsightsIndexRoute() {
  return <InsightsHub />;
}
