import Studio from "@/pages/Index";
import { Spinner } from "@/components/ui/spinner";

export function meta() {
  return [
    { title: "Agent-Native Videos" },
    {
      name: "description",
      content:
        "Your AI agent builds, animates, and refines programmatic videos alongside you.",
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
  return <Studio />;
}
