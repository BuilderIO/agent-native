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
  const requested = useRef<string[]>([]);

  const urlKey = filterSearchKey(search, fields, { prefix });
  const stateKey = filterStateKey(state, fields);

  useEffect(() => {
    const current = latest.current;
    const options = { prefix: current.prefix };
    const currentKey = filterStateKey(current.state, current.fields);
    const own = requested.current.indexOf(urlKey);
    if (own !== -1) {
      requested.current = requested.current.slice(own + 1);
      if (requested.current.length > 0 || currentKey === urlKey) return;
      requested.current = [currentKey];
      current.onSearchChange(
        writeFilterSearch(
          current.search,
          current.state,
          current.fields,
          options,
        ),
        { replace: true },
      );
      return;
    }
    requested.current = [];
    if (currentKey === urlKey) return;
    setLocalState(readFilterParams(current.search, current.fields, options));
  }, [urlKey]);

  useEffect(() => {
    const current = latest.current;
    const options = { prefix: current.prefix };
    const shownKey = filterSearchKey(current.search, current.fields, options);
    if ((requested.current.at(-1) ?? shownKey) === stateKey) return;
    if (stateKey !== shownKey) requested.current.push(stateKey);
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
