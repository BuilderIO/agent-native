import AnalysesList from "@/pages/analyses/AnalysesList";

export function meta() {
  return [{ title: "Analyses — Analytics" }];
}

export default function AnalysesRoute() {
  return <AnalysesList />;
}
