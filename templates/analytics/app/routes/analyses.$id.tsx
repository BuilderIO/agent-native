import AnalysisDetail from "@/pages/analyses/AnalysisDetail";
import { Spinner } from "@/components/ui/spinner";

export function meta() {
  return [{ title: "Analysis — Analytics" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <Spinner className="size-8 text-foreground" />
    </div>
  );
}

export default function AnalysisDetailRoute() {
  return <AnalysisDetail />;
}
