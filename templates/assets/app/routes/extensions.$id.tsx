import { ExtensionViewerPage } from "@agent-native/toolkit/app/extensions";

import { messagesByLocale } from "@/i18n-data";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.extension }];
}

export default function ExtensionViewerRoute() {
  return <ExtensionViewerPage />;
}
