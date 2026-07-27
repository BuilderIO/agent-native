import { Navigate } from "react-router";

import { messagesByLocale } from "@/i18n-data";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.extensionsDesign }];
}

export default function ExtensionsRoute() {
  return <Navigate to="/settings#extensions" replace />;
}
