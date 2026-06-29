import { messagesByLocale } from "@/i18n-data";
import AnalysesList from "@/pages/analyses/AnalysesList";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.analyses }];
}

export default function AnalysesRoute() {
  return <AnalysesList />;
}
