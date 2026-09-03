#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentkit-packages-"));
const packDir = path.join(tempRoot, "packs");
const consumerDir = path.join(tempRoot, "consumer");
const pnpmBin = process.env.AGENTKIT_PACKAGING_PNPM || "pnpm";
const pnpmCli = process.env.AGENTKIT_PACKAGING_PNPM_CLI;
const pnpmCommand = pnpmCli
  ? process.env.AGENTKIT_PACKAGING_NODE || process.execPath
  : pnpmBin;
const pnpmPrefixArgs = pnpmCli ? [pnpmCli] : [];
const commandTimeoutMs = Number(
  process.env.AGENTKIT_PACKAGING_TIMEOUT_MS || 300_000,
);

const publicPackages = [
  "packages/agentkit-protocol",
  "packages/agentkit-client",
  "packages/agentkit-adapters",
  "packages/agentkit-conformance",
  "packages/agentkit-react",
  "packages/agentkit",
] as const;
const supportPackages = ["packages/toolkit"] as const;

interface PackageManifest {
  name: string;
  version: string;
  exports?: Record<string, unknown>;
}

function packageManifest(packagePath: string): PackageManifest {
  return JSON.parse(
    fs.readFileSync(path.join(repoRoot, packagePath, "package.json"), "utf8"),
  ) as PackageManifest;
}

function tail(chunks: string[], max = 120): string {
  return chunks.slice(-max).join("");
}

async function run(
  command: string,
  args: string[],
  options: {
    cwd: string;
    label: string;
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
  },
): Promise<void> {
  console.log(`[agentkit-packaging] ${options.label}`);
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: { ...process.env, NO_COLOR: "1", ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const chunks: string[] = [];
  const record = (chunk: Buffer | string) => {
    const text = chunk.toString();
    chunks.push(text);
    if (chunks.length > 500) chunks.shift();
    process.stdout.write(text);
  };
  child.stdout.on("data", record);
  child.stderr.on("data", record);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
  }, options.timeoutMs ?? commandTimeoutMs);
  try {
    const result = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    if (timedOut) {
      throw new Error(
        `${options.label} exceeded ${options.timeoutMs ?? commandTimeoutMs}ms.\n${tail(chunks)}`,
      );
    }
    if (result.code !== 0) {
      throw new Error(
        `${options.label} failed with exit ${String(result.code)} (${String(result.signal)}).\n${tail(chunks)}`,
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}

function write(relativePath: string, contents: string): void {
  const target = path.join(consumerDir, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function signalProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid && process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
  child.kill(signal);
}

async function runPackageManager(
  args: string[],
  options: Parameters<typeof run>[2],
): Promise<void> {
  await run(pnpmCommand, [...pnpmPrefixArgs, ...args], options);
}

async function waitForUrl(url: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`packed consumer exited before ${url} became ready`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      // coercion-ok: readiness remains distinguishable because the bounded loop throws on timeout.
    } catch {}
    await sleep(100);
  }
  throw new Error(`packed consumer did not become ready at ${url}`);
}

async function main(): Promise<void> {
  fs.mkdirSync(packDir, { recursive: true });
  fs.mkdirSync(consumerDir, { recursive: true });

  for (const packagePath of [...publicPackages, ...supportPackages]) {
    const dist = path.resolve(repoRoot, packagePath, "dist");
    const buildCache = path.resolve(
      repoRoot,
      packagePath,
      "node_modules/.cache/tsbuildinfo",
    );
    assert.ok(
      dist.startsWith(path.resolve(repoRoot, packagePath) + path.sep),
      `refusing to clean an unexpected dist path: ${dist}`,
    );
    assert.ok(
      buildCache.startsWith(path.resolve(repoRoot, packagePath) + path.sep),
      `refusing to clean an unexpected build cache path: ${buildCache}`,
    );
    fs.rmSync(dist, { recursive: true, force: true });
    fs.rmSync(buildCache, { recursive: true, force: true });
  }

  await runPackageManager(
    [
      ...publicPackages.flatMap((packagePath) => [
        "--filter",
        packageManifest(packagePath).name,
      ]),
      ...supportPackages.flatMap((packagePath) => [
        "--filter",
        packageManifest(packagePath).name,
      ]),
      "run",
      "build",
    ],
    { cwd: repoRoot, label: "clean build of packed package graph" },
  );

  const tarballs = new Map<string, string>();
  for (const packagePath of [...publicPackages, ...supportPackages]) {
    const manifest = packageManifest(packagePath);
    const before = new Set(fs.readdirSync(packDir));
    await runPackageManager(["pack", "--pack-destination", packDir], {
      cwd: path.join(repoRoot, packagePath),
      label: `pack ${manifest.name}`,
    });
    const created = fs
      .readdirSync(packDir)
      .filter((file) => !before.has(file) && file.endsWith(".tgz"));
    assert.equal(
      created.length,
      1,
      `${manifest.name} must produce exactly one tarball`,
    );
    tarballs.set(manifest.name, path.join(packDir, created[0]!));
  }

  const dependencies = Object.fromEntries(
    [...tarballs.entries()].map(([name, tarball]) => [name, `file:${tarball}`]),
  );
  write(
    "package.json",
    `${JSON.stringify(
      {
        name: "agentkit-packed-consumer",
        private: true,
        type: "module",
        scripts: {
          build: "vite build",
          start: "vite preview --host 127.0.0.1 --port 9476 --strictPort",
        },
        dependencies: {
          ...dependencies,
          react: "^19.2.7",
          "react-dom": "^19.2.7",
          vite: "8.1.0",
        },
      },
      null,
      2,
    )}\n`,
  );
  write(
    "pnpm-workspace.yaml",
    [
      'packages: ["."]',
      "overrides:",
      ...[...tarballs.entries()].map(
        ([name, tarball]) =>
          `  ${JSON.stringify(name)}: ${JSON.stringify(`file:${tarball}`)}`,
      ),
      "",
    ].join("\n"),
  );
  write(
    "index.html",
    '<!doctype html><html><body><div id="root"></div><script type="module" src="/src.tsx"></script></body></html>\n',
  );
  write(
    "src.tsx",
    `import React from "react";
import { createRoot } from "react-dom/client";
import * as root from "@agent-native/agentkit";
import * as http from "@agent-native/agentkit/http";
import * as react from "@agent-native/agentkit/react";
import * as headless from "@agent-native/agentkit/react/headless";
import * as protocol from "@agent-native/agentkit-protocol";
import * as client from "@agent-native/agentkit-client";
import * as adapters from "@agent-native/agentkit-adapters";
import * as conformance from "@agent-native/agentkit-conformance";
import "@agent-native/agentkit/react/styles.css";
import "@agent-native/agentkit-react/styles.css";

const exportsLoaded = [root, http, react, headless, protocol, client, adapters, conformance]
  .every((value) => Object.keys(value).length > 0);
createRoot(document.getElementById("root")!).render(
  <main>AgentKit packed {exportsLoaded ? "exports ready" : "exports missing"}</main>,
);
`,
  );
  write(
    "probe.mjs",
    `const modules = await Promise.all([
  import("@agent-native/agentkit"),
  import("@agent-native/agentkit/http"),
  import("@agent-native/agentkit/react"),
  import("@agent-native/agentkit/react/headless"),
  import("@agent-native/agentkit-protocol"),
  import("@agent-native/agentkit-client"),
  import("@agent-native/agentkit-adapters"),
  import("@agent-native/agentkit-conformance"),
  import("@agent-native/agentkit-react"),
  import("@agent-native/agentkit-react/headless"),
]);
if (modules.some((value) => Object.keys(value).length === 0)) {
  throw new Error("a supported packed JavaScript export was empty");
}
console.log("packed JavaScript exports ready");
process.exit(0);
`,
  );

  await runPackageManager(["install", "--prefer-offline"], {
    cwd: consumerDir,
    label: "install packed tarballs into isolated consumer",
  });
  await run(process.execPath, ["probe.mjs"], {
    cwd: consumerDir,
    label: "import every packed JavaScript export",
  });
  await runPackageManager(["run", "build"], {
    cwd: consumerDir,
    label: "build packed React and CSS consumer",
  });

  const preview = spawn(
    process.execPath,
    [
      path.join(consumerDir, "node_modules/vite/bin/vite.js"),
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      "9476",
      "--strictPort",
    ],
    {
      cwd: consumerDir,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    },
  );
  preview.stdout.pipe(process.stdout);
  preview.stderr.pipe(process.stderr);
  try {
    await waitForUrl("http://127.0.0.1:9476", preview);
  } finally {
    if (preview.exitCode === null && preview.signalCode === null) {
      signalProcessTree(preview, "SIGTERM");
      await Promise.race([
        new Promise<void>((resolve) => preview.once("close", () => resolve())),
        sleep(5_000).then(() => {
          if (preview.exitCode === null && preview.signalCode === null) {
            signalProcessTree(preview, "SIGKILL");
          }
        }),
      ]);
    }
  }

  for (const packagePath of publicPackages) {
    const manifest = packageManifest(packagePath);
    assert.ok(tarballs.has(manifest.name), `${manifest.name} was not packed`);
    for (const exportPath of Object.keys(manifest.exports ?? {})) {
      assert.ok(
        exportPath.startsWith("."),
        `${manifest.name} has an invalid export`,
      );
    }
  }
  console.log("qa-agentkit-packages: clean");
  console.log(`  packed: ${publicPackages.length} public AgentKit packages`);
  console.log(
    "  checked: tarball install, JS exports, CSS exports, build, launch",
  );
}

try {
  await main();
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5 });
}
