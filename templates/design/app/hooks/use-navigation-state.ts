import { useEffect } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { agentNativePath } from "@agent-native/core/client";

export interface NavigationState {
  view: string;
  designId?: string;
  designSystemId?: string;
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
      const designSystemId = new URLSearchParams(location.search).get(
        "designSystemId",
      );
      if (designSystemId) state.designSystemId = designSystemId;
    } else if (location.pathname.startsWith("/present/")) {
      state.view = "present";
      state.designId = params.id;
    } else if (
      location.pathname.startsWith("/templates") ||
      location.pathname.startsWith("/examples")
    ) {
      state.view = "templates";
    } else if (location.pathname.startsWith("/settings")) {
      state.view = "settings";
    }

    fetch(agentNativePath("/_agent-native/application-state/navigation"), {
      method: "PUT",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => {});
  }, [location.pathname, location.search, params.id]);

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
    structuralSharing: false,
  });

  useEffect(() => {
    if (!navCommand) return;
    fetch(agentNativePath("/_agent-native/application-state/navigate"), {
      method: "DELETE",
      headers: { "X-Agent-Native-CSRF": "1" },
    }).catch(() => {});
    const cmd = navCommand as NavigationState & {
      designId?: string;
      designSystemId?: string;
    };

    let path = cmd.path;
    if (!path) {
      if (cmd.view === "editor" && cmd.designId) {
        path = `/design/${cmd.designId}`;
      } else if (cmd.view === "design-systems") {
        path = cmd.designSystemId
          ? `/design-systems?designSystemId=${encodeURIComponent(
              cmd.designSystemId,
            )}`
          : "/design-systems";
      } else if (cmd.view === "present" && cmd.designId) {
        path = `/present/${cmd.designId}`;
      } else if (cmd.view === "templates" || cmd.view === "examples") {
        path = "/templates";
      } else if (cmd.view === "settings") {
        path = "/settings";
      } else {
        path = "/";
      }
    }

    navigate(path);
    qc.setQueryData(["navigate-command"], null);
  }, [navCommand, navigate, qc]);
}
