import { Navigate } from "react-router";

import { messagesByLocale } from "@/i18n-data";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.analyses }];
}

export default function AnalysesRoute() {
  return <Navigate to="/dashboards" replace />;
}
