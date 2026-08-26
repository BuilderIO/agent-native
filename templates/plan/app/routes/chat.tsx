import { Spinner } from "@/components/ui/spinner";
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
    <div className="flex h-screen w-full items-center justify-center">
      <Spinner className="size-8 text-foreground" />
    </div>
  );
}

export default function ChatRoute() {
  return <PlanChatPage />;
}
