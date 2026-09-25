import enUSMessages from "@/i18n/en-US";
import MonitoringPage from "@/pages/monitoring/MonitoringPage";

export function meta() {
  return [{ title: enUSMessages.routeTitles.monitoring }];
}

export default function MonitoringRoute() {
  return <MonitoringPage />;
}
