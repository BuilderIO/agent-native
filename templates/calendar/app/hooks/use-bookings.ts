import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useActionQuery } from "@agent-native/core/client";
import { appApiPath } from "@/lib/api-path";
import type { Booking } from "@shared/api";

export function useBookings() {
  return useActionQuery<Booking[]>("list-bookings");
}

export function useAvailableSlots(
  date: string,
  duration: number,
  slug?: string,
) {
  return useQuery<{ start: string; end: string }[]>({
    queryKey: ["available-slots", date, duration, slug],
    queryFn: async () => {
      const params = new URLSearchParams({ date, duration: String(duration) });
      if (slug) params.set("slug", slug);
      const res = await fetch(
        appApiPath(`/api/bookings/available-slots?${params}`),
      );
      if (!res.ok) throw new Error("Failed to fetch available slots");
      const data = await res.json();
      return Array.isArray(data) ? data : (data.slots ?? []);
    },
    enabled: !!date,
  });
}

export function useAvailableDays(
  from: string,
  to: string,
  duration: number,
  slug?: string,
  enabled = true,
) {
  return useQuery<string[]>({
    queryKey: ["available-days", from, to, duration, slug],
    queryFn: async () => {
      const params = new URLSearchParams({
        from,
        to,
        duration: String(duration),
      });
      if (slug) params.set("slug", slug);
      const res = await fetch(
        appApiPath(`/api/bookings/available-slots?${params}`),
      );
      if (!res.ok) throw new Error("Failed to fetch available days");
      const data = await res.json();
      return Array.isArray(data?.dates) ? data.dates : [];
    },
    enabled: enabled && !!from && !!to,
  });
}

export function useCreateBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      name: string;
      email: string;
      notes?: string;
      captchaToken?: string;
      fieldResponses?: Record<string, string | boolean>;
      start: string;
      end: string;
      slug: string;
    }) => {
      const res = await fetch(appApiPath("/api/bookings/create"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create booking");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["action", "list-bookings"] });
    },
  });
}

export function useDeleteBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(appApiPath(`/api/bookings/${id}`), {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to cancel booking");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["action", "list-bookings"] });
    },
  });
}
