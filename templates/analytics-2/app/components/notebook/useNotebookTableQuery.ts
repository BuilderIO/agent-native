import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { type RefObject, useEffect, useRef, useState } from "react";
import type { z } from "zod";

import type {
  queryNotebookTableInputSchema,
  QueryNotebookTableReceipt,
} from "../../../shared/notebook-table-query";
import type { WarehouseTableRef } from "../../../shared/warehouse-table";
import type { GetDataTableDetailsInput } from "../../lib/model/data-table-contracts";
import { notebookUndoOrigin } from "./notebook-undo-origin";
import { flushMountedNotebookOrder } from "./useNotebookOperations";

type PendingTable = {
  input: GetDataTableDetailsInput;
  requestId: string;
  cellId: string;
  afterCellId: string | null | undefined;
  admission?: z.input<typeof queryNotebookTableInputSchema>;
};

export function useNotebookTableQuery(
  projectId: string | undefined,
  legacyQuery: ((table: GetDataTableDetailsInput) => void) | undefined,
  onAdmitted: ((receipt: QueryNotebookTableReceipt) => void) | undefined,
  afterCellId?: string | null,
  containerRef?: RefObject<HTMLElement | null>,
) {
  const client = useQueryClient();
  const enabled = Boolean(projectId && (onAdmitted || legacyQuery));
  const snapshot = useActionQuery(
    "get-notebook-snapshot",
    { projectId: projectId ?? "" },
    { enabled, retry: 1 },
  );
  const intent = useRef<PendingTable | null>(null);
  const inFlight = useRef(false);
  const [pendingTableId, setPendingTableId] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [error, setError] = useState<{
    messageKey: string;
    retryable: boolean;
  } | null>(null);
  useEffect(() => {
    if (!added || onAdmitted) return;
    const focus = () => {
      const cell = document.querySelector<HTMLElement>(
        `[data-notebook-cell="${CSS.escape(added)}"]`,
      );
      if (!cell) return false;
      cell.focus({ preventScroll: true });
      cell.scrollIntoView({ block: "nearest" });
      return true;
    };
    if (focus()) return;
    const container =
      containerRef?.current ??
      document.querySelector<HTMLElement>(".nb-body") ??
      document.querySelector<HTMLElement>(".nb-root") ??
      document.querySelector<HTMLElement>("[data-notebook-cell]")
        ?.parentElement ??
      null;
    if (container && container !== document.body) {
      const observer = new MutationObserver(() => {
        if (focus()) observer.disconnect();
      });
      observer.observe(container, { childList: true, subtree: true });
      return () => observer.disconnect();
    }
    let frame = 0;
    let remaining = 20;
    const poll = () => {
      if (focus() || remaining <= 0) return;
      remaining -= 1;
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frame);
  }, [added, onAdmitted, containerRef]);

  async function submit(next: PendingTable) {
    if (inFlight.current || !projectId) return;
    inFlight.current = true;
    intent.current = next;
    setPendingTableId(next.input.tableId);
    setAdded(null);
    setError(null);
    try {
      if (!next.admission) {
        let accepted = (await snapshot.refetch()).data;
        if (
          accepted?.status === "accepted" &&
          (await flushMountedNotebookOrder(accepted.snapshot))
        )
          accepted = (await snapshot.refetch()).data;
        if (accepted?.status !== "accepted")
          throw new Error("The notebook snapshot is unavailable");
        const {
          connectionId,
          tableId,
          catalogGeneration,
          authorityGeneration,
        } = await callAction<WarehouseTableRef>(
          "get-notebook-table-reference",
          next.input,
          {
            method: "GET",
          },
        );
        next.admission = {
          projectId,
          workingVersionId: accepted.snapshot.head.versionId,
          observedHead: accepted.snapshot.head,
          expectedOrderRevision: accepted.resources.orderRevision,
          afterCellId:
            next.afterCellId === undefined
              ? (accepted.cells.at(-1)?.id ?? null)
              : next.afterCellId,
          requestId: next.requestId,
          originId: notebookUndoOrigin(),
          cellId: next.cellId,
          table: {
            connectionId,
            tableId,
            catalogGeneration,
            authorityGeneration,
          },
        };
      }
      const receipt = await callAction<QueryNotebookTableReceipt>(
        "query-notebook-table",
        next.admission,
        { uiOnly: true, keepalive: false },
      );
      intent.current = null;
      setAdded(receipt.cellId);
      onAdmitted?.(receipt);
      await Promise.all([
        client.invalidateQueries({
          queryKey: ["action", "get-workspace-activity"],
        }),
        ...[
          "get-project",
          "get-notebook-execution",
          "get-notebook-snapshot",
        ].map((name) =>
          client.invalidateQueries({
            queryKey: ["action", name, { projectId }],
          }),
        ),
      ]);
    } catch (caught) {
      const code =
        caught instanceof Error && "errorCode" in caught
          ? caught.errorCode
          : undefined;
      if (
        code === "catalog_generation_stale" ||
        code === "notebook_order_conflict"
      ) {
        intent.current = null;
        setError({ messageKey: "notebook.tableQueryStale", retryable: false });
      } else if (
        code === "table_query_denied" ||
        code === "notebook_edit_denied"
      ) {
        intent.current = null;
        setError({ messageKey: "notebook.tableQueryDenied", retryable: false });
      } else if (code === "table_not_found") {
        intent.current = null;
        setError({
          messageKey: "notebook.tableQueryNotFound",
          retryable: false,
        });
      } else {
        setError({
          messageKey: "notebook.addTableQueryFailed",
          retryable: true,
        });
      }
    } finally {
      inFlight.current = false;
      setPendingTableId(null);
    }
  }

  function query(input: GetDataTableDetailsInput) {
    if (inFlight.current) return;
    if (!enabled || (!onAdmitted && snapshot.data?.status === "pending")) {
      legacyQuery?.(input);
      return;
    }
    if (intent.current) return;
    void submit({
      input,
      afterCellId,
      requestId: crypto.randomUUID(),
      cellId: crypto.randomUUID(),
    });
  }

  return {
    query: onAdmitted || legacyQuery ? query : undefined,
    pending: pendingTableId !== null,
    pendingTableId,
    added: added !== null,
    error: error?.messageKey,
    retry: error?.retryable
      ? () => {
          if (intent.current) void submit(intent.current);
        }
      : undefined,
  };
}
