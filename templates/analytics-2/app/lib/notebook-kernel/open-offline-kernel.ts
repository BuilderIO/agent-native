export function openOfflineNotebookKernel() {
  return new Worker(new URL("./offline-kernel.worker.ts", import.meta.url), {
    type: "module",
  });
}
