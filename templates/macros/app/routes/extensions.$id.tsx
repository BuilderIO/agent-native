import { ExtensionViewerPage } from "@agent-native/core/client/extensions";

import messages from "@/i18n/en-US";

export function meta() {
  return [{ title: messages.routeTitles.extensionTool }];
}

export default function ExtensionViewerRoute() {
  return <ExtensionViewerPage />;
}
