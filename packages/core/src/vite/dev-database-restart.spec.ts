import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createServer, type Plugin, type ViteDevServer } from "vite";
import { describe, expect, it } from "vitest";

import { agentNative } from "./client.js";

type ProbeResult = {
  rows: Array<{ id: number; value: string }>;
};

async function waitForProbe(
  url: string,
  condition: (result: ProbeResult) => boolean,
): Promise<ProbeResult> {
  const deadline = Date.now() + 30_000;
  let lastResult = "no response";

  while (Date.now() < deadline) {
    let response: Response;
    let body: string;
    try {
      response = await fetch(url);
      body = await response.text();
    } catch (error) {
      lastResult = error instanceof Error ? error.message : String(error);
      await new Promise((resolve) => setTimeout(resolve, 100));
      continue;
    }

    if (response.ok) {
      const result = JSON.parse(body) as ProbeResult;
      lastResult = JSON.stringify(result);
      if (condition(result)) return result;
    } else {
      lastResult = `${response.status}: ${body.slice(0, 500)}`;
      if (response.status >= 500 && response.status !== 503) {
        throw new Error(`Nitro probe failed: ${lastResult}`);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for the Nitro probe: ${lastResult}`);
}

async function closeServer(server: ViteDevServer): Promise<void> {
  try {
    await server.close();
  } catch (error) {
    const environment = server.environments.nitro as unknown as {
      devServer?: { close?: () => Promise<void> };
    };
    await environment?.devServer?.close?.();
    await server.close();
    throw error;
  }
}

describe("Nitro PGlite dev lifecycle", () => {
  it("releases the PGlite lock before Vite restarts after an .env edit", async () => {
    const testRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agent-native-pglite-env-restart-"),
    );
    const coreRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../..",
    );
    const workspaceRoot = path.resolve(coreRoot, "../..");
    const databaseDir = path.join(testRoot, ".data", "pglite");
    const envFile = path.join(testRoot, ".env");
    const previousCwd = process.cwd();
    let server: ViteDevServer | undefined;
    let serverRestarts = 0;
    let databaseCloseAcknowledgements = 0;

    fs.mkdirSync(path.join(testRoot, "server", "plugins"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(testRoot, "server", "routes"), {
      recursive: true,
    });
    fs.symlinkSync(
      path.join(workspaceRoot, "node_modules"),
      path.join(testRoot, "node_modules"),
      "dir",
    );
    fs.writeFileSync(envFile, "VITE_RESTART_TOKEN=before\n");
    fs.writeFileSync(
      path.join(testRoot, "server", "plugins", "pglite-lifecycle.ts"),
      `import { installDevDatabaseCloseHook } from ${JSON.stringify(
        pathToFileURL(
          path.join(coreRoot, "src/server/dev-database-lifecycle.ts"),
        ).href,
      )};

export default (nitroApp: any) => installDevDatabaseCloseHook(nitroApp);
`,
    );
    fs.writeFileSync(
      path.join(testRoot, "server", "routes", "probe.get.ts"),
      `import { getPgliteClient } from ${JSON.stringify(
        pathToFileURL(path.join(coreRoot, "src/db/client.ts")).href,
      )};

export default async () => {
  const db = await getPgliteClient(${JSON.stringify(`pglite:${databaseDir}`)});
  await db.exec("CREATE TABLE IF NOT EXISTS restart_probe (id integer PRIMARY KEY, value text NOT NULL)");
  await db.exec("INSERT INTO restart_probe (id, value) VALUES (1, 'persisted') ON CONFLICT (id) DO NOTHING");
  const result = await db.query("SELECT id, value FROM restart_probe ORDER BY id");
  return {
    rows: result.rows,
  };
};
`,
    );

    const lifecycleObserver: Plugin = {
      name: "pglite-restart-test-observer",
      configureServer(server) {
        server.httpServer?.once("close", () => {
          serverRestarts++;
        });
        const hot = server.environments.nitro?.hot;
        hot?.on("agent-native:dev-database-closed", (payload: any) => {
          if (typeof payload?.requestId === "string" && !payload.error) {
            databaseCloseAcknowledgements++;
          }
        });
      },
    };

    try {
      process.chdir(testRoot);
      server = await createServer({
        logLevel: "silent",
        optimizeDeps: { noDiscovery: true, include: [] },
        plugins: [...agentNative(), lifecycleObserver],
        root: testRoot,
        server: {
          fs: { allow: [workspaceRoot, coreRoot] },
          host: "127.0.0.1",
          port: 0,
        },
      });
      await server.listen();

      const baseUrl = server.resolvedUrls?.local[0];
      if (!baseUrl) throw new Error("Vite did not report its local dev URL");
      const probeUrl = new URL("probe", baseUrl).href;
      const first = await waitForProbe(probeUrl, () => true);
      expect(first.rows).toEqual([{ id: 1, value: "persisted" }]);
      expect(fs.existsSync(`${databaseDir}.agent-native-pglite.lock`)).toBe(
        true,
      );

      fs.writeFileSync(envFile, "VITE_RESTART_TOKEN=after\n");

      const restarted = await waitForProbe(
        probeUrl,
        () => databaseCloseAcknowledgements > 0,
      );
      expect(serverRestarts).toBeGreaterThan(0);
      expect(restarted.rows).toEqual([{ id: 1, value: "persisted" }]);
      expect(fs.existsSync(`${databaseDir}.agent-native-pglite.lock`)).toBe(
        true,
      );
    } finally {
      try {
        if (server) await closeServer(server);
      } finally {
        process.chdir(previousCwd);
        fs.rmSync(testRoot, { recursive: true, force: true });
      }
    }
  }, 90_000);
});
