import { ExtensionViewerPage } from "@agent-native/core/client/extensions";

export function meta() {
  return [{ title: "Extension - Agent-Native Code" }];
}

export default function ExtensionViewerRoute() {
  return <ExtensionViewerPage />;
}
