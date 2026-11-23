export function waitUntilOnline(): Promise<void> {
  if (typeof navigator === "undefined" || navigator.onLine)
    return Promise.resolve();
  return new Promise((resolve) => {
    window.addEventListener("online", () => resolve(), { once: true });
  });
}
