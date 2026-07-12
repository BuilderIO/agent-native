import { useAgentRouteState, getBrowserTabId } from "@agent-native/core/client";

interface NavigationState {
  view: string;
  documentId?: string;
  /** Explicit path override from the `navigate` action. */
  path?: string;
}

/**
 * Syncs navigation state bidirectionally:
 * 1. Writes the current route to application state so the agent can read it
 * 2. Polls for navigate commands from the agent and applies them
 *
 * Two command shapes arrive here:
 *  - `{ path }` — the `navigate` action's explicit path form.
 *  - `{ view, documentId }` — the deep-link / `/_agent-native/open` form
 *    (the open route writes the non-reserved params + view, never a `path`).
 * `view: "editor"` + `documentId` maps to `/page/<id>`, `view: "list"` to `/`.
 */
export function useNavigationState() {
  useAgentRouteState<NavigationState>({
    browserTabId: getBrowserTabId(),
    getNavigationState: ({ pathname }) => {
      if (pathname === "/" || pathname === "") return { view: "list" };
      if (pathname.startsWith("/local-files")) return { view: "local-files" };

      // Document editor: /:id or /page/:id
      const pageMatch = pathname.match(/^\/page\/(.+)/);
      const directMatch = pathname.match(/^\/([a-f0-9]+)$/);
      if (pageMatch) return { view: "editor", documentId: pageMatch[1] };
      if (directMatch) return { view: "editor", documentId: directMatch[1] };

      return { view: "list" };
    },
    getCommandPath: (cmd) => {
      if (cmd.path) return cmd.path;
      if (cmd.documentId) return `/page/${cmd.documentId}`;
      if (cmd.view === "local-files") return "/local-files";
      if (cmd.view === "list") return "/";
      return null;
    },
  });
}
