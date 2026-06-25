import { ExtensionsListPage } from "@agent-native/core/client/extensions";

import messages from "@/i18n/en-US";

export function meta() {
  return [{ title: messages.routeTitles.extensions }];
}

export default function ExtensionsRoute() {
  return <ExtensionsListPage />;
}
