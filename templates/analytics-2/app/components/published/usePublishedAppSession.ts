import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useState, useRef } from "react";

import type { Cell } from "@/lib/model/contracts";

import {
  inputValueFromControl,
  serializeInputValue,
  type AppSessionOperation,
  type AppSessionProjection,
  type AppSessionRefresh,
  type SavedAppView,
} from "../../../shared/app-session-operations";
import type { InputUpdate } from "./PublishedInputControl";

type OpenSession = {
  projectId: string;
  version: string;
  sessionId?: string;
  savedViewId?: string;
};

function stableOpenId(route: OpenSession) {
  if (route.sessionId || route.savedViewId || typeof window === "undefined") {
    return crypto.randomUUID();
  }
  const key = `analytics2:published-open-id:${route.projectId}:${route.version}`;
  try {
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const created = crypto.randomUUID();
    window.sessionStorage.setItem(key, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

export function usePublishedAppSession(route: OpenSession) {
  const [openId] = useState(() => stableOpenId(route));
  const opened = useActionQuery<AppSessionProjection>(
    "open-published-app-session",
    { ...route, openId },
    {
      method: "POST",
      enabled: route.projectId.length > 0,
      retry: false,
      staleTime: Infinity,
    },
  );
  const pinned = opened.data;
  const observed = useActionQuery<AppSessionProjection>(
    "get-published-app-session",
    { sessionId: pinned?.sessionId ?? "", releaseId: pinned?.releaseId ?? "" },
    {
      enabled: pinned !== undefined,
      initialData: () => pinned,
      staleTime: 750,
      retry: false,
      refetchInterval: (query) =>
        query.state.data?.state === "running" ? 750 : false,
    },
  );
  const readError = opened.error ?? observed.error;
  const status =
    readError && "status" in readError ? readError.status : undefined;
  const accessDenied = status === 401 || status === 403 || status === 404;
  const session = accessDenied ? undefined : (observed.data ?? pinned);
  const [applying, setApplying] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [drafts, setDrafts] = useState<Record<string, { value: string }>>({});
  const draftsRef = useRef(drafts);
  const current = useRef(session);
  if (accessDenied) current.current = undefined;
  else if (
    session &&
    (!current.current ||
      BigInt(current.current.inputRevision) <= BigInt(session.inputRevision))
  )
    current.current = session;
  const pending = useRef(Promise.resolve());
  const write = <T>(change: (current: AppSessionProjection) => Promise<T>) => {
    setApplying((count) => count + 1);
    setError(null);
    const task = pending.current.then(async () => {
      const next = current.current;
      if (!next) throw new Error("Published app session unavailable");
      return change(next);
    });
    pending.current = task.then(
      () => setApplying((count) => count - 1),
      (cause: unknown) => {
        setApplying((count) => count - 1);
        setError(cause);
      },
    );
    return task;
  };

  function updateDrafts(next: typeof drafts) {
    draftsRef.current = next;
    setDrafts(next);
  }

  async function readback() {
    const result = await observed.refetch();
    if (result.error) throw result.error;
    if (result.data) current.current = result.data;
  }

  const values = Object.fromEntries(
    Object.entries(session?.effectiveValues ?? {}).map(([id, value]) => [
      id,
      serializeInputValue(value),
    ]),
  );
  for (const [id, draft] of Object.entries(drafts)) values[id] = draft.value;

  function changeInput(cell: Cell, value: string) {
    updateDrafts({ ...draftsRef.current, [cell.id]: { value } });
  }

  function commitInput(cell: Cell, value: string, optionsResultId?: string) {
    commitInputs([
      { cell, value, ...(optionsResultId ? { optionsResultId } : {}) },
    ]);
  }

  function commitInputs(updates: InputUpdate[]) {
    if (
      !updates.length ||
      updates.some(({ cell }) => cell.contents.kind !== "input")
    )
      return;
    const drafts = { ...draftsRef.current };
    for (const { cell, value } of updates) drafts[cell.id] = { value };
    updateDrafts(drafts);
    const captured = updates.map(({ cell }) => ({
      id: cell.id,
      draft: drafts[cell.id],
    }));
    void write(async (latest) => {
      const changed = updates.flatMap(({ cell, value, optionsResultId }) => {
        if (cell.contents.kind !== "input") return [];
        const next = inputValueFromControl(cell.contents, value);
        return JSON.stringify(latest.effectiveValues[cell.id]) ===
          JSON.stringify(next)
          ? []
          : [
              {
                inputCellId: cell.id,
                value: next,
                ...(optionsResultId ? { optionsResultId } : {}),
              },
            ];
      });
      if (changed.length) {
        const receipt = await callAction<AppSessionOperation>(
          "set-published-app-inputs",
          {
            ...operation(latest),
            updates: changed,
          },
        );
        current.current = {
          ...latest,
          inputRevision: receipt.inputRevision,
          effectiveValues: receipt.effectiveValues,
        };
        await readback();
      }
    }).then(
      () => {
        for (const { id, draft } of captured) clearDraft(id, draft);
      },
      async () => {
        for (const { id, draft } of captured) clearDraft(id, draft);
        await observed.refetch();
      },
    );
  }

  function clearDraft(id: string, draft: { value: string } | undefined) {
    if (!draft || draftsRef.current[id] !== draft) return;
    const next = { ...draftsRef.current };
    delete next[id];
    updateDrafts(next);
  }

  function reset() {
    updateDrafts({});
    void write(async (latest) => {
      const receipt = await callAction<AppSessionOperation>(
        "reset-published-app-session",
        operation(latest),
      );
      current.current = {
        ...latest,
        inputRevision: receipt.inputRevision,
        effectiveValues: receipt.effectiveValues,
      };
      await readback();
    }).catch(async () => {
      await observed.refetch();
    });
  }

  function refresh(
    scope: "session" | "default",
    cachePolicy: "reuse" | "bypass",
  ) {
    void write(async (latest) => {
      await callAction<AppSessionRefresh>("refresh-published-app-results", {
        sessionId: latest.sessionId,
        releaseId: latest.releaseId,
        requestId: crypto.randomUUID(),
        scope,
        cachePolicy,
      });
      await readback();
    }).catch(async () => {
      await observed.refetch();
    });
  }

  function saveView(name: string) {
    return write((latest) =>
      callAction<SavedAppView>("save-published-app-view", {
        ...operation(latest),
        name,
      }),
    );
  }

  return {
    session,
    error: readError ?? error,
    accessDenied,
    loading: opened.isPending,
    busy: applying > 0 || session?.state === "running",
    values,
    changeInput,
    commitInput,
    commitInputs,
    reset,
    refresh,
    retry: () => {
      void (pinned ? observed.refetch() : opened.refetch());
    },
    saveView,
  };
}

function operation(session: AppSessionProjection) {
  return {
    sessionId: session.sessionId,
    releaseId: session.releaseId,
    requestId: crypto.randomUUID(),
    expectedInputRevision: session.inputRevision,
  };
}
