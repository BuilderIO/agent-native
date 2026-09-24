import { useCallback, useEffect, useRef, useState } from "react";

import {
  clearFileDraft,
  readFileDraft,
  writeFileDraft,
} from "./file-draft-cache.js";

export function useFileDraft(
  key: string | null,
  files: readonly File[],
  restore: (file: File) => Promise<unknown>,
) {
  const [error, setError] = useState<"restore" | "save" | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [restored, setRestored] = useState<{
    key: string;
    count: number;
  } | null>(null);
  const latest = useRef({ files, restore });
  latest.current = { files, restore };
  const writes = useRef(Promise.resolve());
  const writeRevision = useRef<string | undefined>(undefined);
  useEffect(() => {
    setError(null);
    setLoadedKey(null);
    setRestored(null);
    if (!key) return;
    let active = true;
    void readFileDraft(key)
      .then(async (saved) => {
        if (!active) return;
        if (!latest.current.files.length && saved?.length) {
          for (const file of saved ?? []) {
            if (!active) return;
            await latest.current.restore(file);
          }
          if (active) setRestored({ key, count: saved.length });
        } else {
          if (active) setLoadedKey(key);
        }
      })
      .catch(() => {
        if (active) setError("restore");
      });
    return () => {
      active = false;
    };
  }, [key]);
  useEffect(() => {
    if (restored?.key === key && files.length >= restored.count) {
      setLoadedKey(key);
      setRestored(null);
    }
  }, [restored, key, files]);
  useEffect(() => {
    if (!key || loadedKey !== key) return;
    let active = true;
    const snapshot = [...files];
    const revision = crypto.randomUUID();
    writeRevision.current = revision;
    writes.current = writes.current
      .catch(() => {})
      .then(() => writeFileDraft(key, snapshot, revision));
    void writes.current.then(
      () => {
        if (active) setError(null);
      },
      () => {
        if (active) setError("save");
      },
    );
    return () => {
      active = false;
    };
  }, [key, loadedKey, files]);
  const captureSubmission = useCallback(() => {
    const revision = writeRevision.current;
    const pendingWrite = writes.current;
    return () => {
      if (!key || !revision) return;
      void pendingWrite
        .then(() => clearFileDraft(key, revision))
        .catch(() => setError("save"));
    };
  }, [key]);
  return {
    error,
    captureSubmission,
    restoring: Boolean(key && loadedKey !== key && error !== "restore"),
  };
}
