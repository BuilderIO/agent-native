import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";

interface NavigationState {
  view: string;
  documentId?: string;
}

/**
 * Syncs navigation state bidirectionally:
 * 1. Writes the current route to application state so the agent can read it
 * 2. Polls for navigate commands from the agent and applies them
 */
export function useNavigationState() {
  const location = useLocation();
  const navigate = useNavigate();
  const versionRef = useRef<number>(0);
  const handledVersionRef = useRef<number>(0);

  // Write current route to application state
  useEffect(() => {
    const path = location.pathname;
    const state: NavigationState = { view: "list" };

    if (path === "/" || path === "") {
      state.view = "list";
    } else {
      // Document editor: /:id or /page/:id
      const pageMatch = path.match(/^\/page\/(.+)/);
      const directMatch = path.match(/^\/([a-f0-9]+)$/);
      if (pageMatch) {
        state.view = "editor";
        state.documentId = pageMatch[1];
      } else if (directMatch) {
        state.view = "editor";
        state.documentId = directMatch[1];
      }
    }

    fetch("/api/application-state/navigation", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => {});
  }, [location.pathname]);

  // Poll for navigate commands from agent
  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const res = await fetch(`/api/poll?since=${versionRef.current}`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          version: number;
          events: Array<{
            source: string;
            type: string;
            key: string;
            version: number;
          }>;
        };

        if (data.version > versionRef.current) {
          versionRef.current = data.version;

          const navEvent = data.events.find(
            (e) =>
              e.source === "app-state" &&
              e.key === "navigate" &&
              e.version > handledVersionRef.current,
          );

          if (navEvent) {
            handledVersionRef.current = navEvent.version;
            const stateRes = await fetch("/api/application-state/navigate");
            if (stateRes.ok) {
              const stateData = (await stateRes.json()) as {
                path?: string;
              } | null;
              if (stateData?.path) {
                navigate(stateData.path);
                // Delete the one-shot command
                fetch("/api/application-state/navigate", {
                  method: "DELETE",
                }).catch(() => {});
              }
            }
          }
        }
      } catch {
        // Silently ignore poll errors
      }

      if (active) {
        setTimeout(poll, 1500);
      }
    }

    // Seed the current version so we only react to future events
    fetch("/api/poll?since=0")
      .then((r) => r.json())
      .then((d: { version: number }) => {
        versionRef.current = d.version;
        handledVersionRef.current = d.version;
        if (active) setTimeout(poll, 1500);
      })
      .catch(() => {
        if (active) setTimeout(poll, 1500);
      });

    return () => {
      active = false;
    };
  }, [navigate]);
}
