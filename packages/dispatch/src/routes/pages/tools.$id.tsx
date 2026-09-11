import { ToolViewerPage } from "@agent-native/core/client/tools";

export function meta() {
  return [{ title: "Extension \u2014 Dispatch" }];
}

export default function ToolViewerRoute() {
  return <ToolViewerPage />;
}
