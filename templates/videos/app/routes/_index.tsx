import Studio from "@/pages/Index";
import { Spinner } from "@/components/ui/spinner";

export function meta() {
  return [
    { title: "Videos" },
    {
      name: "description",
      content:
        "Agent-native video editing — generate animated React compositions with Remotion and edit them on a timeline.",
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
