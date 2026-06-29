import { Navigate } from "react-router";

import messages from "@/i18n/en-US";

export function meta() {
  return [{ title: messages.raw.routeTeamTitle }];
}

export default function TeamRoute() {
  return <Navigate to="/settings#team" replace />;
}
