const IMAGE_UPLOAD_CONCURRENCY = 3;

export async function uploadPickedImages<T extends { name: string }>(
  files: T[],
  uploads: Map<T, Promise<string>>,
  upload: (file: T) => Promise<string>,
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
