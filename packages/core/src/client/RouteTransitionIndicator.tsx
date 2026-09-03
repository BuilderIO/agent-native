import { useEffect, useState } from "react";
import { useNavigation } from "react-router";

export const ROUTE_TRANSITION_INDICATOR_DELAY_MS = 180;

/**
 * A top progress bar while the next route loads.
 *
 * This used to be a floating card in the bottom-right corner that printed the
 * destination pathname. Users read it as a bug rather than a loading state —
 * the old page stays fully interactive while a little box in the corner shows
 * a URL, so it looks like the click did nothing and something else broke
 * ("it takes you back to the grid page with a spinner in the corner ... the
 * spinner shows the new route"). A top bar is the convention precisely because
 * it reads as "this page is on its way" without competing for attention or
 * exposing routing internals.
 *
 * The delay is the part worth keeping: fast navigations never paint anything,
 * so the common case stays silent. It only appears once a transition is slow
 * enough that the user has started to wonder.
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
      aria-label="Loading page..."
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-primary/15"
      data-route-transition-indicator="true"
      data-route-transition-target={destination}
      role="status"
    >
      <div className="route-transition-indicator-bar h-full w-full bg-primary" />
    </div>
  );
}
