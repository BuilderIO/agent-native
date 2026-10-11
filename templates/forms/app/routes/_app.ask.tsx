import { useParams } from "react-router";

import messages from "@/i18n/en-US";
import { AskPage } from "@/pages/AskPage";

export function meta() {
  return [
    {
      title: `${messages.navigation.askForms} - ${messages.navigation.brand}`,
    },
  ];
}

// `/ask` and `/ask/:threadId` (_app.ask.$threadId.tsx re-exports this module)
// must render this same component, so a submit that moves the URL does not
// remount the chat.
export default function AskRoute() {
  const { threadId } = useParams();
  return <AskPage threadId={threadId ?? null} />;
}
