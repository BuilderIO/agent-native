import { useActionMutation } from "@agent-native/core/client/hooks";
import {
  DEFAULT_LAYOUT_GRID,
  normalizeLayoutGridSize,
  type LayoutGrid,
} from "@shared/layout-grid";
import type { QueryClient } from "@tanstack/react-query";
import type { RefObject } from "react";

import {
  applyDesignDataOperations,
  type DesignDataOperation,
} from "@/pages/design-editor/data-operations";

export interface SetLayoutGridArgs {
  id: string | undefined;
  canEditDesign: boolean;
  designDataJsonRef: RefObject<Record<string, unknown>>;
  queryClient: QueryClient;
  updateDesignMutation: ReturnType<
    typeof useActionMutation<undefined, undefined, "update-design">
  >;
}

/** `next` of `null` removes the entry rather than storing a disabled grid: a
 *  hidden grid still snaps, so "no grid" and "hidden" are different states. */
export function runSetLayoutGrid(
  args: SetLayoutGridArgs,
  frameId: string,
  next: Partial<LayoutGrid> | null,
): void {
  const { id, canEditDesign, designDataJsonRef, queryClient } = args;
  if (!id || !canEditDesign || !frameId) return;

  const operation: DesignDataOperation =
    next === null
      ? { op: "delete", path: ["layoutGrids", frameId] }
      : {
          op: "set",
          path: ["layoutGrids", frameId],
          value: {
            kind: "uniform",
            size: normalizeLayoutGridSize(next.size, DEFAULT_LAYOUT_GRID.size),
            visible: next.visible ?? DEFAULT_LAYOUT_GRID.visible,
          },
        };

  const nextData = applyDesignDataOperations(designDataJsonRef.current, [
    operation,
  ]);
  designDataJsonRef.current = nextData;
  queryClient.setQueryData(["action", "get-design", { id }], (old: unknown) => {
    if (!old || typeof old !== "object") return old;
    return { ...old, data: JSON.stringify(nextData) };
  });
  args.updateDesignMutation.mutate(
    { id, dataOperations: [operation] } as never,
    {
      onSettled: () => {
        void queryClient.invalidateQueries({
          queryKey: ["action", "get-design"],
        });
      },
    },
  );
}
