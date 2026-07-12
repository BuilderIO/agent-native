import { InboxPage } from "@/pages/InboxPage";

const SEO_TITLE =
  "Agent-Native Mail - Open Source AI email client and Superhuman alternative";
const SEO_DESCRIPTION =
  "Open Source AI email client for Gmail triage, drafting, organization, follow-ups, and inbox workflows built around shared actions.";

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

export default function ViewRoute() {
  return <InboxPage />;
}
