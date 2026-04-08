import { useState, useCallback, useRef } from "react";

function readStorage<T>(key: string, defaultValue: T): T {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch {
    return defaultValue;
  }
}

export function useLocalStorage<T>(
  key: string,
  defaultValue: T,
): [T, (val: T | ((prev: T) => T)) => void] {
  const prevKeyRef = useRef(key);
  const [value, setValue] = useState<T>(() => readStorage(key, defaultValue));

  // Synchronously update value when key changes (no stale render)
  if (prevKeyRef.current !== key) {
    prevKeyRef.current = key;
    const fresh = readStorage(key, defaultValue);
    setValue(fresh);
  }

  const set = useCallback(
    (val: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = val instanceof Function ? val(prev) : val;
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {}
        return next;
      });
    },
    [key],
  );

  return [value, set];
}
