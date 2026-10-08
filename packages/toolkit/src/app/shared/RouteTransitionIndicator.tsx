import { useEffect, useState } from "react";
import { useNavigation } from "react-router";

export const ROUTE_TRANSITION_INDICATOR_DELAY_MS = 180;
export const ROUTE_TRANSITION_INDICATOR_MAX_DURATION_MS = 15_000;

export function RouteTransitionIndicator() {
  const navigation = useNavigation();
  const destination =
    navigation.state === "loading" && navigation.location
      ? `${navigation.location.pathname}${navigation.location.search}${navigation.location.hash}`
      : null;
  const navigationKey =
    navigation.state === "loading" && navigation.location
      ? navigation.location.key
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
    const maxDurationTimer = window.setTimeout(() => {
      setVisibleDestination(null);
    }, ROUTE_TRANSITION_INDICATOR_MAX_DURATION_MS);

    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(maxDurationTimer);
    };
  }, [destination, navigation, navigationKey]);

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
