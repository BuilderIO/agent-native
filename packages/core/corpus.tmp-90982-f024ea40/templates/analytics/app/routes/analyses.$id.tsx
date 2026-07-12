import { messagesByLocale } from "@/i18n-data";
import AnalysisDetail from "@/pages/analyses/AnalysisDetail";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.analysis }];
}

export default function AnalysisDetailRoute() {
  return <AnalysisDetail />;
}
