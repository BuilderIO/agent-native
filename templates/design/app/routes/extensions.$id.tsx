import { ExtensionViewerPage } from "@agent-native/core/client/extensions";

import enUSMessages from "@/i18n/en-US";

export function meta() {
  return [{ title: enUSMessages.routeTitles.toolDesign }];
}

export default function ExtensionViewerRoute() {
  return <ExtensionViewerPage />;
}
