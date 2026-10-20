import { useParams } from "react-router";

import { APP_TITLE } from "@/lib/app-config";
import { PlanChatHydrateFallback, PlanChatPage } from "@/pages/PlanChatPage";

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
  return <PlanChatHydrateFallback />;
}

// `/chat` and `/chat/:threadId` (chat.$threadId.tsx re-exports this module)
// must render this same component, so a submit that moves the URL does not
// remount the chat.
export default function ChatRoute() {
  const { threadId } = useParams();
  return <PlanChatPage threadId={threadId ?? null} />;
}
