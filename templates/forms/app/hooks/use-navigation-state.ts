import { useAgentRouteState } from "@agent-native/core/client";

interface NavigationState {
  view: string;
  formId?: string;
}

export function useNavigationState() {
  useAgentRouteState<NavigationState>({
    getNavigationState: ({ pathname }) => {
      const state: NavigationState = { view: "forms" };

      if (pathname === "/" || pathname.startsWith("/forms")) {
        const formMatch = pathname.match(/\/forms\/([^/]+)/);
        if (formMatch) {
          const formId = formMatch[1];
          if (pathname.includes("/responses")) {
            state.view = "responses";
            state.formId = formId;
          } else {
            state.view = "form";
            state.formId = formId;
          }
        } else {
          state.view = "forms";
        }
      } else if (pathname.startsWith("/f/")) {
        state.view = "public-form";
      } else if (pathname.startsWith("/team")) {
        state.view = "team";
      } else if (pathname.startsWith("/extensions")) {
        state.view = "extensions";
      } else if (pathname.startsWith("/form-preview")) {
        state.view = "form-preview";
      }

      return state;
    },
    getCommandPath: (cmd) => {
      if (cmd.view === "form" && cmd.formId) return `/forms/${cmd.formId}`;
      if (cmd.view === "responses" && cmd.formId)
        return `/forms/${cmd.formId}/responses`;
      if (cmd.view === "forms") return "/forms";
      if (cmd.view === "team") return "/team";
      if (cmd.view === "extensions") return "/extensions";
      if (cmd.view === "form-preview") return "/form-preview";
      return "/forms";
    },
  });
}
