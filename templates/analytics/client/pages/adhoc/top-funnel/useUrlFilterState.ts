import { useState, useCallback, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

/**
 * Hook that syncs state to URL query params for shareability.
 * - String values are stored directly: ?dateStart=2025-01-01
 * - Array values are stored comma-separated: ?channel=organic,direct
 * - Empty arrays and default values are omitted from the URL
 */

type ParamDef =
  | { type: "string"; default: string }
  | { type: "string[]"; default: string[] }
  | { type: "number"; default: number };

type ParamDefs = Record<string, ParamDef>;

type StateFromDefs<T extends ParamDefs> = {
  [K in keyof T]: T[K] extends { type: "string" }
    ? string
    : T[K] extends { type: "string[]" }
      ? string[]
      : T[K] extends { type: "number" }
        ? number
        : never;
};

function readParam(
  params: URLSearchParams,
  key: string,
  def: ParamDef
): string | string[] | number {
  const raw = params.get(key);
  if (raw === null) return def.default;

  switch (def.type) {
    case "string":
      return raw;
    case "string[]":
      return raw === "" ? [] : raw.split(",").map(decodeURIComponent);
    case "number": {
      const n = Number(raw);
      return isNaN(n) ? def.default : n;
    }
  }
}

function writeParams(
  defs: ParamDefs,
  state: Record<string, unknown>
): URLSearchParams {
  const params = new URLSearchParams();

  for (const [key, def] of Object.entries(defs)) {
    const val = state[key];
    const defaultVal = def.default;

    switch (def.type) {
      case "string":
        if (val !== defaultVal) params.set(key, String(val));
        break;
      case "string[]": {
        const arr = val as string[];
        const defArr = defaultVal as string[];
        if (
          arr.length > 0 &&
          (arr.length !== defArr.length ||
            arr.some((v, i) => v !== defArr[i]))
        ) {
          params.set(key, arr.map(encodeURIComponent).join(","));
        }
        break;
      }
      case "number":
        if (val !== defaultVal) params.set(key, String(val));
        break;
    }
  }

  return params;
}

/**
 * Prefix allows multiple tabs on the same page to use different
 * param namespaces. E.g., prefix="t1" → ?t1.dateStart=...
 */
export function useUrlFilterState<T extends ParamDefs>(
  defs: T,
  prefix?: string
): [
  StateFromDefs<T>,
  <K extends keyof T>(key: K, value: StateFromDefs<T>[K]) => void,
  (partial: Partial<StateFromDefs<T>>) => void,
] {
  const prefixDot = prefix ? `${prefix}.` : "";
  const isInitialized = useRef(false);
  const isInternalWrite = useRef(false);
  const location = useLocation();

  // Read state from current URL search params
  const readFromUrl = useCallback((search: string): StateFromDefs<T> => {
    const params = new URLSearchParams(search);
    const state: Record<string, unknown> = {};
    for (const [key, def] of Object.entries(defs)) {
      state[key] = readParam(params, `${prefixDot}${key}`, def);
    }
    return state as StateFromDefs<T>;
  }, []);

  const [state, setState] = useState<StateFromDefs<T>>(() => readFromUrl(window.location.search));

  // Re-sync from URL when React Router navigates (e.g. sidebar link click)
  useEffect(() => {
    if (!isInitialized.current) return;
    if (isInternalWrite.current) {
      isInternalWrite.current = false;
      return;
    }
    const newState = readFromUrl(location.search);
    setState(newState);
  }, [location.search]);

  // Write state to URL when it changes (skip initial render)
  useEffect(() => {
    if (!isInitialized.current) {
      isInitialized.current = true;
      return;
    }

    const currentParams = new URLSearchParams(window.location.search);

    // Remove all params with our prefix first
    const keysToRemove: string[] = [];
    currentParams.forEach((_, k) => {
      if (prefix ? k.startsWith(prefixDot) : Object.keys(defs).includes(k)) {
        keysToRemove.push(k);
      }
    });
    keysToRemove.forEach((k) => currentParams.delete(k));

    // Add our params
    const ourParams = writeParams(defs, state as Record<string, unknown>);
    ourParams.forEach((v, k) => currentParams.set(`${prefixDot}${k}`, v));

    const newSearch = currentParams.toString();
    const newUrl = `${window.location.pathname}${newSearch ? `?${newSearch}` : ""}`;

    // Use replaceState to avoid cluttering browser history
    isInternalWrite.current = true;
    window.history.replaceState(null, "", newUrl);
  }, [state]);

  const setField = useCallback(
    <K extends keyof T>(key: K, value: StateFromDefs<T>[K]) => {
      setState((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const setMany = useCallback(
    (partial: Partial<StateFromDefs<T>>) => {
      setState((prev) => ({ ...prev, ...partial }));
    },
    []
  );

  return [state, setField, setMany];
}
