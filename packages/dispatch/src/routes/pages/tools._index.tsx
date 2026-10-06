import { ToolsListPage } from "@agent-native/toolkit/app/extensions";

export function meta() {
  return [{ title: "Extensions \u2014 Dispatch" }];
}

export default function ToolsRoute() {
  return <ToolsListPage />;
}
