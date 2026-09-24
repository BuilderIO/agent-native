import { messagesByLocale } from "@/i18n-data";
import MonitoringPage from "@/pages/monitoring/MonitoringPage";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.monitoring }];
}

export default function MonitoringRoute() {
  return <MonitoringPage />;
}
