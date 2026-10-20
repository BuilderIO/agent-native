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
  | ({ status: "saved" } & SavedDraftMetadata)
  | { status: "unavailable"; savedDraft?: SavedDraftMetadata }
  | {
      status: "failed";
      error: unknown;
      savedDraft?: SavedDraftMetadata;
    }
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
        : previousResult && "savedDraft" in previousResult
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
    const result = await save(nextDraft);
    return result.status === "saved"
      ? result
      : { ...result, ...(savedDraft ? { savedDraft } : {}) };
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

export async function deleteCapturedDraftsAfterSaves(
  saveAttempts: Array<{
    id: string;
    promise: Promise<DraftSaveQueueResult>;
  }>,
  pendingMutations: Map<string, Promise<unknown>>,
  ids: string[],
  remove: (id: string) => Promise<unknown>,
): Promise<string[]> {
  const failedIds = new Set<string>();
  await Promise.all(
    saveAttempts.map(async ({ id, promise }) => {
      try {
        const result = await promise;
        if (result.status !== "saved") failedIds.add(id);
      } catch {
        failedIds.add(id);
      }
    }),
  );
  await enqueueCapturedDraftDeletions(
    pendingMutations,
    ids.filter((id) => !failedIds.has(id)),
    remove,
  );
  return [...failedIds];
}

export function applyDraftSaveResult(
  draft: ComposeState,
  result: DraftSaveResult | DraftSaveQueueResult | undefined,
): ComposeState {
  const metadata =
    result?.status === "saved"
      ? result
      : result && "savedDraft" in result
        ? result.savedDraft
        : undefined;
  if (!metadata) return draft;
  return {
    ...draft,
    savedDraftId: metadata.draftId,
    savedDraftBackend: metadata.backend,
    savedDraftAccountEmail: metadata.accountEmail,
  };
}

export function getDraftSaveMetadataUpdate(
  draft: ComposeState | undefined,
  result: DraftSaveQueueResult,
  isRemoved: boolean,
): ComposeState | undefined {
  if (isRemoved || !draft || result.status !== "saved") return undefined;
  if (
    result.draftId === draft.savedDraftId &&
    result.backend === draft.savedDraftBackend &&
    result.accountEmail === draft.savedDraftAccountEmail
  ) {
    return undefined;
  }
  return applyDraftSaveResult(draft, result);
}

export async function deleteSavedDraftAfterPendingSave(
  draft: ComposeState,
  pendingSave: Promise<DraftSaveQueueResult> | undefined,
  deleteSavedDraft: (draft: ComposeState) => Promise<DeleteSavedDraftResult>,
  reportSaveFailure: (result: DraftSaveResult) => void,
): Promise<DeleteSavedDraftResult> {
  let savedDraft = draft;
  if (pendingSave) {
    try {
      const result = await pendingSave;
      const metadata =
        result.status === "saved"
          ? result
          : "savedDraft" in result
            ? result.savedDraft
            : undefined;
      if (metadata) {
        savedDraft = applyDraftSaveResult(savedDraft, {
          status: "saved",
          ...metadata,
        });
      } else if (
        result.status === "failed" ||
        result.status === "unavailable"
      ) {
        reportSaveFailure(result);
      }
    } catch (error) {
      reportSaveFailure({ status: "failed", error });
    }
  }
  return deleteSavedDraft(savedDraft);
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

      qc.setQueryData<ComposeState[]>(["compose-drafts"], (old) => [
        ...(old ?? []),
        draft,
      ]);
      setActiveId(id);

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
        const latest = (
          qc.getQueryData<ComposeState[]>(["compose-drafts"]) ?? []
        ).find((draft) => draft.id === id);
        const updatedDraft = getDraftSaveMetadataUpdate(
          latest,
          result,
          removedDraftIdsRef.current[id] !== undefined,
        );
        if (!updatedDraft) return;

        qc.setQueryData<ComposeState[]>(["compose-drafts"], (old) =>
          (old ?? []).map((draft) => (draft.id === id ? updatedDraft : draft)),
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
      });
    },
    [qc, putMutation, reportDraftSaveResult],
  );

  const update = useCallback(
    (id: string, partial: Partial<ComposeState>) => {
      if (removedDraftIdsRef.current[id] !== undefined) return;
      dirtyRef.current[id] = true;
      draftSaveFailuresRef.current.delete(id);
      const version = (versionRef.current[id] ?? 0) + 1;
      versionRef.current[id] = version;

      qc.setQueryData<ComposeState[]>(["compose-drafts"], (old) =>
        (old ?? []).map((d) => (d.id === id ? { ...d, ...partial } : d)),
      );

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

      if (gmailSaveRef.current[id]) clearTimeout(gmailSaveRef.current[id]);
      gmailSaveRef.current[id] = setTimeout(() => {
        autoSaveToGmail(id);
      }, 3_000);
    },
    [qc, putMutation, autoSaveToGmail],
  );

  const close = useCallback(
    (id: string) => {
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
      const idx = currentDrafts.findIndex((d) => d.id === id);
      const remaining = currentDrafts.filter((d) => d.id !== id);

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

      qc.setQueryData<ComposeState[]>(["compose-drafts"], remaining);

      void enqueueDraftMutation(pendingDraftMutationsRef.current, id, () =>
        deleteMutation.mutateAsync(id),
      ).catch(() => undefined);
      return savePromise;
    },
    [qc, deleteMutation, resolvedActiveId, reportDraftSaveResult],
  );

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

      if (draft) {
        void deleteSavedDraftAfterPendingSave(
          draft,
          pendingSave,
          deleteSavedDraft,
          (result) => reportDraftSaveResult(draft, result),
        ).catch(() =>
          window.dispatchEvent(new Event(DRAFT_DELETE_FAILED_EVENT)),
        );
      }

      if (id === resolvedActiveId) {
        const nextDraft = remaining[Math.min(idx, remaining.length - 1)];
        setActiveId(nextDraft?.id ?? null);
      }

      qc.setQueryData<ComposeState[]>(["compose-drafts"], remaining);
      void enqueueDraftMutation(pendingDraftMutationsRef.current, id, () =>
        deleteMutation.mutateAsync(id),
      ).catch(() => undefined);
    },
    [
      qc,
      deleteMutation,
      deleteSavedDraft,
      reportDraftSaveResult,
      resolvedActiveId,
    ],
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

  const closeAll = useCallback(
    (draftIds?: string[]) => {
      const allDrafts =
        qc.getQueryData<ComposeState[]>(["compose-drafts"]) ?? [];
      const selectedIds = draftIds ? new Set(draftIds) : undefined;
      const currentDrafts = allDrafts.filter(
        (draft) =>
          !stagedSendIds.has(draft.id) &&
          (!selectedIds || selectedIds.has(draft.id)),
      );
      const closingIds = new Set(currentDrafts.map((draft) => draft.id));
      const remainingDrafts = allDrafts.filter(
        (draft) => !closingIds.has(draft.id),
      );
      const draftsById = new Map(
        currentDrafts.map((draft) => [draft.id, draft]),
      );
      const removedAt = Date.now();
      for (const draft of currentDrafts) {
        removedDraftIdsRef.current[draft.id] = removedAt;
      }
      void qc.cancelQueries({ queryKey: ["compose-drafts"] });

      const savePromises = new Map<
        string,
        Promise<DraftSaveQueueResult | undefined>
      >();
      const saveAttempts: Array<{
        id: string;
        promise: Promise<DraftSaveQueueResult>;
      }> = [];
      for (const draft of currentDrafts) {
        if (!hasDraftContent(draft)) {
          savePromises.set(draft.id, Promise.resolve(undefined));
          continue;
        }
        const promise = enqueueDraftSave(
          pendingDraftSavesRef.current,
          draft,
          () => undefined,
          () => removedDraftIdsRef.current[draft.id] !== undefined,
          saveDraftToEmailsBestEffort,
          true,
        ).then(
          async (result) => {
            if (result.status !== "cancelled") {
              reportDraftSaveResult(draft, result);
              if (result.status === "saved") {
                void qc.invalidateQueries({ queryKey: ["emails"] });
              }
            }
            if (result.status !== "saved" && result.savedDraft) {
              const updatedDraft = applyDraftSaveResult(draft, {
                status: "saved",
                ...result.savedDraft,
              });
              draftsById.set(draft.id, updatedDraft);
              qc.setQueryData<ComposeState[]>(["compose-drafts"], (old) => {
                const existing = old ?? [];
                return existing.some((current) => current.id === draft.id)
                  ? existing.map((current) =>
                      current.id === draft.id ? updatedDraft : current,
                    )
                  : [...existing, updatedDraft];
              });
              try {
                await enqueueDraftMutation(
                  pendingDraftMutationsRef.current,
                  draft.id,
                  () => putMutation.mutateAsync(updatedDraft),
                );
              } catch (error) {
                dirtyRef.current[draft.id] = true;
                window.dispatchEvent(
                  new CustomEvent(DRAFT_SAVE_FAILED_EVENT, {
                    detail: { draftId: draft.id },
                  }),
                );
                return {
                  status: "failed",
                  error,
                  savedDraft: result.savedDraft,
                } as const;
              }
            }
            return result;
          },
          (error) => {
            const result = { status: "failed", error } as const;
            reportDraftSaveResult(draft, result);
            return result;
          },
        );
        savePromises.set(draft.id, promise);
        saveAttempts.push({ id: draft.id, promise });
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

      setActiveId((current) =>
        current && closingIds.has(current) ? null : current,
      );
      qc.setQueryData<ComposeState[]>(["compose-drafts"], remainingDrafts);
      const cleanupPromise = deleteCapturedDraftsAfterSaves(
        saveAttempts,
        pendingDraftMutationsRef.current,
        currentDrafts.map((draft) => draft.id),
        (id) => deleteMutation.mutateAsync(id),
      ).then((failedIds) => {
        const failedDrafts = failedIds.flatMap((id) => {
          const draft = draftsById.get(id);
          if (!draft) return [];
          delete removedDraftIdsRef.current[draft.id];
          return [draft];
        });
        if (failedDrafts.length === 0) return failedIds;
        qc.setQueryData<ComposeState[]>(["compose-drafts"], (old) => {
          const existing = old ?? [];
          const existingIds = new Set(existing.map((draft) => draft.id));
          return [
            ...existing,
            ...failedDrafts.filter((draft) => !existingIds.has(draft.id)),
          ];
        });
        setActiveId(
          (current) =>
            current ?? failedDrafts[failedDrafts.length - 1]?.id ?? null,
        );
        return failedIds;
      });
      return new Map(
        currentDrafts.map((draft) => [
          draft.id,
          cleanupPromise.then(() => savePromises.get(draft.id)),
        ]),
      );
    },
    [qc, deleteMutation, putMutation, reportDraftSaveResult, stagedSendIds],
  );

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
