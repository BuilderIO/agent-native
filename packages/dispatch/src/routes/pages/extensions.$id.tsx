import { ExtensionViewerPage } from "@agent-native/core/client/extensions";

export function meta() {
  return [{ title: "Extension \u2014 Dispatch" }];
}

export default function ExtensionViewerRoute() {
  return <ExtensionViewerPage />;
}
