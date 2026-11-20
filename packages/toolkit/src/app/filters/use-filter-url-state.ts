import { useCallback, useEffect, useRef, useState } from "react";

import {
  createFilterState,
  type FilterField,
  type FilterState,
} from "./model.js";
import {
  filterSearchKey,
  filterStateKey,
  readFilterParams,
  writeFilterSearch,
  type FilterParamOptions,
} from "./url.js";

export interface UseFilterUrlStateOptions extends FilterParamOptions {
  fields: readonly FilterField<never>[];
  search: string;
  onSearchChange: (search: string, options: { replace: boolean }) => void;
}

export interface FilterUrlState {
  state: FilterState;
  setState: (
    next: FilterState | ((current: FilterState) => FilterState),
  ) => void;
  clear: () => void;
}

export function useFilterUrlState({
  fields,
  search,
  onSearchChange,
  prefix,
}: UseFilterUrlStateOptions): FilterUrlState {
  const [state, setLocalState] = useState(() =>
    readFilterParams(search, fields, { prefix }),
  );
  const latest = useRef({ fields, search, onSearchChange, prefix, state });
  latest.current = { fields, search, onSearchChange, prefix, state };
  const pending = useRef<string | null>(null);

  const urlKey = filterSearchKey(search, fields, { prefix });
  const stateKey = filterStateKey(state, fields);

  const write = useCallback(() => {
    const current = latest.current;
    pending.current = filterStateKey(current.state, current.fields);
    current.onSearchChange(
      writeFilterSearch(current.search, current.state, current.fields, {
        prefix: current.prefix,
      }),
      { replace: false },
    );
  }, []);

  useEffect(() => {
    const current = latest.current;
    const currentKey = filterStateKey(current.state, current.fields);
    if (pending.current === urlKey) {
      pending.current = null;
      if (currentKey !== urlKey) write();
      return;
    }
    pending.current = null;
    if (currentKey === urlKey) return;
    setLocalState(
      readFilterParams(current.search, current.fields, {
        prefix: current.prefix,
      }),
    );
  }, [urlKey, write]);

  useEffect(() => {
    if (pending.current !== null) return;
    const current = latest.current;
    const shown = filterSearchKey(current.search, current.fields, {
      prefix: current.prefix,
    });
    if (shown !== stateKey) write();
  }, [stateKey, write]);

  const setState = useCallback(
    (next: FilterState | ((current: FilterState) => FilterState)) => {
      setLocalState((current) =>
        typeof next === "function" ? next(current) : next,
      );
    },
    [],
  );

  const clear = useCallback(() => {
    setLocalState(createFilterState(latest.current.fields));
  }, []);

  return { state, setState, clear };
}
