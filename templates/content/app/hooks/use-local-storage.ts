import { useState, useCallback, useEffect, useRef } from "react";

const LOCAL_STORAGE_CHANGE_EVENT = "content-local-storage-change";

function readStorage<T>(key: string, defaultValue: T): T {
  if (typeof window === "undefined") return defaultValue;

  try {
    const stored = window.localStorage.getItem(key);
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

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key === key) {
        setValue(readStorage(key, defaultValue));
      }
    }

    function handleLocalStorageChange(event: Event) {
      const detail = (event as CustomEvent<{ key?: string; value?: T }>).detail;
      if (detail?.key === key) {
        setValue(detail.value as T);
      }
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener(
      LOCAL_STORAGE_CHANGE_EVENT,
      handleLocalStorageChange,
    );

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(
        LOCAL_STORAGE_CHANGE_EVENT,
        handleLocalStorageChange,
      );
    };
  }, [key, defaultValue]);

  const set = useCallback(
    (val: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = val instanceof Function ? val(prev) : val;
        try {
          window.localStorage.setItem(key, JSON.stringify(next));
          window.dispatchEvent(
            new CustomEvent(LOCAL_STORAGE_CHANGE_EVENT, {
              detail: { key, value: next },
            }),
          );
        } catch {}
        return next;
      });
    },
    [key],
  );

  return [value, set];
}
