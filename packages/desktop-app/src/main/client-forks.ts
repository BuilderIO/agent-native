import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { ClientForkStatus } from "../../shared/client-forks.js";

const stateSchema = z.object({
  appId: z.string(),
  sourcePath: z.string(),
  baseSha: z.string().regex(/^[a-f0-9]{40}$/),
  hostedSha: z.string().nullable(),
  enabled: z.boolean(),
  buildPath: z.string().nullable(),
  previousBuildPath: z.string().nullable(),
  error: z.string().nullable(),
  installMs: z.number().nullable(),
  buildMs: z.number().nullable(),
});

export async function runForkCommand(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = Object.fromEntries(
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
  ),
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const append = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-24_000);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(output.trim())
        : reject(new Error(`${command} failed (${code}):\n${output}`)),
    );
  });
}

export class ClientForks {
  private states = new Map<string, ClientForkStatus>();
  private busy = new Set<string>();
  constructor(
    private options: {
      root: string;
      source: string;
      baseSha: string;
      pnpm: string;
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
    await fs.mkdir(this.directory(state.appId), { recursive: true });
    const filename = path.join(this.directory(state.appId), "state.json");
    const temporary = `${filename}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(state, null, 2), {
      mode: 0o600,
    });
    await fs.rename(temporary, filename);
    this.states.set(state.appId, state);
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

  async prepare(
    appId: string,
    hostedSha: string | null,
  ): Promise<ClientForkStatus> {
    return this.exclusive(appId, async () => {
      const state = await this.load(appId);
      const base = hostedSha ?? state.baseSha;
      if (!/^[a-f0-9]{40}$/.test(base))
        throw new Error(
          "The desktop build has no source commit; rebuild Desktop from a git checkout",
        );
      await fs.mkdir(this.directory(appId), { recursive: true });
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
        await runForkCommand(
          "git",
          [
            "clone",
            "--filter=blob:none",
            "--no-checkout",
            this.options.source,
            state.sourcePath,
          ],
          this.directory(appId),
        );
        await runForkCommand(
          "git",
          ["fetch", "origin", base],
          state.sourcePath,
        );
        await runForkCommand(
          "git",
          ["checkout", "-b", "my-version", base],
          state.sourcePath,
        );
        await runForkCommand(
          "git",
          ["branch", `upstream/${base}`, base],
          state.sourcePath,
        );
      }
      if (existing && base !== state.baseSha)
        throw new Error(
          "The host has a new version. Update the existing fork before editing it.",
        );
      state.baseSha = base;
      state.hostedSha = hostedSha;
      await this.save(state);
      return state;
    });
  }

  async build(appId: string): Promise<ClientForkStatus> {
    return this.exclusive(appId, async () => {
      const state = await this.load(appId);
      const appDirectory = path.join(state.sourcePath, "templates", appId);
      try {
        await runForkCommand(
          "git",
          ["add", "--", `templates/${appId}`],
          state.sourcePath,
        );
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
          await runForkCommand(
            this.options.pnpm,
            [
              "install",
              "--frozen-lockfile",
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
        const buildStart = performance.now();
        await runForkCommand(
          this.options.pnpm,
          [
            "exec",
            "node",
            "scripts/prebuild-workspace-packages.ts",
            "agentkit-acceptance",
          ],
          state.sourcePath,
        );
        await runForkCommand(
          this.options.pnpm,
          ["exec", "agent-native", "build", "--client-only"],
          appDirectory,
        );
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
        state.buildMs = Math.round(performance.now() - buildStart);
        state.error = null;
        await this.save(state);
        return state;
      } catch (error) {
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
      await runForkCommand(
        "git",
        ["fetch", "origin", hostedSha],
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
        throw error;
      }
    });
    return this.build(appId);
  }
}
