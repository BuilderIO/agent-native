import { actionErrorCode, callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";

import type { Cell } from "@/lib/model/contracts";

import type decidePendingChanges from "../../../actions/decide-notebook-pending-changes";
import type getPendingChanges from "../../../actions/get-notebook-pending-changes";
import { cellTitleAtPosition } from "./utils";

type PendingPage = Awaited<ReturnType<typeof getPendingChanges.run>>;
type Decision = Parameters<typeof decidePendingChanges.run>[0];
type DecisionReceipt = Awaited<ReturnType<typeof decidePendingChanges.run>>;
export type PendingChange = PendingPage["changes"][number];
type Choice = Pick<Decision, "selection" | "decision">;

export function proposalCell(change: PendingChange): Cell | undefined {
  return (
    change.after?.cells.find((cell) => cell.id === change.cellId) ??
    change.before?.cells.find((cell) => cell.id === change.cellId)
  );
}

export function proposalTitle(change: PendingChange, position: number) {
  const cell = proposalCell(change);
  return cell === undefined
    ? change.cellId
    : cellTitleAtPosition(cell.contents, position);
}

function reviewGroup(
  changes: PendingChange[],
  id: string,
  decision: Decision["decision"],
) {
  const ids = new Set([id]);
  const pending = [...changes];
  for (let index = 0; index < pending.length; ) {
    const candidate = pending[index];
    if (!candidate || ids.has(candidate.id)) {
      pending.splice(index, 1);
    } else if (
      decision === "confirm"
        ? changes.some(
            (change) =>
              ids.has(change.id) && change.dependsOn.includes(candidate.id),
          )
        : candidate.dependsOn.some((dependency) => ids.has(dependency))
    ) {
      ids.add(candidate.id);
      pending.splice(index, 1);
      index = 0;
    } else {
      index++;
    }
  }
  return [...ids];
}

export function useNotebookReview({
  projectId,
  threadId,
  identity,
  refreshAccepted,
}: {
  projectId: string;
  threadId: string | null;
  identity: string;
  refreshAccepted: () => Promise<unknown>;
}) {
  const t = useT();
  const scope = useRef({ identity, threadId });
  if (
    scope.current.identity !== identity ||
    scope.current.threadId !== threadId
  )
    scope.current = { identity, threadId };
  const review = useQuery({
    queryKey: ["action", "get-notebook-pending-changes", identity, threadId],
    enabled: threadId !== null,
    retry: false,
    queryFn: async ({ signal }) => {
      if (threadId === null)
        throw new Error(t("notebookProposalErrors.reviewContextRequired"));
      const scope = { projectId, threadId };
      const options = { method: "GET" as const, signal };
      const first = await callAction<PendingPage>(
        "get-notebook-pending-changes",
        scope,
        options,
      );
      let page = first;
      const changes = new Map(
        first.changes.map((change) => [change.id, change]),
      );
      while (page.hasMore) {
        const next = await callAction<PendingPage>(
          "get-notebook-pending-changes",
          { ...scope, after: page.cursor },
          options,
        );
        if (
          next.reset ||
          next.overlayRevision !== first.overlayRevision ||
          BigInt(next.cursor) <= BigInt(page.cursor)
        ) {
          throw new Error(t("notebook.reviewLoadFailed"));
        }
        for (const change of next.changes) changes.set(change.id, change);
        page = next;
      }
      return { ...page, changes: [...changes.values()] };
    },
  });
  const page =
    !review.isError && !review.isPlaceholderData ? review.data : undefined;
  const changes =
    page?.changes.filter(
      ({ status }) => status === "pending" || status === "conflicted",
    ) ?? [];
  const active = useRef<{
    scope: typeof scope.current;
    request: Decision;
    running: boolean;
  } | null>(null);
  const [checkpoint, setCheckpoint] = useState<{
    scope: typeof scope.current;
    id: string;
  } | null>(null);
  const [working, setWorking] = useState<typeof scope.current | null>(null);
  const [failure, setFailure] = useState<{
    scope: typeof scope.current;
    code: string | undefined;
  } | null>(null);
  const [group, setGroup] = useState<{
    scope: typeof scope.current;
    choice: Choice;
    revision: PendingPage["overlayRevision"];
    digest: string;
  } | null>(null);

  async function decide(choice: Choice) {
    if (
      !page ||
      !threadId ||
      (active.current?.scope === scope.current && active.current.running)
    )
      return;
    const observed = scope.current;
    const previous = active.current;
    const intent = {
      projectId,
      threadId,
      expectedOverlayRevision: page.overlayRevision,
      observedHead: page.acceptedHead,
      ...choice,
    };
    const request =
      previous?.scope === observed &&
      JSON.stringify({ ...intent, opId: previous.request.opId }) ===
        JSON.stringify(previous.request)
        ? previous.request
        : { ...intent, opId: crypto.randomUUID() };
    const operation = { scope: observed, request, running: true };
    active.current = operation;
    setWorking(observed);
    setFailure(null);
    setGroup(null);
    try {
      const receipt = await callAction<DecisionReceipt>(
        "decide-notebook-pending-changes",
        request,
        { uiOnly: true, keepalive: false },
      );
      if (receipt.checkpointId && scope.current === observed)
        setCheckpoint({ scope: observed, id: receipt.checkpointId });
      if (receipt.rerunIntentId && scope.current === observed)
        toast.info(t("notebook.reviewRerunning"));
      if (receipt.decision === "confirm") {
        await refreshAccepted();
        await review.refetch();
      } else {
        await Promise.all([review.refetch(), refreshAccepted()]);
      }
      if (active.current === operation) active.current = null;
    } catch (error) {
      operation.running = false;
      if (scope.current === observed)
        setFailure({ scope: observed, code: actionErrorCode(error) });
    } finally {
      if (scope.current === observed) setWorking(null);
    }
  }

  const currentGroup = group?.scope === scope.current ? group : null;
  return {
    threadId,
    page,
    checkpointId: checkpoint?.scope === scope.current ? checkpoint.id : null,
    changes,
    loading: threadId !== null && review.isPending,
    error: review.isError
      ? (actionErrorCode(review.error) ?? "read_failed")
      : null,
    ready: threadId !== null && page !== undefined,
    busy: working === scope.current,
    decisionFailed: failure?.scope === scope.current,
    conflict:
      failure?.scope === scope.current &&
      (failure.code === "overlay_conflict" ||
        failure.code === "proposal_base_changed"),
    decisionGroup: currentGroup,
    resolveGroup: (confirm: boolean) => {
      if (!currentGroup || !confirm) {
        setGroup(null);
        return;
      }
      if (
        page?.overlayRevision === currentGroup.revision &&
        page.reviewedSetDigest === currentGroup.digest
      ) {
        void decide(currentGroup.choice);
      } else {
        setGroup(null);
        setFailure({ scope: scope.current, code: "overlay_conflict" });
      }
    },
    showLatest: () => {
      setFailure(null);
      void Promise.all([review.refetch(), refreshAccepted()]);
    },
    choose: (decision: Decision["decision"], id?: string) => {
      if (!page) return;
      if (!id) {
        void decide({
          decision,
          selection: { kind: "all", reviewedSetDigest: page.reviewedSetDigest },
        });
        return;
      }
      const ids = reviewGroup(changes, id, decision);
      const choice: Choice = { decision, selection: { kind: "selected", ids } };
      if (ids.length === 1) void decide(choice);
      else
        setGroup({
          scope: scope.current,
          choice,
          revision: page.overlayRevision,
          digest: page.reviewedSetDigest,
        });
    },
  };
}

export type NotebookReview = ReturnType<typeof useNotebookReview>;
