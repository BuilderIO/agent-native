import { ExtensionsListPage } from "@agent-native/core/client/extensions";

import messages from "@/i18n/en-US";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `${messages.header.pageExtensions} — ${APP_TITLE}` }];
}

export default function ExtensionsRoute() {
  return <ExtensionsListPage />;
}
