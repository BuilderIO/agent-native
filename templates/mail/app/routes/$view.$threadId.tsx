import { InboxPage } from "@/pages/InboxPage";

const SEO_TITLE =
  "Agent-Native Mail - Open Source AI email client and Superhuman alternative";
const SEO_DESCRIPTION =
  "Read, triage, draft, and organize email with an AI mail client built around shared actions and agent context.";

export function meta() {
  return [
    { title: SEO_TITLE },
    { name: "description", content: SEO_DESCRIPTION },
    { property: "og:title", content: SEO_TITLE },
    { property: "og:description", content: SEO_DESCRIPTION },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: SEO_TITLE },
    { name: "twitter:description", content: SEO_DESCRIPTION },
  ];
}

export default function ThreadRoute() {
  return <InboxPage />;
}
