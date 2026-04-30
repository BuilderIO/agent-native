import { ToolViewerPage } from "@agent-native/core/client/tools";

export function meta() {
  return [{ title: "Tool — Notes" }];
}

export default function ToolViewerRoute() {
  return <ToolViewerPage />;
}
