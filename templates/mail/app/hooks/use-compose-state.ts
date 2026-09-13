import { agentNativePath } from "@agent-native/core/client/api-path";
import { appApiPath } from "@agent-native/core/client/api-path";
import { useActionMutation } from "@agent-native/core/client/hooks";
import { appendSignatureToBody } from "@shared/signature";
import type { ComposeState, UserSettings } from "@shared/types";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { nanoid } from "nanoid";
import { useState, useRef, useCallback, useEffect } from "react";

import { TAB_ID } from "@/lib/tab-id";

export const FOCUS_COMPOSE_DRAFT_EVENT = "mail:focus-compose-draft";
export const DRAFT_SAVE_FAILED_EVENT = "mail:draft-save-failed";
export const DRAFT_DELETE_FAILED_EVENT = "mail:draft-delete-failed";
const REMOVED_DRAFT_TOMBSTONE_TTL = 60_000;

export type SavedDraftMetadata = {
  draftId: string;
  backend: "gmail" | "local";
  accountEmail?: string;
};

export type DeleteSavedDraftResult =
  | { status: "deleted" }
  | { status: "skipped" }
  | { status: "failed"; error: unknown };

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(
    url.startsWith("/api/") ? appApiPath(url) : agentNativePath(url),
    {
      headers: {
        "Content-Type": "application/json",
        "X-Request-Source": TAB_ID,
      },
      ...options,
    },
  );
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

function pruneRemovedDraftIds(removed: Record<string, number>) {
  const now = Date.now();
  for (const [id, removedAt] of Object.entries(removed)) {
    if (now - removedAt > REMOVED_DRAFT_TOMBSTONE_TTL) {
      delete removed[id];
    }
  }
}

export function filterRemovedDrafts<T extends { id: string }>(
  drafts: T[],
  removed: Record<string, number>,
): T[] {
  pruneRemovedDraftIds(removed);
  return drafts.filter((draft) => removed[draft.id] === undefined);
}

/** Save a compose draft to persistent storage (emails with isDraft=true).
 *  Returns the draftId so callers can track it for subsequent updates. */
async function saveDraftToEmails(
  draft: ComposeState,
): Promise<SavedDraftMetadata | undefined> {
  const result = await apiFetch<{
    draftId?: string;
    backend?: "gmail" | "local";
    accountEmail?: string;
  }>("/api/emails/draft", {
    method: "POST",
    body: JSON.stringify({
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      subject: draft.subject,
      body: draft.body,
      draftId: draft.savedDraftId,
      savedDraftBackend: draft.savedDraftBackend,
      replyToId: draft.replyToId,
      replyToThreadId: draft.replyToThreadId,
      accountEmail: draft.savedDraftAccountEmail ?? draft.accountEmail,
      attachments: draft.attachments,
    }),
  });
  if (!result) return undefined;
  if (
    typeof result.draftId !== "string" ||
    !result.draftId ||
    (result.backend !== "gmail" && result.backend !== "local") ||
    (result.backend === "gmail" && !result.accountEmail)
  ) {
    throw new Error("Draft save response is missing its mailbox metadata");
  }
  return {
    draftId: result.draftId,
    backend: result.backend,
    ...(result.accountEmail ? { accountEmail: result.accountEmail } : {}),
  };
}

export type DraftSaveResult =
  | ({ status: "saved" } & SavedDraftMetadata)
  | { status: "unavailable" }
  | { status: "failed"; error: unknown };

export type DraftSaveQueueResult =
  | DraftSaveResult
  | { status: "cancelled"; savedDraft?: SavedDraftMetadata };

export function enqueueDraftSave(
  pending: Map<string, Promise<DraftSaveQueueResult>>,
  draft: ComposeState,
  getLatestDraft: () => ComposeState | undefined,
  isRemoved: () => boolean,
  save: (draft: ComposeState) => Promise<DraftSaveResult>,
  allowRemoved = false,
): Promise<DraftSaveQueueResult> {
  const previous = pending.get(draft.id);
  const next = (async () => {
    const previousResult = previous ? await previous : undefined;
    const savedDraft =
      previousResult?.status === "saved"
        ? {
            draftId: previousResult.draftId,
            backend: previousResult.backend,
            ...(previousResult.accountEmail
              ? { accountEmail: previousResult.accountEmail }
              : {}),
          }
        : previousResult?.status === "cancelled"
          ? previousResult.savedDraft
          : undefined;

    if (!allowRemoved && isRemoved()) {
      return {
        status: "cancelled",
        ...(savedDraft ? { savedDraft } : {}),
      } as const;
    }

    const latest = getLatestDraft() ?? draft;
    const nextDraft = savedDraft
      ? applyDraftSaveResult(latest, { status: "saved", ...savedDraft })
      : latest;
    return save(nextDraft);
  })();
  pending.set(draft.id, next);
  const clear = () => {
    if (pending.get(draft.id) === next) pending.delete(draft.id);
  };
  void next.then(clear, clear);
  return next;
}

export function enqueueDraftMutation<T>(
  pending: Map<string, Promise<unknown>>,
  id: string,
  mutate: () => Promise<T>,
): Promise<T> {
  const previous = pending.get(id) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(mutate);
  pending.set(id, next);
  const clear = () => {
    if (pending.get(id) === next) pending.delete(id);
  };
  void next.then(clear, clear);
  return next;
}

export function enqueueCapturedDraftDeletions(
  pending: Map<string, Promise<unknown>>,
  ids: string[],
  remove: (id: string) => Promise<unknown>,
): Promise<void> {
  return Promise.all(
    ids.map((id) =>
      enqueueDraftMutation(pending, id, () => remove(id)).then(
        () => undefined,
        () => undefined,
      ),
    ),
  ).then(() => undefined);
}

export function applyDraftSaveResult(
  draft: ComposeState,
  result: DraftSaveResult | undefined,
): ComposeState {
  if (result?.status !== "saved") return draft;
  return {
    ...draft,
    savedDraftId: result.draftId,
    savedDraftBackend: result.backend,
    savedDraftAccountEmail: result.accountEmail,
  };
}

export async function saveDraftToEmailsBestEffort(
  draft: ComposeState,
): Promise<DraftSaveResult> {
  try {
    const savedDraft = await saveDraftToEmails(draft);
    return savedDraft
      ? { status: "saved", ...savedDraft }
      : { status: "unavailable" };
  } catch (error) {
    return { status: "failed", error };
  }
}

export function useComposeState() {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [stagedSendIds, setStagedSendIds] = useState<Set<string>>(
    () => new Set(),
  );
  const dirtyRef = useRef<Record<string, boolean>>({});
  const versionRef = useRef<Record<string, number>>({});
  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const gmailSaveRef = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {},
  );
  const pendingDraftSavesRef = useRef(
    new Map<string, Promise<DraftSaveQueueResult>>(),
  );
  const pendingDraftMutationsRef = useRef(new Map<string, Promise<unknown>>());
  const knownDraftIdsRef = useRef<Set<string> | null>(null);
  const removedDraftIdsRef = useRef<Record<string, number>>({});
  const draftSaveFailuresRef = useRef<Set<string>>(new Set());

  const reportDraftSaveResult = useCallback(
    (draft: ComposeState, result: DraftSaveResult) => {
      if (result.status !== "saved") {
        if (draftSaveFailuresRef.current.has(draft.id)) return;
        draftSaveFailuresRef.current.add(draft.id);
        window.dispatchEvent(
          new CustomEvent(DRAFT_SAVE_FAILED_EVENT, {
            detail: { draftId: draft.id },
          }),
        );
        return;
      }
      draftSaveFailuresRef.current.delete(draft.id);
    },
    [],
  );

  // Fetch all drafts — short staleTime so agent-written drafts appear quickly
  const query = useQuery<ComposeState[]>({
    queryKey: ["compose-drafts"],
    queryFn: async () => {
      const result = await apiFetch<ComposeState[]>(
        "/_agent-native/application-state/compose",
      );
      const serverDrafts = filterRemovedDrafts(
        result ?? [],
        removedDraftIdsRef.current,
      );
      const localDrafts = filterRemovedDrafts(
        qc.getQueryData<ComposeState[]>(["compose-drafts"]) ?? [],
        removedDraftIdsRef.current,
      );
      if (!localDrafts.length) return serverDrafts;

      const merged = serverDrafts.map((serverDraft) => {
        const localDraft = localDrafts.find((d) => d.id === serverDraft.id);
        return localDraft && dirtyRef.current[serverDraft.id]
          ? localDraft
          : serverDraft;
      });

      for (const localDraft of localDrafts) {
        if (
          dirtyRef.current[localDraft.id] &&
          removedDraftIdsRef.current[localDraft.id] === undefined &&
          !merged.some((d) => d.id === localDraft.id)
        ) {
          merged.push(localDraft);
        }
      }

      return merged;
    },
    staleTime: 1_000,
    // request-storm-allow: one focus refresh reconciles bounded compose drafts across tabs.
    refetchOnWindowFocus: true,
  });

  const allDrafts = query.data ?? [];
  const drafts = allDrafts.filter((draft) => !stagedSendIds.has(draft.id));

  useEffect(() => {
    const handleFocusDraft = (event: Event) => {
      const id = (event as CustomEvent<{ id?: unknown }>).detail?.id;
      if (typeof id === "string" && id.trim()) {
        setStagedSendIds((current) => {
          if (!current.has(id)) return current;
          const next = new Set(current);
          next.delete(id);
          return next;
        });
        setActiveId(id);
      }
    };
    window.addEventListener(FOCUS_COMPOSE_DRAFT_EVENT, handleFocusDraft);
    return () =>
      window.removeEventListener(FOCUS_COMPOSE_DRAFT_EVENT, handleFocusDraft);
  }, []);

  useEffect(() => {
    if (!query.isSuccess) return;
    const previousIds = knownDraftIdsRef.current;
    const currentIds = new Set(allDrafts.map((draft) => draft.id));
    knownDraftIdsRef.current = currentIds;
    if (!previousIds) return;

    const newActiveId = newestUnseenPopoutDraftId(previousIds, allDrafts);
    if (newActiveId) setActiveId(newActiveId);
  }, [allDrafts, query.isSuccess]);

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
      apiFetch(`/_agent-native/application-state/compose/${state.id}`, {
        method: "PUT",
        body: JSON.stringify(state),
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/_agent-native/application-state/compose/${id}`, {
        method: "DELETE",
      }),
    onError: () => window.dispatchEvent(new Event(DRAFT_DELETE_FAILED_EVENT)),
  });

  const deleteSavedDraftMutation = useActionMutation("manage-draft", {
    onSuccess: () => qc.invalidateQueries({ queryKey: ["emails"] }),
    onError: () => window.dispatchEvent(new Event(DRAFT_DELETE_FAILED_EVENT)),
  });

  const deleteSavedDraft = useCallback(
    async (
      draft: Pick<
        ComposeState,
        | "savedDraftId"
        | "savedDraftBackend"
        | "savedDraftAccountEmail"
        | "accountEmail"
      >,
    ) => {
      if (!draft.savedDraftId) return { status: "skipped" } as const;
      try {
        await deleteSavedDraftMutation.mutateAsync({
          action: "delete-saved",
          savedDraftId: draft.savedDraftId,
          savedDraftBackend: draft.savedDraftBackend,
          accountEmail: draft.savedDraftAccountEmail ?? draft.accountEmail,
        });
        return { status: "deleted" } as const;
      } catch (error) {
        return { status: "failed", error } as const;
      }
    },
    [deleteSavedDraftMutation],
  );

  /** Open a new draft tab. Returns the new draft's id. */
  const open = useCallback(
    (state: Omit<ComposeState, "id">) => {
      const id = nanoid(10);
      const settings = qc.getQueryData<UserSettings>(["settings"]);
      const shouldAppendSignature = !state.savedDraftId && !state.queuedDraftId;
      const draft: ComposeState = {
        ...state,
        body: shouldAppendSignature
          ? appendSignatureToBody(state.body, settings?.signature)
          : state.body,
        id,
      };
      delete removedDraftIdsRef.current[id];

      // Optimistically add to cache
      qc.setQueryData<ComposeState[]>(["compose-drafts"], (old) => [
        ...(old ?? []),
        draft,
      ]);
      setActiveId(id);

      // Persist to server
      void enqueueDraftMutation(pendingDraftMutationsRef.current, id, () =>
        putMutation.mutateAsync(draft),
      ).catch(() =>
        window.dispatchEvent(
          new CustomEvent(DRAFT_SAVE_FAILED_EVENT, { detail: { draftId: id } }),
        ),
      );

      return id;
    },
    [qc, putMutation],
  );

  /** Auto-save a draft to Gmail/persistent storage, storing the returned draftId. */
  const autoSaveToGmail = useCallback(
    (id: string) => {
      const current = (
        qc.getQueryData<ComposeState[]>(["compose-drafts"]) ?? []
      ).find((d) => d.id === id);
      if (!current || !hasDraftContent(current)) return;

      void enqueueDraftSave(
        pendingDraftSavesRef.current,
        current,
        () =>
          (qc.getQueryData<ComposeState[]>(["compose-drafts"]) ?? []).find(
            (draft) => draft.id === id,
          ),
        () => removedDraftIdsRef.current[id] !== undefined,
        saveDraftToEmailsBestEffort,
      ).then((result) => {
        if (result.status === "cancelled") return;
        reportDraftSaveResult(current, result);
        if (result.status !== "saved" || removedDraftIdsRef.current[id]) return;

        const latest = (
          qc.getQueryData<ComposeState[]>(["compose-drafts"]) ?? []
        ).find((draft) => draft.id === id);
        if (!latest) return;

        if (
          result.draftId !== latest.savedDraftId ||
          result.backend !== latest.savedDraftBackend ||
          result.accountEmail !== latest.savedDraftAccountEmail
        ) {
          const updatedDraft = applyDraftSaveResult(latest, result);
          qc.setQueryData<ComposeState[]>(["compose-drafts"], (old) =>
            (old ?? []).map((draft) =>
              draft.id === id ? updatedDraft : draft,
            ),
          );
          void enqueueDraftMutation(pendingDraftMutationsRef.current, id, () =>
            putMutation.mutateAsync(updatedDraft),
          ).catch(() =>
            window.dispatchEvent(
              new CustomEvent(DRAFT_SAVE_FAILED_EVENT, {
                detail: { draftId: id },
              }),
            ),
          );
        }
      });
    },
    [qc, putMutation, reportDraftSaveResult],
  );

  /** Update a specific draft (debounced 300ms for app-state, 3s for Gmail). */
  const update = useCallback(
    (id: string, partial: Partial<ComposeState>) => {
      if (removedDraftIdsRef.current[id] !== undefined) return;
      dirtyRef.current[id] = true;
      draftSaveFailuresRef.current.delete(id);
      const version = (versionRef.current[id] ?? 0) + 1;
      versionRef.current[id] = version;

      // Optimistic cache update
      qc.setQueryData<ComposeState[]>(["compose-drafts"], (old) =>
        (old ?? []).map((d) => (d.id === id ? { ...d, ...partial } : d)),
      );

      // Debounced write to application-state (300ms)
      if (debounceRef.current[id]) clearTimeout(debounceRef.current[id]);
      debounceRef.current[id] = setTimeout(() => {
        const current = (
          qc.getQueryData<ComposeState[]>(["compose-drafts"]) ?? []
        ).find((d) => d.id === id);
        if (current) {
          void enqueueDraftMutation(pendingDraftMutationsRef.current, id, () =>
            putMutation.mutateAsync(current),
          ).then(
            () => {
              if (versionRef.current[id] === version) {
                dirtyRef.current[id] = false;
              }
            },
            () =>
              window.dispatchEvent(
                new CustomEvent(DRAFT_SAVE_FAILED_EVENT, {
                  detail: { draftId: id },
                }),
              ),
          );
        }
      }, 300);

      // Debounced auto-save to Gmail (3s)
      if (gmailSaveRef.current[id]) clearTimeout(gmailSaveRef.current[id]);
      gmailSaveRef.current[id] = setTimeout(() => {
        autoSaveToGmail(id);
      }, 3_000);
    },
    [qc, putMutation, autoSaveToGmail],
  );

  /** Close a single draft tab — auto-saves to Drafts if it has content. */
  const close = useCallback(
    (id: string) => {
      removedDraftIdsRef.current[id] = Date.now();
      void qc.cancelQueries({ queryKey: ["compose-drafts"] });
      // Clear debounce timers
      if (debounceRef.current[id]) clearTimeout(debounceRef.current[id]);
      if (gmailSaveRef.current[id]) clearTimeout(gmailSaveRef.current[id]);
      delete dirtyRef.current[id];
      delete versionRef.current[id];
      delete debounceRef.current[id];
      delete gmailSaveRef.current[id];

      // Get the draft before removing it
      const currentDrafts =
        qc.getQueryData<ComposeState[]>(["compose-drafts"]) ?? [];
      const draft = currentDrafts.find((d) => d.id === id);
      const idx = currentDrafts.findIndex((d) => d.id === id);
      const remaining = currentDrafts.filter((d) => d.id !== id);

      // Keep the save result available to close-toast actions that reopen or delete it.
      const savePromise =
        draft && hasDraftContent(draft)
          ? enqueueDraftSave(
              pendingDraftSavesRef.current,
              draft,
              () =>
                (
                  qc.getQueryData<ComposeState[]>(["compose-drafts"]) ?? []
                ).find((current) => current.id === id),
              () => removedDraftIdsRef.current[id] !== undefined,
              saveDraftToEmailsBestEffort,
              true,
            ).then((result) => {
              if (result.status === "cancelled") {
                throw new Error("Closed draft save was cancelled");
              }
              reportDraftSaveResult(draft, result);
              if (result.status === "saved") {
                void qc.invalidateQueries({ queryKey: ["emails"] });
              }
              return result;
            })
          : undefined;

      if (id === resolvedActiveId) {
        const nextDraft = remaining[Math.min(idx, remaining.length - 1)];
        setActiveId(nextDraft?.id ?? null);
      }

      // Remove from cache
      qc.setQueryData<ComposeState[]>(["compose-drafts"], remaining);

      // Delete compose file
      void enqueueDraftMutation(pendingDraftMutationsRef.current, id, () =>
        deleteMutation.mutateAsync(id),
      ).catch(() => undefined);
      return savePromise;
    },
    [qc, deleteMutation, resolvedActiveId, reportDraftSaveResult],
  );

  /** Discard a single draft — closes WITHOUT saving to Drafts.
   *  If a Gmail draft was already created by auto-save, delete it. */
  const discard = useCallback(
    (id: string) => {
      setStagedSendIds((current) => {
        if (!current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      removedDraftIdsRef.current[id] = Date.now();
      void qc.cancelQueries({ queryKey: ["compose-drafts"] });
      if (debounceRef.current[id]) clearTimeout(debounceRef.current[id]);
      if (gmailSaveRef.current[id]) clearTimeout(gmailSaveRef.current[id]);
      delete dirtyRef.current[id];
      delete versionRef.current[id];
      delete debounceRef.current[id];
      delete gmailSaveRef.current[id];

      const currentDrafts =
        qc.getQueryData<ComposeState[]>(["compose-drafts"]) ?? [];
      const draft = currentDrafts.find((d) => d.id === id);
      const pendingSave = pendingDraftSavesRef.current.get(id);
      const idx = currentDrafts.findIndex((d) => d.id === id);
      const remaining = currentDrafts.filter((d) => d.id !== id);

      const deleteSavedCopy = async () => {
        if (!draft) return;
        let savedDraft = draft;
        if (pendingSave) {
          const result = await pendingSave;
          const metadata =
            result.status === "saved"
              ? result
              : result.status === "cancelled"
                ? result.savedDraft
                : undefined;
          if (metadata) {
            savedDraft = applyDraftSaveResult(savedDraft, {
              status: "saved",
              ...metadata,
            });
          }
        }
        await deleteSavedDraft(savedDraft);
      };
      void deleteSavedCopy().catch(() =>
        window.dispatchEvent(new Event(DRAFT_DELETE_FAILED_EVENT)),
      );

      if (id === resolvedActiveId) {
        const nextDraft = remaining[Math.min(idx, remaining.length - 1)];
        setActiveId(nextDraft?.id ?? null);
      }

      qc.setQueryData<ComposeState[]>(["compose-drafts"], remaining);
      void enqueueDraftMutation(pendingDraftMutationsRef.current, id, () =>
        deleteMutation.mutateAsync(id),
      ).catch(() => undefined);
    },
    [qc, deleteMutation, deleteSavedDraft, resolvedActiveId],
  );

  const stageForSend = useCallback(
    (id: string) => {
      if (
        !(qc.getQueryData<ComposeState[]>(["compose-drafts"]) ?? []).some(
          (draft) => draft.id === id,
        )
      ) {
        return;
      }
      setStagedSendIds((current) => new Set(current).add(id));
      setActiveId((current) => (current === id ? null : current));
    },
    [qc],
  );

  const restoreAfterSend = useCallback((id: string) => {
    setStagedSendIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setActiveId(id);
  }, []);

  /** Close all drafts — auto-saves any with content. */
  const closeAll = useCallback(() => {
    const allDrafts = qc.getQueryData<ComposeState[]>(["compose-drafts"]) ?? [];
    const stagedDrafts = allDrafts.filter((draft) =>
      stagedSendIds.has(draft.id),
    );
    const currentDrafts = allDrafts.filter(
      (draft) => !stagedSendIds.has(draft.id),
    );
    const removedAt = Date.now();
    for (const draft of currentDrafts) {
      removedDraftIdsRef.current[draft.id] = removedAt;
    }
    void qc.cancelQueries({ queryKey: ["compose-drafts"] });

    // Save all drafts with content
    for (const draft of currentDrafts) {
      if (hasDraftContent(draft)) {
        void enqueueDraftSave(
          pendingDraftSavesRef.current,
          draft,
          () => undefined,
          () => removedDraftIdsRef.current[draft.id] !== undefined,
          saveDraftToEmailsBestEffort,
          true,
        ).then(
          (result) => {
            if (result.status === "cancelled") return;
            reportDraftSaveResult(draft, result);
            if (result.status === "saved") {
              void qc.invalidateQueries({ queryKey: ["emails"] });
            }
          },
          () =>
            window.dispatchEvent(
              new CustomEvent(DRAFT_SAVE_FAILED_EVENT, {
                detail: { draftId: draft.id },
              }),
            ),
        );
      }
    }

    for (const draft of currentDrafts) {
      const id = draft.id;
      if (debounceRef.current[id]) clearTimeout(debounceRef.current[id]);
      if (gmailSaveRef.current[id]) clearTimeout(gmailSaveRef.current[id]);
      delete debounceRef.current[id];
      delete gmailSaveRef.current[id];
      delete dirtyRef.current[id];
      delete versionRef.current[id];
    }

    setActiveId(null);
    qc.setQueryData<ComposeState[]>(["compose-drafts"], stagedDrafts);
    void enqueueCapturedDraftDeletions(
      pendingDraftMutationsRef.current,
      currentDrafts.map((draft) => draft.id),
      (id) => deleteMutation.mutateAsync(id),
    );
  }, [qc, deleteMutation, reportDraftSaveResult, stagedSendIds]);

  /** Flush a specific draft immediately (for Generate button). */
  const flush = useCallback(
    (id: string) => {
      if (debounceRef.current[id]) clearTimeout(debounceRef.current[id]);
      if (gmailSaveRef.current[id]) clearTimeout(gmailSaveRef.current[id]);
      const current = (
        qc.getQueryData<ComposeState[]>(["compose-drafts"]) ?? []
      ).find((d) => d.id === id);
      if (current) {
        dirtyRef.current[id] = false;
        versionRef.current[id] = versionRef.current[id] ?? 0;
        // Also trigger Gmail save immediately
        if (hasDraftContent(current)) autoSaveToGmail(id);
        return enqueueDraftMutation(pendingDraftMutationsRef.current, id, () =>
          putMutation.mutateAsync(current),
        );
      }
    },
    [qc, putMutation, autoSaveToGmail],
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
    stageForSend,
    restoreAfterSend,
    deleteSavedDraft,
    setActiveId,
    flush,
  };
}

export function newestUnseenPopoutDraftId(
  previousIds: ReadonlySet<string>,
  drafts: ComposeState[],
) {
  for (let i = drafts.length - 1; i >= 0; i -= 1) {
    const draft = drafts[i];
    if (!draft.inline && !previousIds.has(draft.id)) return draft.id;
  }
  return null;
}
