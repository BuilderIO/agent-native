import { ExtensionsListPage } from "@agent-native/core/client/extensions";

export function meta() {
  return [{ title: "Tools — Calls" }];
}

export default function ExtensionsRoute() {
  return <ExtensionsListPage />;
}
