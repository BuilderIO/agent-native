import { getBrowserTabId } from "@agent-native/core/client/hooks";
import { useAgentRouteState } from "@agent-native/core/client/navigation";

interface NavigationState {
  view: string;
  documentId?: string;
  /** The Blocks field tab open on a row with several (`?field=`). */
  fieldId?: string;
  path?: string;
}

export function navigationStateForLocation({
  pathname,
  searchParams,
}: {
  pathname: string;
  searchParams: URLSearchParams;
}): NavigationState {
  if (pathname === "/home" || pathname === "") return { view: "list" };
  if (pathname.startsWith("/local-files")) return { view: "local-files" };

  const pageMatch = pathname.match(/^\/page\/(.+)/);
  const directMatch = pathname.match(/^\/([a-f0-9]+)$/);
  if (pageMatch) {
    const fieldId = searchParams.get("field");
    return {
      view: "editor",
      documentId: pageMatch[1],
      ...(fieldId ? { fieldId } : {}),
    };
  }
  if (directMatch) return { view: "editor", documentId: directMatch[1] };

  return { view: "list" };
}

export function useNavigationState() {
  useAgentRouteState<NavigationState>({
    browserTabId: getBrowserTabId(),
    getNavigationState: navigationStateForLocation,
    getCommandPath: (cmd) => {
      if (cmd.path) return cmd.path;
      if (cmd.documentId) return `/page/${cmd.documentId}`;
      if (cmd.view === "local-files") return "/local-files";
      if (cmd.view === "list") return "/home";
      return null;
    },
  });
}
