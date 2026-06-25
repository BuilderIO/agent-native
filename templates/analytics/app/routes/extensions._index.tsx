import { messagesByLocale } from "@/i18n-data";
import { ExtensionsListPage } from "@agent-native/core/client/extensions";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.extensions }];
}

export default function ExtensionsRoute() {
  return <ExtensionsListPage />;
}
