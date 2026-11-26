import { useReducer } from "react";

import type { Paint } from "../../../src/ui/base-ui/paint-editor.js";

interface History {
  current: readonly Paint[];
  draft: readonly Paint[] | null;
  past: readonly (readonly Paint[])[];
}
type Edit =
  | { type: "undo" }
  | { type: "cancel" }
  | { type: "commit" | "preview"; paints: readonly Paint[] };
function history(state: History, edit: Edit): History {
  if (edit.type === "cancel") return { ...state, draft: null };
  if (edit.type === "undo") {
    const previous = state.past.at(-1);
    return previous
      ? { current: previous, draft: null, past: state.past.slice(0, -1) }
      : state;
  }
  if (edit.type === "preview") return { ...state, draft: edit.paints };
  if (JSON.stringify(state.current) === JSON.stringify(edit.paints))
    return { ...state, draft: null };
  return {
    current: edit.paints,
    draft: null,
    past: [...state.past, state.current],
  };
}

export function usePaintHistory(initial: readonly Paint[]) {
  const [state, dispatch] = useReducer(history, {
    current: initial,
    draft: null,
    past: [],
  });
  return {
    paints: state.draft ?? state.current,
    edit: (paints: readonly Paint[], phase: "preview" | "commit") =>
      dispatch({ type: phase, paints }),
    cancel: () => dispatch({ type: "cancel" }),
    undo: () => dispatch({ type: "undo" }),
    canUndo: state.past.length > 0,
  };
}
