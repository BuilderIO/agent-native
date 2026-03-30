import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BookingLink, CustomField } from "@shared/api";

export function useBookingLinks() {
  return useQuery<BookingLink[]>({
    queryKey: ["booking-links"],
    queryFn: async () => {
      const res = await fetch("/api/booking-links");
      if (!res.ok) throw new Error("Failed to fetch booking links");
      return res.json();
    },
  });
}

export function useCreateBookingLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      data: Pick<BookingLink, "title" | "slug" | "duration"> & {
        description?: string;
        durations?: number[];
        customFields?: CustomField[];
        color?: string;
        isActive?: boolean;
      },
    ) => {
      const res = await fetch("/api/booking-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create booking link");
      return res.json() as Promise<BookingLink>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["booking-links"] });
    },
  });
}

export function useUpdateBookingLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      data: Pick<
        BookingLink,
        "id" | "title" | "slug" | "duration" | "isActive"
      > & {
        description?: string;
        durations?: number[];
        customFields?: CustomField[];
        color?: string;
      },
    ) => {
      const res = await fetch(`/api/booking-links/${data.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update booking link");
      return res.json() as Promise<BookingLink>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["booking-links"] });
    },
  });
}

export function useDeleteBookingLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/booking-links/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete booking link");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["booking-links"] });
    },
  });
}
