import AnalysesList from "@/pages/analyses/AnalysesList";
import { Spinner } from "@/components/ui/spinner";

export function meta() {
  return [{ title: "Analyses — Analytics" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <Spinner className="size-8 text-foreground" />
    </div>
  );
}

export default function AnalysesRoute() {
  return <AnalysesList />;
}
