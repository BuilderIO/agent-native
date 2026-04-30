import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { agentNativePath } from "@agent-native/core/client";
import { useFolders } from "@/hooks/use-folders";

export interface NavigationState {
  view: string;
  compositionId?: string;
  folderId?: string;
  folderName?: string;
}

export function useNavigationState() {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { folders, getFolderForComposition } = useFolders();

  useEffect(() => {
    const path = location.pathname;
    const state: NavigationState = { view: "home" };

    if (path.startsWith("/c/")) {
      state.view = "composition";
      const match = path.match(/\/c\/([^/]+)/);
      if (match) {
        const compositionId = match[1];
        state.compositionId = compositionId;
        const folderId = getFolderForComposition(compositionId);
        if (folderId) {
          state.folderId = folderId;
          const folder = folders.find((f) => f.id === folderId);
          if (folder?.name) state.folderName = folder.name;
        }
      }
    } else if (path.startsWith("/components")) {
      state.view = "components";
    }

    fetch(agentNativePath("/_agent-native/application-state/navigation"), {
      method: "PUT",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => {});
  }, [location.pathname, folders, getFolderForComposition]);

  // Listen for navigate commands from agent
  const { data: navCommand } = useQuery({
    queryKey: ["navigate-command"],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath("/_agent-native/application-state/navigate"),
      );
      if (!res.ok) return null;
      const text = await res.text();
      if (!text) return null;
      try {
        const data = JSON.parse(text);
        if (data) {
          // Return with a timestamp to ensure uniqueness
          return { ...data, _ts: Date.now() };
        }
      } catch {
        // Empty or invalid JSON response means there is no pending command.
      }
      return null;
    },
    refetchInterval: 2_000,
    refetchIntervalInBackground: true,
    structuralSharing: false,
  });

  useEffect(() => {
    if (!navCommand) return;
    // Delete the one-shot command AFTER reading it
    fetch(agentNativePath("/_agent-native/application-state/navigate"), {
      method: "DELETE",
      headers: { "X-Agent-Native-CSRF": "1" },
    }).catch(() => {});
    const cmd = navCommand as NavigationState;
    let path = "/";

    if (cmd.compositionId) {
      path = `/c/${cmd.compositionId}`;
    } else if (cmd.view === "components") {
      path = "/components";
    }

    navigate(path);
    qc.setQueryData(["navigate-command"], null);
  }, [navCommand, navigate, qc]);
}
