import { useAgentRouteState } from "@agent-native/core/client";
import { useParams } from "react-router";

export interface NavigationState {
  view: string;
  designId?: string;
  designSystemId?: string;
  path?: string;
}

export function useNavigationState() {
  const params = useParams();

  useAgentRouteState<NavigationState>({
    getNavigationState: ({ pathname, search }) => {
      const state: NavigationState = { view: "list" };

      if (pathname.startsWith("/design/")) {
        state.view = "editor";
        state.designId = params.id;
      } else if (pathname.startsWith("/design-systems")) {
        state.view = "design-systems";
        const designSystemId = new URLSearchParams(search).get(
          "designSystemId",
        );
        if (designSystemId) state.designSystemId = designSystemId;
      } else if (pathname.startsWith("/present/")) {
        state.view = "present";
        state.designId = params.id;
      } else if (
        pathname.startsWith("/templates") ||
        pathname.startsWith("/examples")
      ) {
        state.view = "templates";
      } else if (pathname.startsWith("/settings")) {
        state.view = "settings";
      }

      return state;
    },
    getCommandPath: (cmd) => {
      if (cmd.path) return cmd.path;
      if (cmd.view === "editor" && cmd.designId)
        return `/design/${cmd.designId}`;
      if (cmd.view === "design-systems") {
        return cmd.designSystemId
          ? `/design-systems?designSystemId=${encodeURIComponent(cmd.designSystemId)}`
          : "/design-systems";
      }
      if (cmd.view === "present" && cmd.designId)
        return `/present/${cmd.designId}`;
      if (cmd.view === "templates" || cmd.view === "examples")
        return "/templates";
      if (cmd.view === "settings") return "/settings";
      return "/";
    },
  });
}
