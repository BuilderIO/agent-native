import path from "node:path";

import {
  app,
  ipcMain,
  session,
  webContents,
  type IpcMainInvokeEvent,
} from "electron";
import { z } from "zod";

import {
  CLIENT_FORK_CHANNEL,
  type ClientForkResult,
  type ClientForkStatus,
} from "../../shared/client-forks.js";
import {
  createClientForkHandler,
  clientForkLocalPath,
} from "./client-fork-protocol.js";
import {
  clientForkToolchain,
  writeClientForkBuildCommand,
} from "./client-fork-toolchain.js";
import {
  ClientForks,
  ClientForkRepairRequiredError,
  stopForkBuilds,
} from "./client-forks.js";

const requestSchema = z.object({
  appId: z.string().regex(/^[a-z][a-z0-9-]{0,80}$/),
  operation: z.enum([
    "status",
    "prepare",
    "build",
    "original",
    "activate",
    "update",
    "undo",
  ]),
});

export function registerClientForkRuntime(options: {
  source: string;
  baseSha: string;
  pnpm: string;
  isShell: (event: IpcMainInvokeEvent) => boolean;
  apps: () => { id: string; url?: string | undefined }[];
  notify: (appId: string, error: string | null) => void;
  repair: (state: ClientForkStatus) => Promise<void>;
}) {
  const forks = new ClientForks({
    root: path.join(app.getPath("userData"), "client-forks"),
    source: options.source,
    baseSha: options.baseSha,
    pnpm: options.pnpm,
    toolchain: clientForkToolchain,
    notify: (state) => options.notify(state.appId, state.error),
  });
  app.on("before-quit", stopForkBuilds);
  const installed = new Set<string>();
  const pending = new Map<string, Promise<void>>();
  const editing = new Set<string>();
  function reloadApp(appId: string): void {
    const partition = session.fromPartition(`persist:app-${appId}`);
    for (const contents of webContents.getAllWebContents()) {
      if (contents.getType() === "webview" && contents.session === partition)
        contents.reloadIgnoringCache();
    }
  }

  async function update(appId: string, origin: string): Promise<void> {
    if (editing.has(appId))
      throw new Error("Finish the current source edit before updating");
    try {
      uninstall(appId);
      await forks.update(appId, await hostedSha(appId, origin));
    } catch (error) {
      const state = await forks.load(appId);
      if (error instanceof ClientForkRepairRequiredError) {
        editing.add(appId);
        try {
          await options.repair(state);
        } catch (failure) {
          editing.delete(appId);
          throw failure;
        }
      }
      throw error;
    }
  }

  function uninstall(appId: string): void {
    if (!installed.delete(appId)) return;
    session.fromPartition(`persist:app-${appId}`).protocol.unhandle("https");
  }

  async function sync(appId: string, origin: string): Promise<void> {
    if ((await forks.load(appId)).enabled) await install(appId, origin);
    else uninstall(appId);
  }

  async function install(appId: string, origin: string): Promise<void> {
    if (installed.has(appId)) return;
    const inFlight = pending.get(appId);
    if (inFlight) return inFlight;
    const promise = (async () => {
      const state = await forks.load(appId);
      const partition = session.fromPartition(`persist:app-${appId}`);
      partition.protocol.handle(
        "https",
        createClientForkHandler({
          origin: () =>
            options.apps().find((candidate) => candidate.id === appId)?.url ??
            origin,
          status: () => state,
          forward: (request) =>
            partition.fetch(request, { bypassCustomProtocolHandlers: true }),
          fail: (error) => {
            state.enabled = false;
            uninstall(appId);
            state.error = error.message;
            options.notify(appId, state.error);
            void forks
              .save(state)
              .catch((failure: unknown) =>
                console.error("[client-fork] Could not save fallback", failure),
              );
            setTimeout(() => {
              for (const contents of webContents.getAllWebContents()) {
                if (
                  contents.getType() === "webview" &&
                  contents.session === partition
                )
                  contents.reloadIgnoringCache();
              }
            }, 0);
          },
        }),
      );
      installed.add(appId);
    })();
    pending.set(appId, promise);
    try {
      await promise;
    } finally {
      pending.delete(appId);
    }
  }

  async function hostedSha(
    appId: string,
    origin: string,
  ): Promise<string | null> {
    const partition = session.fromPartition(`persist:app-${appId}`);
    const base = `${origin.replace(/\/$/, "")}/_agent-native/build-info`;
    const response = await partition.fetch(base, {
      bypassCustomProtocolHandlers: true,
      signal: AbortSignal.timeout(15_000),
    });
    const state = await forks.load(appId);
    state.appUrl = origin;
    if (response.status === 401 || response.status === 403) {
      state.hostVersionStatus = "unauthenticated";
      await forks.save(state);
      return null;
    }
    // Older hosts have no build-info route; an HTML shell is not metadata.
    if (
      response.status === 404 ||
      response.headers.get("content-type")?.includes("text/html")
    ) {
      state.hostVersionStatus = "absent";
      await forks.save(state);
      return null;
    }
    if (!response.ok)
      throw new Error(`Could not read host version (${response.status})`);
    const sha = z
      .object({
        gitSha: z
          .string()
          .regex(/^[a-f0-9]{40}$/i)
          .nullable(),
      })
      .parse(await response.json()).gitSha;
    state.hostVersionStatus = sha ? "known" : "absent";
    await forks.save(state);
    return sha;
  }

  ipcMain.handle(
    CLIENT_FORK_CHANNEL,
    async (event, input: unknown): Promise<ClientForkResult> => {
      try {
        if (
          !options.isShell(event) ||
          event.senderFrame !== event.sender.mainFrame
        )
          throw new Error("Only the desktop shell can manage source forks");
        const request = requestSchema.parse(input);
        const configured = options
          .apps()
          .find((candidate) => candidate.id === request.appId);
        if (!configured?.url || new URL(configured.url).protocol !== "https:")
          throw new Error("Choose a hosted first-party app");
        const origin = configured.url;
        const state = await forks.load(request.appId);

        switch (request.operation) {
          case "prepare":
            await forks.prepare(
              request.appId,
              await hostedSha(request.appId, origin),
            );
            break;
          case "build":
            if (editing.has(request.appId))
              throw new Error(
                "Wait for the current source edit to finish before building",
              );
            try {
              await forks.build(request.appId);
            } catch (error) {
              await sync(request.appId, origin);
              reloadApp(request.appId);
              throw error;
            }
            break;
          case "original":
            state.enabled = false;
            await forks.save(state);
            break;
          case "activate":
            if ((state.buildBasePath ?? "/") !== new URL(origin).pathname)
              throw new Error("Rebuild the client for this app mount path");
            if (!state.buildPath || state.error)
              throw new Error("Build a working client before activating it");
            state.hostedSha = await hostedSha(request.appId, origin);
            if (state.hostedSha && state.hostedSha !== state.baseSha)
              throw new Error(
                "Hosted source changed. Update your fork before activating it.",
              );
            state.enabled = true;
            await forks.save(state);
            break;
          case "undo": {
            if (!state.previousBuildPath)
              throw new Error("There is no previous working build");
            const previous = state.previousBuildPath;
            state.previousBuildPath = state.buildPath;
            state.buildPath = previous;
            state.error = null;
            state.enabled = false;
            await forks.save(state);
            break;
          }
          case "update":
            await update(request.appId, origin);
            break;
          case "status":
            break;
        }
        await sync(request.appId, origin);
        return { ok: true, status: state };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  app.on("web-contents-created", (_event, contents) => {
    if (contents.getType() !== "webview") return;
    let generation = 0;
    contents.on("did-start-navigation", () => {
      generation += 1;
    });
    contents.on("did-finish-load", () => {
      const current = generation;
      const configured = options
        .apps()
        .find(
          (candidate) =>
            candidate.url &&
            contents.session ===
              session.fromPartition(`persist:app-${candidate.id}`) &&
            new URL(candidate.url).origin === new URL(contents.getURL()).origin,
        );
      if (!configured?.url) return;
      void (async () => {
        const state = await forks.load(configured.id);
        if (
          !state.enabled ||
          !clientForkLocalPath(
            new Request(contents.getURL(), {
              headers: { "sec-fetch-dest": "document" },
            }),
            configured.url ?? "",
          )
        )
          return;
        for (let attempt = 0; attempt < 12; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          if (
            contents.isDestroyed() ||
            current !== generation ||
            !(await forks.load(configured.id)).enabled
          )
            return;
          const health: string | null = await contents.executeJavaScript(
            "document.documentElement.getAttribute('data-agent-native-client-health')",
          );
          if (health === "ready") {
            const remote = await hostedSha(configured.id, configured.url ?? "");
            if (remote && remote !== state.baseSha) {
              options.notify(configured.id, null);
              uninstall(configured.id);
              await update(configured.id, configured.url ?? "");
              state.enabled = true;
              await forks.save(state);
              await sync(configured.id, configured.url ?? "");
              if (!contents.isDestroyed()) contents.reloadIgnoringCache();
            }
            return;
          }
          if (health === "error") break;
        }
        state.enabled = false;
        uninstall(configured.id);
        state.error =
          "The customized client did not boot. Original has been restored.";
        await forks.save(state);
        options.notify(configured.id, state.error);
        if (!contents.isDestroyed()) contents.reloadIgnoringCache();
      })().catch((error: unknown) =>
        console.error("[client-fork] Health check failed", error),
      );
    });
  });

  const ready = app.whenReady().then(async () => {
    for (const configured of options.apps()) {
      if (!configured.url?.startsWith("https://")) continue;
      try {
        const state = await forks.load(configured.id);
        if (state.enabled && state.buildPath)
          await install(configured.id, configured.url);
      } catch (error) {
        options.notify(
          configured.id,
          `Could not restore customization: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  });

  return {
    ready,
    prepare: async (appId: string, origin: string, prompt: string) => {
      if (editing.has(appId))
        throw new Error("This app already has a source edit running");
      editing.add(appId);
      try {
        const state = await forks.prepare(
          appId,
          await hostedSha(appId, origin),
        );
        if (!state.buildPath) await forks.build(appId);
        await writeClientForkBuildCommand(
          state.sourcePath,
          appId,
          origin,
          state.baseSha,
        );
        state.intents = [...(state.intents ?? []), prompt];
        await forks.save(state);
        return state;
      } catch (error) {
        editing.delete(appId);
        const state = await forks.load(appId);
        state.phase = "error";
        state.error = error instanceof Error ? error.message : String(error);
        await forks.save(state);
        throw error;
      }
    },
    finish: async (appId: string) => {
      try {
        await forks.completeRepair(appId);
        const state = await forks.build(appId);
        state.enabled = true;
        await forks.save(state);
        const origin = options
          .apps()
          .find((candidate) => candidate.id === appId)?.url;
        if (origin) await sync(appId, origin);
        return state;
      } catch (error) {
        uninstall(appId);
        reloadApp(appId);
        throw error;
      } finally {
        editing.delete(appId);
      }
    },
    failEdit: (appId: string) => {
      editing.delete(appId);
    },
  };
}
