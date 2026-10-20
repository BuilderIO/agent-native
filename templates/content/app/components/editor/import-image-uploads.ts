const IMAGE_UPLOAD_CONCURRENCY = 3;

/**
 * Uploads picked images a few at a time and returns each one's url by name.
 * An upload is shared through `uploads` for as long as the import's key
 * lives, so a retry after a failure waits for uploads still running instead
 * of sending those images twice. After a failure no new upload starts.
 */
export async function uploadPickedImages(
  files: File[],
  uploads: Map<File, Promise<string>>,
  upload: (file: File) => Promise<string>,
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  let next = 0;
  let failed = false;
  const work = async () => {
    while (!failed && next < files.length) {
      const file = files[next++]!;
      let pending = uploads.get(file);
      if (!pending) {
        const started = upload(file);
        pending = started;
        uploads.set(file, started);
        started.catch(() => {
          if (uploads.get(file) === started) uploads.delete(file);
        });
      }
      try {
        urls.set(file.name, await pending);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(IMAGE_UPLOAD_CONCURRENCY, files.length) },
      work,
    ),
  );
  return urls;
}
