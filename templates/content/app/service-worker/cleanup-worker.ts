/**
 * The worker a `VITE_CONTENT_SERVICE_WORKER=off` build ships as `/sw.js`.
 * Browsers pick it up on their next update check, and it deletes the shell
 * caches and unregisters itself. It has no fetch handler, so until the tab
 * navigates every request goes to the network.
 */
import { deleteShellCaches } from "./shell-contract";
import { workerScope } from "./worker-scope";

const scope = workerScope();

scope.addEventListener("install", () => {
  void scope.skipWaiting();
});

scope.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await deleteShellCaches(scope.caches);
      await scope.registration.unregister();
    })(),
  );
});
