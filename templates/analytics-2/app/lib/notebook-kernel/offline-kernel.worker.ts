import { loadPyodide } from "pyodide";

import { browserNotebookPackages } from "../../../shared/notebook-browser-packages.js";
import { OfflineKernel, type OfflineDuckDB } from "./offline-kernel.js";

type Request =
  | { type: "initialize"; id: string; assets: string }
  | {
      type: "command";
      id: string;
      command: unknown;
      artifacts: Map<string, Uint8Array>;
    };

type DuckDBModule = {
  createDuckDB: (
    bundle: { mvp: { mainModule: string } },
    logger: unknown,
    runtime: unknown,
  ) => Promise<OfflineDuckDB & { instantiate: () => Promise<unknown> }>;
  VoidLogger: new () => unknown;
  BROWSER_RUNTIME: unknown;
};

let local: Promise<OfflineKernel> | null = null;
const reply = (message: unknown) => self.postMessage(message);

async function initialize(assets: string) {
  const root = new URL(assets, self.location.origin);
  if (root.origin !== self.location.origin || !root.pathname.endsWith("/"))
    throw new Error("Invalid offline kernel asset directory");
  const python = await loadPyodide({
    indexURL: new URL("pyodide/", root).href,
    jsglobals: Object.create(null),
  });
  const [arrow, duckdb] = await Promise.allSettled([
    python.loadPackage([...browserNotebookPackages]),
    openDuckDB(root),
  ]);
  return new OfflineKernel(
    python,
    duckdb.status === "fulfilled" ? duckdb.value : null,
    arrow.status === "fulfilled",
  );
}

async function openDuckDB(root: URL) {
  const duckdbUrl = new URL("duckdb/duckdb.mjs", root).href;
  const module: DuckDBModule = await import(/* @vite-ignore */ duckdbUrl);
  const duckdb = await module.createDuckDB(
    { mvp: { mainModule: new URL("duckdb/duckdb-mvp.wasm", root).href } },
    new module.VoidLogger(),
    module.BROWSER_RUNTIME,
  );
  await duckdb.instantiate();
  return duckdb;
}

self.addEventListener("message", (message: MessageEvent<Request>) => {
  const request = message.data;
  if (request.type === "initialize") {
    local ??= initialize(request.assets);
    void local.then(
      () => reply({ id: request.id, type: "ready" }),
      (failure: unknown) => {
        console.error("Browser notebook kernel initialization failed", failure);
        reply({ id: request.id, type: "unavailable" });
      },
    );
    return;
  }
  if (local === null) {
    reply({ id: request.id, type: "unavailable" });
    return;
  }
  void local
    .then((kernel) => {
      const receipt = kernel.execute(
        request.command,
        request.artifacts,
        (output) => reply({ id: request.id, ...output, type: "event" }),
      );
      reply({ id: request.id, type: "acknowledgement", receipt });
    })
    .catch(() => reply({ id: request.id, type: "unreadable" }));
});
