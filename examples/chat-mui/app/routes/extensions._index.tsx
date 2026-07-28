import { Navigate } from "react-router";

import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `Extensions — ${APP_TITLE}` }];
}

export default function ExtensionsRoute() {
  return <Navigate to="/settings#extensions" replace />;
}
