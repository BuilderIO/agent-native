import { useQuery } from "@tanstack/react-query";
import { appApiPath } from "@/lib/api-path";
import type { Settings, AvailabilityConfig, BookingLink } from "@shared/api";

/** Fetches settings from the public (unauthenticated) endpoint */
export function usePublicSettings() {
  return useQuery<Settings>({
    queryKey: ["public-settings"],
    queryFn: async () => {
      const res = await fetch(appApiPath("/api/public/settings"));
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json();
    },
  });
}

/** Fetches availability from the public (unauthenticated) endpoint */
export function usePublicAvailability(slug?: string) {
  return useQuery<AvailabilityConfig>({
    queryKey: ["public-availability", slug],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (slug) params.set("slug", slug);
      const path = params.size
        ? `/api/public/availability?${params}`
        : "/api/public/availability";
      const res = await fetch(appApiPath(path));
      if (!res.ok) throw new Error("Failed to fetch availability");
      return res.json();
    },
  });
}

export function usePublicBookingLink(slug?: string) {
  return useQuery<BookingLink & { redirect?: string }>({
    queryKey: ["public-booking-link", slug],
    queryFn: async () => {
      const res = await fetch(appApiPath(`/api/public/booking-links/${slug}`));
      if (!res.ok) throw new Error("Failed to fetch booking link");
      return res.json();
    },
    enabled: !!slug,
  });
}
