import { Navigate } from "react-router";

import enUSMessages from "@/i18n/en-US";

export function meta() {
  return [{ title: enUSMessages.routeTitles.teamDesign }];
}

export default function TeamRoute() {
  return <Navigate to="/settings/organization" replace />;
}
