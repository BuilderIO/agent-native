import Index from "@/pages/Index";
import { Spinner } from "@/components/ui/spinner";

export function meta() {
  return [
    { title: "Agent-Native Slides" },
    {
      name: "description",
      content:
        "Your AI agent builds, edits, and refines presentations alongside you.",
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
