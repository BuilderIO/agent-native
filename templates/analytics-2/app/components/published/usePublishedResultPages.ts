import { callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useQueries } from "@tanstack/react-query";

import type {
  LoadResultPage,
  NotebookCellOutputState,
} from "@/components/notebook/types";
import {
  displayRows,
  notebookPageOutput,
} from "@/components/notebook/useNotebookResults";

import type getNotebookResultPage from "../../../actions/get-notebook-result-page";
import { PROJECT_QUERY_PAGE_SIZE } from "../../../shared/project-query-page";

const PENDING_RESULT_POLL_MS = 1_000;

type ResultRead = Awaited<ReturnType<typeof getNotebookResultPage.run>>;
type ResultScope = { sessionId: string } | { previewId: string };

export function usePublishedResultPages(
  entries: ReadonlyArray<{ cellId: string; resultId: string | null }>,
  scope: ResultScope,
) {
  const t = useT();
  const reads = entries.flatMap(({ cellId, resultId }) =>
    resultId ? [{ cellId, resultId }] : [],
  );
  const key = (resultId: string) =>
    ["published-result-page", scope, resultId] as const;
  const pages = useQueries({
    queries: reads.map(({ resultId }) => ({
      queryKey: key(resultId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        callAction<ResultRead>(
          "get-notebook-result-page",
          { resultId, ...scope, page: 1 },
          { method: "GET", signal },
        ),
      refetchInterval: (query: { state: { data: ResultRead | undefined } }) =>
        query.state.data?.status === "pending"
          ? PENDING_RESULT_POLL_MS
          : (false as const),
    })),
  });
  const outputs: Record<string, NotebookCellOutputState> = {};
  const manifests: Record<
    string,
    Extract<ResultRead, { status: "ready" }>
  > = {};
  reads.forEach(({ cellId, resultId }, index) => {
    const query = pages[index];
    const result = query?.data;
    if (result?.status === "ready") {
      manifests[cellId] = result;
      if (result.pythonOutputs) {
        outputs[cellId] = { pythonOutputs: result.pythonOutputs };
        return;
      }
      const output = notebookPageOutput(result);
      outputs[cellId] = {
        output,
        resultFields: result.manifest.fields,
        pageRequestId: resultId,
        totalRows: output.totalRows ?? null,
        hasNextPage:
          BigInt(output.totalRows ?? "0") > BigInt(PROJECT_QUERY_PAGE_SIZE),
      };
    } else if (query?.isPending || result?.status === "pending") {
      outputs[cellId] = { artifactLoading: true };
    } else {
      outputs[cellId] = {
        artifactError: true,
        output: {
          type: "error",
          message: t(
            result?.status === "incomplete"
              ? "notebook.resultIncomplete"
              : result?.status === "denied"
                ? "publishedAppSharing.resultDenied"
                : "notebook.resultPageFailed",
          ),
          detail: null,
        },
      };
    }
  });
  const loadPage: LoadResultPage = async (offset, resultId) => {
    const result = await callAction<ResultRead>(
      "get-notebook-result-page",
      { resultId, ...scope, page: offset / PROJECT_QUERY_PAGE_SIZE + 1 },
      { method: "GET" },
    );
    if (result.status !== "ready")
      throw new Error(t("notebook.resultPageFailed"));
    return displayRows(result.rows, result.manifest.fields);
  };
  return { outputs, manifests, loadPage };
}
