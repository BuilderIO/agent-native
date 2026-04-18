/**
 * useEventType — fetch one event type by id or slug via a consumer-provided
 * callback (typically calling the `get-event-type` action).
 */
import { useEffect, useState } from "react";
import type { EventType } from "../../shared/index.js";

export interface UseEventTypeOpts {
  id?: string;
  slug?: string;
  ownerEmail?: string;
  teamId?: string;
  fetchEventType: (params: {
    id?: string;
    slug?: string;
    ownerEmail?: string;
    teamId?: string;
  }) => Promise<{ eventType: EventType | null }>;
}

export function useEventType(opts: UseEventTypeOpts) {
  const [eventType, setEventType] = useState<EventType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    opts
      .fetchEventType({
        id: opts.id,
        slug: opts.slug,
        ownerEmail: opts.ownerEmail,
        teamId: opts.teamId,
      })
      .then((r) => {
        if (cancelled) return;
        setEventType(r.eventType);
        setIsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err);
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [opts.id, opts.slug, opts.ownerEmail, opts.teamId, opts.fetchEventType]);

  return { eventType, isLoading, error };
}
