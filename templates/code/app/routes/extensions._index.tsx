import { ExtensionsListPage } from "@agent-native/core/client/extensions";

export function meta() {
  return [{ title: "Extensions - Agent-Native Code" }];
}

export default function ExtensionsRoute() {
  return <ExtensionsListPage />;
}
