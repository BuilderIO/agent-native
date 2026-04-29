import DataSources from "@/pages/DataSources";
import { Spinner } from "@/components/ui/spinner";

export function meta() {
  return [{ title: "Data Sources — Analytics" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <Spinner className="size-8 text-foreground" />
    </div>
  );
}

export default function DataSourcesRoute() {
  return <DataSources />;
}
