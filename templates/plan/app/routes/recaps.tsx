import { Spinner } from "@agent-native/toolkit/ui/spinner";

import { APP_TITLE } from "@/lib/app-config";
import { PlansPage } from "@/pages/PlansPage";

export function meta() {
  return [
    { title: `${APP_TITLE} Recaps` },
    {
      name: "description",
      content:
        "Review merged PR visual recaps with diagrams, wireframes, API specs, and annotations.",
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

export default function RecapsRoute() {
  return <PlansPage />;
}
