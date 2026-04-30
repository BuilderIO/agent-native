import { ToolsListPage } from "@agent-native/core/client/tools";

export function meta() {
  return [{ title: "Tools — Calls" }];
}

export default function ToolsRoute() {
  return <ToolsListPage />;
}
