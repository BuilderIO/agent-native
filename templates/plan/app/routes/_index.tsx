import { Spinner } from "@agent-native/toolkit/ui/spinner";

import { APP_TITLE } from "@/lib/app-config";
import { PlanChatPage } from "@/pages/PlanChatPage";

const SEO_TITLE = `${APP_TITLE} - Open Source visual planning and PR recaps for coding agents`;
const SEO_DESCRIPTION =
  "Open Source planning workspace for coding agents with visual plans, PR recaps, diagrams, wireframes, API specs, and prototypes.";

export function meta() {
  return [
    { title: SEO_TITLE },
    {
      name: "description",
      content: SEO_DESCRIPTION,
    },
    { property: "og:title", content: SEO_TITLE },
    { property: "og:description", content: SEO_DESCRIPTION },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: SEO_TITLE },
    { name: "twitter:description", content: SEO_DESCRIPTION },
  ];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <Spinner className="size-8 text-foreground" />
    </div>
  );
}

export default function IndexPage() {
  return <PlanChatPage />;
}
