import { useEffect } from "react";
import { useParams } from "react-router";
import { ToolViewer } from "./ToolViewer.js";
import { ToolsListPage } from "./ToolsListPage.js";

export function ToolViewerPage() {
  const { id } = useParams<{ id: string }>();

  useEffect(() => {
    fetch("/_agent-native/application-state/navigation", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: { view: "tools", toolId: id } }),
    }).catch(() => {});
  }, [id]);

  if (id === "new") {
    // No manual editor — tools are created via the agent
    return <ToolsListPage />;
  }
  if (!id) return null;
  return <ToolViewer toolId={id} />;
}
