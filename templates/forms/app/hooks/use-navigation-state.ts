import { useAgentRouteState } from "@agent-native/core/client";
import { useLocation } from "react-router";
import { markFormsChatHomeHandoff } from "@/lib/chat-home-handoff";

interface NavigationState {
  view: string;
  formId?: string;
}

export function useNavigationState() {
  const location = useLocation();

  useAgentRouteState<NavigationState>({
    getNavigationState: ({ pathname, searchParams }) => {
      const state: NavigationState = { view: "forms" };

      if (pathname === "/") {
        state.view = "home";
      } else if (pathname.startsWith("/forms")) {
        const formMatch = pathname.match(/\/forms\/([^/]+)/);
        if (formMatch) {
          const formId = decodeURIComponent(formMatch[1]);
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
      } else if (pathname.startsWith("/response-insights")) {
        state.view = "response-insights";
        const formId = searchParams.get("formId");
        if (formId) state.formId = formId;
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
      if (!cmd.view && cmd.formId) return `/forms/${cmd.formId}`;
      if (cmd.view === "home") return "/";
      if (cmd.view === "form" && cmd.formId) return `/forms/${cmd.formId}`;
      if (cmd.view === "responses" && cmd.formId)
        return `/forms/${cmd.formId}/responses`;
      if (cmd.view === "response-insights") {
        return cmd.formId
          ? `/response-insights?formId=${encodeURIComponent(cmd.formId)}`
          : "/response-insights";
      }
      if (cmd.view === "forms") return "/forms";
      if (cmd.view === "team") return "/team";
      if (cmd.view === "extensions") return "/extensions";
      if (cmd.view === "form-preview") return "/form-preview";
      return "/forms";
    },
    agentChatViewTransition: true,
    onNavigate: (_command, path) => {
      if (location.pathname === "/" && path !== "/") {
        markFormsChatHomeHandoff();
      }
    },
  });
}
