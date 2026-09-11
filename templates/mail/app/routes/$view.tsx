import { data, useParams } from "react-router";

import messages from "@/i18n/en-US";
import { InboxPage } from "@/pages/InboxPage";
import { NotFound } from "@/pages/NotFound";

const SEO_TITLE =
  "Mail - Open Source AI email client and Superhuman alternative";
const SEO_DESCRIPTION =
  "Open Source AI email client for Gmail triage, drafting, organization, follow-ups, and inbox workflows built around shared actions.";

// The only `view` values the app itself ever links to (sidebar hrefs,
// navigate.ts). This is a sibling of the $.tsx splat 404 route, and
// react-router always scores a `:view` dynamic segment above a `*` splat at
// the same depth — so an arbitrary single-segment URL matches here first.
// Rejecting anything outside this list is what lets a typo'd/unknown path
// still reach NotFound instead of silently rendering the inbox shell.
const KNOWN_MAIL_VIEWS = new Set([
  "inbox",
  "unread",
  "starred",
  "snoozed",
  "scheduled",
  "sent",
  "drafts",
  "archive",
  "trash",
  "all",
]);

export function isKnownMailView(view: string | undefined): boolean {
  return !view || KNOWN_MAIL_VIEWS.has(view);
}

// react-router always scores a `:view` dynamic segment above the `$.tsx`
// splat at the same depth, so an unmatched single-segment path matches here
// and would otherwise serve 200 (React Router only auto-404s when literally
// no route matches). Reject it explicitly so the response status matches the
// NotFound content the component renders below.
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

export default function ViewRoute() {
  const { view } = useParams<{ view: string }>();
  if (!isKnownMailView(view)) {
    return <NotFound />;
  }
  return <InboxPage />;
}
