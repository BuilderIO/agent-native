import { Navigate } from "react-router";

import enUS from "@/i18n/en-US";

export function meta() {
  return [{ title: enUS.raw.routes.team }];
}

export default function TeamRoute() {
  return <Navigate to="/settings#team" replace />;
}
