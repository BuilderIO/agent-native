import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { compareAndSetClientAppState } from "@agent-native/core/client/application-state";
import {
  callAction,
  writeClientAppState,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import {
  notebookThreadId,
  notebookThreadPath,
  withNotebookAgentView,
} from "@/components/agent/notebook-thread-route";
import type {
  NotebookAgentContext,
  NotebookCellSelection,
} from "@/components/agent/WorkspaceAgent";
import { TAB_ID } from "@/lib/tab-id";

import type createNotebookThread from "../../../actions/create-notebook-thread";
import type getRepairContext from "../../../actions/get-notebook-repair-context";
import type getProject from "../../../actions/get-project";
import type { DraftHead } from "../../../shared/notebook-snapshot-contract";
import { useNotebookReview } from "./useNotebookReview";

type Thread = Awaited<ReturnType<typeof createNotebookThread.run>>;
type Repair = Awaited<ReturnType<typeof getRepairContext.run>>;
type Project = Awaited<ReturnType<typeof getProject.run>>;

export function useNotebookAgentReview({
  projectId,
  identity,
  head,
  editable,
  agentOpen,
  refreshAccepted,
}: {
  projectId: string;
  identity: string;
  head: DraftHead | undefined;
  editable: boolean;
  agentOpen: boolean;
  refreshAccepted: () => Promise<unknown>;
}) {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const threadId = notebookThreadId(location.search);
  const scope = useRef({ identity, threadId });
  if (
    scope.current.identity !== identity ||
    scope.current.threadId !== threadId
  )
    scope.current = { identity, threadId };
  const review = useNotebookReview({
    projectId,
    identity,
    threadId: editable ? threadId : null,
    refreshAccepted,
  });
  const [selection, setSelection] = useState<{
    identity: string;
    threadId: string | null;
    cell: NotebookCellSelection;
  }>();
  const [prefill, setPrefill] = useState<{
    identity: string;
    threadId: string;
    prompt: string;
  }>();
  const [aiContext, setAiContext] = useState<{
    scope: typeof scope.current;
    connection?: string | undefined;
  }>();
  const selected =
    selection?.identity === identity &&
    selection.threadId === threadId &&
    (!selection.cell.proposalId ||
      review.changes.some(({ id }) => id === selection.cell.proposalId))
      ? selection.cell
      : undefined;
  const selectCell = (cell: NotebookCellSelection) =>
    setSelection({ identity, threadId, cell });
  useEffect(() => {
    if (
      !agentOpen ||
      prefill?.identity !== identity ||
      prefill.threadId !== threadId
    )
      return;
    sendToAgentChat({
      message: prefill.prompt,
      targetTabId: prefill.threadId,
      chatTarget: "local",
      openSidebar: false,
      submit: false,
    });
    setPrefill(undefined);
  }, [agentOpen, identity, prefill, threadId]);
  const createRequest = useRef<
    | {
        scope: typeof scope.current;
        threadId?: string | undefined;
        opId: string;
      }
    | undefined
  >(undefined);
  const busy = useRef<typeof scope.current | undefined>(undefined);
  const revision = head?.revision;
  useEffect(() => {
    if (!editable || revision === undefined) return;
    const key = `notebook-review:${TAB_ID}`;
    const state = {
      projectId,
      threadId,
      cellId: selected?.cellId ?? null,
      revision,
    };
    const report = (error: unknown) =>
      console.error("Could not update notebook review context", error);
    const options = { requestSource: TAB_ID };
    const write = writeClientAppState(key, state, options);
    void write.catch(report);
    return () => {
      void write
        .then(() => compareAndSetClientAppState(key, state, null, options))
        .catch(report);
    };
  }, [editable, projectId, revision, selected?.cellId, threadId]);

  function selectThread(id: string | null) {
    const next = id && !agentOpen ? withNotebookAgentView(location) : location;
    void navigate(notebookThreadPath(next, id));
  }

  async function ensureThread(id?: string) {
    const observed = scope.current;
    let currentHead = editable ? head : undefined;
    if (!currentHead) {
      const current = await callAction<Project>(
        "get-project",
        { projectId },
        { method: "GET" },
      );
      currentHead = current.notebook?.snapshot.head;
      if (
        !editable ||
        !current.canEdit ||
        !currentHead ||
        currentHead.versionId !== head?.versionId ||
        scope.current !== observed
      )
        throw new Error(t("notebookProposalErrors.reviewContextRequired"));
    }
    const pending = createRequest.current;
    const opId =
      pending?.scope === observed && pending.threadId === id
        ? pending.opId
        : crypto.randomUUID();
    createRequest.current = { scope: observed, threadId: id, opId };
    const thread = await callAction<Thread>(
      "create-notebook-thread",
      {
        projectId,
        opId,
        head: currentHead,
        ...(id ? { threadId: id } : {}),
      },
      { uiOnly: true, keepalive: false },
    );
    createRequest.current = undefined;
    return thread.threadId;
  }

  async function prepareThread(id: string) {
    if (threadId && threadId !== id)
      throw new Error(t("notebookProposalErrors.reviewContextRequired"));
    if (
      review.page?.acceptedHead.versionId === head?.versionId &&
      threadId === id
    )
      return;
    if (threadId) {
      if (!head)
        throw new Error(t("notebookProposalErrors.reviewContextRequired"));
      await callAction(
        "bind-notebook-thread",
        { projectId, threadId, opId: crypto.randomUUID(), head },
        { uiOnly: true, keepalive: false },
      );
    } else {
      await ensureThread(id);
    }
  }

  async function createThread() {
    const observed = scope.current;
    if (busy.current === observed) return;
    busy.current = observed;
    try {
      const id = await ensureThread();
      if (scope.current === observed) selectThread(id);
    } catch {
      toast.error(t("notebookProposalErrors.reviewContextRequired"));
    } finally {
      if (busy.current === observed) busy.current = undefined;
    }
  }

  async function fix(cellId: string, attemptId: string) {
    const observed = scope.current;
    if (!editable || busy.current === observed) return;
    busy.current = observed;
    try {
      const target = threadId ?? (await ensureThread());
      if (scope.current !== observed) return;
      const repair = await callAction<Repair>(
        "get-notebook-repair-context",
        { projectId, threadId: target, cellId, attemptId },
        { method: "GET" },
      );
      if (scope.current !== observed) return;
      const proposalId = review.changes.find(
        (change) => change.cellId === cellId,
      )?.id;
      setSelection({
        identity,
        threadId: target,
        cell: { projectId, cellId, title: repair.cellLabel, proposalId },
      });
      setPrefill({ identity, threadId: target, prompt: repair.prompt });
      const next = agentOpen ? location : withNotebookAgentView(location);
      if (next !== location || target !== threadId)
        void navigate(notebookThreadPath(next, target));
    } catch {
      if (scope.current === observed)
        toast.error(t("notebook.reviewRepairFailed"));
    } finally {
      if (busy.current === observed) busy.current = undefined;
    }
  }

  const ai = aiContext?.scope === scope.current ? aiContext : undefined;
  const notebook: NotebookAgentContext = {
    review,
    identity,
    revision: revision ?? "",
    editable,
    selection: selected,
    aiMode: ai !== undefined,
    connection: ai?.connection,
    prepareThread,
    createThread,
    selectThread,
  };
  return {
    threadId,
    notebook,
    ensureThread: () =>
      threadId && review.ready ? Promise.resolve(threadId) : ensureThread(),
    selectCell,
    fix,
    useAi: (cell: NotebookCellSelection, connection?: string) => {
      selectCell(cell);
      setAiContext({ scope: scope.current, connection });
      const next = agentOpen ? location : withNotebookAgentView(location);
      if (next !== location) void navigate(next);
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>(
            ".ws-agent-notebook [contenteditable=true]",
          )
          ?.focus();
      });
    },
  };
}
