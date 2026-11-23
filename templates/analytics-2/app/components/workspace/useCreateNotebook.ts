import { actionErrorCode, callAction } from "@agent-native/core/client/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import {
  applyNotebookCommand,
  readTitleSnapshot,
  titleCommand,
} from "@/components/notebook/notebook-title";

import {
  creationReceiptSchema,
  projectCreationSchema,
  type CreationReceipt,
} from "../../../shared/notebook-creation";
import {
  type NotebookCommand,
  type NotebookSnapshot,
} from "../../../shared/notebook-operations";

type Phase =
  | "creating"
  | "checking"
  | "ready"
  | "createFailed"
  | "denied"
  | "savingTitle"
  | "titleFailed"
  | "titleChanged";

type Creation = {
  requestId: string;
  ownerScope: string;
  phase: Phase;
  routeIdentity: string;
  editingTitle: boolean;
  title: string | null;
  receipt?: CreationReceipt;
  snapshot?: NotebookSnapshot;
  command?: NotebookCommand;
  needsLookup?: boolean;
};

const PENDING_KEY = "analytics-2:pending-project-creation";

function pendingKey(ownerScope: string) {
  return `${PENDING_KEY}:${ownerScope}`;
}

function readPendingRequestId(ownerScope: string): string | undefined {
  try {
    return window.sessionStorage.getItem(pendingKey(ownerScope)) ?? undefined;
  } catch {
    return undefined;
  }
}

function retainRequestId(ownerScope: string, requestId: string) {
  try {
    window.sessionStorage.setItem(pendingKey(ownerScope), requestId);
  } catch {
    // Storage unavailable: reconciliation still works within this page.
  }
}

function releaseRequestId(ownerScope: string, requestId: string) {
  try {
    if (window.sessionStorage.getItem(pendingKey(ownerScope)) === requestId)
      window.sessionStorage.removeItem(pendingKey(ownerScope));
  } catch {
    // Nothing retained.
  }
}

function definiteCreateFailure(error: unknown) {
  const code = actionErrorCode(error);
  return (
    code === "project_create_denied" ||
    code === "creation_intent_reused" ||
    code === "project_not_found" ||
    code === "invalid_project_starter" ||
    code === "invalid_title"
  );
}

function conflictsWithTitle(error: unknown) {
  return (
    actionErrorCode(error) === "notebook_conflict" ||
    actionErrorCode(error) === "notebook_lineage_changed"
  );
}

export function useCreateNotebook(
  canCreate: boolean,
  ownerScope: string | undefined,
) {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const routeIdentity = JSON.stringify([ownerScope, location.key]);
  const identity = useRef(routeIdentity);
  identity.current = routeIdentity;
  const active = useRef<Creation | null>(null);
  const [state, setState] = useState<Creation | null>(null);
  const creation = state?.routeIdentity === routeIdentity ? state : null;

  useEffect(() => {
    if (active.current?.routeIdentity !== routeIdentity) {
      active.current = null;
      setState(null);
    }
  }, [routeIdentity]);

  const owns = useCallback(
    (intent: Creation) =>
      active.current === intent && identity.current === intent.routeIdentity,
    [],
  );
  const reflect = useCallback(
    (intent: Creation, phase: Phase = intent.phase) => {
      intent.phase = phase;
      if (owns(intent)) setState({ ...intent });
    },
    [owns],
  );

  const refreshLists = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["action", "list-projects"] }),
      queryClient.invalidateQueries({
        queryKey: ["action", "get-workspace-activity"],
      }),
    ]);
  }, [queryClient]);

  const openAccepted = useCallback(
    (intent: Creation, receipt: CreationReceipt, renamed: boolean) => {
      void refreshLists();
      if (!owns(intent)) return;
      void navigate(receipt.href, {
        state: { focusProjectTitle: !renamed, projectRenamed: renamed },
      });
    },
    [navigate, owns, refreshLists],
  );

  const saveTitle = useCallback(
    async (intent: Creation, useLatest = false) => {
      const { receipt, snapshot, title } = intent;
      if (!receipt || !snapshot || !owns(intent) || intent.editingTitle) return;
      if (!title || useLatest) {
        openAccepted(intent, receipt, false);
        return;
      }
      const prior = intent.command;
      const command = (intent.command ??= titleCommand(snapshot, title));
      reflect(intent, "savingTitle");
      try {
        const result = await applyNotebookCommand(command, Boolean(prior));
        if (result.status === "conflict") reflect(intent, "titleChanged");
        else openAccepted(intent, receipt, true);
      } catch (error) {
        reflect(
          intent,
          conflictsWithTitle(error) ? "titleChanged" : "titleFailed",
        );
      }
    },
    [openAccepted, owns, reflect],
  );

  const submit = useCallback(
    async (intent: Creation) => {
      const lookup = async () => {
        reflect(intent, "checking");
        const result = projectCreationSchema.parse(
          await callAction(
            "get-project-creation",
            { requestId: intent.requestId },
            { method: "GET" },
          ),
        );
        intent.needsLookup = false;
        if (result.status === "committed")
          releaseRequestId(intent.ownerScope, intent.requestId);
        return result.status === "committed" ? result.receipt : undefined;
      };
      try {
        let receipt = intent.needsLookup ? await lookup() : undefined;
        if (!receipt && owns(intent)) {
          reflect(intent, "creating");
          retainRequestId(intent.ownerScope, intent.requestId);
          try {
            receipt = creationReceiptSchema.parse(
              await callAction(
                "create-project",
                { requestId: intent.requestId },
                { keepalive: false },
              ),
            );
          } catch (error) {
            if (definiteCreateFailure(error)) {
              releaseRequestId(intent.ownerScope, intent.requestId);
              throw error;
            }
            intent.needsLookup = true;
            receipt = await lookup();
          }
        }
        if (!receipt || receipt.requestId !== intent.requestId) {
          reflect(intent, "createFailed");
          return;
        }
        releaseRequestId(intent.ownerScope, intent.requestId);
        if (!owns(intent)) {
          void refreshLists();
          return;
        }
        intent.receipt = receipt;
        intent.snapshot = receipt.snapshot;
        reflect(intent, "ready");
        await saveTitle(intent);
      } catch (error) {
        reflect(
          intent,
          actionErrorCode(error) === "project_create_denied"
            ? "denied"
            : "createFailed",
        );
      }
    },
    [owns, reflect, refreshLists, saveTitle],
  );

  const start = useCallback(() => {
    if (!canCreate || !ownerScope || (active.current && owns(active.current)))
      return;
    const retained = readPendingRequestId(ownerScope);
    const intent: Creation = {
      requestId: retained ?? crypto.randomUUID(),
      ownerScope,
      routeIdentity,
      phase: "creating",
      editingTitle: false,
      title: null,
      ...(retained ? { needsLookup: true } : {}),
    };
    active.current = intent;
    reflect(intent);
    void submit(intent);
  }, [canCreate, ownerScope, owns, reflect, routeIdentity, submit]);

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        !event.altKey ||
        !event.shiftKey ||
        event.metaKey ||
        event.ctrlKey ||
        (event.code !== "KeyN" && event.key.toLowerCase() !== "n")
      )
        return;
      if (
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable ||
          event.target.closest("input,textarea,select"))
      )
        return;
      if (
        !canCreate ||
        document.querySelector('[role="dialog"], [role="menu"]')
      )
        return;
      event.preventDefault();
      start();
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [canCreate, start]);

  useEffect(() => {
    if (!creation?.editingTitle && !creation?.title) return;
    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = true;
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [creation?.editingTitle, creation?.title]);

  return {
    creation,
    start,
    setEditingTitle(editingTitle: boolean) {
      const intent = active.current;
      if (!intent || !owns(intent)) return;
      intent.editingTitle = editingTitle;
      reflect(intent);
      if (!editingTitle && intent.phase === "ready") void saveTitle(intent);
    },
    async bufferTitle(title: string) {
      const intent = active.current;
      if (!intent || !owns(intent)) return;
      intent.title = title;
      reflect(intent);
    },
    retry() {
      const intent = active.current;
      if (!intent || !owns(intent)) return;
      if (intent.phase === "createFailed") void submit(intent);
      if (intent.phase === "titleFailed") void saveTitle(intent);
    },
    async reapplyTitle() {
      const intent = active.current;
      if (!intent?.receipt || !owns(intent) || intent.phase !== "titleChanged")
        return;
      const receipt = intent.receipt;
      reflect(intent, "savingTitle");
      try {
        const latest = await readTitleSnapshot(receipt.projectId);
        if (!owns(intent)) return;
        intent.snapshot = latest;
        delete intent.command;
        await saveTitle(intent);
      } catch {
        reflect(intent, "titleChanged");
      }
    },
    useLatestTitle() {
      const intent = active.current;
      if (intent?.phase === "titleChanged") void saveTitle(intent, true);
    },
    back() {
      active.current = null;
      setState(null);
      void navigate("/home/all");
    },
  };
}
