import Index from "@/pages/Index";
import { Spinner } from "@/components/ui/spinner";

export function meta() {
  return [
    { title: "Agent-Native Analytics" },
    {
      name: "description",
      content:
        "Your AI agent queries your data sources, builds dashboards, and answers business questions alongside you.",
    },
  ];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <Spinner className="size-8 text-foreground" />
    </div>
  );
}

export default function IndexRoute() {
  return <Index />;
}
