import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  lstat,
  writeFile,
  copyFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { expect, it } from "vitest";

import "./vitest-config.js";

const coreRoot = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);

it("mocks a dependency imported by an installed Core module", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "core-vitest-installed-"));
  try {
    const modules = path.join(root, "node_modules");
    const installedCore = path.join(modules, "@agent-native", "core");
    await mkdir(installedCore, { recursive: true });
    await copyFile(
      path.join(coreRoot, "package.json"),
      path.join(installedCore, "package.json"),
    );
    for (const name of ["vitest", "esbuild"]) {
      const packageDir = path.dirname(require.resolve(`${name}/package.json`));
      await symlink(
        await realpath(packageDir),
        path.join(modules, name),
        process.platform === "win32" ? "junction" : "dir",
      );
    }
    expect((await lstat(installedCore)).isSymbolicLink()).toBe(false);
    expect((await lstat(installedCore)).isDirectory()).toBe(true);

    const sourceDir = path.join(coreRoot, "src");
    await build({
      entryPoints: [
        "vitest-config.ts",
        "vite/bounded-task-plugin.ts",
        "collab/bounded-task-bundle.ts",
        "collab/bounded-task-source.ts",
        "shared/optional-peer.ts",
        "package-lifecycle/migration-message.ts",
      ].map((file) => path.join(sourceDir, file)),
      outbase: sourceDir,
      outdir: path.join(installedCore, "dist"),
      platform: "node",
      format: "esm",
      logLevel: "silent",
    });

    await writeFile(
      path.join(root, "vitest.config.mjs"),
      `import config from "@agent-native/core/vitest-config";\nexport default config;\n`,
    );
    await writeFile(
      path.join(root, "behavior.test.ts"),
      `import { writeFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
vi.mock("@agent-native/core/package-lifecycle/migration-message", () => ({
  AGENT_NATIVE_MIGRATION_GUIDE_URL: "mocked-migration-guide",
}));
import { OptionalPeerDependencyError } from "@agent-native/core/shared/optional-peer";
it("uses the mocked migration guide in the real error", () => {
  const message = new OptionalPeerDependencyError("example-peer").message;
  writeFileSync("observed-message.txt", message);
  expect(message).toContain("mocked-migration-guide");
});
`,
    );

    const inheritedEnv = new Set([
      "PATH",
      "HOME",
      "SYSTEMROOT",
      "TEMP",
      "TMP",
      "TMPDIR",
      "CI",
    ]);
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        inheritedEnv.has(key.toUpperCase()),
      ),
    );
    const child = spawnSync(
      process.execPath,
      [
        path.join(
          path.dirname(require.resolve("vitest/package.json")),
          "vitest.mjs",
        ),
        "run",
        "--config",
        "vitest.config.mjs",
        "--maxWorkers=1",
        "--no-file-parallelism",
      ],
      { cwd: root, env, encoding: "utf8", timeout: 45_000 },
    );
    const output = `${child.stdout ?? ""}\n${child.stderr ?? ""}`;
    expect(child.error, output).toBeUndefined();
    expect(child.status, output).toBe(0);
    const message = await readFile(
      path.join(root, "observed-message.txt"),
      "utf8",
    ).catch((error: unknown) => {
      throw new Error(
        `Child did not produce the observed message.\n${output}`,
        {
          cause: error,
        },
      );
    });
    expect(message, output).toContain("mocked-migration-guide");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
