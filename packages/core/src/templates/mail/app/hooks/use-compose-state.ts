import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { nanoid } from "nanoid";
import type { ComposeState } from "@shared/types";
import { TAB_ID } from "@/lib/tab-id";

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "X-Request-Source": TAB_ID,
    },
    ...options,
  });
  if (!res.ok) {
    if (res.status === 404) return undefined as T;
    throw new Error(`Request failed (${res.status})`);
  }
  return res.json();
}

/** Check if a compose draft has any meaningful content worth saving */
function hasDraftContent(draft: ComposeState): boolean {
  return !!(
    draft.to?.trim() ||
    draft.cc?.trim() ||
    draft.bcc?.trim() ||
    draft.subject?.trim() ||
    draft.body?.trim()
  );
}

/** Save a compose draft to persistent storage (emails with isDraft=true) */
async function saveDraftToEmails(draft: ComposeState): Promise<void> {
  await apiFetch("/api/emails/draft", {
    method: "POST",
    body: JSON.stringify({
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      subject: draft.subject,
      body: draft.body,
      draftId: draft.savedDraftId,
      replyToId: draft.replyToId,
      replyToThreadId: draft.replyToThreadId,
    }),
  });
}

export function useComposeState() {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const dirtyRef = useRef<Record<string, boolean>>({});
  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Fetch all drafts — short staleTime so agent-written drafts appear quickly
  const query = useQuery<ComposeState[]>({
    queryKey: ["compose-drafts"],
    queryFn: async () => {
      const result = await apiFetch<ComposeState[]>(
        "/api/application-state/compose",
      );
      return result ?? [];
    },
    staleTime: 1_000,
    refetchOnWindowFocus: true,
  });

  const drafts = query.data ?? [];

  // Resolve activeId: use current if valid, else last draft, else null
  const resolvedActiveId =
    activeId && drafts.some((d) => d.id === activeId)
      ? activeId
      : drafts.length > 0
        ? drafts[drafts.length - 1].id
        : null;

  const activeDraft = drafts.find((d) => d.id === resolvedActiveId) ?? null;

  const putMutation = useMutation({
    mutationFn: (state: ComposeState) =>
      apiFetch(`/api/application-state/compose/${state.id}`, {
        method: "PUT",
        body: JSON.stringify(state),
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/application-state/compose/${id}`, { method: "DELETE" }),
  });

  const deleteAllMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/application-state/compose", { method: "DELETE" }),
  });

  /** Open a new draft tab. Returns the new draft's id. */
  const open = useCallback(
    (state: Omit<ComposeState, "id">) => {
      const id = nanoid(10);
      const draft: ComposeState = { ...state, id };

      // Optimistically add to cache
      qc.setQueryData<ComposeState[]>(["compose-drafts"], (old) => [
        ...(old ?? []),
        draft,
      ]);
      setActiveId(id);

      // Persist to server
      putMutation.mutate(draft);

      return id;
    },
    [qc, putMutation],
  );

  /** Update a specific draft (debounced 300ms). */
  const update = useCallback(
    (id: string, partial: Partial<ComposeState>) => {
      dirtyRef.current[id] = true;

      // Optimistic cache update
      qc.setQueryData<ComposeState[]>(["compose-drafts"], (old) =>
        (old ?? []).map((d) => (d.id === id ? { ...d, ...partial } : d)),
      );

      // Debounced write
      if (debounceRef.current[id]) clearTimeout(debounceRef.current[id]);
      debounceRef.current[id] = setTimeout(() => {
        const current = (
          qc.getQueryData<ComposeState[]>(["compose-drafts"]) ?? []
        ).find((d) => d.id === id);
        if (current) {
          putMutation.mutate(current, {
            onSettled: () => {
              dirtyRef.current[id] = false;
            },
          });
        }
      }, 300);
    },
    [qc, putMutation],
  );

  /** Close a single draft tab — auto-saves to Drafts if it has content. */
  const close = useCallback(
    (id: string) => {
      // Clear debounce timer
      if (debounceRef.current[id]) clearTimeout(debounceRef.current[id]);
      delete dirtyRef.current[id];
      delete debounceRef.current[id];

      // Get the draft before removing it
      const currentDrafts =
        qc.getQueryData<ComposeState[]>(["compose-drafts"]) ?? [];
      const draft = currentDrafts.find((d) => d.id === id);
      const idx = currentDrafts.findIndex((d) => d.id === id);
      const remaining = currentDrafts.filter((d) => d.id !== id);

      // Auto-save to persistent drafts if there's any content
      if (draft && hasDraftContent(draft)) {
        saveDraftToEmails(draft).then(() => {
          qc.invalidateQueries({ queryKey: ["emails"] });
        });
      }

      if (id === resolvedActiveId) {
        const nextDraft = remaining[Math.min(idx, remaining.length - 1)];
        setActiveId(nextDraft?.id ?? null);
      }

      // Remove from cache
      qc.setQueryData<ComposeState[]>(["compose-drafts"], remaining);

      // Delete compose file
      deleteMutation.mutate(id);
    },
    [qc, deleteMutation, resolvedActiveId],
  );

  /** Discard a single draft — closes WITHOUT saving to Drafts. */
  const discard = useCallback(
    (id: string) => {
      if (debounceRef.current[id]) clearTimeout(debounceRef.current[id]);
      delete dirtyRef.current[id];
      delete debounceRef.current[id];

      const currentDrafts =
        qc.getQueryData<ComposeState[]>(["compose-drafts"]) ?? [];
      const idx = currentDrafts.findIndex((d) => d.id === id);
      const remaining = currentDrafts.filter((d) => d.id !== id);

      if (id === resolvedActiveId) {
        const nextDraft = remaining[Math.min(idx, remaining.length - 1)];
        setActiveId(nextDraft?.id ?? null);
      }

      qc.setQueryData<ComposeState[]>(["compose-drafts"], remaining);
      deleteMutation.mutate(id);
    },
    [qc, deleteMutation, resolvedActiveId],
  );

  /** Close all drafts — auto-saves any with content. */
  const closeAll = useCallback(() => {
    const currentDrafts =
      qc.getQueryData<ComposeState[]>(["compose-drafts"]) ?? [];

    // Save all drafts with content
    for (const draft of currentDrafts) {
      if (hasDraftContent(draft)) {
        saveDraftToEmails(draft).then(() => {
          qc.invalidateQueries({ queryKey: ["emails"] });
        });
      }
    }

    for (const timer of Object.values(debounceRef.current)) clearTimeout(timer);
    debounceRef.current = {};
    dirtyRef.current = {};

    setActiveId(null);
    qc.setQueryData<ComposeState[]>(["compose-drafts"], []);
    deleteAllMutation.mutate();
  }, [qc, deleteAllMutation]);

  /** Flush a specific draft immediately (for Generate button). */
  const flush = useCallback(
    (id: string) => {
      if (debounceRef.current[id]) clearTimeout(debounceRef.current[id]);
      const current = (
        qc.getQueryData<ComposeState[]>(["compose-drafts"]) ?? []
      ).find((d) => d.id === id);
      if (current) {
        dirtyRef.current[id] = false;
        return putMutation.mutateAsync(current);
      }
    },
    [qc, putMutation],
  );

  return {
    drafts,
    activeId: resolvedActiveId,
    activeDraft,
    isLoading: query.isLoading,
    open,
    update,
    close,
    closeAll,
    discard,
    setActiveId,
    flush,
  };
}
