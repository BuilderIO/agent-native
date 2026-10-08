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

type NitroHot = {
  off?: (event: string, listener: (payload: any) => void) => void;
  on?: (event: string, listener: (payload: any) => void) => void;
  send?: (payload: any) => void;
};

function suppressNitroAcknowledgements(
  hot: NitroHot,
  event: string,
): () => void {
  if (!hot.on || !hot.off) {
    throw new Error("Nitro dev environment cannot observe lifecycle events");
  }

  const hotOn = hot.on.bind(hot);
  const hotOff = hot.off.bind(hot);
  const wrappedListeners = new Map<
    (payload: any) => void,
    (payload: any) => void
  >();
  let suppress = true;
  hot.on = (registeredEvent, listener) => {
    if (registeredEvent !== event || !suppress) {
      hotOn(registeredEvent, listener);
      return;
    }
    const wrapped = (payload: any) => {
      if (suppress) return;
      listener(payload);
    };
    wrappedListeners.set(listener, wrapped);
    hotOn(registeredEvent, wrapped);
  };
  hot.off = (registeredEvent, listener) => {
    const wrapped = wrappedListeners.get(listener) ?? listener;
    wrappedListeners.delete(listener);
    hotOff(registeredEvent, wrapped);
  };

  return () => {
    suppress = false;
  };
}

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

async function waitForFile(file: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
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
    const resumeRequestHeldPath = path.join(testRoot, "resume-request-held");
    const probeEnteredPath = path.join(testRoot, "probe-entered");
    const probeRejectedPath = path.join(testRoot, "probe-rejected");
    const resumeProbePath = path.join(testRoot, "resume-probe");
    const slowQueryPath = path.join(testRoot, "slow-query");
    const slowQueryStartedPath = path.join(testRoot, "slow-query-started");
    const slowQueryCompletedPath = path.join(testRoot, "slow-query-completed");
    const previousCwd = process.cwd();
    const previousDatabaseUrl = process.env.DATABASE_URL;
    let server: ViteDevServer | undefined;
    let serverRestarts = 0;
    let serverListens = 0;
    let serverConfigurations = 0;
    let databaseCloseAcknowledgements = 0;
    let databaseCloseRequests = 0;
    let resumeRequestsToDrop = 0;
    let deferNextResumeRequest = false;
    let releaseDeferredResumeRequest: (() => void) | undefined;
    let restoreCloseAcknowledgements: (() => void) | undefined;
    let restoreNitroSend: (() => void) | undefined;
    let restoreShutdownRaceListener: (() => void) | undefined;

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
import { getDbExec } from ${JSON.stringify(
        pathToFileURL(path.join(coreRoot, "src/db/client.ts")).href,
      )};

export default async () => {
  if (existsSync(${JSON.stringify(pauseProbePath)})) {
    writeFileSync(${JSON.stringify(probeEnteredPath)}, "entered");
    while (!existsSync(${JSON.stringify(resumeProbePath)})) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  const db = getDbExec();
  if (existsSync(${JSON.stringify(slowQueryPath)})) {
    writeFileSync(${JSON.stringify(slowQueryStartedPath)}, "started");
    try {
      await db.execute("SELECT pg_sleep(8)");
    } finally {
      writeFileSync(${JSON.stringify(slowQueryCompletedPath)}, "completed");
    }
  }
  try {
    await db.execute("CREATE TABLE IF NOT EXISTS restart_probe (id integer PRIMARY KEY, value text NOT NULL)");
    await db.execute("INSERT INTO restart_probe (id, value) VALUES (1, 'persisted') ON CONFLICT (id) DO NOTHING");
    const result = await db.execute("SELECT id, value FROM restart_probe ORDER BY id");
    return {
      rows: result.rows,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("PGlite access is paused")) {
      writeFileSync(${JSON.stringify(probeRejectedPath)}, "rejected");
      return new Response(error.message, { status: 503 });
    }
    throw error;
  }
};
`,
    );

    const lifecycleObserver: Plugin = {
      name: "pglite-restart-test-observer",
      configureServer(server) {
        serverConfigurations++;
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
        const send = hot?.send;
        if (hot && send) {
          hot.send = (payload: any) => {
            if (payload?.event === "agent-native:dev-database-close") {
              databaseCloseRequests++;
            }
            if (
              payload?.event === "agent-native:dev-database-resume" &&
              resumeRequestsToDrop > 0
            ) {
              resumeRequestsToDrop--;
              return;
            }
            if (
              payload?.event === "agent-native:dev-database-resume" &&
              deferNextResumeRequest
            ) {
              deferNextResumeRequest = false;
              releaseDeferredResumeRequest = () => send.call(hot, payload);
              fs.writeFileSync(resumeRequestHeldPath, "held");
              return;
            }
            send.call(hot, payload);
          };
        }
      },
    };

    try {
      process.env.DATABASE_URL = `pglite:${databaseDir}`;
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
      await waitForFile(probeRejectedPath);
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
      resumeRequestsToDrop = 2;
      deferNextResumeRequest = true;

      fs.writeFileSync(envFile, "VITE_RESTART_TOKEN=after\n");

      await waitForFile(resumeRequestHeldPath, 20_000);
      expect(databaseCloseAcknowledgements).toBeGreaterThan(
        acknowledgementsBeforeRestart,
      );
      expect(serverRestarts).toBeGreaterThan(0);
      expect(serverListens).toBeGreaterThan(1);
      expect(fs.existsSync(`${databaseDir}.agent-native-pglite.lock`)).toBe(
        false,
      );
      const pausedDuringResume = await fetch(probeUrl);
      const pausedDuringResumeBody = await pausedDuringResume.text();
      expect(pausedDuringResume.status).toBe(503);
      expect(pausedDuringResumeBody).toContain("PGlite access is paused");

      const restartsBeforeOverlappingRestart = serverRestarts;
      const listensBeforeOverlappingRestart = serverListens;
      const configurationsBeforeOverlappingRestart = serverConfigurations;
      const closeRequestsBeforeOverlappingRestart = databaseCloseRequests;
      fs.writeFileSync(envFile, "VITE_RESTART_TOKEN=after-pending-resume\n");
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      expect(databaseCloseRequests).toBe(closeRequestsBeforeOverlappingRestart);
      expect(serverRestarts).toBe(restartsBeforeOverlappingRestart);
      expect(serverConfigurations).toBe(configurationsBeforeOverlappingRestart);
      expect(fs.existsSync(`${databaseDir}.agent-native-pglite.lock`)).toBe(
        false,
      );

      const releaseResumeRequest = releaseDeferredResumeRequest;
      if (!releaseResumeRequest) {
        throw new Error("The deferred Nitro database resume request was lost");
      }
      releaseDeferredResumeRequest = undefined;
      fs.rmSync(resumeRequestHeldPath, { force: true });
      releaseResumeRequest();

      const restarted = await waitForProbe(
        probeUrl,
        () =>
          serverRestarts > restartsBeforeOverlappingRestart &&
          serverListens > listensBeforeOverlappingRestart &&
          databaseCloseAcknowledgements > acknowledgementsBeforeRestart,
      );
      expect(databaseCloseAcknowledgements).toBeGreaterThan(
        acknowledgementsBeforeRestart,
      );
      expect(serverRestarts).toBeGreaterThan(restartsBeforeOverlappingRestart);
      expect(serverListens).toBeGreaterThan(listensBeforeOverlappingRestart);
      expect(restarted.rows).toEqual([{ id: 1, value: "persisted" }]);
      expect(fs.existsSync(`${databaseDir}.agent-native-pglite.lock`)).toBe(
        true,
      );

      const restartsBeforeSlowQuery = serverRestarts;
      fs.writeFileSync(slowQueryPath, "run");
      const slowProbe = fetch(probeUrl).catch(() => undefined);
      await waitForFile(slowQueryStartedPath);
      fs.rmSync(slowQueryPath, { force: true });
      fs.writeFileSync(envFile, "VITE_RESTART_TOKEN=slow-query-restart\n");
      await new Promise((resolve) => setTimeout(resolve, 5_500));
      expect(fs.existsSync(slowQueryCompletedPath)).toBe(false);
      expect(serverRestarts).toBe(restartsBeforeSlowQuery);
      expect(fs.existsSync(`${databaseDir}.agent-native-pglite.lock`)).toBe(
        true,
      );
      await waitForFile(slowQueryCompletedPath);
      await slowProbe;
      const restartedAfterSlowQuery = await waitForProbe(
        probeUrl,
        () => serverRestarts > restartsBeforeSlowQuery && serverListens > 2,
      );
      expect(restartedAfterSlowQuery.rows).toEqual([
        { id: 1, value: "persisted" },
      ]);
      expect(fs.existsSync(`${databaseDir}.agent-native-pglite.lock`)).toBe(
        true,
      );

      const restartsBeforeMissingAcknowledgement = serverRestarts;
      const listensBeforeMissingAcknowledgement = serverListens;
      const configurationsBeforeMissingAcknowledgement = serverConfigurations;
      const closeNitroHot = server.environments.nitro?.hot as NitroHot;
      const closeRequests: string[] = [];
      const send = closeNitroHot.send;
      if (!send) throw new Error("Nitro dev environment cannot send events");
      closeNitroHot.send = (payload) => {
        if (payload?.event === "agent-native:dev-database-close") {
          closeRequests.push(payload.data?.requestId);
        }
        send.call(closeNitroHot, payload);
      };
      restoreNitroSend = () => {
        closeNitroHot.send = send;
      };
      restoreCloseAcknowledgements = suppressNitroAcknowledgements(
        closeNitroHot,
        "agent-native:dev-database-closed",
      );
      fs.writeFileSync(envFile, "VITE_RESTART_TOKEN=missing-close-ack\n");
      const closeRequestDeadline = Date.now() + 20_000;
      while (closeRequests.length < 3 && Date.now() < closeRequestDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(closeRequests.slice(0, 3)).toHaveLength(3);
      expect(new Set(closeRequests.slice(0, 3)).size).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 5_500));
      expect(serverRestarts).toBe(restartsBeforeMissingAcknowledgement);
      expect(serverListens).toBe(listensBeforeMissingAcknowledgement);
      expect(serverConfigurations).toBe(
        configurationsBeforeMissingAcknowledgement,
      );
      expect(fs.existsSync(`${databaseDir}.agent-native-pglite.lock`)).toBe(
        false,
      );
      const unacknowledgedResponse = await fetch(probeUrl);
      const unacknowledgedBody = await unacknowledgedResponse.text();
      expect(unacknowledgedResponse.status).toBe(503);
      expect(unacknowledgedBody).toContain("PGlite access is paused");
      expect(unacknowledgedBody).not.toContain("already owned by process");

      restoreCloseAcknowledgements();
      restoreCloseAcknowledgements = undefined;
      restoreNitroSend();
      restoreNitroSend = undefined;
      const recovered = await waitForProbe(
        probeUrl,
        () =>
          serverRestarts > restartsBeforeMissingAcknowledgement &&
          serverListens > listensBeforeMissingAcknowledgement,
      );
      expect(recovered.rows).toEqual([{ id: 1, value: "persisted" }]);
      expect(fs.existsSync(`${databaseDir}.agent-native-pglite.lock`)).toBe(
        true,
      );

      const restartsBeforeShutdown = serverRestarts;
      const listensBeforeShutdown = serverListens;
      const configurationsBeforeShutdown = serverConfigurations;
      const shutdownNitroHot = server.environments.nitro?.hot as NitroHot;
      if (!shutdownNitroHot.on || !shutdownNitroHot.off) {
        throw new Error("Nitro dev environment cannot observe shutdown events");
      }
      let shutdownClosePromise: Promise<void> | undefined;
      const onShutdownRaceCloseAcknowledged = (payload: any) => {
        if (shutdownClosePromise || typeof payload?.requestId !== "string") {
          return;
        }
        restoreCloseAcknowledgements = suppressNitroAcknowledgements(
          shutdownNitroHot,
          "agent-native:dev-database-closed",
        );
        shutdownClosePromise = server?.close();
      };
      shutdownNitroHot.on(
        "agent-native:dev-database-closed",
        onShutdownRaceCloseAcknowledged,
      );
      restoreShutdownRaceListener = () => {
        shutdownNitroHot.off?.(
          "agent-native:dev-database-closed",
          onShutdownRaceCloseAcknowledged,
        );
      };
      const shutdownStartedAt = Date.now();
      fs.writeFileSync(envFile, "VITE_RESTART_TOKEN=shutdown-during-restart\n");
      const shutdownDeadline = Date.now() + 20_000;
      while (!shutdownClosePromise && Date.now() < shutdownDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      if (!shutdownClosePromise) {
        throw new Error(
          "Explicit Vite shutdown did not race the restart cleanup acknowledgement",
        );
      }
      await shutdownClosePromise;
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(Date.now() - shutdownStartedAt).toBeLessThan(20_000);
      expect(serverRestarts).toBe(restartsBeforeShutdown + 1);
      expect(serverListens).toBe(listensBeforeShutdown);
      expect(serverConfigurations).toBe(configurationsBeforeShutdown);
      expect(server.httpServer?.listening).toBe(false);
      expect(fs.existsSync(`${databaseDir}.agent-native-pglite.lock`)).toBe(
        false,
      );
      restoreShutdownRaceListener();
      restoreShutdownRaceListener = undefined;
      restoreCloseAcknowledgements();
      restoreCloseAcknowledgements = undefined;
      server = undefined;
    } finally {
      const releaseResumeRequest = releaseDeferredResumeRequest;
      releaseDeferredResumeRequest = undefined;
      releaseResumeRequest?.();
      restoreShutdownRaceListener?.();
      restoreCloseAcknowledgements?.();
      restoreNitroSend?.();
      try {
        if (server) await closeServer(server);
      } finally {
        process.chdir(previousCwd);
        if (previousDatabaseUrl === undefined) {
          delete process.env.DATABASE_URL;
        } else {
          process.env.DATABASE_URL = previousDatabaseUrl;
        }
        fs.rmSync(testRoot, { recursive: true, force: true });
      }
    }
  }, 90_000);
});
