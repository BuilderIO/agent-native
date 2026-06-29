import { Navigate } from "react-router";

import { messagesByLocale } from "@/i18n-data";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.team }];
}

export default function TeamRoute() {
  return <Navigate to="/settings#team" replace />;
}
