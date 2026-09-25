import enUSMessages from "@/i18n/en-US";
import AnalysisDetail from "@/pages/analyses/AnalysisDetail";

export function meta() {
  return [{ title: enUSMessages.routeTitles.analysis }];
}

export default function AnalysisDetailRoute() {
  return <AnalysisDetail />;
}
