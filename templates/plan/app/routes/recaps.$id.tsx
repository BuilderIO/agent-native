import { Spinner } from "@/components/ui/spinner";
import { PlansPage } from "@/pages/PlansPage";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [
    { title: `${APP_TITLE} Recap` },
    {
      name: "description",
      content:
        "Review a code change as a high-altitude visual recap with diagrams, wireframes, and before/after comparisons.",
    },
  ];
}

export function HydrateFallback() {
  return (
    <div className="flex h-screen w-full items-center justify-center">
      <Spinner className="size-8 text-foreground" />
    </div>
  );
}

export default function RecapRoute() {
  return <PlansPage />;
}
