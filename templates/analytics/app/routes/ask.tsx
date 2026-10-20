import { useParams } from "react-router";

import enUSMessages from "@/i18n/en-US";
import AskPage from "@/pages/Ask";

export function meta() {
  return [{ title: enUSMessages.routeTitles.ask }];
}

// Serves both /ask and /ask/:threadId (ask.$threadId.tsx re-exports this
// module). Keep this component the only one rendered for both paths so the
// chat is not remounted when the thread URL changes mid-run.
export default function AskRoute() {
  const { threadId } = useParams();
  return <AskPage threadId={threadId ?? null} />;
}
