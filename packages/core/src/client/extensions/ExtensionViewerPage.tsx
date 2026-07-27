import { useEffect } from "react";
import { useParams } from "react-router";

import { agentNativePath } from "../api-path.js";
import { incrementExtensionView } from "./extension-popularity.js";
import { ExtensionsListPage } from "./ExtensionsListPage.js";
import { ExtensionViewer } from "./ExtensionViewer.js";

export function ExtensionViewerPage() {
  const { id } = useParams<{ id: string }>();

  useEffect(() => {
    if (id && id !== "new") {
      incrementExtensionView(id);
    }
    fetch(agentNativePath("/_agent-native/application-state/navigation"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        view: "extensions",
        ...(id && id !== "new" ? { extensionId: id } : {}),
      }),
    }).catch(() => {});
  }, [id]);

  if (id === "new") {
    // No manual editor — extensions are created via the agent
    return <ExtensionsListPage />;
  }
  if (!id) return null;
  return <ExtensionViewer extensionId={id} />;
}
