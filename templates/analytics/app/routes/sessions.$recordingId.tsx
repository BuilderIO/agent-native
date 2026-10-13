import { useLocation, useParams } from "react-router";

import enUSMessages from "@/i18n/en-US";
import { isReplayFrameRequest } from "@/pages/sessions/session-replay-frame";
import SessionDetailPage from "@/pages/sessions/SessionDetailPage";
import SessionReplayFrame from "@/pages/sessions/SessionReplayFrame";

export function meta() {
  return [{ title: enUSMessages.routeTitles.session }];
}

export default function SessionDetailRoute() {
  const { recordingId = "" } = useParams();
  const location = useLocation();
  if (isReplayFrameRequest(location.pathname, location.search)) {
    return <SessionReplayFrame recordingId={recordingId} />;
  }
  return <SessionDetailPage />;
}
