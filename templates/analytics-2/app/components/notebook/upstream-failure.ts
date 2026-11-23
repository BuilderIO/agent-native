import type { NotebookCellOutputState } from "./types";

type CellStates = Record<
  string,
  | {
      attempt?: { state: { status: string; blockedBy?: string } } | null;
    }
  | undefined
>;

export function inheritUpstreamFailures(
  cells: CellStates,
  outputs: Record<string, NotebookCellOutputState>,
) {
  for (const [cellId, cell] of Object.entries(cells)) {
    const state = cell?.attempt?.state;
    if (state?.status !== "blocked" || !state.blockedBy) continue;
    const upstream = outputs[state.blockedBy];
    if (upstream?.status !== "error" || upstream.output?.type !== "error")
      continue;
    outputs[cellId] = {
      ...outputs[cellId],
      status: "error",
      output: upstream.output,
    };
  }
}
