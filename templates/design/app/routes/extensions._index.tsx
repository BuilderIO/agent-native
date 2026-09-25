import { Navigate } from "react-router";

import enUSMessages from "@/i18n/en-US";

export function meta() {
  return [{ title: enUSMessages.routeTitles.extensionsDesign }];
}

export default function ExtensionsRoute() {
  return <Navigate to="/settings/extensions" replace />;
}
