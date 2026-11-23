import {
  callAction,
  useChangeVersion,
  useDbSync,
} from "@agent-native/core/client/hooks";
import { useOrg } from "@agent-native/core/client/org";
import {
  registerBeforeSignOutCleanup,
  useSession,
} from "@agent-native/core/client/use-session";
import { useEffect, useState, useSyncExternalStore } from "react";
import { matchPath, useLocation } from "react-router";

import {
  notebookChangesReadSchema,
  notebookOperationReadSchema,
  operationReceiptSchema,
  type NotebookSnapshot,
} from "../../../shared/notebook-operations";
import { notebookSnapshotActionReadSchema } from "../../../shared/notebook-snapshot-read";
import {
  NotebookOperations,
  type NotebookOperationScope,
  type NotebookOperationTransport,
} from "./notebook-write-queue";

const notebookTransport: NotebookOperationTransport = {
  async apply(command, signal) {
    return operationReceiptSchema.parse(
      await callAction("apply-notebook-operation", command, {
        signal,
        uiOnly: true,
        keepalive: false,
      }),
    );
  },
  async receipt(input, signal) {
    return notebookOperationReadSchema.parse(
      await callAction("get-notebook-operation", input, {
        method: "GET",
        signal,
      }),
    );
  },
  async changes(input, signal) {
    return notebookChangesReadSchema.parse(
      await callAction("list-notebook-changes", input, {
        signal,
        keepalive: false,
      }),
    );
  },
  async snapshot(input, signal) {
    return notebookSnapshotActionReadSchema.parse(
      await callAction("get-notebook-snapshot", input, {
        method: "GET",
        signal,
      }),
    );
  },
};

const mountedOperations = new Map<string, NotebookOperations>();

function notebookKey(
  workspaceId: string,
  projectId: string,
  versionId: string,
) {
  return JSON.stringify([workspaceId, projectId, versionId]);
}

export async function flushMountedNotebookOrder(
  snapshot: NotebookSnapshot["snapshot"],
) {
  const key = notebookKey(
    snapshot.workspaceId,
    snapshot.projectId,
    snapshot.head.versionId,
  );
  const operations = mountedOperations.get(key);
  if (!operations) return false;
  const accepted = await operations.barrier({ type: "order" });
  return accepted.eventSeq !== snapshot.eventSeq;
}

function isPrivateNotebookPath(pathname: string) {
  const match = matchPath(
    "/project/:projectLocator/:version?/:view?/:appSessionId?",
    pathname,
  );
  if (!match) return false;
  const { view } = match.params;
  return view === undefined || view === "logic" || view === "app";
}

export function warnBeforeNotebookUnload(
  operations: NotebookOperations,
  target: Window = window,
) {
  const warn = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = true;
  };
  const sync = () => {
    if (operations.getSnapshot().hasUnsavedChanges)
      target.addEventListener("beforeunload", warn);
    else target.removeEventListener("beforeunload", warn);
  };
  sync();
  const unsubscribe = operations.subscribe(sync);
  return () => {
    unsubscribe();
    target.removeEventListener("beforeunload", warn);
  };
}

export function useNotebookOperations(
  scope: NotebookOperationScope,
  initial?: NotebookSnapshot,
) {
  const { accountId, workspaceId, projectId, workingVersionId } = scope;
  const { pathname } = useLocation();
  const { session } = useSession();
  const org = useOrg();
  const authorized =
    session?.email.trim().toLowerCase() === accountId &&
    org.data?.orgId === workspaceId &&
    !org.error;
  const context = JSON.stringify([
    accountId,
    workspaceId,
    projectId,
    workingVersionId,
  ]);
  const [instance, setInstance] = useState(() => ({
    context,
    operations: new NotebookOperations(scope, notebookTransport, initial),
  }));
  if (instance.context !== context) {
    setInstance({
      context,
      operations: new NotebookOperations(scope, notebookTransport, initial),
    });
  }
  const { operations } = instance;
  const view = useSyncExternalStore(
    operations.subscribe,
    operations.getSnapshot,
    operations.getSnapshot,
  );
  const actionVersion = useChangeVersion("action");
  const realtime =
    authorized && isPrivateNotebookPath(pathname)
      ? { reason: "other tabs and collaborators can edit the draft notebook" }
      : undefined;
  useDbSync(realtime ? { realtime } : {});

  useEffect(() => {
    if (!authorized) {
      operations.pause();
      return;
    }
    const key = notebookKey(workspaceId, projectId, workingVersionId);
    mountedOperations.set(key, operations);
    const sync = () => {
      if (navigator.onLine) void operations.resume();
      else operations.pause("offline");
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    sync();
    const unregisterSignOut = registerBeforeSignOutCleanup(async () => {
      operations.pause();
    });
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (mountedOperations.get(key) === operations)
        mountedOperations.delete(key);
      operations.pause();
      unregisterSignOut();
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [authorized, operations, projectId, workingVersionId, workspaceId]);

  useEffect(() => {
    if (authorized) void operations.reconnect();
  }, [actionVersion, authorized, operations]);

  useEffect(() => warnBeforeNotebookUnload(operations), [operations]);

  return {
    ...view,
    accepted: authorized ? view.accepted : null,
    effective: authorized ? view.effective : null,
    pending: authorized ? view.pending : [],
    paused: !authorized || view.paused,
    dispatch: operations.dispatch,
    discard: operations.discard,
    reconnect: operations.reconnect,
    barrier: operations.barrier,
  };
}
