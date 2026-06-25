import {
  appBasePath,
  markAgentChatHomeHandoff,
  useAgentRouteState,
} from "@agent-native/core/client";
import { useLocation } from "react-router";

import {
  formsRoutePath,
  normalizeFormBuilderTab,
  type FormBuilderTab,
} from "@/lib/form-builder-tabs";
import { prewarmFormsRoutePath } from "@/lib/route-prewarm";
import { TAB_ID } from "@/lib/tab-id";

interface NavigationState {
  view: string;
  formId?: string;
  activeTab?: FormBuilderTab;
  tab?: FormBuilderTab;
}

interface NavigateCommand extends NavigationState {
  path?: string;
  url?: string;
}

function localPathFromCommandUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const origin =
      typeof window !== "undefined"
        ? window.location.origin
        : "http://localhost";
    const url = new URL(trimmed, origin);
    if (url.origin !== origin) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function formsNavigateCommandPath(cmd: NavigateCommand): string | null {
  const path =
    localPathFromCommandUrl(cmd.path) ??
    localPathFromCommandUrl(cmd.url) ??
    formsRoutePath(cmd);
  return path ? routerPath(path) : null;
}

function routerPath(path: string): string {
  const basePath = appBasePath();
  if (!basePath) return path;
  let result = path;
  // React Router is already scoped to the app basename. Strip mounted URLs so
  // navigate() receives router-local paths and does not duplicate the prefix.
  for (let i = 0; i < 4; i += 1) {
    if (result === basePath) return "/";
    if (result.startsWith(`${basePath}/`)) {
      result = result.slice(basePath.length) || "/";
      continue;
    }
    if (
      result.startsWith(`${basePath}?`) ||
      result.startsWith(`${basePath}#`)
    ) {
      result = `/${result.slice(basePath.length)}`;
      continue;
    }
    break;
  }
  return result;
}

export function useNavigationState() {
  const location = useLocation();

  useAgentRouteState<NavigationState, NavigateCommand>({
    browserTabId: TAB_ID,
    requestSource: TAB_ID,
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
            state.activeTab = "responses";
          } else {
            state.view = "form";
            state.formId = formId;
            state.activeTab = normalizeFormBuilderTab(searchParams.get("tab"));
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
      return formsNavigateCommandPath(cmd);
    },
    refetchInterval: 500,
    // The agent fires navigate commands mid-response, while chat tokens are
    // still streaming. React Router wraps navigate() in React.startTransition
    // by default, and the high-frequency streaming re-renders starve that
    // transition — so the URL would not change until the stream finished (and
    // sometimes not at all). Keep command navigation plain and synchronous:
    // route correctness matters more than the chat morph here, and view
    // transitions can leave the old home chat visible while the new route loads.
    navigateOptions: { flushSync: true, replace: true },
    onNavigate: (_command, path) => {
      void prewarmFormsRoutePath(path);
      if (location.pathname === "/" && path !== "/") {
        markAgentChatHomeHandoff("forms");
      }
    },
  });
}
