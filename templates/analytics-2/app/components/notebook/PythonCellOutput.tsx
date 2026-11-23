import { sendToAgentChatAndConfirm } from "@agent-native/core/client/agent-chat";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconCopy, IconSparkles } from "@tabler/icons-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import type getNotebookResultPage from "../../../actions/get-notebook-result-page";
import { PROJECT_QUERY_PAGE_SIZE } from "../../../shared/project-query-page";
import { CellErrorAlert } from "./CellErrorAlert";
import { CellOutputView } from "./CellOutputView";
import type {
  LoadPythonPage,
  LoadResultPage,
  VisualizationViewScope,
} from "./types";
import { notebookPageOutput } from "./useNotebookResults";
import type { PythonExport, PythonOutput } from "./useNotebookRun";

type ResultScope = Pick<VisualizationViewScope, "sessionId" | "previewId">;

function PythonTable({
  resultId,
  scope,
  onLoadPage,
}: {
  resultId: string;
  scope?: ResultScope | undefined;
  onLoadPage?: LoadPythonPage | undefined;
}) {
  const t = useT();
  const [loaded, setLoaded] = useState<{
    page: number;
    rows: Awaited<ReturnType<LoadResultPage>>;
  }>();
  const query = useActionQuery<
    Awaited<ReturnType<typeof getNotebookResultPage.run>>
  >(
    "get-notebook-result-page",
    {
      resultId,
      ...(scope?.sessionId ? { sessionId: scope.sessionId } : {}),
      ...(scope?.previewId ? { previewId: scope.previewId } : {}),
    },
    { method: "GET" },
  );
  if (query.isPending || query.data?.status === "pending")
    return <CellOutputView output={null} loading />;
  if (query.isError || query.data?.status !== "ready")
    return <p role="alert">{t("queryPaging.failed")}</p>;

  const output = notebookPageOutput(query.data);
  return (
    <CellOutputView
      output={loaded ? { ...output, rows: loaded.rows } : output}
      allowCsvDownload
      queryRequestId={resultId}
      hasNextPage={
        BigInt(output.totalRows ?? "0") > BigInt(PROJECT_QUERY_PAGE_SIZE)
      }
      artifactPage={loaded?.page ?? query.data.page}
      onLoadPage={
        onLoadPage
          ? async (offset) => {
              const rows = await onLoadPage(resultId, offset);
              setLoaded({ page: offset / PROJECT_QUERY_PAGE_SIZE + 1, rows });
              return rows;
            }
          : undefined
      }
    />
  );
}

function PythonError({
  output,
  projectId,
  cellId,
  onSelectLine,
  copy,
  canRepair,
  actionsBlocked,
}: {
  output: Extract<PythonOutput, { kind: "error" }>;
  projectId: string;
  cellId: string;
  onSelectLine?: ((line: number) => void) | undefined;
  copy: (value: string) => void;
  canRepair: boolean;
  actionsBlocked: boolean;
}) {
  const t = useT();
  const [repairStatus, setRepairStatus] = useState<
    "ready" | "sending" | "sent"
  >("ready");
  const submitted = useRef(false);
  const { line, trace } = output;
  const name =
    output.exceptionName ??
    trace
      .trimEnd()
      .split("\n")
      .at(-1)
      ?.match(/^([\w.]+)(?=:|$)/)?.[1];
  const traceback =
    trace || [name, output.exceptionMessage].filter(Boolean).join(": ");

  const repairFailed = () => {
    submitted.current = false;
    setRepairStatus("ready");
    toast.error(t("notebook.sendFailed"));
  };

  const repair = async () => {
    if (submitted.current || actionsBlocked) return;
    submitted.current = true;
    setRepairStatus("sending");
    try {
      const result = await sendToAgentChatAndConfirm({
        message: t("notebook.pythonRepairPrompt"),
        context: JSON.stringify({ projectId, cellId, traceback }),
        contextLabel: t("notebook.pythonCellName"),
        submit: true,
        openSidebar: true,
        chatTarget: "local",
      });
      if (result.delivered) setRepairStatus("sent");
      else repairFailed();
    } catch {
      repairFailed();
    }
  };

  return (
    <CellErrorAlert>
      {name && <strong>{name}</strong>}
      <pre>{traceback}</pre>
      <div className="nb-python-error-actions">
        {line !== null && onSelectLine && !actionsBlocked && (
          <button
            type="button"
            className="nb-text-button"
            onClick={() => onSelectLine(line)}
          >
            {t("notebook.pythonTraceLine", { line })}
          </button>
        )}
        <button
          type="button"
          className="nb-text-button"
          onClick={() => copy(traceback)}
        >
          {t("notebook.errorCopy")}
        </button>
        {canRepair && name !== "KeyboardInterrupt" && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={actionsBlocked || repairStatus !== "ready"}
            aria-busy={repairStatus === "sending" || undefined}
            onClick={() => void repair()}
          >
            <IconSparkles size={14} aria-hidden="true" />
            {t(
              repairStatus === "sent"
                ? "notebook.pythonRepairSent"
                : "notebook.pythonFixWithAgent",
            )}
          </Button>
        )}
      </div>
    </CellErrorAlert>
  );
}

export function PythonCellOutput({
  projectId,
  cellId,
  outputs,
  scope,
  onSelectLine,
  onLoadPage,
  canRepair,
  running = false,
  stale = false,
  ranAt,
  statusMessage,
}: {
  projectId: string;
  cellId: string;
  outputs: readonly PythonOutput[];
  scope?: ResultScope | undefined;
  onSelectLine?: ((line: number) => void) | undefined;
  onLoadPage?: LoadPythonPage | undefined;
  canRepair: boolean;
  running?: boolean;
  stale?: boolean;
  ranAt?: string | undefined;
  statusMessage?: string | undefined;
}) {
  const t = useT();
  const copy = (value: string) =>
    void navigator.clipboard
      .writeText(value)
      .catch(() => toast.error(t("notebook.pythonCopyOutputFailed")));
  return (
    <section
      className="nb-python-output"
      aria-label={t("notebook.pythonStack")}
      aria-busy={running || undefined}
    >
      {outputs.map((output, index) => {
        switch (output.kind) {
          case "browser-table":
            return (
              <CellOutputView
                key={index}
                output={output.table}
                allowCsvDownload
              />
            );
          case "table":
            return (
              <PythonTable
                key={`${index}:${output.resultId}`}
                resultId={output.resultId}
                scope={scope}
                onLoadPage={onLoadPage}
              />
            );
          case "stream":
            return (
              <div className="nb-python-stream" key={index}>
                <pre>{output.text}</pre>
                <button
                  type="button"
                  className="nb-icon-button"
                  aria-label={t("notebook.pythonCopyOutput")}
                  onClick={() => copy(output.text)}
                >
                  <IconCopy size={14} aria-hidden="true" />
                </button>
              </div>
            );
          case "text":
            return (
              <pre className="nb-output-text" key={index}>
                {output.data}
              </pre>
            );
          case "error":
            return (
              <PythonError
                key={`${index}:${ranAt ?? ""}`}
                output={output}
                projectId={projectId}
                cellId={cellId}
                onSelectLine={onSelectLine}
                canRepair={canRepair}
                actionsBlocked={stale || running}
                copy={copy}
              />
            );
        }
      })}
      {statusMessage && (
        <p className="nb-side-panel-note" role="status">
          {statusMessage}
        </p>
      )}
    </section>
  );
}

export function PythonCellExports({
  exports,
}: {
  exports: readonly PythonExport[];
}) {
  const t = useT();
  return (
    <div className="nb-result-variable nb-python-exports">
      {exports.map((item) => (
        <span
          className="nb-result-variable-name"
          key={item.name}
          data-variable-kind={item.kind}
          aria-label={t("notebook.pythonReferenceCount", {
            name: item.name,
            count: item.referenceCount,
          })}
        >
          {item.name} {item.referenceCount}
        </span>
      ))}
    </div>
  );
}
