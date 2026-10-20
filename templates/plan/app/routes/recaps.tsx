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
  return <PlansPage />;
}

export default function RecapsRoute() {
  return <PlansPage />;
}
