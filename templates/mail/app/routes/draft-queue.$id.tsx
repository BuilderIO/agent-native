import messages from "@/i18n/en-US";
import { DraftQueuePage } from "@/pages/DraftQueuePage";

export function meta() {
  return [{ title: messages.mail.routeTitles.draftQueue }];
}

export default function DraftQueueDetailRoute() {
  return <DraftQueuePage />;
}
