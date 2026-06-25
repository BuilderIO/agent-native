import { messagesByLocale } from "@/i18n-data";
import OverviewPage from "@/pages/overview/OverviewPage";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.overview }];
}

export default function OverviewRoute() {
  return <OverviewPage />;
}
