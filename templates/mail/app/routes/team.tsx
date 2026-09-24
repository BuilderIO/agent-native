import { Navigate } from "react-router";

import messages from "@/i18n/en-US";

export function meta() {
  return [{ title: messages.mail.routeTitles.team }];
}

export default function TeamRoute() {
  return <Navigate to="/settings?section=team" replace />;
}
