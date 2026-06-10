import { useRef } from "react";
import { useAgentRouteState } from "@agent-native/core/client";
import { useFolders } from "@/hooks/use-folders";

export interface NavigationState {
  view: string;
  compositionId?: string;
  folderId?: string;
  folderName?: string;
}

export function useNavigationState() {
  const { folders, getFolderForComposition } = useFolders();

  // Capture current folder state in a ref so the stable getNavigationState
  // callback always reads the latest values without triggering re-renders.
  const foldersRef = useRef(folders);
  foldersRef.current = folders;
  const getFolderForCompositionRef = useRef(getFolderForComposition);
  getFolderForCompositionRef.current = getFolderForComposition;

  useAgentRouteState<NavigationState>({
    getNavigationState: ({ pathname }) => {
      const state: NavigationState = { view: "home" };

      if (pathname.startsWith("/c/")) {
        state.view = "composition";
        const match = pathname.match(/\/c\/([^/]+)/);
        if (match) {
          const compositionId = match[1];
          state.compositionId = compositionId;
          const folderId = getFolderForCompositionRef.current(compositionId);
          if (folderId) {
            state.folderId = folderId;
            const folder = foldersRef.current.find((f) => f.id === folderId);
            if (folder?.name) state.folderName = folder.name;
          }
        }
      } else if (pathname.startsWith("/components")) {
        state.view = "components";
      }

      return state;
    },
    getCommandPath: (cmd) => {
      if (cmd.compositionId) return `/c/${cmd.compositionId}`;
      if (cmd.view === "components") return "/components";
      return "/";
    },
  });
}
