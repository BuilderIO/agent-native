import { Navigate } from "react-router";

import messages from "@/i18n/en-US";

export function meta() {
  return [{ title: messages.routeTitles.extensionsForms }];
}

export default function ExtensionsRoute() {
  return <Navigate to="/settings#extensions" replace />;
}
