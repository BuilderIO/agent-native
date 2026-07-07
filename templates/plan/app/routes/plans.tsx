import { Spinner } from "@/components/ui/spinner";
import { APP_TITLE } from "@/lib/app-config";
import { PlansPage } from "@/pages/PlansPage";

export function meta() {
  return [
    { title: `${APP_TITLE} Plans` },
    {
      name: "description",
      content:
        "Review coding-agent plans as interactive HTML documents with diagrams, wireframes, prototypes, and annotations.",
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

export default function PlansRoute() {
  return <PlansPage />;
}
