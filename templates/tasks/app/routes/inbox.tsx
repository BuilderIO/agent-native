import { InboxListPage } from "@/components/inbox/InboxListPage";
import messages from "@/i18n/en-US";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [
    { title: `${messages.inbox.pageTitle} · ${APP_TITLE}` },
    {
      name: "description",
      content: "Capture rough ideas in the inbox before they become tasks.",
    },
  ];
}

export default function InboxRoute() {
  return <InboxListPage />;
}
