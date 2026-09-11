import { ExtensionViewerPage } from "@agent-native/core/client/extensions";

import messages from "@/i18n/en-US";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `${messages.header.pageExtension} — ${APP_TITLE}` }];
}

export default function ExtensionViewerRoute() {
  return <ExtensionViewerPage />;
}
