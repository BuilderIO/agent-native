import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

interface NavigationState {
  view: string;
  formId?: string;
}

export function useNavigationState() {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Sync current route to application state
  useEffect(() => {
    const path = location.pathname;
    const state: NavigationState = { view: "forms" };

    if (path === "/" || path.startsWith("/forms")) {
      const formMatch = path.match(/\/forms\/([^/]+)/);
      if (formMatch) {
        const formId = formMatch[1];
        if (path.includes("/responses")) {
          state.view = "responses";
          state.formId = formId;
        } else {
          state.view = "form";
          state.formId = formId;
        }
      } else {
        state.view = "forms";
      }
    } else if (path.startsWith("/f/")) {
      state.view = "public-form";
    }

    fetch("/_agent-native/application-state/navigation", {
      method: "PUT",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => {});
  }, [location.pathname]);

  // Listen for navigate commands from agent
  const { data: navCommand } = useQuery({
    queryKey: ["navigate-command"],
    queryFn: async () => {
      const res = await fetch("/_agent-native/application-state/navigate");
      if (!res.ok) return null;
      const data = await res.json();
      if (data) {
        // Return with a timestamp to ensure uniqueness
        return { ...data, _ts: Date.now() };
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
    fetch("/_agent-native/application-state/navigate", {
      method: "DELETE",
    }).catch(() => {});
    const cmd = navCommand as NavigationState;
    let path = "/forms";

    if (cmd.view === "form" && cmd.formId) {
      path = `/forms/${cmd.formId}`;
    } else if (cmd.view === "responses" && cmd.formId) {
      path = `/forms/${cmd.formId}/responses`;
    } else if (cmd.view === "forms") {
      path = "/forms";
    }

    navigate(path);
    qc.setQueryData(["navigate-command"], null);
  }, [navCommand, navigate, qc]);
}
