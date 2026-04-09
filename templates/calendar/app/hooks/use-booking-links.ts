import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useActionQuery, useActionMutation } from "@agent-native/core/client";
import type { BookingLink, ConferencingConfig, CustomField } from "@shared/api";

export function useBookingLinks() {
  return useActionQuery<BookingLink[]>("list-booking-links");
}

export function useCreateBookingLink() {
  const queryClient = useQueryClient();
  return useActionMutation<
    BookingLink,
    Pick<BookingLink, "title" | "slug" | "duration"> & {
      description?: string;
      durations?: number[];
      customFields?: CustomField[];
      conferencing?: ConferencingConfig;
      color?: string;
      isActive?: boolean;
    }
  >("create-booking-link", {
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["action", "list-booking-links"],
      });
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
        conferencing?: ConferencingConfig;
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
      queryClient.invalidateQueries({
        queryKey: ["action", "list-booking-links"],
      });
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
      queryClient.invalidateQueries({
        queryKey: ["action", "list-booking-links"],
      });
    },
  });
}
