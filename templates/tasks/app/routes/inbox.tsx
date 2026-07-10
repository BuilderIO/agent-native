import { APP_TITLE } from "@/lib/app-config";
import { InboxListPage } from "@/components/inbox/InboxListPage";

export function meta() {
  return [
    { title: `Inbox · ${APP_TITLE}` },
    {
      name: "description",
      content: "Capture rough ideas in the inbox before they become tasks.",
    },
  ];
}

export default function InboxRoute() {
  return <InboxListPage />;
}
