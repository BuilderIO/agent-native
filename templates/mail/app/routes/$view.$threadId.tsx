import { data, useParams } from "react-router";

import messages from "@/i18n/en-US";
import { InboxPage } from "@/pages/InboxPage";
import { NotFound } from "@/pages/NotFound";

import { isKnownMailView } from "./$view";

const SEO_TITLE =
  "Mail - Open Source AI email client and Superhuman alternative";
const SEO_DESCRIPTION =
  "Open Source AI email client for Gmail triage, drafting, organization, follow-ups, and inbox workflows built around shared actions.";

// Same rationale as $view.tsx's loader: this route also matches unknown
// `/:view/:threadId` paths and must not serve them as 200.
export function loader({ params }: { params: { view?: string } }) {
  if (!isKnownMailView(params.view)) {
    return data(null, { status: 404 });
  }
  return null;
}

export function meta({ params }: { params: { view?: string } }) {
  if (!isKnownMailView(params.view)) {
    return [{ title: messages.mail.routeTitles.notFound }];
  }
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
  const { view } = useParams<{ view: string }>();
  if (!isKnownMailView(view)) {
    return <NotFound />;
  }
  return <InboxPage />;
}
