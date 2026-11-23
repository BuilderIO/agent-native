import { isActionContractError } from "@agent-native/core/action";

import {
  executionSnapshotSchema,
  runNamespaceSchema,
  type Snapshot,
} from "../../../shared/notebook-execution.js";
import { getDb } from "../../db/index.js";
import { APPLICATION_ID } from "../../lib/workspace-access.js";
import { readOwnedAskNotebook } from "../ask-thread-notebook.js";
import type { Queryable, WorkspaceScope } from "../scope.js";
import { digest } from "./planner.js";
import {
  executionFingerprint,
  executionSnapshotCells,
  readCurrentDraftSnapshot,
  readDraftSnapshot,
  type SnapshotReader,
} from "./snapshot.js";

export function threadNamespace(
  scope: WorkspaceScope,
  bindingId: string,
  threadId: string,
) {
  return runNamespaceSchema.options[1].parse({
    kind: "thread",
    threadId,
    namespaceId: digest(["thread", scope.orgId, bindingId]),
  });
}

export async function currentThreadSnapshot(
  scope: WorkspaceScope,
  { projectId, threadId }: { projectId: string; threadId: string },
  tx?: Queryable,
  lock: "share" | "update" = "update",
): Promise<
  Awaited<ReturnType<typeof readCurrentDraftSnapshot>> | { status: "denied" }
> {
  if (!tx)
    return getDb().transaction((transaction) =>
      currentThreadSnapshot(
        scope,
        { projectId, threadId },
        transaction,
        "share",
      ),
    );
  const accepted = await readCurrentDraftSnapshot(scope, projectId, tx, lock);
  if (accepted.status !== "accepted") return accepted;
  const threadScope = { ...scope, appId: APPLICATION_ID };
  const input = { projectId, threadId };
  const ask = await readOwnedAskNotebook(threadScope, input, tx);
  if (ask)
    return {
      ...accepted,
      value: {
        ...accepted.value,
        snapshot: {
          ...accepted.value.snapshot,
          namespace: threadNamespace(scope, ask.bindingId, threadId),
        },
      },
    };
  try {
    const { readNotebookProposalSnapshot } =
      await import("../notebook-proposals.js");
    const { binding, notebook } = await readNotebookProposalSnapshot(
      threadScope,
      input,
      tx,
      lock,
    );
    const cells = executionSnapshotCells(notebook.cells);
    const snapshot = executionSnapshotSchema.parse({
      ...accepted.value.snapshot,
      namespace: threadNamespace(scope, binding.id, threadId),
      executionFingerprint: executionFingerprint(cells),
    });
    return { ...accepted, value: { snapshot, ...cells } };
  } catch (error) {
    if (isActionContractError(error) && error.statusCode < 500)
      return { status: "denied" };
    throw error;
  }
}

export async function readExecutionSnapshot(
  actor: Parameters<SnapshotReader>[0],
  requested: Snapshot,
  tx?: Queryable,
): ReturnType<SnapshotReader> {
  if (requested.namespace.kind !== "thread")
    return readDraftSnapshot(actor, requested, tx);
  if (actor.orgId !== requested.ref.workspaceId) return { status: "denied" };
  const loaded = await currentThreadSnapshot(
    actor,
    {
      projectId: requested.ref.projectId,
      threadId: requested.namespace.threadId,
    },
    tx,
  );
  if (
    loaded.status === "accepted" &&
    loaded.value.snapshot.namespace.namespaceId !==
      requested.namespace.namespaceId
  )
    return { status: "denied" };
  return loaded;
}

export async function readRunThread(
  actor: WorkspaceScope,
  snapshot: Snapshot,
  threadId?: string,
) {
  if (
    snapshot.namespace.kind !== "thread" ||
    snapshot.namespace.threadId !== threadId
  )
    return null;
  const loaded = await currentThreadSnapshot(actor, {
    projectId: snapshot.ref.projectId,
    threadId,
  });
  if (loaded.status !== "accepted") return null;
  const latest = loaded.value.snapshot;
  return latest.namespace.namespaceId === snapshot.namespace.namespaceId &&
    latest.ref.head.versionId === snapshot.ref.head.versionId
    ? loaded.value
    : null;
}
