import { useEffect, useState } from "react";

export const DATA_VIEWS = ["schema", "table", "json"] as const;
export type DataView = (typeof DATA_VIEWS)[number];

type DataPaneName = "input" | "output";

const FIRST_VIEW: Record<DataPaneName, DataView> = {
  input: "schema",
  output: "table",
};

const SEARCH_DEBOUNCE_MS = 300;

export function isDataView(value: unknown): value is DataView {
  return (
    typeof value === "string" &&
    (DATA_VIEWS as readonly string[]).includes(value)
  );
}

function storageKey(pane: DataPaneName): string {
  return `factory.workflow.nodeData.${pane}View`;
}

function rememberedView(pane: DataPaneName): DataView {
  try {
    const stored = window.localStorage.getItem(storageKey(pane));
    return isDataView(stored) ? stored : FIRST_VIEW[pane];
  } catch {
    // coercion-ok: the remembered view is a preference; the default view works without it.
    return FIRST_VIEW[pane];
  }
}

/** The view a pane shows, remembered per pane in this browser. */
export function useDataView(
  pane: DataPaneName,
): [DataView, (view: DataView) => void] {
  const [view, setView] = useState<DataView>(() => rememberedView(pane));
  const choose = (next: DataView) => {
    setView(next);
    try {
      window.localStorage.setItem(storageKey(pane), next);
    } catch {
      // coercion-ok: without storage the choice lasts until the modal closes.
    }
  };
  return [view, choose];
}

/** The search box's text now, and the trimmed query the views filter by 300 ms after the last keystroke. */
export function useDebouncedSearch(): {
  draft: string;
  setDraft: (value: string) => void;
  query: string;
} {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const id = window.setTimeout(
      () => setQuery(draft.trim()),
      SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(id);
  }, [draft]);
  return { draft, setDraft, query };
}
