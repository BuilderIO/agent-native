import { ToolsListPage } from "@agent-native/core/client/tools";

export function meta() {
  return [{ title: "Tools — Design" }];
}

export default function ToolsRoute() {
  return <ToolsListPage />;
}
