import enUSMessages from "@/i18n/en-US";
import RoutePerformancePage from "@/pages/sessions/RoutePerformancePage";

export function meta() {
  return [{ title: enUSMessages.routeTitles.routePerformance }];
}

export default function RoutePerformanceRoute() {
  return <RoutePerformancePage />;
}
