import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export interface NavigationState {
  view: string;
  path?: string;
}

export function useNavigationState() {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Sync current route to application state
  useEffect(() => {
    const state: NavigationState = { view: "home" };

    // As you add routes, extend this mapping:
    // if (location.pathname.startsWith("/settings")) state.view = "settings";

    fetch("/api/application-state/navigation", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => {});
  }, [location.pathname]);

  // Listen for navigate commands from agent
  const { data: navCommand } = useQuery({
    queryKey: ["navigate-command"],
    queryFn: async () => {
      const res = await fetch("/api/application-state/navigate");
      if (!res.ok) return null;
      const data = await res.json();
      if (data) {
        // Delete the one-shot command
        fetch("/api/application-state/navigate", { method: "DELETE" }).catch(
          () => {},
        );
        return data;
      }
      return null;
    },
    refetchInterval: 5_000,
  });

  useEffect(() => {
    if (!navCommand) return;
    const cmd = navCommand as NavigationState;

    // Navigate to a specific path or resolve view name to path
    const path = cmd.path || "/";
    navigate(path);
    qc.setQueryData(["navigate-command"], null);
  }, [navCommand, navigate, qc]);
}
