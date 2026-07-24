import { Navigate } from "react-router";

import messages from "@/i18n/en-US";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `${messages.header.pageExtensions} — ${APP_TITLE}` }];
}

export default function ExtensionsRoute() {
  return <Navigate to="/settings#extensions" replace />;
}
