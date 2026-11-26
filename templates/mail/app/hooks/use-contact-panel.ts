import { callAction } from "@agent-native/core/client/hooks";
import { reportWriteFailure } from "@agent-native/core/client/write-failure";
import {
  normalizeContactPanelWidgets,
  type ContactPanelWidgetId,
  type ContactPanelWidgets,
} from "@shared/contact-panel-widgets";
import type {
  AddContactNoteResult,
  ContactAttachmentList,
  ContactMeetings,
  ContactNoteResult,
  UserSettings,
} from "@shared/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useSettings } from "@/hooks/use-emails";
import { TAB_ID } from "@/lib/tab-id";

export function useContactPanelWidgets() {
  const qc = useQueryClient();
  const settings = useSettings();
  const widgets = normalizeContactPanelWidgets(
    settings.data?.contactPanelWidgets,
  );

  const mutation = useMutation({
    mutationFn: (change: Partial<ContactPanelWidgets>) =>
      callAction(
        "update-mail-preferences",
        { contactPanelWidgets: change, requestSource: TAB_ID },
        { method: "PUT", headers: { "X-Request-Source": TAB_ID } },
      ),
    onMutate: async (change) => {
      await qc.cancelQueries({ queryKey: ["settings"] });
      const prev = qc.getQueryData<UserSettings>(["settings"]);
      if (prev) {
        qc.setQueryData<UserSettings>(["settings"], {
          ...prev,
          contactPanelWidgets: normalizeContactPanelWidgets(
            change,
            normalizeContactPanelWidgets(prev.contactPanelWidgets),
          ),
        });
      }
    },
    onError: (error, change) => {
      const current = qc.getQueryData<UserSettings>(["settings"]);
      if (current) {
        const restored = normalizeContactPanelWidgets(
          current.contactPanelWidgets,
        );
        for (const [id, on] of Object.entries(change)) {
          const key = id as ContactPanelWidgetId;
          if (restored[key] === on) restored[key] = !on;
        }
        qc.setQueryData<UserSettings>(["settings"], {
          ...current,
          contactPanelWidgets: restored,
        });
      }
      reportWriteFailure(error);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });

  return {
    widgets,
    loaded: settings.isSuccess,
    setWidget: (id: ContactPanelWidgetId, on: boolean) =>
      mutation.mutate({ [id]: on }),
  };
}

export function useContactAttachments(email: string, enabled: boolean) {
  return useQuery<ContactAttachmentList>({
    queryKey: ["contact-attachments", email],
    queryFn: () =>
      callAction(
        "list-contact-attachments",
        { email, limit: 10 },
        { method: "GET" },
      ) as Promise<ContactAttachmentList>,
    enabled: enabled && Boolean(email),
    staleTime: 60_000,
    retry: false,
  });
}

export function useContactMeetings(email: string, enabled: boolean) {
  return useQuery<ContactMeetings>({
    queryKey: ["contact-meetings", email],
    queryFn: () =>
      callAction(
        "list-contact-meetings",
        { email },
        { method: "GET" },
      ) as Promise<ContactMeetings>,
    enabled: enabled && Boolean(email),
    staleTime: 60_000,
    retry: false,
  });
}

function localDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function useContactNote(email: string, enabled: boolean) {
  return useQuery<ContactNoteResult>({
    queryKey: ["contact-note", email],
    queryFn: () =>
      callAction(
        "get-contact-note",
        { email },
        { method: "GET" },
      ) as Promise<ContactNoteResult>,
    enabled: enabled && Boolean(email),
    staleTime: 30_000,
    retry: false,
  });
}

export function useAddContactNote(email: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      text: string;
      name?: string;
      threadId?: string;
      subject?: string;
    }) =>
      callAction("add-contact-note", {
        email,
        date: localDate(new Date()),
        ...args,
      }) as Promise<AddContactNoteResult>,
    onSuccess: (result) => {
      qc.setQueryData<ContactNoteResult>(["contact-note", email], {
        note: result.note,
      });
    },
  });
}
