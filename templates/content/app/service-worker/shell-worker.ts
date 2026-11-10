/**
 * Entry of Content's app-shell service worker. The build bundles this file on
 * its own into `/sw.js`; the logic lives in `shell-worker-core.ts`.
 */
import { SHELL_ADOPT_MESSAGE, SHELL_RUNNING_MESSAGE } from "./shell-contract";
import { createShellWorker, shellStaticRoutes } from "./shell-worker-core";
import { workerScope } from "./worker-scope";

const scope = workerScope();

const worker = createShellWorker({
  origin: scope.location.origin,
  caches: scope.caches,
  fetch: (input, init) => scope.fetch(input, init),
  now: () => Date.now(),
  unregister: () => scope.registration.unregister(),
  clientIds: async () =>
    (
      await scope.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      })
    ).map((client) => client.id),
  languages: () => scope.navigator.languages,
  saveData: () => scope.navigator.connection?.saveData === true,
});

scope.addEventListener("install", (event) => {
  if (event.addRoutes) {
    event.waitUntil(
      event.addRoutes(shellStaticRoutes()).catch((error: unknown) => {
        // coercion-ok: the routes only skip the fetch handler, which serves
        // the same requests, so a browser that rejects them still works.
        console.warn("[content-shell] static routes refused", error);
      }),
    );
  }
  // A new worker shares the old one's caches, so it can take over open tabs
  // at once: they keep running the build they loaded.
  void scope.skipWaiting();
});

scope.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await worker.activate();
      // Navigation preload starts the network request while the worker boots;
      // the worker uses it to check the cached shell is still current.
      await scope.registration.navigationPreload?.enable();
      await scope.clients.claim();
    })(),
  );
});

scope.addEventListener("fetch", (event) => worker.handleFetch(event));

scope.addEventListener("message", (event) => {
  const data = event.data as {
    type?: unknown;
    url?: unknown;
    version?: unknown;
  } | null;
  const clientId = event.source?.id;
  const client =
    clientId && typeof data?.version === "string"
      ? { id: clientId, version: data.version }
      : undefined;
  if (data?.type === SHELL_RUNNING_MESSAGE && client) {
    event.waitUntil(
      worker.pageLoaded(client.id, client.version).catch((error: unknown) => {
        console.warn("[content-shell] could not note the tab's build", error);
      }),
    );
    return;
  }
  if (data?.type !== SHELL_ADOPT_MESSAGE || typeof data.url !== "string") {
    return;
  }
  event.waitUntil(
    worker.adopt(data.url, client).catch((error: unknown) => {
      console.warn("[content-shell] could not cache the shell", error);
    }),
  );
});
