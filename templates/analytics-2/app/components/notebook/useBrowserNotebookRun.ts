import { actionErrorCode, callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useEffect, useRef, useState } from "react";

import {
  BrowserNotebookKernel,
  browserTable,
  type BrowserResult,
} from "@/lib/notebook-kernel/browser-kernel";
import { startBrowserRunResult } from "@/lib/notebook-kernel/browser-run-result";

import type getBrowserNotebookInput from "../../../actions/get-browser-notebook-input";
import type getNotebookExecution from "../../../actions/get-notebook-execution";
import type getNotebookRun from "../../../actions/get-notebook-run";
import {
  compileNotebookSql,
  inputBinding,
} from "../../../server/execution/sql-compiler";
import type { BrowserNotebookCell } from "../../../server/model/notebook-execution/draft-state";
import {
  sectionRunTargets,
  type RunAdmission,
  type RunRequest,
  type RunSectionCell,
} from "../../../shared/notebook-execution";
import { completeResultManifestSchema } from "../../../shared/notebook-result-contract";
import type { NotebookCellOutputState } from "./types";
import type { PythonOutput } from "./useNotebookRun";

type Execution = Extract<
  Awaited<ReturnType<typeof getNotebookExecution.run>>,
  { status: "found" }
>;
type RunRead = Awaited<ReturnType<typeof getNotebookRun.run>>;
type BrowserInput = Awaited<ReturnType<typeof getBrowserNotebookInput.run>>;
type CellRecord = {
  signature: string;
  eventSeq: bigint;
  kernelGeneration?: number;
  output: NotebookCellOutputState;
  result?: BrowserResult;
  warehouseResultId?: string;
  outputGeneration?: string;
  serverObserved?: true;
};

type Session = {
  identity: string;
  worker?: BrowserNotebookKernel;
  kernelGeneration: number;
  recent: Map<string, CellRecord>;
};

type State = {
  identity: string;
  phase: "idle" | "starting" | "running" | "ready" | "error";
  recent: ReadonlyMap<string, CellRecord>;
  active: ReadonlySet<string>;
  streaming?: { cellId: string; outputs: readonly PythonOutput[] } | undefined;
  lastRunAt?: string | undefined;
};

type RunTask = {
  identity: string;
  controller: AbortController;
  warehouseRunId?: string;
  browserRunId?: string;
  streamFrame?: number;
  runningCell?: {
    cell: BrowserNotebookCell;
    eventSeq: bigint;
    startTime: number;
    outputs: PythonOutput[];
  };
};

function cancelStreamFrame(task: RunTask | null) {
  if (task?.streamFrame === undefined) return;
  cancelAnimationFrame(task.streamFrame);
  delete task.streamFrame;
}

function resultForBinding(
  record: CellRecord,
  name: string,
  caseInsensitive: boolean,
) {
  if (record.kernelGeneration === undefined) return record.result;
  const exported = record.result?.manifest.result.producer.exportId;
  const matches = caseInsensitive
    ? exported?.toLowerCase() === name.toLowerCase()
    : exported === name;
  return matches ? record.result : undefined;
}

function resetWorker(session: Session) {
  session.worker?.close();
  delete session.worker;
  session.kernelGeneration++;
}

const emptyState = (identity: string): State => ({
  identity,
  phase: "idle",
  recent: new Map(),
  active: new Set(),
});
const executable = ({ contents }: BrowserNotebookCell) =>
  contents.kind !== "input" &&
  (contents.kind !== "code" || contents.source.trim() !== "");
const browserCell = ({ contents }: BrowserNotebookCell) =>
  contents.kind === "code" ||
  (contents.kind === "sql" && contents.connectionMode === "dataframes");

export function browserRunCells(
  graph: BrowserNotebookCell[],
  request: RunRequest,
  fresh: (cell: BrowserNotebookCell) => boolean,
  sections: RunSectionCell[] = [],
) {
  const nodes = graph.filter(executable);
  if (request.mode === "run-all") return nodes;
  const targets =
    request.mode === "run-section"
      ? (sectionRunTargets(graph, sections, request.targetCellId) ??
        new Set<string>())
      : new Set<string>([request.targetCellId]);
  if (request.mode === "auto" || request.mode === "downstream") {
    for (const cell of nodes)
      if (cell.dependencies.some(({ cellId }) => targets.has(cellId)))
        targets.add(cell.id);
  }
  if (
    request.mode === "auto" ||
    request.mode === "upstream" ||
    request.mode === "run-section"
  ) {
    const byId = new Map(nodes.map((cell) => [cell.id, cell]));
    for (const id of targets) {
      for (const dependency of byId.get(id)?.dependencies ?? []) {
        const producer = byId.get(dependency.cellId);
        if (producer && (request.mode === "upstream" || !fresh(producer)))
          targets.add(producer.id);
      }
    }
  }
  return nodes.filter(({ id }) => targets.has(id));
}

async function warehouseResult(
  request: RunRequest,
  cellId: string,
  transfer: boolean,
  signal: AbortSignal,
  setRunId: (id: string) => void,
): Promise<{ result?: BrowserResult; warehouseResultId?: string } | undefined> {
  const admitted = await callAction<RunAdmission>(
    "start-notebook-run",
    {
      snapshot: request.snapshot,
      requestId: crypto.randomUUID(),
      cache: request.cache,
      mode: "cell-only",
      targetCellId: cellId,
      staleValues: "allow-compatible",
    },
    { uiOnly: true, keepalive: false },
  );
  if (admitted.status !== "admitted")
    throw new Error("SQL run was not admitted");
  setRunId(admitted.runId);
  const readDeadline = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
  let receipt = admitted;
  while (
    receipt.attempts.some(
      ({ state }) => state.status === "queued" || state.status === "running",
    )
  ) {
    readDeadline.throwIfAborted();
    const read = await callAction<RunRead>(
      "get-notebook-run",
      {
        runId: admitted.runId,
      },
      { method: "GET", signal: readDeadline },
    );
    if (read.status !== "found") throw new Error("SQL run is unavailable");
    receipt = read.run;
    if (
      receipt.attempts.some(
        ({ state }) => state.status === "queued" || state.status === "running",
      )
    )
      await new Promise<void>((resolve) => setTimeout(resolve, 750));
  }
  const state = receipt.attempts.find(
    ({ attempt }) => attempt.cellId === cellId,
  )?.state;
  if (state?.status !== "complete")
    throw new Error("SQL cell did not complete");
  const resultId = state.resultIds[0];
  if (!resultId) return undefined;
  if (!transfer) return { warehouseResultId: resultId };
  const result = await callAction<BrowserInput>(
    "get-browser-notebook-input",
    {
      projectId: request.snapshot.ref.projectId,
      resultId,
    },
    { method: "GET", signal },
  );
  return {
    result: {
      manifest: result.manifest,
      bytes: Uint8Array.from(atob(result.arrow), (character) =>
        character.charCodeAt(0),
      ),
    },
    warehouseResultId: resultId,
  };
}

export function useBrowserNotebookRun(
  identity: string,
  execution: Execution | undefined,
) {
  const t = useT();
  const [rendered, setRendered] = useState(() => emptyState(identity));
  const session = useRef<Session | null>(null);
  const task = useRef<RunTask | null>(null);
  const state =
    rendered.identity === identity ? rendered : emptyState(identity);
  const enabled = execution?.browserCells !== undefined;
  useEffect(() => {
    if (enabled && session.current?.identity !== identity) {
      session.current = {
        identity,
        kernelGeneration: 0,
        recent: new Map(),
      };
    }
  }, [enabled, identity]);

  useEffect(() => {
    return () => {
      if (session.current?.identity === identity) {
        session.current.worker?.close();
        session.current = null;
      }
      if (task.current?.identity === identity) {
        cancelStreamFrame(task.current);
        task.current.controller.abort();
        task.current = null;
      }
    };
  }, [identity]);

  function update(patch: Partial<State>) {
    setRendered((previous) =>
      session.current?.identity === identity
        ? {
            ...(previous.identity === identity
              ? previous
              : emptyState(identity)),
            ...patch,
          }
        : previous,
    );
  }

  async function start(accepted: Execution, request: RunRequest) {
    const graph = accepted.browserCells;
    if (!graph) return null;
    const current: Session =
      session.current?.identity === identity
        ? session.current
        : (session.current = {
            identity,
            kernelGeneration: 0,
            recent: new Map(),
          });
    const eventSeq = BigInt(accepted.snapshot.ref.eventSeq);
    const byId = new Map(graph.map((cell) => [cell.id, cell]));
    const saved = new Map<string, CellRecord>();
    const priorResult = (cellId: string) => {
      const recent = current.recent.get(cellId) ?? saved.get(cellId);
      if (recent) return recent;
      const view = accepted.cells[cellId];
      const cell = byId.get(cellId);
      if (
        !cell ||
        cell.contents.kind !== "sql" ||
        cell.contents.connectionMode === "dataframes" ||
        !view?.resultId ||
        view.stale
      )
        return undefined;
      const record: CellRecord = {
        signature: cell.signature,
        eventSeq,
        output: { status: "complete" },
        warehouseResultId: view.resultId,
      };
      saved.set(cellId, record);
      return record;
    };
    const restart = request.mode === "run-all" && request.restart;
    const isInCurrentKernel = ({ kernelGeneration }: CellRecord) =>
      kernelGeneration === undefined ||
      kernelGeneration === current.kernelGeneration;
    const targets = browserRunCells(
      graph,
      request,
      (cell) => {
        const previous = priorResult(cell.id);
        return (
          !restart &&
          previous?.signature === cell.signature &&
          previous.output.status === "complete" &&
          isInCurrentKernel(previous) &&
          (cell.contents.kind !== "sql" ||
            previous.result !== undefined ||
            previous.warehouseResultId !== undefined)
        );
      },
      accepted.browserSections,
    );
    if (!targets.some(browserCell)) return null;
    if (task.current?.identity === identity) return false;
    const operation: RunTask = {
      identity,
      controller: new AbortController(),
    };
    task.current = operation;
    const { signal } = operation.controller;
    const runId = crypto.randomUUID();
    const stillHere = () =>
      task.current === operation &&
      session.current === current &&
      !signal.aborted;
    let fatal = false;
    const active = new Set(targets.map(({ id }) => id));
    const failed = new Set<string>();
    const publish = () => {
      cancelStreamFrame(operation);
      update({
        recent: new Map(current.recent),
        active: new Set(active),
        streaming: undefined,
      });
    };
    update({
      active,
      phase: current.worker && !restart ? "running" : "starting",
    });
    try {
      if (restart) {
        resetWorker(current);
        current.recent.clear();
        publish();
      }
      const worker = current.worker ?? new BrowserNotebookKernel();
      if (!current.worker) {
        current.worker = worker;
        await worker.initialize(accepted.snapshot);
      }
      if (!stillHere()) return false;
      update({ phase: "running" });
      const transfer = new Set(
        targets
          .filter(browserCell)
          .flatMap(({ dependencies }) =>
            dependencies
              .filter(({ kind }) => kind === "result")
              .map(({ cellId }) => cellId),
          ),
      );
      for (const cell of targets) {
        const { id, signature, contents } = cell;
        const local = browserCell(cell);
        const startTime = performance.now();
        const outputs: PythonOutput[] = [];
        operation.runningCell = { cell, eventSeq, startTime, outputs };
        let result: BrowserResult | undefined;
        let warehouseResultId: string | undefined;
        let error: string | undefined;
        let outputGeneration: string | undefined;
        let storageUnavailable = false;
        try {
          const needsUpstream =
            local &&
            cell.dependencies.some(({ kind, cellId, name }) => {
              const prior = priorResult(cellId);
              return (
                kind === "result" &&
                prior?.output.status === "complete" &&
                !isInCurrentKernel(prior) &&
                !resultForBinding(prior, name, contents.kind === "sql") &&
                !prior?.warehouseResultId
              );
            });
          if (
            cell.problem ||
            needsUpstream ||
            cell.dependencies.some(({ cellId }) => failed.has(cellId))
          ) {
            error = t(
              cell.problem || needsUpstream
                ? "notebook.runMissingPrerequisite"
                : "notebook.upstreamFailed",
            );
          } else if (!local) {
            const out = await warehouseResult(
              request,
              id,
              transfer.has(id),
              signal,
              (id) => {
                operation.warehouseRunId = id;
              },
            );
            result = out?.result;
            warehouseResultId = out?.warehouseResultId;
            delete operation.warehouseRunId;
          } else if (contents.kind === "code" || contents.kind === "sql") {
            const inputs = [];
            const artifacts = new Map<string, Uint8Array>();
            const bindings = new Map<string, ReturnType<typeof inputBinding>>();
            for (const dependency of cell.dependencies) {
              const producer = byId.get(dependency.cellId)?.contents;
              if (dependency.kind === "input" && producer?.kind === "input") {
                bindings.set(dependency.name, inputBinding(producer));
              } else if (dependency.kind === "result") {
                const prior = priorResult(dependency.cellId);
                if (prior?.output.status !== "complete")
                  throw new Error("Missing prerequisite");
                if (prior.warehouseResultId && !prior.result) {
                  const fetched = await callAction<BrowserInput>(
                    "get-browser-notebook-input",
                    {
                      projectId: request.snapshot.ref.projectId,
                      resultId: prior.warehouseResultId,
                    },
                    { method: "GET", signal },
                  );
                  prior.result = {
                    manifest: fetched.manifest,
                    bytes: Uint8Array.from(atob(fetched.arrow), (character) =>
                      character.charCodeAt(0),
                    ),
                  };
                }
                const binding = resultForBinding(
                  prior,
                  dependency.name,
                  contents.kind === "sql",
                );
                if (!binding) continue;
                const { manifest, bytes } = binding;
                artifacts.set(manifest.result.resultId, bytes);
                inputs.push({ name: dependency.name, manifest });
              }
            }
            const compiled =
              contents.kind === "sql"
                ? compileNotebookSql(contents.source, bindings, "dataframes")
                : null;
            const received: { complete: boolean; arrow?: Uint8Array } = {
              complete: false,
            };
            const submission = await startBrowserRunResult(
              request.snapshot,
              id,
              signal,
            );
            operation.browserRunId = submission.runId;
            signal.throwIfAborted();
            const decoded = new TextDecoder();
            const command = await worker.execute(
              accepted.snapshot,
              runId,
              compiled
                ? {
                    operation: "execute-dataframe-sql",
                    source: compiled.sql,
                    params: compiled.parameters.map(
                      ({ parameterType, parameterValue }) => ({
                        type: parameterType.type,
                        value: parameterValue.value,
                      }),
                    ),
                    inputs,
                  }
                : {
                    operation: "execute-python",
                    source: contents.source,
                    inputs,
                  },
              artifacts,
              ({ event: { event }, artifact }) => {
                if (!stillHere()) return;
                submission.receive(event, artifact);
                if (artifact?.metadata) return;
                if (event.type === "stream") {
                  const previous = outputs.at(-1);
                  if (
                    previous?.kind === "stream" &&
                    previous.channel === event.channel
                  ) {
                    outputs[outputs.length - 1] = {
                      ...previous,
                      text: previous.text + event.text,
                    };
                  } else {
                    outputs.push({
                      kind: "stream",
                      channel: event.channel,
                      text: event.text,
                    });
                  }
                  if (
                    contents.kind === "code" &&
                    operation.streamFrame === undefined
                  )
                    operation.streamFrame = requestAnimationFrame(() => {
                      delete operation.streamFrame;
                      if (stillHere())
                        update({
                          streaming: { cellId: id, outputs: [...outputs] },
                        });
                    });
                } else if (event.type === "error") {
                  outputs.push({
                    kind: "error",
                    trace: event.trace,
                    line: event.line,
                    exceptionName: event.exceptionName,
                    exceptionMessage: event.exceptionMessage,
                  });
                } else if (event.type === "terminal") {
                  received.complete = event.outcome.status === "complete";
                } else if (artifact?.format === "arrow") {
                  if (
                    contents.kind === "sql" ||
                    (contents.resultVariable && event.type === "result")
                  )
                    received.arrow = artifact.bytes;
                  if (contents.kind === "code")
                    outputs.push({
                      kind: "browser-table",
                      table: browserTable(artifact.bytes),
                    });
                } else if (artifact) {
                  outputs.push({
                    kind: "text",
                    data: decoded.decode(artifact.bytes),
                  });
                }
              },
            );
            signal.throwIfAborted();
            const completed = await submission.complete(received.complete);
            signal.throwIfAborted();
            delete operation.browserRunId;
            if (completed.status !== "saved") {
              current.recent.delete(id);
              failed.add(id);
              active.delete(id);
              publish();
              continue;
            }
            outputGeneration = submission.outputGeneration;
            if (!received.complete) error = t("notebook.runFailedExecution");
            if (received.complete && received.arrow) {
              const table = browserTable(received.arrow);
              const rowCount = table.totalRows ?? String(table.rowCount);
              result = {
                bytes: received.arrow,
                manifest: completeResultManifestSchema.parse({
                  status: rowCount === "0" ? "complete-empty" : "complete",
                  rowCount,
                  fields: table.columns.map((column, index) => ({
                    ...column,
                    fieldId: String(index),
                    nullable: true,
                  })),
                  result: {
                    resultId: crypto.randomUUID(),
                    snapshot: accepted.snapshot.ref,
                    producer: {
                      cellId: id,
                      outputGeneration: "1",
                      namespaceId: command.namespaceId,
                      attemptId: command.attemptId,
                      runId: command.runId,
                      exportId: contents.resultVariable ?? id,
                    },
                    inputRevision: accepted.snapshot.inputRevision,
                    dependencyFingerprint: signature,
                    kernelGeneration: command.generation,
                    sourceGeneration: null,
                  },
                }),
              };
            }
          }
        } catch (failure) {
          const admittedRunId = operation.browserRunId;
          delete operation.browserRunId;
          if (admittedRunId) {
            try {
              await cancelAdmittedRun(admittedRunId);
            } catch (cancelFailure) {
              console.warn(
                "Could not cancel browser notebook run",
                cancelFailure,
              );
            }
          }
          if (!stillHere()) return false;
          if (!worker.usable) throw new Error("Browser kernel stopped");
          storageUnavailable =
            actionErrorCode(failure) === "notebook_result_storage_unavailable";
          error = t(
            storageUnavailable
              ? "queryError.resultStorageUnavailable"
              : "notebook.runFailedExecution",
          );
        }
        if (!stillHere()) return false;
        if (error) failed.add(id);
        active.delete(id);
        const pythonOutputs = contents.kind === "code" ? outputs : [];
        const workerError = outputs.find((output) => output.kind === "error");
        const sqlError =
          contents.kind === "sql" ? workerError?.trace : undefined;
        current.recent.set(id, {
          signature,
          eventSeq,
          ...(local ? { kernelGeneration: current.kernelGeneration } : {}),
          ...(result ? { result } : {}),
          ...(warehouseResultId ? { warehouseResultId } : {}),
          ...(outputGeneration === undefined ? {} : { outputGeneration }),
          output: {
            status: error ? "error" : "complete",
            ranAt: new Date().toISOString(),
            durationMs: Math.round(performance.now() - startTime),
            ...(error &&
            (contents.kind === "sql" || !workerError || storageUnavailable)
              ? { error: storageUnavailable ? error : sqlError || error }
              : {}),
            ...(pythonOutputs.length ? { pythonOutputs } : {}),
            ...(result && contents.kind === "sql" && local
              ? {
                  output: browserTable(result.bytes),
                  resultFields: result.manifest.fields,
                }
              : {}),
          },
        });
        publish();
      }
      return true;
    } catch {
      if (!stillHere()) return false;
      fatal = true;
      resetWorker(current);
      current.recent.clear();
      for (const { id, signature } of targets)
        current.recent.set(id, {
          signature,
          eventSeq,
          output: { status: "error", error: t("notebook.runFailedExecution") },
        });
      publish();
      return false;
    } finally {
      if (stillHere()) {
        task.current = null;
        update({
          active: new Set(),
          phase: fatal ? "error" : "ready",
          lastRunAt: new Date().toISOString(),
        });
      }
    }
  }

  async function stop(reason: "cancel" | "restart") {
    const current = session.current;
    const running = task.current;
    if (
      !current ||
      current.identity !== identity ||
      (!running && reason === "cancel")
    )
      return;
    task.current = null;
    cancelStreamFrame(running);
    running?.controller.abort();
    const activeCell = running?.runningCell;
    if (reason === "restart" || !activeCell || browserCell(activeCell.cell))
      resetWorker(current);
    if (reason === "restart") {
      current.recent.clear();
    } else if (activeCell && browserCell(activeCell.cell)) {
      const { cell, eventSeq, startTime, outputs } = activeCell;
      current.recent.set(cell.id, {
        signature: cell.signature,
        eventSeq,
        output: {
          status: "cancelled",
          error: t("notebook.runInterruptedBrowser"),
          ranAt: new Date().toISOString(),
          durationMs: Math.round(performance.now() - startTime),
          ...(cell.contents.kind === "code" && outputs.length
            ? { pythonOutputs: outputs }
            : {}),
        },
      });
    }
    update({
      phase: current.worker ? "ready" : "idle",
      active: new Set(),
      recent: new Map(current.recent),
      streaming: undefined,
    });
    const admittedRunId = running?.browserRunId ?? running?.warehouseRunId;
    if (running && admittedRunId) {
      delete running.browserRunId;
      await cancelAdmittedRun(admittedRunId);
    }
  }

  function clear() {
    if (task.current || session.current?.identity !== identity) return;
    session.current.recent.clear();
    update({ recent: new Map() });
  }

  function observeServerReadback() {
    const current = session.current;
    if (current?.identity !== identity) return;
    let changed = false;
    for (const [id, record] of current.recent) {
      if (record.outputGeneration !== undefined && !record.serverObserved) {
        current.recent.set(id, { ...record, serverObserved: true });
        changed = true;
      }
    }
    if (changed) update({ recent: new Map(current.recent) });
  }

  const outputs = Object.fromEntries(
    [...state.recent].flatMap(
      ([id, { output, outputGeneration, serverObserved }]) => {
        const observed = execution?.cells[id]?.attempt;
        if (
          serverObserved ||
          (observed &&
            observed.attempt.outputGeneration === outputGeneration &&
            (observed.state.status === "complete" ||
              observed.state.status === "failed"))
        )
          return [];
        return output.status === "complete" &&
          !output.output &&
          !output.pythonOutputs &&
          execution?.browserCells?.some(
            (cell) => cell.id === id && !browserCell(cell),
          )
          ? []
          : [[id, output]];
      },
    ),
  );
  if (state.streaming) {
    outputs[state.streaming.cellId] = {
      status: "running",
      pythonOutputs: state.streaming.outputs,
    };
  }
  const stale = new Set<string>();
  if (execution?.browserCells) {
    const observedEventSeq = BigInt(execution.snapshot.ref.eventSeq);
    for (const { id, signature } of execution.browserCells) {
      const result = state.recent.get(id);
      if (
        result &&
        observedEventSeq >= result.eventSeq &&
        signature !== result.signature
      )
        stale.add(id);
    }
  }
  return {
    ...state,
    enabled,
    outputs,
    stale,
    start,
    cancel: () => stop("cancel"),
    restart: () => stop("restart"),
    clear,
    observeServerReadback,
  };
}

function cancelAdmittedRun(runId: string) {
  return callAction(
    "cancel-notebook-run",
    { runId },
    { uiOnly: true, keepalive: false },
  );
}
