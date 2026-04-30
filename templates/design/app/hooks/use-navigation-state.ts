import { useEffect } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { agentNativePath } from "@agent-native/core/client";

export interface NavigationState {
  view: string;
  designId?: string;
  path?: string;
}

export function useNavigationState() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();
  const qc = useQueryClient();

  // Sync current route to application state
  useEffect(() => {
    const state: NavigationState = { view: "list" };

    if (location.pathname.startsWith("/design/")) {
      state.view = "editor";
      state.designId = params.id;
    } else if (location.pathname.startsWith("/design-systems")) {
      state.view = "design-systems";
    } else if (location.pathname.startsWith("/present/")) {
      state.view = "present";
      state.designId = params.id;
    } else if (location.pathname.startsWith("/examples")) {
      state.view = "examples";
    }

    fetch(agentNativePath("/_agent-native/application-state/navigation"), {
      method: "PUT",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => {});
  }, [location.pathname, params.id]);

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
    fetch(agentNativePath("/_agent-native/application-state/navigate"), {
      method: "DELETE",
    }).catch(() => {});
    const cmd = navCommand as NavigationState & { designId?: string };

    let path = cmd.path;
    if (!path) {
      if (cmd.view === "editor" && cmd.designId) {
        path = `/design/${cmd.designId}`;
      } else if (cmd.view === "design-systems") {
        path = "/design-systems";
      } else if (cmd.view === "present" && cmd.designId) {
        path = `/present/${cmd.designId}`;
      } else if (cmd.view === "examples") {
        path = "/examples";
      } else {
        path = "/";
      }
    }

    navigate(path);
    qc.setQueryData(["navigate-command"], null);
  }, [navCommand, navigate, qc]);
}
