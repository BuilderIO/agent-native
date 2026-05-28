import { ExtensionViewerPage } from "@agent-native/core/client/extensions";

export function meta() {
  return [{ title: "Extension - Assets" }];
}

export default function ExtensionViewerRoute() {
  return <ExtensionViewerPage />;
}
