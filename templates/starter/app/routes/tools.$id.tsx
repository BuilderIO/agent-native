import { ToolViewerPage } from "@agent-native/core/client/tools";

export function meta() {
  return [{ title: "Tool — Starter" }];
}

export default function ToolViewerRoute() {
  return <ToolViewerPage />;
}
