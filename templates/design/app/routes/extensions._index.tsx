import { ExtensionsListPage } from "@agent-native/core/client/extensions";

import { messagesByLocale } from "@/i18n-data";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.extensionsDesign }];
}

export default function ExtensionsRoute() {
  return <ExtensionsListPage />;
}
