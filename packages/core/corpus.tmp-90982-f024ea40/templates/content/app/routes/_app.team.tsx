import { Navigate } from "react-router";

import { messagesByLocale } from "@/i18n-data";

export function meta() {
  return [{ title: messagesByLocale["en-US"].team.metaTitle }];
}

export default function TeamRoute() {
  return <Navigate to="/settings#organization" replace />;
}
