import { writeClientAppState } from "@agent-native/core/client/hooks";

import { TAB_ID } from "@/lib/tab-id";

import type { NotebookEditing } from "../../../shared/notebook-editing";

let current: {
  projectId: string;
  value: string;
  snapshot: NotebookEditing;
  pending: Promise<unknown>;
  failureReported: boolean;
} | null = null;

function writeSnapshot(snapshot: NotebookEditing, value: string): void {
  const pending = writeClientAppState(`notebook-editing:${TAB_ID}`, snapshot, {
    requestSource: TAB_ID,
  });
  current = {
    projectId: snapshot.projectId,
    value,
    snapshot,
    pending,
    failureReported: false,
  };
  void pending.catch((error) =>
    console.error("Could not update notebook editing context", error),
  );
}

export function publishNotebookEditing(snapshot: NotebookEditing): void {
  const value = JSON.stringify(snapshot);
  if (current?.projectId === snapshot.projectId && current.value === value)
    return;
  writeSnapshot(snapshot, value);
}

export async function waitForNotebookEditing(projectId: string): Promise<void> {
  if (current?.projectId === projectId && current.failureReported)
    writeSnapshot(current.snapshot, current.value);
  while (current?.projectId === projectId) {
    const entry = current;
    try {
      await entry.pending;
    } catch (error) {
      if (entry === current) {
        entry.failureReported = true;
        throw error;
      }
      continue;
    }
    if (entry === current) return;
  }
}
