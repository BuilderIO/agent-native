import { ToolsListPage } from "@agent-native/core/client/tools";

export function meta() {
  return [{ title: "Tools — Starter" }];
}

export default function ToolsRoute() {
  return <ToolsListPage />;
}
