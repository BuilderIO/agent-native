import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { agentNativePath } from "@agent-native/core/client";

/**
 * Polls /_agent-native/poll for app-state "navigate" events and calls
 * React Router's navigate() when one is received.
 *
 * The agent triggers navigation by calling writeAppState("navigate", { path: "/some-id" })
 * via the script helpers, which emits an SSE event picked up here.
 */
export function useNavigationWatcher() {
  const navigate = useNavigate();
  const versionRef = useRef<number>(0);
  const handledVersionRef = useRef<number>(0);

  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const res = await fetch(
          agentNativePath(`/_agent-native/poll?since=${versionRef.current}`),
        );
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

          // Find any navigate event we haven't handled yet
          const navEvent = data.events.find(
            (e) =>
              e.source === "app-state" &&
              e.key === "navigate" &&
              e.version > handledVersionRef.current,
          );

          if (navEvent) {
            handledVersionRef.current = navEvent.version;
            // Fetch the navigation path from app state
            const stateRes = await fetch(
              agentNativePath("/_agent-native/application-state/navigate"),
            );
            if (stateRes.ok) {
              const stateData = (await stateRes.json()) as {
                path?: string;
              } | null;
              if (stateData?.path) {
                navigate(stateData.path);
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
    fetch(agentNativePath("/_agent-native/poll?since=0"))
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
