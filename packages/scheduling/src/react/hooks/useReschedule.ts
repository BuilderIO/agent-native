/**
 * useReschedule — fetch an existing booking + drive the Booker through a
 * reschedule flow that replaces its start/end time.
 */
import { useEffect, useState } from "react";
import type { Booking } from "../../shared/index.js";

export interface UseRescheduleOpts {
  uid: string;
  fetchBooking: (uid: string) => Promise<{ booking: Booking | null }>;
}

export function useReschedule(opts: UseRescheduleOpts) {
  const [booking, setBooking] = useState<Booking | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    opts
      .fetchBooking(opts.uid)
      .then((r) => {
        if (cancelled) return;
        setBooking(r.booking);
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
  }, [opts.uid, opts.fetchBooking]);

  return { booking, isLoading, error };
}
