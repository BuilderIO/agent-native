import { useCallback } from "react";

import type { Cell } from "@/lib/model/contracts";

import type { CellDrafts } from "./useCellDrafts";

export function useReactiveInputs({ drafts }: { drafts: CellDrafts }) {
  const { update, save, flushInputs } = drafts;

  const change = useCallback(
    (cell: Cell, value: string) => {
      if (cell.contents.kind !== "input") return;
      const type = cell.contents.inputType;
      const delay =
        type === "NUMERIC_INPUT" ? 250 : type === "TEXT_INPUT" ? 2000 : false;
      update(cell, value, delay);
    },
    [update],
  );

  const commit = useCallback(
    (cell: Cell, value?: string, inputOptionsResultId?: string) =>
      save(cell, value, false, false, inputOptionsResultId),
    [save],
  );

  return { change, commit, flush: flushInputs };
}
