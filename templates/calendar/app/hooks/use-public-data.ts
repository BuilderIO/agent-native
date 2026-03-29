import { useQuery } from "@tanstack/react-query";
import type { Settings, AvailabilityConfig, BookingLink } from "@shared/api";

/** Fetches settings from the public (unauthenticated) endpoint */
export function usePublicSettings() {
  return useQuery<Settings>({
    queryKey: ["public-settings"],
    queryFn: async () => {
      const res = await fetch("/api/public/settings");
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json();
    },
  });
}

/** Fetches availability from the public (unauthenticated) endpoint */
export function usePublicAvailability() {
  return useQuery<AvailabilityConfig>({
    queryKey: ["public-availability"],
    queryFn: async () => {
      const res = await fetch("/api/public/availability");
      if (!res.ok) throw new Error("Failed to fetch availability");
      return res.json();
    },
  });
}

export function usePublicBookingLink(slug?: string) {
  return useQuery<BookingLink>({
    queryKey: ["public-booking-link", slug],
    queryFn: async () => {
      const res = await fetch(`/api/public/booking-links/${slug}`);
      if (!res.ok) throw new Error("Failed to fetch booking link");
      return res.json();
    },
    enabled: !!slug,
  });
}
