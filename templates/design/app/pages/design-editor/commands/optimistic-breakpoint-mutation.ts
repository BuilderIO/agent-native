import type { QueryClient } from "@tanstack/react-query";

import {
  applyOptimisticBreakpointAdd,
  applyOptimisticBreakpointRemove,
} from "../derive/design-breakpoints";

type DesignQueryData = { data?: string } & Record<string, unknown>;

/**
 * Patch get-design query cache + the live designDataJsonRef so breakpoint
 * add/remove paints in the same click frame. Returns a rollback that restores
 * both on mutation failure.
 */
export function beginOptimisticBreakpointSetPatch(args: {
  designId: string;
  queryClient: QueryClient;
  designDataJsonRef: { current: Record<string, unknown> };
  nextData: Record<string, unknown>;
}): { rollback: () => void } {
  const designQueryKey = ["action", "get-design", { id: args.designId }] as const;
  const previousDesign = args.queryClient.getQueryData<DesignQueryData>(
    designQueryKey,
  );
  const previousData = args.designDataJsonRef.current;
  args.designDataJsonRef.current = args.nextData;
  args.queryClient.setQueryData(
    designQueryKey,
    (old: DesignQueryData | undefined) => {
      if (!old || typeof old !== "object") return old;
      return { ...old, data: JSON.stringify(args.nextData) };
    },
  );
  return {
    rollback: () => {
      args.designDataJsonRef.current = previousData;
      args.queryClient.setQueryData(designQueryKey, previousDesign);
    },
  };
}

export function optimisticAddBreakpointData(
  designData: Record<string, unknown>,
  breakpoint: { id: string; label: string; widthPx: number },
): Record<string, unknown> {
  return applyOptimisticBreakpointAdd(designData, breakpoint);
}

export function optimisticRemoveBreakpointData(
  designData: Record<string, unknown>,
  breakpointId: string,
): Record<string, unknown> {
  return applyOptimisticBreakpointRemove(designData, breakpointId);
}
