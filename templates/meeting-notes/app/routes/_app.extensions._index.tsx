import { ExtensionsListPage } from "@agent-native/core/client/extensions";

export function meta() {
  return [{ title: "Tools — Notes" }];
}

export default function ExtensionsRoute() {
  return <ExtensionsListPage />;
}
