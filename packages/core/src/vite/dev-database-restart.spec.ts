import { randomUUID } from "node:crypto";
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
  observeResponse?: (status: number, body: string) => void,
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

    observeResponse?.(response.status, body);

    if (response.ok) {
      const result = JSON.parse(body) as ProbeResult;
      lastResult = JSON.stringify(result);
      if (condition(result)) return result;
    } else {
      lastResult = `${response.status}: ${body.slice(0, 500)}`;
      if (
        response.status >= 500 &&
        response.status !== 503 &&
        !body.includes("PGlite access is paused")
      ) {
        throw new Error(`Nitro probe failed: ${lastResult}`);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for the Nitro probe: ${lastResult}`);
}

async function waitForFile(file: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${file}`);
}

async function closeNitroDatabase(
  server: ViteDevServer,
  onClosing: () => void,
): Promise<void> {
  const hot = server.environments.nitro?.hot as
    | {
        off?: (event: string, listener: (payload: any) => void) => void;
        on?: (event: string, listener: (payload: any) => void) => void;
        send?: (payload: any) => void;
      }
    | undefined;
  if (!hot?.off || !hot.on || !hot.send) {
    throw new Error(
      "Nitro dev environment cannot send the database close event",
    );
  }

  const requestId = randomUUID();
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      hot.off?.("agent-native:dev-database-closing", onClosingEvent);
      hot.off?.("agent-native:dev-database-closed", onClosed);
    };
    const onClosingEvent = (payload: any) => {
      if (payload?.requestId === requestId) onClosing();
    };
    const onClosed = (payload: any) => {
      if (payload?.requestId !== requestId) return;
      cleanup();
      if (typeof payload.error === "string") {
        reject(new Error(payload.error));
      } else {
        resolve();
      }
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Nitro did not acknowledge database cleanup"));
    }, 5_000);
    hot.on?.("agent-native:dev-database-closing", onClosingEvent);
    hot.on?.("agent-native:dev-database-closed", onClosed);
    hot.send?.({
      type: "custom",
      event: "agent-native:dev-database-close",
      data: { requestId },
    });
  });
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
  it("blocks PGlite lock reacquisition during an .env-triggered Vite restart", async () => {
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
    const pauseProbePath = path.join(testRoot, "pause-probe");
    const probeEnteredPath = path.join(testRoot, "probe-entered");
    const probeRejectedPath = path.join(testRoot, "probe-rejected");
    const resumeProbePath = path.join(testRoot, "resume-probe");
    const previousCwd = process.cwd();
    let server: ViteDevServer | undefined;
    let serverRestarts = 0;
    let serverListens = 0;
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
      `import { existsSync, writeFileSync } from "node:fs";
import { getPgliteClient } from ${JSON.stringify(
        pathToFileURL(path.join(coreRoot, "src/db/client.ts")).href,
      )};

export default async () => {
  if (existsSync(${JSON.stringify(pauseProbePath)})) {
    writeFileSync(${JSON.stringify(probeEnteredPath)}, "entered");
    while (!existsSync(${JSON.stringify(resumeProbePath)})) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  let db;
  try {
    db = await getPgliteClient(${JSON.stringify(`pglite:${databaseDir}`)});
  } catch (error) {
    if (error instanceof Error && error.message.includes("PGlite access is paused")) {
      writeFileSync(${JSON.stringify(probeRejectedPath)}, "rejected");
      return new Response(error.message, { status: 503 });
    }
    throw error;
  }
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
        server.httpServer?.once("listening", () => {
          serverListens++;
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

      fs.writeFileSync(pauseProbePath, "pause");
      const pausedProbe = fetch(probeUrl);
      await waitForFile(probeEnteredPath);
      await closeNitroDatabase(server, () => {
        fs.writeFileSync(resumeProbePath, "resume");
      });
      expect(fs.existsSync(probeRejectedPath)).toBe(true);
      expect(fs.existsSync(`${databaseDir}.agent-native-pglite.lock`)).toBe(
        false,
      );
      const pausedResponse = await pausedProbe;
      const pausedBody = await pausedResponse.text();
      expect(pausedResponse.status).toBe(503);
      expect(pausedBody).toContain("PGlite access is paused");
      expect(fs.existsSync(`${databaseDir}.agent-native-pglite.lock`)).toBe(
        false,
      );
      fs.rmSync(pauseProbePath, { force: true });
      const acknowledgementsBeforeRestart = databaseCloseAcknowledgements;
      const nitroHot = server.environments.nitro?.hot as {
        off?: (event: string, listener: (payload: any) => void) => void;
        on?: (event: string, listener: (payload: any) => void) => void;
      };
      const hotOn = nitroHot.on?.bind(nitroHot);
      const hotOff = nitroHot.off?.bind(nitroHot);
      if (!hotOn || !hotOff) {
        throw new Error("Nitro dev environment cannot observe cleanup events");
      }
      const wrappedListeners = new Map<
        (payload: any) => void,
        (payload: any) => void
      >();
      let suppressNextCloseAcknowledgement = true;
      nitroHot.on = (event, listener) => {
        if (
          event !== "agent-native:dev-database-closed" ||
          !suppressNextCloseAcknowledgement
        ) {
          hotOn(event, listener);
          return;
        }
        const wrapped = (payload: any) => {
          if (
            suppressNextCloseAcknowledgement &&
            typeof payload?.requestId === "string"
          ) {
            suppressNextCloseAcknowledgement = false;
            return;
          }
          listener(payload);
        };
        wrappedListeners.set(listener, wrapped);
        hotOn(event, wrapped);
      };
      nitroHot.off = (event, listener) => {
        hotOff(event, wrappedListeners.get(listener) ?? listener);
      };

      fs.writeFileSync(envFile, "VITE_RESTART_TOKEN=after\n");

      const restarted = await waitForProbe(
        probeUrl,
        () =>
          serverRestarts > 0 &&
          serverListens > 1 &&
          databaseCloseAcknowledgements > acknowledgementsBeforeRestart,
      );
      expect(databaseCloseAcknowledgements).toBeGreaterThan(
        acknowledgementsBeforeRestart,
      );
      expect(serverRestarts).toBeGreaterThan(0);
      expect(serverListens).toBeGreaterThan(1);
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
