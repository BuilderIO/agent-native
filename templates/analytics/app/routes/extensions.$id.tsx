import { messagesByLocale } from "@/i18n-data";
import { ExtensionViewerPage } from "@agent-native/core/client/extensions";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.tool }];
}

export default function ExtensionViewerRoute() {
  return <ExtensionViewerPage />;
}
