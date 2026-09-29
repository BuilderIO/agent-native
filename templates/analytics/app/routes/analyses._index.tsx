import { Navigate } from "react-router";

import enUSMessages from "@/i18n/en-US";

export function meta() {
  return [{ title: enUSMessages.routeTitles.analyses }];
}

export default function AnalysesRoute() {
  return <Navigate to="/dashboards" replace />;
}
