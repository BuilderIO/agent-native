import { randomUUID } from "node:crypto";
import fs from "node:fs";
import net, { type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createServer, type Plugin, type ViteDevServer } from "vite";
import { describe, expect, it } from "vitest";

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

// Each restart waits on 5 s acknowledgement timeouts of its own, several of
// them in a row. A wait with a deadline of its own races those timers on a
// loaded runner, so these waits end only when the test times out.
function abandonedWait(description: string, signal: AbortSignal): Error {
  // Vitest reports only its own timeout error, which names no wait.
  console.error(`Timed out waiting for ${description}`);
  return new Error(`Timed out waiting for ${description}`, {
    cause: signal.reason,
  });
}

async function waitFor(
  description: string,
  ready: () => boolean,
  signal: AbortSignal,
): Promise<void> {
  while (!ready()) {
    if (signal.aborted) throw abandonedWait(description, signal);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitForProbe(
  url: () => string | undefined,
  condition: (result: ProbeResult) => boolean,
  signal: AbortSignal,
): Promise<ProbeResult> {
  let lastResult = "no response";

  while (!signal.aborted) {
    // Vite has no URL between closing a server and its replacement listening.
    const target = url();
    let response: Response;
    let body: string;
    try {
      if (target === undefined) throw new Error("no dev server URL");
      response = await fetch(target);
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

  throw abandonedWait(`the Nitro probe: ${lastResult}`, signal);
}

// Nitro reads `server.port: 0` as unset and listens on 3000, where another dev
// server is likely. The probes read the server's current URL, so if this port
// is taken before Vite binds it, or during a restart, they follow the server.
async function freePort(): Promise<number> {
  const listener = net.createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const { port } = listener.address() as AddressInfo;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  return port;
}

async function closeNitroDatabase(
  server: ViteDevServer,
  onClosing: () => void,
  signal: AbortSignal,
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
      signal.removeEventListener("abort", onAbort);
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
    const onAbort = () => {
      cleanup();
      reject(abandonedWait("Nitro to acknowledge database cleanup", signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
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
  it("blocks PGlite lock reacquisition during an .env-triggered Vite restart", async ({
    signal,
  }) => {
    const testRoot = fs.mkdtempSync(
      path.join(
        fs.realpathSync(os.tmpdir()),
        "agent-native-pglite-env-restart-",
      ),
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
    const slowQueryPath = path.join(testRoot, "slow-query");
    const slowQueryStartedPath = path.join(testRoot, "slow-query-started");
    const slowQueryReleasePath = path.join(testRoot, "slow-query-release");
    const slowQueryCompletedPath = path.join(testRoot, "slow-query-completed");
    const previousCwd = process.cwd();
    const previousDatabaseUrl = process.env.DATABASE_URL;
    let server: ViteDevServer | undefined;
    let serverRestarts = 0;
    let serverListens = 0;
    let serverConfigurations = 0;
    const configuredInlineConfigs = new Set<object>();
    const nitroLifecyclePlugins = new Set<Plugin>();
    const restartRequests: Array<{ settled: boolean; error?: unknown }> = [];
    const databaseCloseRequestIds: string[] = [];
    let databaseCloseAcknowledgements = 0;
    let resumeRequestsToDrop = 0;
    let deferNextResumeRequest = false;
    let deferNextReplacementConfiguration = false;
    let deferredResumeRequestId: string | undefined;
    let closeRequestsAtDeferredResumeAcknowledgement: number | undefined;
    let releaseDeferredResumeRequest: (() => void) | undefined;
    let releaseDeferredReplacementConfiguration: (() => void) | undefined;
    let replacementListenFailure: string | undefined;
    let restoreCloseAcknowledgements: (() => void) | undefined;
    let restoreShutdownRaceListener: (() => void) | undefined;

    fs.mkdirSync(path.join(testRoot, "server", "plugins"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(testRoot, "server", "routes"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(testRoot, "vite.config.ts"),
      `import { agentNative } from ${JSON.stringify(
        pathToFileURL(path.join(coreRoot, "src/vite/client.ts")).href,
      )};

export default { plugins: agentNative() };
`,
    );
    // Nitro writes `.nitro/vite/dev-worker.mjs` with imports relative to the
    // build dir's unresolved path, so the dir must be real, not a symlink into
    // the workspace (or through /var -> /private/var): otherwise the worker's
    // imports miss whenever the two depths differ, which is always in CI. Link
    // only directory entries: pnpm's root metadata files are not needed for
    // package resolution, and file symlinks can require privileges on Windows.
    const workspaceModules = path.join(workspaceRoot, "node_modules");
    fs.mkdirSync(path.join(testRoot, "node_modules"));
    for (const entry of fs.readdirSync(workspaceModules)) {
      if (entry === ".nitro" || entry === ".vite") continue;
      const target = fs.realpathSync(path.join(workspaceModules, entry));
      if (!fs.statSync(target).isDirectory()) continue;
      fs.symlinkSync(
        target,
        path.join(testRoot, "node_modules", entry),
        "junction",
      );
    }
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
  // pg_sleep would block this worker's event loop, so the worker could not
  // even receive the close request; a transaction the test releases stays an
  // in-flight operation while the worker keeps running.
  if (existsSync(${JSON.stringify(slowQueryPath)})) {
    try {
      await db.transaction(async (tx) => {
        await tx.execute("SELECT 1");
        writeFileSync(${JSON.stringify(slowQueryStartedPath)}, "started");
        while (!existsSync(${JSON.stringify(slowQueryReleasePath)})) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      });
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
      async configureServer(server) {
        serverConfigurations++;
        configuredInlineConfigs.add(server.config.inlineConfig);
        const lifecyclePlugin = server.config.plugins.find(
          (plugin) =>
            plugin.name === "agent-native-nitro-dev-environment-close",
        );
        if (lifecyclePlugin) nitroLifecyclePlugins.add(lifecyclePlugin);
        server.httpServer?.once("close", () => {
          serverRestarts++;
        });
        server.httpServer?.once("listening", () => {
          serverListens++;
        });
        const restart = server.restart.bind(server);
        server.restart = (forceOptimize) => {
          const request: { settled: boolean; error?: unknown } = {
            settled: false,
          };
          restartRequests.push(request);
          const restarting = restart(forceOptimize);
          void restarting.then(
            () => {
              request.settled = true;
            },
            (error: unknown) => {
              request.error = error;
              request.settled = true;
            },
          );
          return restarting;
        };
        const hot = server.environments.nitro?.hot;
        hot?.on("agent-native:dev-database-closed", (payload: any) => {
          if (typeof payload?.requestId === "string" && !payload.error) {
            databaseCloseAcknowledgements++;
          }
        });
        hot?.on("agent-native:dev-database-resumed", (payload: any) => {
          if (payload?.requestId === deferredResumeRequestId) {
            closeRequestsAtDeferredResumeAcknowledgement =
              databaseCloseRequestIds.length;
          }
        });
        const send = hot?.send;
        if (hot && send) {
          hot.send = (payload: any) => {
            if (payload?.event === "agent-native:dev-database-close") {
              databaseCloseRequestIds.push(payload.data?.requestId);
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
              deferredResumeRequestId = payload.data?.requestId;
              releaseDeferredResumeRequest = () => send.call(hot, payload);
              return;
            }
            send.call(hot, payload);
          };
        }
        if (!deferNextReplacementConfiguration) return;

        deferNextReplacementConfiguration = false;
        await new Promise<void>((resolve) => {
          releaseDeferredReplacementConfiguration = resolve;
        });
        const listen = server.listen.bind(server);
        server.listen = async (...args) => {
          try {
            return await listen(...args);
          } catch (error) {
            replacementListenFailure =
              error instanceof Error
                ? `${"code" in error ? String(error.code) : ""}: ${error.message}`
                : String(error);
            throw error;
          }
        };
      },
    };

    try {
      process.env.DATABASE_URL = `pglite:${databaseDir}`;
      process.chdir(testRoot);
      const devServerPort = await freePort();
      server = await createServer({
        configFile: path.join(testRoot, "vite.config.ts"),
        configLoader: "runner",
        logLevel: "silent",
        optimizeDeps: { noDiscovery: true, include: [] },
        plugins: [lifecycleObserver],
        root: testRoot,
        server: {
          fs: { allow: [workspaceRoot, coreRoot] },
          host: "127.0.0.1",
          port: devServerPort,
        },
      });
      await server.listen();

      // Where the server listens now: Vite takes the next port if its own is
      // taken when it binds, including on a restart.
      const probeUrl = () => {
        const baseUrl = server?.resolvedUrls?.local[0];
        return baseUrl === undefined
          ? undefined
          : new URL("probe", baseUrl).href;
      };
      const listeningProbeUrl = () => {
        const url = probeUrl();
        if (!url) throw new Error("Vite did not report its local dev URL");
        return url;
      };
      listeningProbeUrl();
      const first = await waitForProbe(probeUrl, () => true, signal);
      expect(first.rows).toEqual([{ id: 1, value: "persisted" }]);
      expect(fs.existsSync(`${databaseDir}.agent-native-pglite.lock`)).toBe(
        true,
      );

      fs.writeFileSync(pauseProbePath, "pause");
      const pausedProbe = fetch(listeningProbeUrl());
      await waitFor(
        "the probe to pause before using the database",
        () => fs.existsSync(probeEnteredPath),
        signal,
      );
      await closeNitroDatabase(
        server,
        () => {
          fs.writeFileSync(resumeProbePath, "resume");
        },
        signal,
      );
      expect(fs.existsSync(`${databaseDir}.agent-native-pglite.lock`)).toBe(
        false,
      );
      const pausedResponse = await pausedProbe;
      const pausedBody = await pausedResponse.text();
      expect(fs.existsSync(probeRejectedPath)).toBe(true);
      expect(pausedResponse.status).toBe(503);
      expect(pausedBody).toContain("PGlite access is paused");
      expect(fs.existsSync(`${databaseDir}.agent-native-pglite.lock`)).toBe(
        false,
      );
      fs.rmSync(pauseProbePath, { force: true });
      const acknowledgementsBeforeRestart = databaseCloseAcknowledgements;
      const restartsBeforeEnvChange = serverRestarts;
      const listensBeforeEnvChange = serverListens;
      const closeRequestsBeforeEnvChange = databaseCloseRequestIds.length;
      resumeRequestsToDrop = 2;
      deferNextResumeRequest = true;

      fs.writeFileSync(envFile, "VITE_RESTART_TOKEN=after\n");

      await waitFor(
        "the restarted server's held database resume request",
        () => releaseDeferredResumeRequest !== undefined,
        signal,
      );
      expect(databaseCloseAcknowledgements).toBeGreaterThan(
        acknowledgementsBeforeRestart,
      );
      const envRestartCloseRequests = databaseCloseRequestIds.slice(
        closeRequestsBeforeEnvChange,
      );
      expect(envRestartCloseRequests).toHaveLength(2);
      expect(new Set(envRestartCloseRequests).size).toBe(2);
      expect(serverRestarts).toBeGreaterThan(restartsBeforeEnvChange);
      expect(serverListens).toBeGreaterThan(listensBeforeEnvChange);
      expect(fs.existsSync(`${databaseDir}.agent-native-pglite.lock`)).toBe(
        false,
      );
      const pausedDuringResume = await fetch(listeningProbeUrl());
      const pausedDuringResumeBody = await pausedDuringResume.text();
      expect(pausedDuringResume.status).toBe(503);
      expect(pausedDuringResumeBody).toContain("PGlite access is paused");

      const restartsBeforeOverlappingRestart = serverRestarts;
      const listensBeforeOverlappingRestart = serverListens;
      const configurationsBeforeOverlappingRestart = serverConfigurations;
      const closeRequestsBeforeOverlappingRestart =
        databaseCloseRequestIds.length;
      const restartRequestsBeforeOverlappingRestart = restartRequests.length;
      fs.writeFileSync(envFile, "VITE_RESTART_TOKEN=after-pending-resume\n");
      // A restart that does not wait for the pending resume sends its close
      // request before restart() returns, so this check needs no grace period.
      await waitFor(
        "Vite to request the overlapping restart",
        () => restartRequests.length > restartRequestsBeforeOverlappingRestart,
        signal,
      );
      expect(databaseCloseRequestIds).toHaveLength(
        closeRequestsBeforeOverlappingRestart,
      );
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
      releaseResumeRequest();

      const restarted = await waitForProbe(
        probeUrl,
        () =>
          serverRestarts > restartsBeforeOverlappingRestart &&
          serverListens > listensBeforeOverlappingRestart &&
          databaseCloseAcknowledgements > acknowledgementsBeforeRestart,
        signal,
      );
      expect(closeRequestsAtDeferredResumeAcknowledgement).toBe(
        closeRequestsBeforeOverlappingRestart,
      );
      const overlappingRestartCloseRequests = databaseCloseRequestIds.slice(
        closeRequestsBeforeOverlappingRestart,
      );
      expect(overlappingRestartCloseRequests).toHaveLength(2);
      expect(new Set(overlappingRestartCloseRequests).size).toBe(2);
      expect(databaseCloseAcknowledgements).toBeGreaterThan(
        acknowledgementsBeforeRestart,
      );
      expect(serverRestarts).toBeGreaterThan(restartsBeforeOverlappingRestart);
      expect(serverListens).toBeGreaterThan(listensBeforeOverlappingRestart);
      expect(restarted.rows).toEqual([{ id: 1, value: "persisted" }]);
      expect(configuredInlineConfigs.size).toBe(1);
      expect(nitroLifecyclePlugins.size).toBeGreaterThan(1);
      expect(fs.existsSync(`${databaseDir}.agent-native-pglite.lock`)).toBe(
        true,
      );

      const restartsBeforeSlowQuery = serverRestarts;
      const acknowledgementsBeforeSlowQuery = databaseCloseAcknowledgements;
      const closeRequestsBeforeSlowQuery = databaseCloseRequestIds.length;
      fs.writeFileSync(slowQueryPath, "run");
      const slowProbe = fetch(listeningProbeUrl()).catch(() => undefined);
      await waitFor(
        "the slow query to start",
        () => fs.existsSync(slowQueryStartedPath),
        signal,
      );
      fs.rmSync(slowQueryPath, { force: true });
      fs.writeFileSync(envFile, "VITE_RESTART_TOKEN=slow-query-restart\n");
      // A repeated request id means the first cleanup request outlived its
      // acknowledgement timeout while the query held the database open.
      await waitFor(
        "the restart to repeat its database cleanup request",
        () =>
          databaseCloseRequestIds.length >= closeRequestsBeforeSlowQuery + 2 ||
          databaseCloseAcknowledgements > acknowledgementsBeforeSlowQuery ||
          serverRestarts > restartsBeforeSlowQuery,
        signal,
      );
      const slowQueryCloseRequests = databaseCloseRequestIds.slice(
        closeRequestsBeforeSlowQuery,
      );
      expect(slowQueryCloseRequests).toHaveLength(2);
      expect(new Set(slowQueryCloseRequests).size).toBe(1);
      expect(databaseCloseAcknowledgements).toBe(
        acknowledgementsBeforeSlowQuery,
      );
      expect(fs.existsSync(slowQueryCompletedPath)).toBe(false);
      expect(serverRestarts).toBe(restartsBeforeSlowQuery);
      expect(fs.existsSync(`${databaseDir}.agent-native-pglite.lock`)).toBe(
        true,
      );
      fs.writeFileSync(slowQueryReleasePath, "release");
      await waitFor(
        "the slow query to complete",
        () => fs.existsSync(slowQueryCompletedPath),
        signal,
      );
      await slowProbe;
      const restartedAfterSlowQuery = await waitForProbe(
        probeUrl,
        () => serverRestarts > restartsBeforeSlowQuery && serverListens > 2,
        signal,
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
      const closeRequestsBeforeMissingAcknowledgement =
        databaseCloseRequestIds.length;
      const restartRequestsBeforeMissingAcknowledgement =
        restartRequests.length;
      const closeNitroHot = server.environments.nitro?.hot as NitroHot;
      restoreCloseAcknowledgements = suppressNitroAcknowledgements(
        closeNitroHot,
        "agent-native:dev-database-closed",
      );
      fs.writeFileSync(envFile, "VITE_RESTART_TOKEN=missing-close-ack\n");
      await waitFor(
        "the unacknowledged restart to give up",
        () =>
          restartRequests[restartRequestsBeforeMissingAcknowledgement]
            ?.settled === true,
        signal,
      );
      expect(
        restartRequests[restartRequestsBeforeMissingAcknowledgement]?.error,
      ).toMatchObject({
        message: expect.stringContaining("not acknowledged after 3 attempts"),
      });
      const closeRequests = databaseCloseRequestIds.slice(
        closeRequestsBeforeMissingAcknowledgement,
      );
      expect(closeRequests.slice(0, 3)).toHaveLength(3);
      expect(new Set(closeRequests.slice(0, 3)).size).toBe(1);
      expect(serverRestarts).toBe(restartsBeforeMissingAcknowledgement);
      expect(serverListens).toBe(listensBeforeMissingAcknowledgement);
      expect(serverConfigurations).toBe(
        configurationsBeforeMissingAcknowledgement,
      );
      expect(fs.existsSync(`${databaseDir}.agent-native-pglite.lock`)).toBe(
        false,
      );
      const unacknowledgedResponse = await fetch(listeningProbeUrl());
      const unacknowledgedBody = await unacknowledgedResponse.text();
      expect(unacknowledgedResponse.status).toBe(503);
      expect(unacknowledgedBody).toContain("PGlite access is paused");
      expect(unacknowledgedBody).not.toContain("already owned by process");

      restoreCloseAcknowledgements();
      restoreCloseAcknowledgements = undefined;
      const recovered = await waitForProbe(
        probeUrl,
        () =>
          serverRestarts > restartsBeforeMissingAcknowledgement &&
          serverListens > listensBeforeMissingAcknowledgement,
        signal,
      );
      expect(recovered.rows).toEqual([{ id: 1, value: "persisted" }]);
      expect(fs.existsSync(`${databaseDir}.agent-native-pglite.lock`)).toBe(
        true,
      );

      const restartsBeforeShutdown = serverRestarts;
      const listensBeforeShutdown = serverListens;
      const configurationsBeforeShutdown = serverConfigurations;
      const closeRequestsBeforeShutdown = databaseCloseRequestIds.length;
      const restartRequestsBeforeShutdown = restartRequests.length;
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
      fs.writeFileSync(envFile, "VITE_RESTART_TOKEN=shutdown-during-restart\n");
      await waitFor(
        "an explicit Vite shutdown to race the restart cleanup acknowledgement",
        () => shutdownClosePromise !== undefined,
        signal,
      );
      if (!shutdownClosePromise) {
        throw new Error(
          "Explicit Vite shutdown did not race the restart cleanup acknowledgement",
        );
      }
      await waitFor(
        "the raced restart to stand down",
        () => restartRequests[restartRequestsBeforeShutdown]?.settled === true,
        signal,
      );
      // Vite's watcher stays open while the shutdown's cleanup goes
      // unanswered, and one .env write can report more than one change. The
      // restart it asks for then must not bring the closing server back.
      const restartDuringShutdown = server.restart();
      await shutdownClosePromise;
      expect(
        restartRequests[restartRequestsBeforeShutdown]?.error,
      ).toBeUndefined();
      for (const request of restartRequests.slice(
        restartRequestsBeforeShutdown + 1,
      )) {
        expect(request).toEqual({ settled: true });
      }
      await restartDuringShutdown;
      // The restart's cleanup was acknowledged; the shutdown's own went
      // unanswered, and shutdown proceeded after its bounded attempts.
      const [restartCloseRequest, ...shutdownCloseRequests] =
        databaseCloseRequestIds.slice(closeRequestsBeforeShutdown);
      expect(shutdownCloseRequests).toHaveLength(3);
      expect(new Set(shutdownCloseRequests).size).toBe(1);
      expect(shutdownCloseRequests).not.toContain(restartCloseRequest);
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

      server = await createServer({
        configFile: path.join(testRoot, "vite.config.ts"),
        configLoader: "runner",
        logLevel: "silent",
        optimizeDeps: { noDiscovery: true, include: [] },
        plugins: [lifecycleObserver],
        root: testRoot,
        server: {
          fs: { allow: [workspaceRoot, coreRoot] },
          host: "127.0.0.1",
          port: devServerPort,
        },
      });
      await server.listen();

      listeningProbeUrl();
      const replacementReady = await waitForProbe(probeUrl, () => true, signal);
      expect(replacementReady.rows).toEqual([{ id: 1, value: "persisted" }]);
      expect(fs.existsSync(`${databaseDir}.agent-native-pglite.lock`)).toBe(
        true,
      );

      const configurationsBeforeReplacement = serverConfigurations;
      const listensBeforeReplacement = serverListens;
      const restartsBeforeReplacement = serverRestarts;
      const restartRequestsBeforeReplacement = restartRequests.length;
      deferNextReplacementConfiguration = true;
      fs.writeFileSync(envFile, "VITE_RESTART_TOKEN=shutdown-during-create\n");
      await waitFor(
        "the replacement server's configuration to start",
        () => releaseDeferredReplacementConfiguration !== undefined,
        signal,
      );
      expect(serverConfigurations).toBeGreaterThan(
        configurationsBeforeReplacement,
      );

      await server.close();
      // The replacement is parked in configureServer until this test releases
      // it, so shutdown finished without waiting for the restart.
      expect(restartRequests[restartRequestsBeforeReplacement]?.settled).toBe(
        false,
      );
      expect(serverRestarts).toBe(restartsBeforeReplacement + 1);
      expect(fs.existsSync(`${databaseDir}.agent-native-pglite.lock`)).toBe(
        false,
      );
      expect(server.httpServer?.listening).toBe(false);

      const releaseReplacementConfiguration =
        releaseDeferredReplacementConfiguration;
      if (!releaseReplacementConfiguration) {
        throw new Error("The replacement configure barrier was lost");
      }
      releaseDeferredReplacementConfiguration = undefined;
      releaseReplacementConfiguration();
      await waitFor(
        "the cancelled restart to settle",
        () =>
          restartRequests[restartRequestsBeforeReplacement]?.settled === true,
        signal,
      );
      expect(
        restartRequests[restartRequestsBeforeReplacement]?.error,
      ).toBeUndefined();
      expect(replacementListenFailure).toContain(
        "AGENT_NATIVE_VITE_RESTART_CANCELLED",
      );
      expect(serverListens).toBe(listensBeforeReplacement);
      expect(server.httpServer?.listening).toBe(false);
      server = undefined;
    } finally {
      // A failure before the release leaves the probe's transaction open, and
      // the worker would wait on it while the server closes.
      fs.writeFileSync(slowQueryReleasePath, "release");
      const releaseResumeRequest = releaseDeferredResumeRequest;
      releaseDeferredResumeRequest = undefined;
      releaseResumeRequest?.();
      const releaseReplacementConfiguration =
        releaseDeferredReplacementConfiguration;
      releaseDeferredReplacementConfiguration = undefined;
      releaseReplacementConfiguration?.();
      restoreShutdownRaceListener?.();
      restoreCloseAcknowledgements?.();
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
  }, 180_000);
});
