import { DefaultSpinner } from "@agent-native/core/client/ui";

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
  return <DefaultSpinner />;
}

export default function PlansRoute() {
  return <PlansPage />;
}
