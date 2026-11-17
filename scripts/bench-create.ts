#!/usr/bin/env node
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  pnpmCommand,
  stopProcessTree,
  type PnpmCommand,
} from "./lib/pnpm-command.ts";

const repoRoot = path.resolve(import.meta.dirname, "..");
const WORKSPACE_NAME = "bench-ws";
const ADDED_APP_NAME = "bench-app";
const PHASE_TIMEOUT_MS = 20 * 60_000;

const HELP = `Measure how long a first-time \`create\` takes and how many bytes it moves.

Usage: pnpm bench:create [--target <spec>]... [options]

Each run starts cold: a fresh npm cache, pnpm store, and temp folder, with all
traffic tunneled through a local proxy that counts bytes per host. Phases:

  install       npm installs the target, as npx does before running it
  create        the CLI scaffolds a workspace, or one app with --standalone,
                downloading templates
  add-app       the same CLI adds an app to the new workspace (only with
                --add-app)
  pnpm-install  pnpm installs the new workspace (only with --pnpm-install)

Targets (default: @agent-native/core@latest and local):
  local             this checkout's @agent-native/core, built and packed
  <path>.tgz        a packed package, such as a create-agent-native build
  <npm spec>        anything npm installs, such as @agent-native/core@0.223.0

The first target is the baseline the others are compared against.

Options:
  --template <names>    templates to scaffold (default: dispatch, or chat
                        with --standalone)
  --standalone          scaffold one standalone app, as Getting Started does
  --add-app <template>  then add an app from this template to the workspace
  --runs <n>            runs per target; times are medians (default: 1)
  --pnpm-install        also time pnpm install in the new workspace
  --out <file>          results JSON (default: .tmp/bench/create-<time>.json)
  --keep                keep each run's folder instead of deleting it

A local, .tgz, or tarball-URL target skips the package's own registry metadata,
and a local or .tgz one its tarball too, so its install phase undercounts by
that much. For @agent-native/core 0.228.1 that was 3.6 MB of metadata and a
10.7 MB tarball. Bytes are what crossed the wire, TLS included.`;

export interface HostTraffic {
  received: number;
  sent: number;
  connections: number;
  errors: number;
}

export type Traffic = Record<string, HostTraffic>;

export interface CountingProxy {
  url: string;
  snapshot(): Traffic;
  plainRequests(): number;
  close(): Promise<void>;
}

/** An HTTPS tunneling proxy that counts the bytes each host sends and receives. */
export async function startCountingProxy(): Promise<CountingProxy> {
  const traffic: Traffic = {};
  const sockets = new Set<net.Socket>();
  let plainRequests = 0;
  const track = (socket: net.Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  };
  const hostEntry = (key: string): HostTraffic =>
    (traffic[key] ??= { received: 0, sent: 0, connections: 0, errors: 0 });

  const server = http.createServer((_req, res) => {
    plainRequests += 1;
    res.writeHead(501).end("This proxy only tunnels HTTPS (CONNECT).");
  });
  server.on("connection", track);
  server.on("connect", (req, client: net.Socket, head: Buffer) => {
    const authority = new URL(`http://${req.url ?? ""}`);
    const port = Number(authority.port || 443);
    const hostname = authority.hostname.replace(/^\[|\]$/g, "");
    const stats = hostEntry(port === 443 ? hostname : `${hostname}:${port}`);
    stats.connections += 1;
    const upstream = net.connect(port, hostname, () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) {
        stats.sent += head.length;
        upstream.write(head);
      }
      upstream.on("data", (chunk: Buffer) => (stats.received += chunk.length));
      client.on("data", (chunk: Buffer) => (stats.sent += chunk.length));
      upstream.pipe(client);
      client.pipe(upstream);
    });
    track(upstream);
    upstream.on("error", () => {
      stats.errors += 1;
      client.destroy();
    });
    client.on("error", () => upstream.destroy());
  });

  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("The counting proxy has no TCP address.");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    snapshot: () => structuredClone(traffic),
    plainRequests: () => plainRequests,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

/** The traffic between two snapshots, leaving out hosts that saw none. */
export function diffTraffic(before: Traffic, after: Traffic): Traffic {
  const diff: Traffic = {};
  for (const [host, end] of Object.entries(after)) {
    const start = before[host];
    const delta: HostTraffic = {
      received: end.received - (start?.received ?? 0),
      sent: end.sent - (start?.sent ?? 0),
      connections: end.connections - (start?.connections ?? 0),
      errors: end.errors - (start?.errors ?? 0),
    };
    if (delta.connections > 0 || delta.received > 0 || delta.sent > 0) {
      diff[host] = delta;
    }
  }
  return diff;
}

export function totalTraffic(traffic: Traffic): HostTraffic {
  const total: HostTraffic = {
    received: 0,
    sent: 0,
    connections: 0,
    errors: 0,
  };
  for (const host of Object.values(traffic)) {
    total.received += host.received;
    total.sent += host.sent;
    total.connections += host.connections;
    total.errors += host.errors;
  }
  return total;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("median of no values");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const middle =
    sorted.length % 2 === 1
      ? sorted.slice(mid, mid + 1)
      : sorted.slice(mid - 1, mid + 1);
  return middle.reduce((sum, value) => sum + value, 0) / middle.length;
}

export interface ScaffoldOptions {
  template: string;
  standalone: boolean;
  addApp: string | undefined;
}

/** The CLI arguments for create and add-app, given the installed package. */
export function scaffoldArgs(
  packageName: string,
  { template, standalone, addApp }: ScaffoldOptions,
): { create: string[]; addApp: string[] | undefined } {
  // Core's bin is the whole CLI; a dedicated create package's bin is `create`.
  const isCore = packageName === "@agent-native/core";
  if (addApp !== undefined && !isCore) {
    throw new Error(
      `--add-app runs @agent-native/core's add-app command, which ${packageName} doesn't have.`,
    );
  }
  // Without a terminal, `create` with one template makes a standalone app, so
  // a workspace needs the `create-workspace` alias, which forces one.
  const coreCommand = standalone ? "create" : "create-workspace";
  return {
    create: [
      ...(isCore ? [coreCommand] : []),
      WORKSPACE_NAME,
      "--template",
      template,
      ...(standalone ? ["--standalone"] : []),
    ],
    addApp:
      addApp === undefined
        ? undefined
        : ["add-app", ADDED_APP_NAME, "--template", addApp],
  };
}

type PhaseName = "install" | "create" | "add-app" | "pnpm-install";

interface PhaseResult {
  ms: number;
  hosts: Traffic;
}

interface RunResult {
  version: string;
  phases: Partial<Record<PhaseName, PhaseResult>>;
  workspaceFiles: number;
  workspaceBytes: number;
}

interface Target {
  label: string;
  spec: string;
  /** Only targets npm installs from the same source download the same files. */
  source: "registry" | "url" | "file";
}

function isolatedEnv(runDir: string, proxyUrl: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  // `pnpm bench:create` exports its own npm_config_* settings; a nested npm or
  // pnpm would inherit them and stop being a cold, default install.
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(npm_|pnpm_|PNPM_|COREPACK_)/i.test(key)) continue;
    if (/^(https?|all|no)_proxy$/i.test(key)) continue;
    env[key] = value;
  }
  const userconfig = path.join(runDir, "npmrc");
  fs.writeFileSync(userconfig, "");
  const tmpDir = path.join(runDir, "tmp");
  fs.mkdirSync(tmpDir);
  return {
    ...env,
    PATH: `${path.dirname(process.execPath)}${path.delimiter}${env.PATH ?? ""}`,
    HTTPS_PROXY: proxyUrl,
    HTTP_PROXY: proxyUrl,
    https_proxy: proxyUrl,
    http_proxy: proxyUrl,
    npm_config_userconfig: userconfig,
    npm_config_registry: "https://registry.npmjs.org/",
    npm_config_cache: path.join(runDir, "npm-cache"),
    npm_config_store_dir: path.join(runDir, "pnpm-store"),
    npm_config_cache_dir: path.join(runDir, "pnpm-cache"),
    npm_config_update_notifier: "false",
    XDG_CACHE_HOME: path.join(runDir, "xdg-cache"),
    TMPDIR: tmpDir,
    DO_NOT_TRACK: "1",
    AGENT_NATIVE_TELEMETRY_DISABLED: "1",
  };
}

async function runPhase(
  proxy: CountingProxy,
  logFile: string,
  { command, args, shell }: PnpmCommand,
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<PhaseResult> {
  const before = proxy.snapshot();
  const log = fs.openSync(logFile, "w");
  const started = performance.now();
  let timedOut = false;
  const exit = await new Promise<{
    code: number | null;
    signal: string | null;
  }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell,
      stdio: ["ignore", log, log],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      stopProcessTree(child, "SIGKILL");
    }, PHASE_TIMEOUT_MS);
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
  const ms = performance.now() - started;
  fs.closeSync(log);
  if (exit.code !== 0) {
    const tail = fs.readFileSync(logFile, "utf8").split("\n").slice(-30);
    throw new Error(
      `${[command, ...args].join(" ")} ${timedOut ? `timed out after ${PHASE_TIMEOUT_MS / 60_000} minutes` : `exited with ${exit.signal ?? exit.code}`}. Last lines of ${path.basename(logFile)} (--keep keeps the whole log):\n${tail.join("\n")}`,
    );
  }
  return { ms, hosts: diffTraffic(before, proxy.snapshot()) };
}

/** npm's own entry point, which runs on Windows without npm's .cmd shim. */
function npmCliPath(): string {
  const nodeDir = path.dirname(process.execPath);
  const candidates = [
    path.join(nodeDir, "node_modules/npm/bin/npm-cli.js"),
    path.join(nodeDir, "../lib/node_modules/npm/bin/npm-cli.js"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      `No npm found beside ${process.execPath}. Looked in:\n${candidates.join("\n")}`,
    );
  }
  return found;
}

function installedPackage(cliDir: string): {
  root: string;
  name: string;
  version: string;
  bin: string;
} {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(cliDir, "package.json"), "utf8"),
  ) as { dependencies?: Record<string, string> };
  // For an npm alias the dependency key is the alias, so the name has to
  // come from the installed package.
  const keys = Object.keys(manifest.dependencies ?? {});
  const key = keys[0];
  if (keys.length !== 1 || !key) {
    throw new Error(
      `Expected one installed package in ${cliDir}, found: ${keys.join(", ") || "none"}.`,
    );
  }
  const root = path.join(cliDir, "node_modules", key);
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  ) as { name: string; version: string; bin?: string | Record<string, string> };
  const { name } = pkg;
  const bins =
    typeof pkg.bin === "string"
      ? [pkg.bin]
      : Object.values(pkg.bin ?? {}).slice(0, 2);
  const bin = bins[0];
  if (bins.length !== 1 || !bin) {
    throw new Error(`${name} must declare exactly one bin to benchmark.`);
  }
  return { root, name, version: pkg.version, bin: path.join(root, bin) };
}

function countFiles(dir: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = countFiles(full);
      files += nested.files;
      bytes += nested.bytes;
    } else {
      files += 1;
      bytes += fs.lstatSync(full).size;
    }
  }
  return { files, bytes };
}

async function benchRun(
  proxy: CountingProxy,
  target: Target,
  options: ScaffoldOptions & { pnpmInstall: boolean; keep: boolean },
): Promise<RunResult> {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-native-bench-"));
  try {
    const env = isolatedEnv(runDir, proxy.url);
    const cliDir = path.join(runDir, "cli");
    const workDir = path.join(runDir, "work");
    fs.mkdirSync(cliDir);
    fs.mkdirSync(workDir);
    fs.writeFileSync(path.join(cliDir, "package.json"), '{"private":true}\n');
    const phases: RunResult["phases"] = {};

    phases.install = await runPhase(
      proxy,
      path.join(runDir, "install.log"),
      {
        command: process.execPath,
        args: [
          npmCliPath(),
          "install",
          "--no-audit",
          "--no-fund",
          "--loglevel=error",
          target.spec,
        ],
        shell: false,
      },
      { cwd: cliDir, env },
    );
    if (totalTraffic(phases.install.hosts).connections === 0) {
      throw new Error(
        "npm installed with no traffic through the counting proxy, so it bypassed it. Check for a proxy or noproxy setting in the global npmrc.",
      );
    }
    const pkg = installedPackage(cliDir);
    const args = scaffoldArgs(pkg.name, options);
    phases.create = await runPhase(
      proxy,
      path.join(runDir, "create.log"),
      {
        command: process.execPath,
        args: [pkg.bin, ...args.create],
        shell: false,
      },
      { cwd: workDir, env },
    );
    const workspaceDir = path.join(workDir, WORKSPACE_NAME);
    if (!fs.existsSync(workspaceDir)) {
      throw new Error(`create exited 0 but wrote no ${workspaceDir}.`);
    }
    if (args.addApp) {
      // Users run the workspace's own CLI through `pnpm exec`, which works only
      // after a pnpm install. This is the same command without that wait.
      phases["add-app"] = await runPhase(
        proxy,
        path.join(runDir, "add-app.log"),
        {
          command: process.execPath,
          args: [pkg.bin, ...args.addApp],
          shell: false,
        },
        { cwd: workspaceDir, env },
      );
      const appDir = path.join(workspaceDir, "apps", ADDED_APP_NAME);
      if (!fs.existsSync(appDir) || countFiles(appDir).files === 0) {
        throw new Error(`add-app exited 0 but wrote nothing to ${appDir}.`);
      }
    }
    const written = countFiles(workspaceDir);
    if (written.files === 0) {
      throw new Error(`create exited 0 but ${workspaceDir} is empty.`);
    }
    if (options.pnpmInstall) {
      phases["pnpm-install"] = await runPhase(
        proxy,
        path.join(runDir, "pnpm-install.log"),
        pnpmCommand(["install", "--reporter=append-only"]),
        { cwd: workspaceDir, env },
      );
    }
    return {
      version: pkg.version,
      phases,
      workspaceFiles: written.files,
      workspaceBytes: written.bytes,
    };
  } finally {
    // A failed run is deleted too: its caches run to hundreds of MB, and the
    // error already carries the log's last lines.
    if (options.keep) {
      console.error(`[bench] kept ${runDir}`);
    } else {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  }
}

function packLocalCore(packDir: string): string {
  console.error("[bench] building and packing this checkout's core…");
  const pnpm = pnpmCommand(["pack", "--pack-destination", packDir]);
  const packed = spawnSync(pnpm.command, pnpm.args, {
    cwd: path.join(repoRoot, "packages/core"),
    shell: pnpm.shell,
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (packed.error) {
    throw new Error(`pnpm pack failed: ${packed.error.message}`, {
      cause: packed.error,
    });
  }
  if (packed.status !== 0) {
    // The build prints its type errors on stdout, not stderr.
    const tail = packed.stdout.split("\n").slice(-30).join("\n");
    throw new Error(
      `pnpm pack in packages/core exited with ${packed.signal ?? packed.status}. Last lines of its output:\n${tail}`,
    );
  }
  const tarballs = fs.readdirSync(packDir).filter((f) => f.endsWith(".tgz"));
  const tarball = tarballs[0];
  if (tarballs.length !== 1 || !tarball) {
    throw new Error(
      `Expected one tarball in ${packDir}, found ${tarballs.length}.`,
    );
  }
  return path.join(packDir, tarball);
}

function gitLabel(): string {
  const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  return dirty ? `${sha}+dirty` : sha;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function formatChange(baseline: number, value: number): string {
  if (baseline === 0) return value === 0 ? "same" : "new";
  const percent = ((value - baseline) / baseline) * 100;
  return `${percent > 0 ? "+" : ""}${percent.toFixed(0)}%`;
}

interface PhaseSummary {
  ms: number;
  received: number;
  sent: number;
  connections: number;
  /** Summed across runs, not a median, so one failed run still shows. */
  failedConnections: number;
  hosts: string;
}

function summarizePhase(
  runs: RunResult[],
  phase: PhaseName,
): PhaseSummary | undefined {
  const results = runs
    .map((run) => run.phases[phase])
    .filter((result): result is PhaseResult => result !== undefined);
  if (results.length === 0) return undefined;
  const totals = results.map((result) => totalTraffic(result.hosts));
  const receivedByHost: Record<string, number> = {};
  for (const result of results) {
    for (const [name, host] of Object.entries(result.hosts)) {
      receivedByHost[name] = (receivedByHost[name] ?? 0) + host.received;
    }
  }
  const received = Object.values(receivedByHost).reduce((a, b) => a + b, 0);
  const hosts = Object.entries(receivedByHost)
    .filter(([, bytes]) => bytes >= received * 0.1)
    .sort(([, a], [, b]) => b - a)
    .map(([name]) => name)
    .join(", ");
  return {
    ms: median(results.map((result) => result.ms)),
    received: median(totals.map((total) => total.received)),
    sent: median(totals.map((total) => total.sent)),
    connections: median(totals.map((total) => total.connections)),
    failedConnections: totals.reduce((sum, total) => sum + total.errors, 0),
    hosts,
  };
}

function report(
  results: { target: Target; runs: RunResult[] }[],
  phases: PhaseName[],
): string {
  const lines = [
    "| Target | Phase | Time | Received | Sent | Connections | Mostly from | vs baseline |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  const baseline = results[0];
  for (const { target, runs } of results) {
    const version = runs[0]?.version ?? "?";
    for (const phase of phases) {
      const summary = summarizePhase(runs, phase);
      if (!summary) continue;
      const base =
        baseline && baseline !== results.find((r) => r.target === target)
          ? summarizePhase(baseline.runs, phase)
          : undefined;
      const comparable =
        phase !== "install" || target.source === baseline?.target.source;
      const change = !base
        ? ""
        : comparable
          ? `time ${formatChange(base.ms, summary.ms)}, bytes ${formatChange(base.received + base.sent, summary.received + summary.sent)}`
          : "not comparable";
      lines.push(
        `| ${target.label} (${version}) | ${phase} | ${(summary.ms / 1000).toFixed(1)} s | ${formatBytes(summary.received)} | ${formatBytes(summary.sent)} | ${summary.connections}${summary.failedConnections > 0 ? ` (${summary.failedConnections} failed)` : ""} | ${summary.hosts} | ${change} |`,
      );
    }
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      target: { type: "string", multiple: true },
      template: { type: "string" },
      standalone: { type: "boolean", default: false },
      "add-app": { type: "string" },
      runs: { type: "string", default: "1" },
      "pnpm-install": { type: "boolean", default: false },
      out: { type: "string" },
      keep: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    console.log(HELP);
    return;
  }
  const runs = Number(values.runs);
  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error(`--runs must be a positive integer, got ${values.runs}.`);
  }
  const { standalone } = values;
  const addApp = values["add-app"];
  if (standalone && addApp !== undefined) {
    throw new Error(
      "--add-app adds to a workspace, so it can't be combined with --standalone.",
    );
  }
  const scaffold: ScaffoldOptions = {
    template: values.template ?? (standalone ? "chat" : "dispatch"),
    standalone,
    addApp,
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = path.resolve(
    values.out ?? path.join(repoRoot, ".tmp/bench", `create-${stamp}.json`),
  );
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  const proxy = await startCountingProxy();
  const packDirs: string[] = [];
  let results: { target: Target; runs: RunResult[] }[];
  try {
    const targets: Target[] = (
      values.target ?? ["@agent-native/core@latest", "local"]
    ).map((spec) => {
      if (spec === "local") {
        const packDir = fs.mkdtempSync(
          path.join(os.tmpdir(), "agent-native-bench-pack-"),
        );
        packDirs.push(packDir);
        return {
          label: `local ${gitLabel()}`,
          spec: packLocalCore(packDir),
          source: "file",
        };
      }
      if (/^https?:\/\//.test(spec)) {
        return { label: spec, spec, source: "url" };
      }
      if (spec.endsWith(".tgz")) {
        return {
          label: path.basename(spec),
          spec: path.resolve(spec),
          source: "file",
        };
      }
      return { label: spec, spec, source: "registry" };
    });
    results = targets.map((target) => ({ target, runs: [] }));
    // Alternate targets within each round so a slow minute hits all of them.
    for (let round = 1; round <= runs; round++) {
      for (const result of results) {
        console.error(`[bench] ${result.target.label}: run ${round}/${runs}…`);
        result.runs.push(
          await benchRun(proxy, result.target, {
            ...scaffold,
            pnpmInstall: values["pnpm-install"],
            keep: values.keep,
          }),
        );
      }
    }
    if (proxy.plainRequests() > 0) {
      throw new Error(
        `${proxy.plainRequests()} plain-HTTP request(s) reached the proxy and were refused; the byte counts would miss them.`,
      );
    }
  } finally {
    await proxy.close();
    for (const dir of packDirs)
      fs.rmSync(dir, { recursive: true, force: true });
  }

  const phases: PhaseName[] = ["install", "create", "add-app", "pnpm-install"];
  fs.writeFileSync(
    outFile,
    `${JSON.stringify(
      {
        startedAt: new Date().toISOString(),
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        ...scaffold,
        runsPerTarget: runs,
        targets: results.map(({ target, runs: targetRuns }) => ({
          ...target,
          runs: targetRuns,
          summary: Object.fromEntries(
            phases.flatMap((phase) => {
              const summary = summarizePhase(targetRuns, phase);
              return summary ? [[phase, summary]] : [];
            }),
          ),
        })),
      },
      null,
      2,
    )}\n`,
  );
  const scenario = [
    standalone
      ? `standalone ${scaffold.template} app`
      : `workspace with ${scaffold.template}`,
    ...(addApp === undefined ? [] : [`then add-app ${addApp}`]),
  ].join(", ");
  console.log(
    `${scenario} · ${runs} run(s) per target, times are medians · Node ${process.version} · ${process.platform}\n`,
  );
  console.log(report(results, phases));
  if (
    results.some(({ runs: targetRuns }) =>
      phases.some(
        (phase) =>
          (summarizePhase(targetRuns, phase)?.failedConnections ?? 0) > 0,
      ),
    )
  ) {
    console.log(
      "\nFailed connections ended in a network error, so their phase's bytes and time include whatever retried them.",
    );
  }
  if (results.some(({ target }) => target.source !== "registry")) {
    console.log(
      "\nLocal, .tgz, and tarball-URL targets skip the package's own registry metadata in the install phase, and local and .tgz ones its tarball too, so install is compared only between targets from the same source.",
    );
  }
  console.log(`\nResults: ${outFile}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
