import { useCallback, useEffect, useRef, useState } from "react";

export function useEagerFileUploads<T>(
  upload: (files: File[]) => Promise<readonly T[]>,
) {
  const uploadsRef = useRef(new Map<File, Promise<T>>());
  const pendingRef = useRef(new Set<File>());
  const mountedRef = useRef(true);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const syncUploading = useCallback(() => {
    if (mountedRef.current) {
      setUploading(pendingRef.current.size > 0);
    }
  }, []);

  const startUploads = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const batch = upload(files);
      for (const [index, file] of files.entries()) {
        const promise = batch.then((results) => {
          const result = results[index];
          if (result === undefined) {
            throw new Error(
              "Upload failed: response file count did not match request",
            );
          }
          return result;
        });
        uploadsRef.current.set(file, promise);
        pendingRef.current.add(file);
        void promise.then(
          () => {
            if (uploadsRef.current.get(file) !== promise) return;
            pendingRef.current.delete(file);
            syncUploading();
          },
          () => {
            if (uploadsRef.current.get(file) !== promise) return;
            uploadsRef.current.delete(file);
            pendingRef.current.delete(file);
            syncUploading();
          },
        );
      }
      syncUploading();
    },
    [syncUploading, upload],
  );

  const uploadFiles = useCallback(
    async (files: readonly File[]) => {
      if (files.length === 0) return [] as T[];
      const newFiles = [...new Set(files)].filter(
        (file) => !uploadsRef.current.has(file),
      );
      startUploads(newFiles);
      return Promise.all(
        files.map((file) => {
          const promise = uploadsRef.current.get(file);
          if (!promise)
            throw new Error(`Upload did not start for "${file.name}".`);
          return promise;
        }),
      );
    },
    [startUploads],
  );

  const reset = useCallback(() => {
    uploadsRef.current.clear();
    pendingRef.current.clear();
    syncUploading();
  }, [syncUploading]);

  return { uploadFiles, uploading, reset };
}
