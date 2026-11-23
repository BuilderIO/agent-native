import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";

import { reactRouter } from "@react-router/dev/vite";
import { createServer, normalizePath, type ViteDevServer } from "vite";

await test("report A2-DAILY-OPTIMIZER-COLD-ENTRY scans the client and root before browser discovery", async () => {
  const app = resolve(import.meta.dirname, "../..");
  const cacheDir = await mkdtemp(resolve(tmpdir(), "analytics-optimizer-"));
  const configFile = resolve(cacheDir, "vite.config.mjs");
  await writeFile(configFile, "export default {};\n");
  let server: ViteDevServer | undefined;
  try {
    server = await createServer({
      root: app,
      configFile,
      envDir: false,
      plugins: [reactRouter()],
      server: { middlewareMode: true, watch: null, hmr: false },
      cacheDir,
      logLevel: "silent",
    });
    const entries = [server.config.optimizeDeps.entries].flat();
    for (const file of ["entry.client.tsx", "root.tsx"])
      assert.ok(
        entries.includes(normalizePath(resolve(app, "app", file))),
        `${file} must be an optimizer scan entry`,
      );
  } finally {
    await server?.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});
