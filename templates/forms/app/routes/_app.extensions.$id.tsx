import { ExtensionViewerPage } from "@agent-native/core/client/extensions";

export function meta() {
  return [{ title: "Tool — Forms" }];
}

export default function ExtensionViewerRoute() {
  return <ExtensionViewerPage />;
}
