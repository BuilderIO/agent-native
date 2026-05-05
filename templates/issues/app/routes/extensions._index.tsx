import { ExtensionsListPage } from "@agent-native/core/client/extensions";

export function meta() {
  return [{ title: "Tools — Issues" }];
}

export default function ExtensionsRoute() {
  return <ExtensionsListPage />;
}
