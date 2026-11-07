import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { ClientForkStatus } from "../../shared/client-forks.js";
import {
  sparseForkSource,
  sourceSize,
  verifyClientAssets,
} from "./client-fork-source.js";

const stateSchema = z.object({
  appId: z.string(),
  appUrl: z.string().url().optional(),
  buildBasePath: z.string().optional(),
  sourcePath: z.string(),
  baseSha: z.string().regex(/^[a-f0-9]{40}$/),
  hostedSha: z.string().nullable(),
  hostVersionStatus: z.enum(["known", "absent", "unauthenticated"]).optional(),
  intents: z.array(z.string()).optional(),
  phase: z
    .enum(["downloading", "installing", "building", "ready", "error"])
    .optional(),
  cloneMs: z.number().optional(),
  sourceBytes: z.number().optional(),
  enabled: z.boolean(),
  buildPath: z.string().nullable(),
  previousBuildPath: z.string().nullable(),
  error: z.string().nullable(),
  installMs: z.number().nullable(),
  buildMs: z.number().nullable(),
});

const forkProcesses = new Set<ChildProcess>();
export class ClientForkRepairRequiredError extends Error {}
function stopForkProcess(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") child.kill("SIGTERM");
    else process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH"))
      throw error;
  }
}

export function stopForkBuilds(): void {
  for (const child of forkProcesses) stopForkProcess(child);
}

export function forkCommandEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    [
      "PATH",
      "HOME",
      "TMPDIR",
      "USERPROFILE",
      "SYSTEMROOT",
      "COMSPEC",
      "PNPM_HOME",
      "XDG_CACHE_HOME",
      "XDG_DATA_HOME",
    ].flatMap((key) => (process.env[key] ? [[key, process.env[key]]] : [])),
  );
}

export async function runForkCommand(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = forkCommandEnvironment(),
  maxOutputBytes = 24_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    forkProcesses.add(child);
    const timeout = setTimeout(() => stopForkProcess(child), 10 * 60_000);
    timeout.unref();
    let output = "";
    const append = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-maxOutputBytes);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (error) => {
      clearTimeout(timeout);
      forkProcesses.delete(child);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      forkProcesses.delete(child);
      return code === 0
        ? resolve(output.trim())
        : reject(new Error(`${command} failed (${code}):\n${output}`));
    });
  });
}

export class ClientForks {
  private states = new Map<string, ClientForkStatus>();
  private busy = new Set<string>();
  private buildTail: Promise<void> = Promise.resolve();
  constructor(
    private options: {
      root: string;
      source: string;
      baseSha: string;
      pnpm: string;
      toolchain?: () => Promise<{
        command: string;
        args: string[];
        env: NodeJS.ProcessEnv;
      }>;
      notify?: (state: ClientForkStatus) => void;
    },
  ) {}

  private directory(appId: string): string {
    if (!/^[a-z][a-z0-9-]{0,80}$/.test(appId))
      throw new Error("Invalid app id");
    return path.join(this.options.root, appId);
  }

  async load(appId: string): Promise<ClientForkStatus> {
    const cached = this.states.get(appId);
    if (cached) return cached;
    let state: ClientForkStatus;
    try {
      state = stateSchema.parse(
        JSON.parse(
          await fs.readFile(
            path.join(this.directory(appId), "state.json"),
            "utf8",
          ),
        ),
      );
      if (
        state.appId !== appId ||
        state.sourcePath !== path.join(this.directory(appId), "source")
      )
        throw new Error("Fork identity mismatch");
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      )
        throw error;
      state = {
        appId,
        sourcePath: path.join(this.directory(appId), "source"),
        baseSha: this.options.baseSha,
        hostedSha: null,
        enabled: false,
        buildPath: null,
        previousBuildPath: null,
        error: null,
        installMs: null,
        buildMs: null,
      };
    }
    this.states.set(appId, state);
    return state;
  }

  async save(state: ClientForkStatus): Promise<void> {
    await fs.mkdir(this.directory(state.appId), {
      recursive: true,
      mode: 0o700,
    });
    const filename = path.join(this.directory(state.appId), "state.json");
    const temporary = `${filename}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(state, null, 2), {
      mode: 0o600,
    });
    await fs.rename(temporary, filename);
    this.states.set(state.appId, state);
    this.options.notify?.(state);
  }

  async exclusive<T>(appId: string, execute: () => Promise<T>): Promise<T> {
    if (this.busy.has(appId))
      throw new Error("This app already has a customization operation running");
    this.busy.add(appId);
    try {
      return await execute();
    } finally {
      this.busy.delete(appId);
    }
  }

  private async cloneSource(
    state: ClientForkStatus,
    base: string,
  ): Promise<void> {
    const temporary = path.join(
      this.directory(state.appId),
      `source-preparing-${randomUUID()}`,
    );
    try {
      await runForkCommand(
        "git",
        [
          "clone",
          "--depth=1",
          "--single-branch",
          "--no-tags",
          "--filter=blob:none",
          "--no-checkout",
          this.options.source,
          temporary,
        ],
        this.directory(state.appId),
      );
      await runForkCommand(
        "git",
        ["fetch", "--depth=1", "origin", base],
        temporary,
      );
      await sparseForkSource(temporary, base, state.appId);
      await runForkCommand(
        "git",
        ["checkout", "-b", "my-version", base],
        temporary,
      );
      await runForkCommand(
        "git",
        ["branch", `upstream/${base}`, base],
        temporary,
      );
      await fs.rename(temporary, state.sourcePath);
    } catch (error) {
      await fs.rm(temporary, { recursive: true, force: true });
      throw error;
    }
  }

  async prepare(
    appId: string,
    hostedSha: string | null,
  ): Promise<ClientForkStatus> {
    return this.exclusive(appId, async () => {
      const state = await this.load(appId);
      await this.options.toolchain?.();
      const started = performance.now();
      state.phase = "downloading";
      await this.save(state);
      const base = hostedSha ?? state.baseSha;
      if (!/^[a-f0-9]{40}$/.test(base))
        throw new Error(
          "The desktop build has no source commit; rebuild Desktop from a git checkout",
        );
      await fs.mkdir(this.directory(appId), { recursive: true, mode: 0o700 });
      let existing = false;
      try {
        await fs.access(path.join(state.sourcePath, ".git"));
        existing = true;
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          )
        )
          throw error;
        await this.cloneSource(state, base);
      }
      if (existing && base !== state.baseSha)
        throw new Error(
          "The host has a new version. Update the existing fork before editing it.",
        );
      state.cloneMs = Math.round(performance.now() - started);
      state.sourceBytes = await sourceSize(state.sourcePath);
      state.baseSha = base;
      state.hostedSha = hostedSha;
      await this.save(state);
      return state;
    });
  }

  async build(appId: string): Promise<ClientForkStatus> {
    const previous = this.buildTail;
    let release: () => void = () => {};
    this.buildTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await this.buildNow(appId);
    } finally {
      release();
    }
  }

  private async buildNow(appId: string): Promise<ClientForkStatus> {
    return this.exclusive(appId, async () => {
      const state = await this.load(appId);
      const appDirectory = path.join(state.sourcePath, "templates", appId);
      try {
        const tools = await this.options.toolchain?.();
        const pnpm = (
          args: string[],
          cwd: string,
          extra: NodeJS.ProcessEnv = {},
        ) =>
          runForkCommand(
            tools?.command ?? this.options.pnpm,
            [...(tools?.args ?? []), ...args],
            cwd,
            { ...(tools?.env ?? forkCommandEnvironment()), ...extra },
          );
        await runForkCommand("git", ["add", "--all"], state.sourcePath);
        const changedServer = await runForkCommand(
          "git",
          [
            "diff",
            `upstream/${state.baseSha}`,
            "--name-only",
            "--",
            `templates/${appId}/actions`,
            `templates/${appId}/server`,
            `templates/${appId}/drizzle`,
          ],
          state.sourcePath,
        );
        if (changedServer)
          throw new Error(
            "This edit changes server code. This prototype runs client edits against the hosted backend; server edits need a separate runtime.",
          );
        state.phase = "installing";
        await this.save(state);
        const installStart = performance.now();
        const dependencyHash = createHash("sha256");
        for (const filename of [
          "pnpm-lock.yaml",
          "package.json",
          `templates/${appId}/package.json`,
        ])
          dependencyHash.update(
            await fs.readFile(path.join(state.sourcePath, filename)),
          );
        const digest = dependencyHash.digest("hex");
        const stamp = path.join(this.directory(appId), "dependencies.sha256");
        let installedDigest: string | null = null;
        try {
          installedDigest = await fs.readFile(stamp, "utf8");
        } catch (error) {
          if (
            !(
              error instanceof Error &&
              "code" in error &&
              error.code === "ENOENT"
            )
          )
            throw error;
        }
        if (installedDigest !== digest) {
          await pnpm(
            [
              "install",
              "--frozen-lockfile",
              "--ignore-scripts",
              "--filter",
              `${appId}...`,
              "--store-dir",
              path.join(this.options.root, "pnpm-store"),
            ],
            state.sourcePath,
          );
          await fs.writeFile(stamp, digest);
        }
        state.installMs = Math.round(performance.now() - installStart);
        await this.save(state);
        state.phase = "building";
        await this.save(state);
        const buildStart = performance.now();
        await pnpm(
          ["--filter", "@agent-native/toolkit...", "run", "build"],
          state.sourcePath,
        );
        await pnpm(
          ["exec", "agent-native", "build", "--client-only"],
          appDirectory,
          {
            VITE_APP_BASE_PATH: new URL(
              state.appUrl ?? "https://local.example/",
            ).pathname,
            AGENT_NATIVE_BUILD_SHA: state.baseSha,
            AGENT_NATIVE_BUILD_ID: state.baseSha,
          },
        );
        await verifyClientAssets(path.join(appDirectory, "build", "client"));
        const candidate = path.join(
          this.directory(appId),
          "builds",
          randomUUID(),
        );
        await fs.mkdir(candidate, { recursive: true });
        await fs.cp(path.join(appDirectory, "build", "client"), candidate, {
          recursive: true,
          dereference: true,
        });
        await fs.access(path.join(candidate, "index.html"));
        const staged = await runForkCommand(
          "git",
          ["diff", "--cached", "--name-only"],
          state.sourcePath,
        );
        if (staged)
          await runForkCommand(
            "git",
            ["commit", "-m", "Customize app client"],
            state.sourcePath,
          );
        state.previousBuildPath = state.buildPath;
        state.buildPath = candidate;
        state.buildBasePath = new URL(
          state.appUrl ?? "https://local.example/",
        ).pathname;
        state.buildMs = Math.round(performance.now() - buildStart);
        state.error = null;
        state.phase = "ready";
        await this.save(state);
        const builds = path.join(this.directory(appId), "builds");
        for (const entry of await fs.readdir(builds)) {
          const artifact = path.join(builds, entry);
          if (
            /^[a-f0-9-]{36}$/.test(entry) &&
            artifact !== state.buildPath &&
            artifact !== state.previousBuildPath
          )
            await fs.rm(artifact, { recursive: true, force: true });
        }
        return state;
      } catch (error) {
        state.phase = "error";
        state.error = error instanceof Error ? error.message : String(error);
        state.enabled = false;
        await this.save(state);
        throw error;
      }
    });
  }

  async update(
    appId: string,
    hostedSha: string | null,
  ): Promise<ClientForkStatus> {
    const state = await this.load(appId);
    if (!hostedSha || hostedSha === state.baseSha) return state;
    await this.exclusive(appId, async () => {
      if (
        await runForkCommand("git", ["status", "--porcelain"], state.sourcePath)
      )
        throw new Error("Build or preserve your current edits before updating");
      state.hostedSha = hostedSha;
      state.enabled = false;
      await this.save(state);
      await runForkCommand(
        "git",
        ["fetch", "--depth=1", "origin", hostedSha],
        state.sourcePath,
      );
      try {
        await runForkCommand(
          "git",
          ["rebase", "--onto", hostedSha, state.baseSha],
          state.sourcePath,
        );
        await runForkCommand(
          "git",
          ["branch", `upstream/${hostedSha}`, hostedSha],
          state.sourcePath,
        );
        state.baseSha = hostedSha;
        state.hostedSha = hostedSha;
        state.enabled = false;
        await this.save(state);
      } catch (error) {
        state.error = `Update needs repair: ${error instanceof Error ? error.message : String(error)}`;
        state.enabled = false;
        await this.save(state);
        throw new ClientForkRepairRequiredError(state.error, { cause: error });
      }
    });
    try {
      return await this.build(appId);
    } catch (error) {
      throw new ClientForkRepairRequiredError(
        "Updated client needs a build repair",
        { cause: error },
      );
    }
  }

  async completeRepair(appId: string): Promise<void> {
    const state = await this.load(appId);
    if (!state.hostedSha || state.hostedSha === state.baseSha) return;
    await runForkCommand(
      "git",
      ["merge-base", "--is-ancestor", state.hostedSha, "HEAD"],
      state.sourcePath,
    );
    const branch = `upstream/${state.hostedSha}`;
    const found = await runForkCommand(
      "git",
      ["branch", "--list", branch],
      state.sourcePath,
    );
    if (!found)
      await runForkCommand(
        "git",
        ["branch", branch, state.hostedSha],
        state.sourcePath,
      );
    state.baseSha = state.hostedSha;
    await this.save(state);
  }
}
