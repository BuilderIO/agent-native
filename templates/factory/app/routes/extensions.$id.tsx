import { ExtensionViewerPage } from "@agent-native/core/client/extensions";

import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `Extension — ${APP_TITLE}` }];
}

export default function ExtensionViewerRoute() {
  return <ExtensionViewerPage />;
}
