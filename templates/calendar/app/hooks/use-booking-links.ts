import {
  useActionQuery,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import type {
  BookingHost,
  BookingLink,
  ConferencingConfig,
  CustomField,
} from "@shared/api";
import { useQueryClient } from "@tanstack/react-query";
import { nanoid } from "nanoid";

const LIST_KEY = ["action", "list-booking-links", undefined] as const;

export function useBookingLinks() {
  return useActionQuery<BookingLink[]>("list-booking-links");
}

export const OPTIMISTIC_PREFIX = "optimistic_";

export function useCreateBookingLink() {
  const queryClient = useQueryClient();
  return useActionMutation<
    BookingLink,
    Pick<BookingLink, "title" | "slug" | "duration"> & {
      description?: string;
      durations?: number[];
      hosts?: BookingHost[];
      customFields?: CustomField[];
      conferencing?: ConferencingConfig;
      color?: string;
      isActive?: boolean;
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
        hosts: input.hosts,
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
      void queryClient.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

export function useUpdateBookingLink() {
  const queryClient = useQueryClient();
  return useActionMutation<
    BookingLink,
    Pick<BookingLink, "id" | "title" | "slug" | "duration" | "isActive"> & {
      description?: string;
      durations?: number[];
      hosts?: BookingHost[];
      customFields?: CustomField[];
      conferencing?: ConferencingConfig;
      color?: string;
    }
  >("update-booking-link", {
    onSuccess: (updated) => {
      queryClient.setQueryData<BookingLink[]>(LIST_KEY, (current = []) =>
        current.map((link) =>
          link.id === updated.id
            ? { ...updated, accessRole: updated.accessRole ?? link.accessRole }
            : link,
        ),
      );
      void queryClient.invalidateQueries({
        queryKey: LIST_KEY,
      });
      void queryClient.invalidateQueries({
        queryKey: ["public-booking-link"],
      });
    },
  });
}

export function useDeleteBookingLink() {
  const queryClient = useQueryClient();
  return useActionMutation<{ ok: true }, { id: string }>(
    "delete-booking-link",
    {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: LIST_KEY,
        });
      },
    },
  );
}
