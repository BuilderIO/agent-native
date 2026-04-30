import Index from "@/pages/Index";
import { Spinner } from "@/components/ui/spinner";

export function meta() {
  return [
    { title: "Analytics" },
    {
      name: "description",
      content:
        "Agent-native product analytics — connect data sources, generate charts from natural language, and explore funnels and cohorts.",
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
