import {
  actionErrorCode,
  callAction,
  useActionMutation,
  writeClientAppState,
} from "@agent-native/core/client/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import type { z } from "zod";

import type { CellKind, ParameterInputType } from "@/lib/model/cell-types";
import type { ProjectDocument } from "@/lib/model/contracts";
import { compareOrder } from "@/lib/model/order";
import { TAB_ID } from "@/lib/tab-id";

import { draftAppLayout, resolveAppTab } from "../../../shared/app-layout";
import type { AppDocument } from "../../../shared/app-layout";
import {
  setAppCommandSchema,
  setAppPatchSchema,
} from "../../../shared/notebook-operations";
import {
  CONTRACT_VERSION,
  revisionSchema,
} from "../../../shared/notebook-snapshot-contract";
import { appBuilderCellKindSchema, appCellDraft } from "./app-cell-draft";
import type { BuilderPlacement } from "./ProjectAppBuilder";
import type { NotebookConnection } from "./types";

const INITIAL_REVISION = revisionSchema.parse("0");

export function useAppLayout(
  project: ProjectDocument | undefined,
  connections: readonly NotebookConnection[],
  active: boolean,
) {
  const mutation = useActionMutation("set-app", {
    errorNotification: "caller",
  });
  const queryClient = useQueryClient();
  const projectId = project?.id;
  const key = ["action", "get-project", { projectId }];
  const cells = useMemo(
    () =>
      [...(project?.cells ?? [])].sort((a, b) =>
        compareOrder(a.contents.order, b.contents.order),
      ),
    [project?.cells],
  );
  const [params, setParams] = useSearchParams();
  const pending = useRef(new Map<string, Promise<AppDocument>>());
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const document = useMemo(
    () => project?.appLayout ?? draftAppLayout(cells, INITIAL_REVISION),
    [project?.appLayout, cells],
  );
  const head = project?.draftHead;
  const bookmark = params.get("tab");
  const { tabId } = resolveAppTab(document, bookmark);

  useEffect(() => {
    if (!active || !projectId) return;
    void writeClientAppState(
      `selection:${TAB_ID}`,
      { kind: "app-tab", id: tabId, projectId },
      { requestSource: TAB_ID },
    ).catch((error) =>
      console.error("Could not update app tab selection", error),
    );
  }, [active, projectId, tabId]);

  function commit(patches: readonly z.input<typeof setAppPatchSchema>[]) {
    if (!projectId || pending.current.has(projectId))
      return Promise.reject(new Error("Layout edit unavailable"));
    const request = async () => {
      const command = setAppCommandSchema.parse({
        protocol: CONTRACT_VERSION,
        projectId,
        workingVersionId: head?.versionId,
        observedHead: head,
        opId: crypto.randomUUID(),
        changes: [
          {
            type: "set-app",
            expectedLayoutRevision: document.revision,
            patches,
          },
        ],
      });
      try {
        const receipt = await mutation
          .mutateAsync(command)
          .catch(async (error: unknown) => {
            if (actionErrorCode(error)) throw error;
            const result = await callAction(
              "get-notebook-operation",
              {
                projectId: command.projectId,
                opId: command.opId,
              },
              { method: "GET" },
            );
            return result.status === "found"
              ? result.receipt
              : mutation.mutateAsync(command);
          });
        if (receipt.status === "no_change") return document;
        if (receipt.status !== "applied" || !receipt.delta.appLayout)
          throw new Error("Layout receipt unavailable");
        const next = receipt.delta.appLayout;
        const newCells = receipt.delta.cells;
        queryClient.setQueryData<{ project: ProjectDocument }>(key, (data) => {
          const cachedHead = data?.project.draftHead;
          if (
            !data ||
            !cachedHead ||
            cachedHead.versionId !== receipt.nextHead.versionId ||
            BigInt(cachedHead.revision) >= BigInt(receipt.nextHead.revision)
          )
            return data;
          const byId = new Map(
            data.project.cells.map((cell) => [cell.id, cell]),
          );
          for (const cell of newCells) byId.set(cell.id, cell);
          return {
            ...data,
            project: {
              ...data.project,
              appLayout: next,
              draftHead: receipt.nextHead,
              orderRevision: receipt.delta.resources.orderRevision,
              cells: [...byId.values()],
            },
          };
        });
        return next;
      } catch (error) {
        if (actionErrorCode(error) === "notebook_conflict")
          await queryClient.invalidateQueries({ queryKey: key });
        throw error;
      }
    };
    setSaving((ids) => new Set([...ids, projectId]));
    const write = request().finally(() => {
      pending.current.delete(projectId);
      setSaving((ids) => {
        const next = new Set(ids);
        next.delete(projectId);
        return next;
      });
    });
    pending.current.set(projectId, write);
    return write;
  }

  return {
    document,
    saving: projectId !== undefined && saving.has(projectId),
    bookmark,
    selectTab: (id: string) =>
      setParams(
        (currentParams) => {
          const next = new URLSearchParams(currentParams);
          next.set("tab", id);
          return next;
        },
        { preventScrollReset: true },
      ),
    commit,
    async insert(
      kind: CellKind,
      placement: BuilderPlacement,
      inputType?: ParameterInputType,
    ) {
      const cellId = crypto.randomUUID();
      return commit([
        {
          type: "insert-and-place",
          insert: {
            type: "insert",
            cellId,
            gap: { afterCellId: cells.at(-1)?.id ?? null, beforeCellId: null },
            expectedOrderRevision: project?.orderRevision ?? INITIAL_REVISION,
            contents: appCellDraft(
              appBuilderCellKindSchema.parse(kind),
              cells,
              connections,
              inputType,
            ),
          },
          placement: { ...placement, cellId },
        },
      ]);
    },
    pendingWrite: () =>
      projectId ? pending.current.get(projectId) : undefined,
  };
}
