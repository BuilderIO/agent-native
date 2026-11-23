import { callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";

import type { CellOutput } from "@/lib/model/contracts";

import type getNotebookResultPage from "../../../actions/get-notebook-result-page";
import type setNotebookResultView from "../../../actions/set-notebook-result-view";
import { PROJECT_QUERY_PAGE_SIZE } from "../../../shared/project-query-page";
import type { NotebookCellOutputState, NotebookTableOutput } from "./types";
import { inheritUpstreamFailures } from "./upstream-failure";
import type {
  NotebookCellExecutionRead,
  NotebookRunController,
} from "./useNotebookRun";

type ResultRead = Awaited<ReturnType<typeof getNotebookResultPage.run>>;
type ReadyPage = Extract<ResultRead, { status: "ready" }>;
type TableOutput = Extract<CellOutput, { type: "table" }>;

export function displayRows(
  rows: ReadyPage["rows"],
  fields: ReadyPage["manifest"]["fields"],
): TableOutput["rows"] {
  return rows.map((row) =>
    row.map((value, index) => {
      if (value === null || typeof value !== "object") return value;
      const type = fields[index]?.type;
      if (
        (type === "integer" || type === "decimal" || type === "binary") &&
        "type" in value &&
        value.type === type &&
        "value" in value &&
        typeof value.value === "string"
      )
        return value.value;
      return JSON.stringify(value);
    }),
  );
}

export function displayTableRows(
  rows: ReadyPage["rows"],
  fields: ReadyPage["manifest"]["fields"],
  knownRows: string,
  incomplete: boolean,
): NotebookTableOutput {
  return {
    type: "table",
    columns: fields.map(({ name, type }) => ({
      name,
      schemaType: type,
      type:
        type === "integer" || type === "decimal"
          ? "number"
          : type === "number" ||
              type === "boolean" ||
              type === "date" ||
              type === "datetime" ||
              type === "null"
            ? type
            : "string",
    })),
    rows: displayRows(rows, fields),
    rowCount: Number(knownRows),
    totalRows: knownRows,
    truncated: incomplete || BigInt(knownRows) > BigInt(rows.length),
  };
}

export function notebookPageOutput(result: ReadyPage): NotebookTableOutput {
  const { manifest } = result;
  const knownRows =
    manifest.status === "complete" || manifest.status === "complete-empty"
      ? manifest.rowCount
      : manifest.verifiedRowCount;
  return displayTableRows(
    result.rows,
    manifest.fields,
    knownRows,
    manifest.status === "incomplete",
  );
}

export { notebookPageOutput as displayTable };

function readResult(resultId: string, page?: number, signal?: AbortSignal) {
  return callAction<ResultRead>(
    "get-notebook-result-page",
    { resultId, ...(page === undefined ? {} : { page }) },
    { method: "GET", ...(signal ? { signal } : {}) },
  );
}

const resultKey = (identity: string, resultId: string) =>
  ["notebook-result-page", identity, resultId] as const;

const KERNEL_ERRORS: Readonly<Record<string, string>> = {
  quota_exceeded: "notebook.pythonKernelLimit",
  kernel_export_expired: "notebook.pythonKernelExpired",
  dataframe_denied: "notebook.resultSourceDenied",
  dataframe_incomplete: "notebook.resultIncomplete",
  notebook_result_storage_unavailable: "queryError.resultStorageUnavailable",
};

export function useNotebookResults({
  identity,
  projectId,
  execution,
  pythonCellIds,
}: {
  identity: string;
  projectId: string;
  execution: NotebookRunController;
  pythonCellIds: ReadonlySet<string>;
}) {
  const t = useT();
  const client = useQueryClient();
  const current = useRef<{ identity: string } | null>({ identity });
  if (current.current?.identity !== identity) current.current = { identity };
  useEffect(() => {
    current.current ??= { identity };
    const observed = current.current;
    return () => {
      if (current.current === observed) current.current = null;
    };
  }, [identity]);
  const snippetState = execution.snippetAttempt?.state;
  const snippetId =
    snippetState?.status === "complete" ? snippetState.resultIds[0] : undefined;
  const resultIds = [
    ...new Set([
      ...Object.entries(execution.cells ?? {}).flatMap(([cellId, cell]) =>
        cell.resultId && !pythonCellIds.has(cellId) ? [cell.resultId] : [],
      ),
      ...(snippetId ? [snippetId] : []),
    ]),
  ];
  const pages = useQueries({
    queries: resultIds.map((id) => ({
      queryKey: resultKey(identity, id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        readResult(id, id === snippetId ? 1 : undefined, signal),
      refetchInterval: (query: { state: { data: ResultRead | undefined } }) =>
        query.state.data?.status === "pending" ? 750 : false,
    })),
  });
  const pythonAttempts = [...pythonCellIds].flatMap((cellId) => {
    const receipt = execution.cells?.[cellId]?.attempt;
    return receipt ? [{ cellId, receipt }] : [];
  });
  const pythonReads = useQueries({
    queries: pythonAttempts.map(({ cellId, receipt }) => ({
      queryKey: [
        "notebook-cell-execution",
        identity,
        cellId,
        receipt.attempt.attemptId,
        receipt.state.status,
      ],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        callAction<NotebookCellExecutionRead>(
          "get-notebook-cell-execution",
          { projectId, cellId },
          { method: "GET", signal },
        ),
      refetchInterval: (query: {
        state: { data: NotebookCellExecutionRead | undefined };
      }) => (query.state.data?.status === "pending" ? 750 : false),
    })),
  });

  const outputs: Record<string, NotebookCellOutputState> = {};
  for (const [cellId, cell] of Object.entries(execution.cells ?? {})) {
    if (pythonCellIds.has(cellId)) continue;
    const receipt = cell.attempt;
    if (!cell.resultId && !receipt) continue;
    const state = receipt?.state;
    const query = cell.resultId
      ? pages[resultIds.indexOf(cell.resultId)]
      : undefined;
    const page = query?.data;
    const blocked = state?.status === "blocked";
    const diagnostic = cell.diagnostic;
    const artifactError =
      state?.status !== "failed" &&
      !blocked &&
      (query?.isError ||
        (page !== undefined &&
          page.status !== "ready" &&
          page.status !== "pending"));
    const output =
      state?.status === "failed"
        ? {
            type: "error" as const,
            ...(state.reason === "provider_outcome_unknown"
              ? { code: "cancel_unknown" as const }
              : {}),
            message:
              diagnostic?.message ??
              (state.reason === "provider_outcome_unknown"
                ? t("queryError.cancelUnknown")
                : t("queryError.title")),
            detail: diagnostic?.detail ?? null,
          }
        : state?.status === "cancelled"
          ? {
              type: "error" as const,
              code: "interrupted" as const,
              message: t("queryError.interrupted"),
              detail: null,
            }
          : page?.status === "ready" && !blocked
            ? notebookPageOutput(page)
            : artifactError
              ? {
                  type: "error" as const,
                  message: t(
                    page?.status === "incomplete"
                      ? "notebook.resultIncomplete"
                      : page?.status === "denied"
                        ? "notebook.resultSourceDenied"
                        : "notebook.resultPageFailed",
                  ),
                  detail: null,
                }
              : null;
    outputs[cellId] = {
      output,
      ...(state
        ? {
            status:
              state.status === "failed"
                ? "error"
                : blocked
                  ? "cancelled"
                  : state.status,
          }
        : {}),
      ...(cell.finishedAt && !blocked ? { ranAt: cell.finishedAt } : {}),
      ...(cell.durationMs !== undefined && !blocked
        ? { durationMs: cell.durationMs }
        : {}),
      ...(artifactError ? { artifactError: true } : {}),
      ...(page?.status === "ready" && output?.type === "table" && cell.resultId
        ? {
            artifactPage: page.page,
            pageRequestId: cell.resultId,
            totalRows: output.totalRows ?? null,
            resultFields: page.manifest.fields,
            hasNextPage:
              BigInt(output.totalRows ?? "0") > BigInt(PROJECT_QUERY_PAGE_SIZE),
          }
        : {}),
      ...(cell.resultId && (query?.isPending || page?.status === "pending")
        ? { artifactLoading: true }
        : {}),
      ...(query && (query.isError || page?.status === "unreadable")
        ? { artifactRetry: () => void query.refetch() }
        : {}),
    };
  }
  for (const [index, { cellId, receipt }] of pythonAttempts.entries()) {
    const query = pythonReads[index];
    const read = query?.data;
    const record =
      !query?.isError &&
      read?.status === "found" &&
      read.attemptId === receipt.attempt.attemptId
        ? read
        : undefined;
    const state = record?.state ?? receipt.state;
    const cell = execution.cells?.[cellId];
    const trace = record?.outputs.some(({ kind }) => kind === "error");
    const error =
      read?.status === "denied"
        ? t("notebook.resultSourceDenied")
        : query?.isError || read?.status === "unreadable"
          ? t("notebook.runFailedExecution")
          : state.status === "blocked"
            ? t("notebook.upstreamFailed")
            : trace
              ? undefined
              : state.status === "cancelled" ||
                  (state.status === "failed" && state.reason === "interrupted")
                ? t("notebook.pythonInterrupted")
                : state.status === "failed"
                  ? t(
                      KERNEL_ERRORS[record?.diagnosticCode ?? ""] ??
                        "notebook.runFailedExecution",
                    )
                  : undefined;
    outputs[cellId] = {
      status:
        state.status === "failed"
          ? "error"
          : state.status === "blocked"
            ? "cancelled"
            : state.status,
      ...(error ? { error } : {}),
      ...(cell?.finishedAt ? { ranAt: cell.finishedAt } : {}),
      ...(cell?.durationMs === undefined
        ? {}
        : { durationMs: cell.durationMs }),
      ...(record?.outputs.length ? { pythonOutputs: record.outputs } : {}),
      ...(record?.exports.length ? { exports: record.exports } : {}),
    };
  }
  if (snippetId && execution.snippetAttempt) {
    const page = pages[resultIds.indexOf(snippetId)]?.data;
    if (page?.status === "ready") {
      const { cellId } = execution.snippetAttempt.attempt;
      outputs[cellId] = {
        ...outputs[cellId],
        snippetOutput: notebookPageOutput(page),
      };
    }
  }

  Object.assign(outputs, execution.browser?.outputs);
  const pythonResultIds = useRef(new Set<string>());
  pythonResultIds.current = new Set(
    Object.values(outputs).flatMap(({ pythonOutputs }) =>
      (pythonOutputs ?? []).flatMap((output) =>
        output.kind === "table" ? [output.resultId] : [],
      ),
    ),
  );
  const seek = useCallback(
    async (resultId: string, rowOffset: number, python: boolean) => {
      const observed = current.current;
      const isCurrent = () =>
        observed?.identity === identity &&
        current.current === observed &&
        (!python || pythonResultIds.current.has(resultId));
      if (!isCurrent()) throw new Error(t("notebook.resultPageFailed"));
      const page = rowOffset / PROJECT_QUERY_PAGE_SIZE + 1;
      const result = await readResult(resultId, page);
      if (!isCurrent() || result.status !== "ready")
        throw new Error(t("notebook.resultPageFailed"));
      const saved = await callAction<
        Awaited<ReturnType<typeof setNotebookResultView.run>>
      >(
        "set-notebook-result-view",
        {
          resultId,
          page: result.page,
          requestId: crypto.randomUUID(),
          expectedViewRevision: result.view.viewRevision,
        },
        { uiOnly: true, keepalive: false },
      );
      if (!isCurrent() || saved.status !== "saved")
        throw new Error(t("notebook.resultPageFailed"));
      if (!python)
        client.setQueryData<ResultRead>(resultKey(identity, resultId), () => ({
          ...result,
          view: { page: saved.page, viewRevision: saved.viewRevision },
        }));
      return displayRows(result.rows, result.manifest.fields);
    },
    [client, identity, t],
  );

  const load = useCallback(
    (_cellId: string, rowOffset: number, resultId: string) =>
      seek(resultId, rowOffset, false),
    [seek],
  );
  const loadPython = useCallback(
    (resultId: string, rowOffset: number) => seek(resultId, rowOffset, true),
    [seek],
  );

  inheritUpstreamFailures(execution.cells ?? {}, outputs);
  return { outputs, load, loadPython };
}
