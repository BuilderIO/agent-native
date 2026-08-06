import { IconLoader2 } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useNavigation } from "react-router";

export const ROUTE_TRANSITION_INDICATOR_DELAY_MS = 180;

/**
 * Shows the destination after a short delay so fast route changes stay quiet.
 * The provider shell survives lazy route loading, including a cold Vite graph.
 */
export function RouteTransitionIndicator() {
  const navigation = useNavigation();
  const destination =
    navigation.state === "loading" && navigation.location
      ? `${navigation.location.pathname}${navigation.location.search}${navigation.location.hash}`
      : null;
  const [visibleDestination, setVisibleDestination] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!destination) {
      setVisibleDestination(null);
      return;
    }

    setVisibleDestination(null);
    const timer = window.setTimeout(() => {
      setVisibleDestination(destination);
    }, ROUTE_TRANSITION_INDICATOR_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [destination]);

  if (!destination || visibleDestination !== destination) return null;

  return (
    <div
      aria-label={`Loading ${destination}`}
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-md border border-border bg-background/95 px-3 py-2 text-xs text-muted-foreground shadow-lg backdrop-blur"
      data-route-transition-indicator="true"
      data-route-transition-target={destination}
      role="status"
    >
      <IconLoader2
        aria-hidden="true"
        className="size-3.5 shrink-0 animate-spin text-primary"
      />
      <span className="truncate">{destination}</span>
    </div>
  );
}
