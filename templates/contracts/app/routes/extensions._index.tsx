import { ExtensionsListPage } from "@agent-native/core/client/extensions";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `Extensions — ${APP_TITLE}` }];
}

export default function ExtensionsRoute() {
  return <ExtensionsListPage />;
}
