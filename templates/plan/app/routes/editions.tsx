import { DefaultSpinner } from "@agent-native/core/client/ui";

import { APP_TITLE } from "@/lib/app-config";
import { EditionPage } from "@/pages/EditionPage";

export function meta() {
  return [
    { title: `${APP_TITLE} Editions` },
    {
      name: "description",
      content:
        "Read the engineering newspaper: what shipped across the org each day, written from merged PR recaps.",
    },
  ];
}

export function HydrateFallback() {
  return <DefaultSpinner />;
}

export default function EditionsRoute() {
  return <EditionPage />;
}
