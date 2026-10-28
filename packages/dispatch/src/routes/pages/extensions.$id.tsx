import { ExtensionViewerPage } from "@agent-native/toolkit/app/extensions";

export function meta() {
  return [{ title: "Extension \u2014 Dispatch" }];
}

export default function ExtensionViewerRoute() {
  return <ExtensionViewerPage />;
}
