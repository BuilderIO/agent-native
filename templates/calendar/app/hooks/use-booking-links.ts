import { useMutation, useQueryClient } from "@tanstack/react-query";
import { nanoid } from "nanoid";
import { useActionQuery, useActionMutation } from "@agent-native/core/client";
import type { BookingLink, ConferencingConfig, CustomField } from "@shared/api";

const LIST_KEY = ["action", "list-booking-links"] as const;

export function useBookingLinks() {
  return useActionQuery<BookingLink[]>("list-booking-links");
}

/** Prefix on optimistically-inserted ids so the UI can identify them. */
export const OPTIMISTIC_PREFIX = "optimistic_";

/**
 * Create a booking link with instant, optimistic UI.
 *
 * The mutation inserts a placeholder row into the list cache on `onMutate`
 * (with an `optimistic_*` id) so `useBookingLinks()` and any lookup by id
 * see the new row immediately. Callers can `navigate('/booking-links/' + id)`
 * as soon as they call `mutate(...)` — the detail view will find it in the
 * cache without waiting for the server.
 *
 * On success, the optimistic row is swapped for the server value and URLs
 * using the optimistic id are redirected to the real id.
 *
 * On failure, the optimistic row is removed and the error surfaces on the
 * mutation's `error` field.
 */
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
      /** Optional pre-generated id so the caller can navigate before mutate resolves. */
      optimisticId?: string;
    }
  >("create-booking-link", {
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: LIST_KEY });
      const previous = queryClient.getQueryData<BookingLink[]>(LIST_KEY) ?? [];
      const optimisticId =
        input.optimisticId ?? `${OPTIMISTIC_PREFIX}${nanoid()}`;
      const now = new Date().toISOString();
      const optimistic: BookingLink = {
        id: optimisticId,
        slug: input.slug,
        title: input.title,
        description: input.description,
        duration: input.duration,
        durations: input.durations,
        customFields: input.customFields,
        conferencing: input.conferencing,
        color: input.color,
        isActive: input.isActive ?? true,
        visibility: "private",
        createdAt: now,
        updatedAt: now,
      };
      queryClient.setQueryData<BookingLink[]>(LIST_KEY, [
        ...previous,
        optimistic,
      ]);
      return { previous, optimisticId };
    },
    onSuccess: (created, _input, context) => {
      const optimisticId = (context as any)?.optimisticId as string | undefined;
      queryClient.setQueryData<BookingLink[]>(LIST_KEY, (current = []) =>
        current.map((l) => (l.id === optimisticId ? created : l)),
      );
    },
    onError: (_err, _input, context) => {
      const previous = (context as any)?.previous as BookingLink[] | undefined;
      if (previous !== undefined) {
        queryClient.setQueryData<BookingLink[]>(LIST_KEY, previous);
      }
    },
    onSettled: () => {
      // Sync with server eventually — non-blocking.
      queryClient.invalidateQueries({ queryKey: LIST_KEY });
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
