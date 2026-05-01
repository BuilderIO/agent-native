import { useActionMutation, useActionQuery } from "@agent-native/core/client";

export type QueuedDraftStatus = "queued" | "in_review" | "sent" | "dismissed";

export type QueuedEmailDraft = {
  id: string;
  orgId: string;
  ownerEmail: string;
  requesterEmail: string;
  requesterName: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  context: string;
  source: string;
  sourceThreadId: string;
  accountEmail: string;
  composeId: string;
  sentMessageId: string;
  status: QueuedDraftStatus;
  createdAt: number;
  updatedAt: number;
  sentAt: number | null;
};

export type DraftQueueMember = {
  email: string;
  role: string;
  joinedAt: number;
};

type DraftListResponse = {
  drafts: QueuedEmailDraft[];
  count: number;
};

type MemberListResponse = {
  orgId: string;
  currentUser: string;
  members: DraftQueueMember[];
};

export function useQueuedDrafts(params?: {
  scope?: "review" | "requested" | "all";
  status?: QueuedDraftStatus | "active" | "all";
  ownerEmail?: string;
  limit?: number;
}) {
  const query = useActionQuery("list-queued-drafts", params ?? {}, {
    staleTime: 5_000,
    refetchInterval: 30_000,
    retry: false,
  });
  const data = query.data as DraftListResponse | null | undefined;
  return {
    ...query,
    drafts: data?.drafts ?? [],
    count: data?.count ?? 0,
  };
}

export function useQueuedDraftCount() {
  const query = useQueuedDrafts({
    scope: "review",
    status: "active",
    limit: 100,
  });
  return {
    count: query.count,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

export function useDraftQueueMembers() {
  const query = useActionQuery(
    "list-org-members",
    {},
    {
      staleTime: 60_000,
      retry: false,
    },
  );
  const data = query.data as MemberListResponse | null | undefined;
  return {
    ...query,
    orgId: data?.orgId ?? "",
    currentUser: data?.currentUser ?? "",
    members: data?.members ?? [],
  };
}

export function useQueueEmailDraft() {
  return useActionMutation("queue-email-draft");
}

export function useUpdateQueuedDraft() {
  return useActionMutation("update-queued-draft");
}

export function useOpenQueuedDraft() {
  return useActionMutation("open-queued-draft");
}

export function useSendQueuedDrafts() {
  return useActionMutation("send-queued-drafts");
}
