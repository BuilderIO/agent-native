import { agentNativePath } from "../api-path.js";
import { useEffect } from "react";
import { useParams } from "react-router";
import { ExtensionViewer } from "./ExtensionViewer.js";
import { ExtensionsListPage } from "./ExtensionsListPage.js";

export function ExtensionViewerPage() {
  const { id } = useParams<{ id: string }>();

  useEffect(() => {
    fetch(agentNativePath("/_agent-native/application-state/navigation"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: { view: "extensions", extensionId: id } }),
    }).catch(() => {});
  }, [id]);

  if (id === "new") {
    // No manual editor — extensions are created via the agent
    return <ExtensionsListPage />;
  }
  if (!id) return null;
  return <ExtensionViewer extensionId={id} />;
}
