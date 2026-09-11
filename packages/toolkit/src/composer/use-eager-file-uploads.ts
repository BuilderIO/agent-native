import { useCallback, useEffect, useRef, useState } from "react";

interface EagerUploadOptions<T> {
  onDiscard?: (result: T) => Promise<void> | void;
  onRetainedFilesAbandoned?: (
    files: readonly File[],
    discard: () => void,
  ) => void;
}

interface UploadEntry<T> {
  promise: Promise<T>;
}

export function useEagerFileUploads<T>(
  upload: (files: File[]) => Promise<readonly T[]>, // i18n-ignore: parameter declaration, not UI copy
  options: EagerUploadOptions<T> = {},
) {
  const uploadsRef = useRef(new Map<File, UploadEntry<T>>());
  const pendingRef = useRef(new Set<File>());
  const retainedFilesRef = useRef(new Set<File>());
  const mountedRef = useRef(true);
  const [uploading, setUploading] = useState(false);

  const syncUploading = useCallback(() => {
    if (mountedRef.current) {
      setUploading(pendingRef.current.size > 0);
    }
  }, []);

  const discardFile = useCallback(
    (file: File) => {
      retainedFilesRef.current.delete(file);
      const entry = uploadsRef.current.get(file);
      if (!entry) return;
      uploadsRef.current.delete(file);
      pendingRef.current.delete(file);
      void entry.promise
        .then(
          (result) => options.onDiscard?.(result),
          () => undefined,
        )
        .catch((error) => {
          console.error("Eager upload cleanup failed", error);
        });
    },
    [options.onDiscard],
  );

  const syncFiles = useCallback(
    (files: readonly File[]) => {
      const activeFiles = new Set(files);
      for (const file of uploadsRef.current.keys()) {
        if (!activeFiles.has(file)) discardFile(file);
      }
      syncUploading();
    },
    [discardFile, syncUploading],
  );

  const discardFiles = useCallback(
    (files: readonly File[]) => {
      for (const file of new Set(files)) discardFile(file);
      syncUploading();
    },
    [discardFile, syncUploading],
  );

  const retainFiles = useCallback((files: readonly File[]) => {
    for (const file of new Set(files)) {
      if (uploadsRef.current.has(file)) retainedFilesRef.current.add(file);
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
        const entry = { promise };
        uploadsRef.current.set(file, entry);
        pendingRef.current.add(file);
        void promise.then(
          () => {
            if (uploadsRef.current.get(file) !== entry) return;
            pendingRef.current.delete(file);
            syncUploading();
          },
          () => {
            if (uploadsRef.current.get(file) !== entry) return;
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
          const entry = uploadsRef.current.get(file);
          if (!entry)
            throw new Error(`Upload did not start for "${file.name}".`);
          return entry.promise;
        }),
      );
    },
    [startUploads],
  );

  const commitFiles = useCallback(
    (files: readonly File[]) => {
      for (const file of new Set(files)) {
        retainedFilesRef.current.delete(file);
        if (!uploadsRef.current.has(file)) continue;
        uploadsRef.current.delete(file);
        pendingRef.current.delete(file);
      }
      syncUploading();
    },
    [syncUploading],
  );

  const reset = useCallback(() => {
    for (const file of uploadsRef.current.keys()) {
      if (!retainedFilesRef.current.has(file)) discardFile(file);
    }
    syncUploading();
  }, [discardFile, syncUploading]);

  const abandonRetainedFiles = useCallback(() => {
    const files = [...retainedFilesRef.current];
    if (files.length === 0) return;
    const discard = () => discardFiles(files);
    if (options.onRetainedFilesAbandoned) {
      options.onRetainedFilesAbandoned(files, discard);
    } else {
      discard();
    }
  }, [discardFiles, options.onRetainedFilesAbandoned]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      abandonRetainedFiles();
      reset();
    };
  }, [abandonRetainedFiles, reset]);

  return {
    commitFiles,
    discardFiles,
    retainFiles,
    syncFiles,
    uploadFiles,
    uploading,
    reset,
  };
}
