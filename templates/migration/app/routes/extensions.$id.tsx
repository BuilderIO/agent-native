import { ExtensionViewerPage } from "@agent-native/core/client/extensions";

export function meta() {
  return [{ title: "Extension - Migration" }];
}

export default function ExtensionViewerRoute() {
  return <ExtensionViewerPage />;
}
