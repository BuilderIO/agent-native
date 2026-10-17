import { ExtensionViewerPage } from "@agent-native/toolkit/app/extensions";

import enUSMessages from "@/i18n/en-US";

export function meta() {
  return [{ title: enUSMessages.routeTitles.tool }];
}

export default function ExtensionViewerRoute() {
  return <ExtensionViewerPage />;
}
