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
  const pending = useRef<string[]>([]);

  const urlKey = filterSearchKey(search, fields, { prefix });
  const stateKey = filterStateKey(state, fields);

  useEffect(() => {
    const echo = pending.current.indexOf(urlKey);
    if (echo !== -1) {
      pending.current = pending.current.slice(echo + 1);
      return;
    }
    pending.current = [];
    const current = latest.current;
    if (filterStateKey(current.state, current.fields) === urlKey) return;
    setLocalState(
      readFilterParams(current.search, current.fields, {
        prefix: current.prefix,
      }),
    );
  }, [urlKey]);

  useEffect(() => {
    const current = latest.current;
    const options = { prefix: current.prefix };
    const target =
      pending.current.at(-1) ??
      filterSearchKey(current.search, current.fields, options);
    if (target === stateKey) return;
    pending.current = [...pending.current, stateKey];
    current.onSearchChange(
      writeFilterSearch(current.search, current.state, current.fields, options),
      { replace: false },
    );
  }, [stateKey]);

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
