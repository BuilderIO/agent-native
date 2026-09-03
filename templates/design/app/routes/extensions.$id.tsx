import { ExtensionViewerPage } from "@agent-native/core/client/extensions";

import { messagesByLocale } from "@/i18n-data";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.toolDesign }];
}

export default function ExtensionViewerRoute() {
  return <ExtensionViewerPage />;
}
