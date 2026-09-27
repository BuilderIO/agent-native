import { mailSettingsRoute } from "@shared/settings-navigation";
import { Navigate } from "react-router";

import messages from "@/i18n/en-US";

export function meta() {
  return [{ title: messages.mail.routeTitles.team }];
}

export default function TeamRoute() {
  return <Navigate to={mailSettingsRoute("members")} replace />;
}
