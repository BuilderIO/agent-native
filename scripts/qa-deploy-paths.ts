#!/usr/bin/env tsx
/**
 * Proves one documented standalone deploy path end to end: scaffold a Chat
 * app, install, migrate a real Postgres, build, run it the way the guide says,
 * then sign up, call the `hello` action, and confirm the account landed in
 * Postgres and survived a restart. The Netlify path also waits for its signed
 * scheduled wake to update scheduler health in the throwaway database, and
 * local-source runs verify durable AgentHarness recovery through that sweep.
 *
 *   pnpm qa:deploy-paths --target node|docker|netlify|vercel|presets
 *     [--source local|npm] [--exercise-chat-durability]
 *
 * `node` and `docker` run the app here. `netlify` and `vercel` deploy it to a
 * real project on that host and run the same checks against its address.
 * `presets` is the cheap one: it builds the Netlify and Vercel output and checks
 * the files each host's deploy command looks for, without deploying.
 *
 * `--source local` (the default) installs the packages from this checkout, so
 * the check can fail before anything is published. `--source npm` runs the
 * guide's own `npx @agent-native/core@<tag> create`, so the check proves what
 * readers get from npm.
 *
 * The database comes from `--admin-database-url` (or DEPLOY_CHECK_DATABASE_URL),
 * a Postgres server the check creates one throwaway database on. Without it the
 * check starts a Postgres container, which only the targets that run the app
 * here can reach. Every resource registers its cleanup the moment it exists,
 * and a cleanup that fails fails the run: a leaked database, container or
 * host secret is a failure, never a footnote. A host project is created once
 * and reused by every later run, which links to it, overwrites its variables
 * and removes them again, because the credential that runs the check may not be
 * allowed to delete a project.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  baseEnv,
  dropDatabase,
  fetchWithTimeout,
  findNetlifySite,
  makeNetlifySitePublic,
  netlifyCliArgs,
  netlifyEnv,
  repoRoot,
  runQuiet,
  vercelCliArgs,
  vercelEnv,
  withSql,
} from "./qa-deploy-paths-cloud";
import {
  assertDocContract,
  captureDeployReadyBaseline,
  containerReachableDatabaseUrl,
  databaseUrlFor,
  DEPLOY_DOC_CONTRACTS,
  DEPLOY_TARGETS,
  deployDatabaseName,
  deployProjectName,
  deployProjectSlot,
  diagnosticStageName,
  dockerfileBaseImages,
  extractFencedBlock,
  findFileUrls,
  isVercelEnvVarAbsent,
  observeDeployMarkerResponse,
  PRESET_SHAPES,
  redactSecrets,
  routeFailureEvidenceSummary,
  schedulerCheckIsAfter,
  secretsInUrl,
  VENDOR_DIR,
  vendorDockerfile,
  vendorSpecifier,
  type DatabaseTarget,
  type DeployTarget,
} from "./qa-deploy-paths-lib";

type Source = "local" | "npm";

const APP_NAME = "my-app";
const INSTALL_TIMEOUT_MS = 10 * 60_000;
const BUILD_TIMEOUT_MS = 10 * 60_000;
const DOCKER_BUILD_TIMEOUT_MS = 20 * 60_000;
const READY_TIMEOUT_MS = 3 * 60_000;
const SCHEDULER_WAKE_TIMEOUT_MS = 5 * 60_000;
const PASSWORD = `Dp-${randomBytes(12).toString("hex")}`;

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    target: { type: "string" },
    source: { type: "string", default: "local" },
    "npm-tag": { type: "string", default: "latest" },
    "admin-database-url": { type: "string" },
    "netlify-account-slug": { type: "string" },
    "vercel-scope": { type: "string" },
    keep: { type: "boolean", default: false },
    "exercise-chat-durability": { type: "boolean", default: false },
  },
});

const target = values.target as DeployTarget;
const source = values.source as Source;
const npmTag = values["npm-tag"] as string;
const adminDatabaseUrlArg =
  values["admin-database-url"] ?? process.env.DEPLOY_CHECK_DATABASE_URL;
const netlifyAccountSlug = values["netlify-account-slug"];
const vercelScope = values["vercel-scope"];
const keep = values.keep === true;
const exerciseChatDurability = values["exercise-chat-durability"] === true;

if (!DEPLOY_TARGETS.includes(target)) {
  console.error(`--target must be one of: ${DEPLOY_TARGETS.join(", ")}`);
  process.exit(2);
}
if (source !== "local" && source !== "npm") {
  console.error("--source must be local or npm");
  process.exit(2);
}
if (exerciseChatDurability && (target !== "netlify" || source !== "local")) {
  console.error(
    "--exercise-chat-durability requires --target netlify and --source local",
  );
  process.exit(2);
}
const e2eOpenAiApiKey = process.env.BETA_E2E_OPENAI_API_KEY?.trim();
if (exerciseChatDurability && !e2eOpenAiApiKey) {
  console.error("--exercise-chat-durability requires BETA_E2E_OPENAI_API_KEY");
  process.exit(2);
}

const tag = `[deploy-paths:${target}:${source}]`;

// Values that must never reach a log: the database password, the auth secret,
// the sign-up password. `::add-mask::` makes the Actions log hide them even
// where this script does not print them itself.
const secretValues = new Set<string>();

function registerSecrets(...candidates: string[]): void {
  for (const candidate of candidates) {
    if (candidate.length < 8 || secretValues.has(candidate)) continue;
    secretValues.add(candidate);
    if (process.env.GITHUB_ACTIONS === "true") {
      console.log(`::add-mask::${candidate}`);
    }
  }
}

const redact = (text: string) => redactSecrets(text, secretValues);
const log = (message: string) => console.log(redact(`${tag} ${message}`));
const warn = (message: string) => console.error(redact(`${tag} ${message}`));

registerSecrets(PASSWORD);
if (adminDatabaseUrlArg) registerSecrets(...secretsInUrl(adminDatabaseUrlArg));
for (const name of ["NETLIFY_AUTH_TOKEN", "VERCEL_TOKEN"]) {
  const token = process.env[name];
  if (token) registerSecrets(token);
}
if (e2eOpenAiApiKey) registerSecrets(e2eOpenAiApiKey);

interface StepResult {
  name: string;
  ms: number;
  status: "passed" | "failed";
}

const steps: StepResult[] = [];

let interruptedBy: NodeJS.Signals | null = null;

// Checked wherever the run starts work. A cancellation can arrive between two
// commands, and anything the run started after the stop snapshot would outlive
// cleanup: commands run detached, so exiting does not take them along.
function assertNotInterrupted(): void {
  if (interruptedBy) throw new Error(`interrupted by ${interruptedBy}`);
}

async function step<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
  assertNotInterrupted();
  const started = Date.now();
  log(`▶ ${name}`);
  try {
    const result = await fn();
    steps.push({ name, ms: Date.now() - started, status: "passed" });
    return result;
  } catch (error) {
    steps.push({ name, ms: Date.now() - started, status: "failed" });
    throw error;
  }
}

const cleanups: Array<{ label: string; run: () => Promise<void> | void }> = [];

// Registered next to the line that creates the resource, so a failure between
// two creations never strands the first one.
function onCleanup(label: string, run: () => Promise<void> | void): void {
  cleanups.push({ label, run });
}

// One drain serves every caller. A cancellation and the run it interrupts both
// finish by cleaning up, and the second must wait for the first: returning
// early would let the process exit with a cleanup still in flight.
let cleanupRun: Promise<string[]> | undefined;

function runCleanups(): Promise<string[]> {
  return (cleanupRun ??= drainCleanups());
}

async function drainCleanups(): Promise<string[]> {
  const failures: string[] = [];
  while (cleanups.length > 0) {
    const { label, run } = cleanups.pop()!;
    try {
      await run();
      log(`cleaned up: ${label}`);
    } catch (error) {
      failures.push(`${label}: ${errorMessage(error)}`);
    }
  }
  return failures;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Commands and the server run in their own process group because `pnpm`, `npx`
// and `docker` leave descendants that keep the output pipes open: signalling
// only the direct child would leave `close` unfired and cleanup unreached.
function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    // ESRCH is the group having already exited; anything else means a process
    // may still be running.
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      warn(
        `could not signal process group ${child.pid}: ${errorMessage(error)}`,
      );
    }
  }
}

// Commands still running, so a cancellation can end them before cleanup runs:
// an in-flight create or deploy would otherwise recreate what cleanup deleted.
const activeRuns = new Set<ChildProcess>();

async function waitUpTo(ms: number, work: Promise<unknown>): Promise<void> {
  let giveUp: NodeJS.Timeout | undefined;
  await Promise.race([
    work,
    new Promise<void>((resolve) => {
      giveUp = setTimeout(resolve, ms);
    }),
  ]);
  clearTimeout(giveUp);
}

// GitHub Actions ends a cancelled step about ten seconds after the first signal
// (SIGTERM at 7.5 s, SIGKILL 2.5 s later), so everything a cancellation waits
// for before cleanup shares this one deadline and leaves the rest to cleanup.
const INTERRUPT_WAIT_MS = 3_000;

async function stopActiveRuns(): Promise<void> {
  const running = [...activeRuns];
  const closed = Promise.all(
    running.map(
      (child) =>
        new Promise<void>((resolve) => child.once("close", () => resolve())),
    ),
  );
  for (const child of running) killGroup(child, "SIGTERM");
  const killer = setTimeout(() => {
    for (const child of running) killGroup(child, "SIGKILL");
  }, 1_500);
  await closed;
  clearTimeout(killer);
}

// Creations that run in this process rather than in a child, so a cancellation
// can wait for them: a DROP that runs before a CREATE has landed is a no-op,
// and the database would outlive the cleanup.
const creations = new Set<Promise<unknown>>();

function tracked<T>(creation: Promise<T>): Promise<T> {
  creations.add(creation);
  const forget = () => creations.delete(creation);
  creation.then(forget, forget);
  return creation;
}

interface RunOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  label: string;
  /** Written to the command's stdin, for a secret the guide pipes in. */
  input?: string;
}

async function runLive(
  cmd: string,
  args: string[],
  options: RunOptions,
): Promise<string> {
  assertNotInterrupted();
  log(`${options.label}: ${cmd} ${args.join(" ")}`);
  const child = spawn(cmd, args, {
    cwd: options.cwd,
    env: options.env ?? baseEnv(),
    detached: true,
    stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  activeRuns.add(child);
  child.once("close", () => activeRuns.delete(child));
  const output: string[] = [];
  const append = (chunk: Buffer | string) => {
    const text = redact(chunk.toString());
    output.push(text);
    if (output.length > 400) output.shift();
    process.stdout.write(text);
  };
  if (options.input !== undefined) {
    // A command that exits before it reads its input reports that through its
    // exit code; the write error only needs to be on the record.
    child.stdin!.once("error", (error) =>
      append(`stdin: ${errorMessage(error)}\n`),
    );
    child.stdin!.end(options.input);
  }
  child.stdout!.on("data", append);
  child.stderr!.on("data", append);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    killGroup(child, "SIGTERM");
    setTimeout(() => killGroup(child, "SIGKILL"), 5_000).unref();
  }, options.timeoutMs);
  try {
    const result = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    if (timedOut) {
      throw new Error(`${options.label} exceeded ${options.timeoutMs}ms.`);
    }
    if (result.code !== 0) {
      throw new Error(
        `${options.label} failed with exit ${String(result.code)} (${String(result.signal)}).`,
      );
    }
    return output.join("");
  } finally {
    clearTimeout(timeout);
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(
  label: string,
  timeoutMs: number,
  probe: () => Promise<boolean>,
  abortReason: () => string | null = () => null,
  timeoutContext: () => string | null = () => null,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    // Outside the try below: a process that has already died must fail the
    // wait now, not be retried until the timeout.
    const reason = abortReason();
    if (reason) throw new Error(`While waiting for ${label}: ${reason}`);
    try {
      if (await probe()) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(1_000);
  }
  const context = timeoutContext();
  const diagnostics = [
    ...(lastError ? [`last error: ${errorMessage(lastError)}`] : []),
    ...(context ? [context] : []),
  ];
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for ${label}${
      diagnostics.length ? ` (${diagnostics.join("; ")})` : ""
    }.`,
  );
}

async function startLocalPostgres(): Promise<string> {
  const port = await freePort();
  const container = `an-deploy-paths-pg-${randomBytes(3).toString("hex")}`;
  const password = randomBytes(12).toString("hex");
  runQuiet("docker", [
    "run",
    "-d",
    "--name",
    container,
    "-p",
    `${port}:5432`,
    "-e",
    `POSTGRES_PASSWORD=${password}`,
    "postgres:17-alpine",
  ]);
  onCleanup(`postgres container ${container}`, () => {
    runQuiet("docker", ["rm", "-f", container]);
  });
  const url = new URL(`postgres://127.0.0.1:${port}/postgres`);
  url.username = "postgres";
  url.password = password;
  registerSecrets(...secretsInUrl(url.toString()));
  await waitFor("the Postgres container", 90_000, () =>
    withSql(
      url.toString(),
      async (sql) => (await sql`select 1 as ok`).length === 1,
    ),
  );
  return url.toString();
}

async function createDatabase(
  adminUrl: string,
  forTarget: DatabaseTarget,
): Promise<string> {
  const name = deployDatabaseName(
    forTarget,
    Date.now(),
    randomBytes(3).toString("hex"),
  );
  // Registered before the CREATE: DROP IF EXISTS is harmless when the CREATE
  // never landed, and a CREATE that landed but errored on the way back is
  // still cleaned up.
  onCleanup(`database ${name}`, () => dropDatabase(adminUrl, name));
  await tracked(
    withSql(adminUrl, (sql) => sql.unsafe(`CREATE DATABASE "${name}"`)),
  );
  const url = databaseUrlFor(adminUrl, name);
  registerSecrets(...secretsInUrl(url));
  return url;
}

function corepackEnv(workDir: string): NodeJS.ProcessEnv {
  const binDir = path.join(workDir, "corepack-bin");
  return {
    ...baseEnv(),
    PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
  };
}

async function scaffoldApp(workDir: string): Promise<void> {
  if (source === "npm") {
    await runLive(
      "npx",
      [
        "--yes",
        `@agent-native/core@${npmTag}`,
        "create",
        APP_NAME,
        "--standalone",
        "--template",
        "chat",
      ],
      { cwd: workDir, timeoutMs: INSTALL_TIMEOUT_MS, label: "create" },
    );
    return;
  }
  const cli = path.join(repoRoot, "packages/core/dist/cli/index.js");
  assert.ok(
    fs.existsSync(cli),
    `Missing ${cli}. Run pnpm --filter @agent-native/core build first.`,
  );
  await runLive(
    "node",
    [cli, "create", APP_NAME, "--standalone", "--template", "chat"],
    {
      cwd: workDir,
      env: { ...baseEnv(), AGENT_NATIVE_CREATE_USE_LOCAL_CORE: "1" },
      timeoutMs: INSTALL_TIMEOUT_MS,
      label: "create",
    },
  );
}

// A local-source scaffold points at tarballs in the OS temp directory. Copy
// them into the app so the same app installs on the host and inside the
// Docker build context.
function vendorLocalPackages(appDir: string): void {
  const files = ["package.json", "pnpm-workspace.yaml"].map((name) =>
    path.join(appDir, name),
  );
  const texts = files.map((file) => fs.readFileSync(file, "utf8"));
  const urls = [...new Set(texts.flatMap(findFileUrls))];
  assert.ok(
    urls.length > 0,
    "A local-source scaffold should reference local packages through file: URLs.",
  );
  const vendorDir = path.join(appDir, VENDOR_DIR);
  fs.mkdirSync(vendorDir, { recursive: true });
  const replacements = new Map<string, string>();
  for (const url of urls) {
    const from = fileURLToPath(url);
    const basename = path.basename(from);
    assert.ok(fs.existsSync(from), `${url} does not exist on disk.`);
    const to = path.join(vendorDir, basename);
    if (fs.statSync(from).isDirectory()) {
      fs.cpSync(from, to, {
        recursive: true,
        filter: (entry) =>
          !/(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(
            path.relative(from, entry),
          ),
      });
    } else {
      fs.copyFileSync(from, to);
    }
    replacements.set(url, vendorSpecifier(basename));
  }
  files.forEach((file, index) => {
    let text = texts[index]!;
    for (const [url, specifier] of replacements) {
      text = text.split(url).join(specifier);
    }
    fs.writeFileSync(file, text);
  });
  log(`vendored ${replacements.size} local package(s) into ${VENDOR_DIR}/`);
}

async function pullWithRetry(image: string, cwd: string): Promise<void> {
  const attempts = 3;
  for (let attempt = 1; ; attempt++) {
    try {
      await runLive("docker", ["pull", image], {
        cwd,
        timeoutMs: 5 * 60_000,
        label: `pull ${image} (attempt ${attempt}/${attempts})`,
      });
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      await sleep(attempt * 10_000);
    }
  }
}

interface RunningApp {
  baseUrl: string;
  /** First time the host served this run's unique deploy marker. */
  deployedAt?: number;
  /** Absent where the host gives the check no restart to perform. */
  restart?(): Promise<void>;
  logs(): string;
}

async function waitForReady(
  baseUrl: string,
  exited: () => string | null,
  logs: () => string,
): Promise<void> {
  try {
    await waitFor(
      "the app to answer /_agent-native/ping",
      READY_TIMEOUT_MS,
      async () =>
        (await fetchWithTimeout(`${baseUrl}/_agent-native/ping`)).status ===
        200,
      exited,
    );
  } catch (error) {
    warn(`app logs:\n${logs()}`);
    throw error;
  }
}

// A reused project still serves the previous run's deploy at its address until
// the host moves the address to the new one, and that old deploy points at a
// database the previous run already dropped. Any answer from the address would
// pass for the new deploy, so each deploy carries a file only it contains, and
// the check waits for the address to serve that file. It goes in the app's
// `public` folder before any build, because every build copies that folder into
// what the host serves, including the rebuild the Netlify CLI runs on deploy.
// One answer is not enough: a host moves its address to the new deploy over a
// few seconds and answers from either deploy meanwhile (measured on Vercel with
// a warm previous deploy: the old one still answered up to 3 s after the deploy
// command returned, between answers from the new one), so the file has to be
// served this many times in a row.
const DEPLOY_SETTLE_HITS = 10;
interface DeployMarker {
  urlPath: string;
  nonce: string;
}

function addDeployMarker(appDir: string): DeployMarker {
  const nonce = randomBytes(8).toString("hex");
  const urlPath = `/an-deploy-check-${nonce}.txt`;
  fs.writeFileSync(path.join(appDir, "public", urlPath), nonce);
  return { urlPath, nonce };
}

async function waitForNewDeploy(
  baseUrl: string,
  marker: DeployMarker,
  logs: () => string,
): Promise<number> {
  return captureDeployReadyBaseline(
    async () => {
      let observation = { consecutiveHits: 0 };
      await waitFor(
        "the new deploy to answer at its address",
        READY_TIMEOUT_MS,
        async () => {
          const response = await fetchWithTimeout(
            `${baseUrl}${marker.urlPath}`,
          );
          const isNewDeploy =
            response.status === 200 && (await response.text()) === marker.nonce;
          observation = observeDeployMarkerResponse(observation, isNewDeploy);
          return observation.consecutiveHits >= DEPLOY_SETTLE_HITS;
        },
      );
    },
    () => waitForReady(baseUrl, () => null, logs),
  );
}

async function startNodeServer(
  appDir: string,
  env: NodeJS.ProcessEnv,
): Promise<RunningApp> {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let child: ChildProcess | undefined;
  let closed = true;
  let exitMessage: string | null = null;
  const output: string[] = [];

  const launch = () => {
    assertNotInterrupted();
    exitMessage = null;
    closed = false;
    const next = spawn("pnpm", ["start"], {
      cwd: appDir,
      env: { ...env, NODE_ENV: "production", PORT: String(port) },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const append = (chunk: Buffer | string) => {
      output.push(chunk.toString());
      if (output.length > 400) output.shift();
    };
    next.stdout!.on("data", append);
    next.stderr!.on("data", append);
    next.once("exit", (code, signal) => {
      exitMessage = `The server exited early (code ${String(code)}, signal ${String(signal)}).`;
    });
    next.once("close", () => {
      closed = true;
    });
    child = next;
  };

  // Waits for `close`, not `exit`: a server killed by a signal has an
  // `exitCode` of null, and descendants can outlive it holding the pipes, so
  // the group is signalled until `close` has actually fired.
  const stop = async () => {
    const running = child;
    if (!running?.pid || closed) return;
    const closing = new Promise<void>((resolve) =>
      running.once("close", () => resolve()),
    );
    killGroup(running, "SIGTERM");
    const killer = setTimeout(() => killGroup(running, "SIGKILL"), 10_000);
    await closing;
    clearTimeout(killer);
  };

  const logs = () => output.join("");
  launch();
  onCleanup("node server process group", stop);
  await waitForReady(baseUrl, () => exitMessage, logs);
  return {
    baseUrl,
    logs,
    restart: async () => {
      await stop();
      launch();
      await waitForReady(baseUrl, () => exitMessage, logs);
    },
  };
}

async function startContainer(
  appDir: string,
  image: string,
  env: NodeJS.ProcessEnv,
): Promise<RunningApp> {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const container = `an-deploy-paths-app-${randomBytes(3).toString("hex")}`;
  // The guide runs with `--rm`; keeping the container lets a failure read its
  // logs. `-e NAME` copies the value from `env`, as in the guide, and
  // `host.docker.internal` reaches the host's database on Linux too.
  runQuiet(
    "docker",
    [
      "run",
      "-d",
      "--name",
      container,
      "-p",
      `${port}:3000`,
      "--add-host=host.docker.internal:host-gateway",
      "-e",
      "DATABASE_URL",
      "-e",
      "BETTER_AUTH_SECRET",
      image,
    ],
    { cwd: appDir, env },
  );
  onCleanup(`app container ${container}`, () => {
    runQuiet("docker", ["rm", "-f", container]);
  });
  const exited = () => {
    const state = runQuiet("docker", [
      "inspect",
      "--format",
      "{{.State.Status}}",
      container,
    ]).trim();
    return state === "running" ? null : `The container is ${state}.`;
  };
  const logs = () => {
    try {
      return runQuiet("docker", ["logs", "--tail", "400", container]);
    } catch (error) {
      return `could not read container logs: ${errorMessage(error)}`;
    }
  };
  await waitForReady(baseUrl, exited, logs);
  return {
    baseUrl,
    logs,
    restart: async () => {
      runQuiet("docker", ["restart", container]);
      await waitForReady(baseUrl, exited, logs);
    },
  };
}

function assertPresetShape(
  appDir: string,
  preset: keyof typeof PRESET_SHAPES,
): void {
  const missing = PRESET_SHAPES[preset].files.filter(
    (file) => !fs.existsSync(path.join(appDir, file)),
  );
  assert.equal(
    missing.length,
    0,
    `The ${preset} build exited 0 but did not leave what the ${preset} deploy command looks for: ${missing.join(", ")}`,
  );
}

interface Session {
  cookie: string;
  storageState: {
    cookies: Array<{
      name: string;
      value: string;
      domain: string;
      path: string;
      expires: number;
      httpOnly: boolean;
      secure: boolean;
      sameSite: "Strict" | "Lax" | "None";
    }>;
    origins: [];
  };
}

function sessionFrom(response: Response, baseUrl: string): Session {
  const host = new URL(baseUrl).hostname;
  const cookies: Session["storageState"]["cookies"] = response.headers
    .getSetCookie()
    .flatMap((entry) => {
      const [pair, ...rawAttributes] = entry
        .split(";")
        .map((part) => part.trim());
      if (!pair) return [];
      const separator = pair.indexOf("=");
      if (separator < 1) return [];
      const attributes = new Map<string, string>(
        rawAttributes.map((attribute) => {
          const index = attribute.indexOf("=");
          return index < 0
            ? ([attribute.toLowerCase(), ""] as const)
            : ([
                attribute.slice(0, index).toLowerCase(),
                attribute.slice(index + 1),
              ] as const);
        }),
      );
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      const rawSameSite = attributes.get("samesite")?.toLowerCase();
      const sameSite: Session["storageState"]["cookies"][number]["sameSite"] =
        rawSameSite === "strict"
          ? "Strict"
          : rawSameSite === "none"
            ? "None"
            : "Lax";
      const maxAge = Number(attributes.get("max-age"));
      const expiresAt = attributes.get("expires");
      const expires = Number.isFinite(maxAge)
        ? Math.floor(Date.now() / 1000) + maxAge
        : expiresAt
          ? Math.floor(Date.parse(expiresAt) / 1000)
          : -1;
      return [
        {
          name,
          value,
          domain: attributes.get("domain") || host,
          path: attributes.get("path") || "/",
          expires,
          httpOnly: attributes.has("httponly"),
          secure: attributes.has("secure"),
          sameSite,
        },
      ];
    })
    .filter((cookie) => cookie.value.length > 0);
  const cookie = cookies
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
  assert.ok(
    cookie.includes("session_token="),
    "The auth response should set a session cookie.",
  );
  for (const { name, value } of cookies) registerSecrets(`${name}=${value}`);
  return { cookie, storageState: { cookies, origins: [] } };
}

async function authenticate(
  baseUrl: string,
  action: "sign-up" | "sign-in",
  email: string,
): Promise<Session> {
  const response = await fetchWithTimeout(
    `${baseUrl}/_agent-native/auth/ba/${action}/email`,
    {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl },
      body: JSON.stringify(
        action === "sign-up"
          ? { name: "Deploy Check", email, password: PASSWORD }
          : { email, password: PASSWORD },
      ),
    },
  );
  const body = await response.text();
  assert.equal(response.status, 200, `${action} failed: ${body}`);
  return sessionFrom(response, baseUrl);
}

async function callHello(baseUrl: string, session: Session): Promise<void> {
  const response = await fetchWithTimeout(
    `${baseUrl}/_agent-native/actions/hello?name=deploy-paths`,
    { headers: { cookie: session.cookie } },
  );
  const body = await response.text();
  assert.equal(response.status, 200, `hello failed: ${body}`);
  assert.deepEqual(JSON.parse(body), { message: "Hello, deploy-paths!" });
}

async function exerciseDisposableChatReliability(
  app: RunningApp,
  workDir: string,
  email: string,
  session: Session,
): Promise<void> {
  assert.ok(
    e2eOpenAiApiKey,
    "The isolated Chat proof needs its dedicated key.",
  );
  const stateDir = path.join(workDir, "disposable-chat-e2e");
  const authStateDir = path.join(stateDir, "auth-state");
  const storageStateFile = path.join(stateDir, "signup-session.json");
  const reportSlot = `deploy-paths-${process.pid}-${randomBytes(3).toString("hex")}`;
  const outputDir = path.join(
    repoRoot,
    "e2e",
    "beta",
    "test-results",
    reportSlot,
  );
  const reportDir = path.join(
    repoRoot,
    "e2e",
    "beta",
    "playwright-report",
    reportSlot,
  );
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(storageStateFile, JSON.stringify(session.storageState));

  try {
    await runLive(
      "pnpm",
      [
        "e2e:beta",
        "--project=chat",
        "--grep",
        "a direct busy POST retains its reference attachment across reload|Stop returns the composer to idle and the thread still works|refresh mid-run restores the complete answer",
      ],
      {
        cwd: repoRoot,
        env: {
          ...baseEnv(),
          CI: "true",
          BETA_E2E_APPS: "chat",
          BETA_E2E_AUTHED: "1",
          BETA_E2E_CLUSTER: "chat",
          BETA_E2E_EMAIL: email,
          BETA_E2E_SESSION_TOKENS: "",
          BETA_E2E_SESSION_TOKEN_CHAT: "",
          BETA_E2E_STORAGE_STATE: "",
          BETA_E2E_STORAGE_STATE_FILE: storageStateFile,
          BETA_E2E_AUTH_STATE_DIR: authStateDir,
          BETA_E2E_DISPOSABLE_CHAT_ORIGIN: app.baseUrl,
          BETA_E2E_OPENAI_API_KEY: e2eOpenAiApiKey,
          BETA_E2E_ALLOW_SHARED_KEY: "",
          BETA_E2E_SHARED_OPENAI_API_KEY: "",
          BETA_E2E_GLOBAL_TIMEOUT_MINUTES: "20",
          BETA_E2E_REPORT_SLOT: reportSlot,
        },
        timeoutMs: 21 * 60_000,
        label: "isolated authenticated Chat durability specs",
      },
    );
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });
    fs.rmSync(reportDir, { recursive: true, force: true });
  }
}

async function exerciseApp(
  app: RunningApp,
  appDir: string,
  databaseUrl: string,
): Promise<void> {
  const email = exerciseChatDurability
    ? `deploy-paths+autoz-${randomBytes(4).toString("hex")}@example.com`
    : `deploy-paths-${randomBytes(4).toString("hex")}@example.com`;

  await step("the server reports no missing deploy settings", async () => {
    const response = await fetchWithTimeout(
      `${app.baseUrl}/_agent-native/ping?configuration=1`,
    );
    const text = await response.text();
    assert.equal(
      response.status,
      200,
      `The configuration probe answered ${response.status}: ${text.slice(0, 300)}`,
    );
    let body: { configuration?: { ok?: boolean; issues?: unknown[] } };
    try {
      body = JSON.parse(text);
    } catch (error) {
      throw new Error(
        `The configuration probe did not return JSON (${errorMessage(error)}): ${text.slice(0, 300)}`,
      );
    }
    assert.equal(
      body.configuration?.ok,
      true,
      `The configuration probe reported a problem: ${JSON.stringify(body.configuration)}`,
    );
    assert.deepEqual(body.configuration?.issues, []);
  });

  const session = await step("sign up", () =>
    authenticate(app.baseUrl, "sign-up", email),
  );

  await step("call the hello action as the signed-up user", () =>
    callHello(app.baseUrl, session),
  );

  await step(
    "the account lives in Postgres, not a local database",
    async () => {
      await withSql(databaseUrl, async (sql) => {
        const rows = await sql`select email from "user" where email = ${email}`;
        assert.equal(rows.length, 1, `No "user" row for ${email} in Postgres.`);
      });
      assert.equal(
        fs.existsSync(path.join(appDir, "data")),
        false,
        "The app created a local database directory (data/) instead of using DATABASE_URL.",
      );
    },
  );

  await step(
    app.restart
      ? "restart, then sign in with the same account"
      : "sign in again with the same account",
    async () => {
      await app.restart?.();
      const again = await authenticate(app.baseUrl, "sign-in", email);
      await callHello(app.baseUrl, again);
    },
  );

  if (target === "netlify") {
    const deployedAt = app.deployedAt;
    assert.ok(
      deployedAt !== undefined,
      "The Netlify app must include the time its unique deploy marker was observed.",
    );
    await step("a signed Netlify scheduled tick reaches the scheduler", () =>
      withSql(databaseUrl, (sql) =>
        waitFor(
          "automation_scheduler_health to record a check after this deploy",
          SCHEDULER_WAKE_TIMEOUT_MS,
          async () => {
            const rows = await sql`
              select last_checked_at
              from automation_scheduler_health
              where runtime = 'recurring-jobs'
                and last_checked_at is not null
              order by last_checked_at desc
              limit 1
            `;
            return rows.some((row) =>
              schedulerCheckIsAfter(row.last_checked_at, deployedAt),
            );
          },
        ),
      ),
    );

    if (source === "local") {
      await step(
        "a signed Netlify scheduled tick recovers an expired AgentHarness follow-up",
        () => exerciseScheduledAgentHarnessRecovery(databaseUrl),
      );
    }

    if (exerciseChatDurability) {
      await step(
        "authenticated busy Chat POST retains its reference attachment through reload",
        () =>
          exerciseDisposableChatReliability(
            app,
            path.dirname(appDir),
            email,
            session,
          ),
      );
      await step(
        "a signed Netlify scheduled tick completes one stale Chat continuation",
        () => exerciseScheduledStaleChatContinuation(databaseUrl, email),
      );
    }
  }
}

async function exerciseScheduledAgentHarnessRecovery(
  databaseUrl: string,
): Promise<void> {
  const [
    {
      claimAgentHarnessSessionFollowUp,
      getAgentHarnessSession,
      listAgentHarnessSessionEvents,
      saveAgentHarnessSession,
    },
    { createDbExec, withDbExec },
  ] = await Promise.all([
    import("../packages/core/src/agent/harness/store.js"),
    import("../packages/core/src/db/client.js"),
  ]);
  const sessionId = "qa-deploy-paths-scheduled-recovery";
  const followUpId = `${sessionId}:follow-up`;
  const claimId = `${sessionId}:claim`;
  const db = await createDbExec({ url: databaseUrl });

  try {
    const { claimed, previousSchedulerCheck } = await withDbExec(
      db,
      async () => {
        const session = await saveAgentHarnessSession({
          id: sessionId,
          harnessName: "qa-deploy-paths-scheduler-recovery",
          threadId: `${sessionId}:thread`,
        });
        assert.equal(
          session.generation,
          1,
          "The scheduled recovery fixture must start in a fresh database.",
        );
        assert.equal(session.status, "idle");

        const claimed = await claimAgentHarnessSessionFollowUp(
          sessionId,
          session.generation,
          claimId,
          {
            followUpId,
            prompt: "Recover this undispatched deployment-path follow-up.",
            metadata: { source: "qa-deploy-paths" },
            claimLeaseMs: 15_000,
            deadlineDurationMs: 30 * 60_000,
          },
        );
        assert.ok(claimed, "The scheduled recovery fixture must be claimed.");
        assert.equal(claimed.followUpDispatchedAt, null);

        const health = await db.execute({
          sql: `SELECT last_checked_at
                FROM automation_scheduler_health
                WHERE runtime = 'recurring-jobs' AND last_checked_at IS NOT NULL
                ORDER BY last_checked_at DESC
                LIMIT 1`,
        });
        const previousCheck = (
          health.rows[0] as { last_checked_at?: unknown } | undefined
        )?.last_checked_at;
        assert.notEqual(
          previousCheck,
          undefined,
          "The signed scheduler health check must exist before seeding recovery.",
        );
        assert.notEqual(previousCheck, null);
        const previousSchedulerCheck = Number(previousCheck);
        assert.ok(
          Number.isSafeInteger(previousSchedulerCheck),
          "The scheduler health check must be a safe integer timestamp.",
        );
        return { claimed, previousSchedulerCheck };
      },
    );
    assert.ok(
      claimed.followUpClaimExpiresAt !== null &&
        claimed.followUpClaimExpiresAt !== undefined,
      "The scheduled recovery fixture must have a short claim expiry.",
    );

    await waitFor(
      "the scheduled sweep to recover the expired AgentHarness follow-up",
      SCHEDULER_WAKE_TIMEOUT_MS,
      async () =>
        withDbExec(db, async () => {
          const health = await db.execute({
            sql: `SELECT last_checked_at
                  FROM automation_scheduler_health
                  WHERE runtime = 'recurring-jobs' AND last_checked_at IS NOT NULL
                  ORDER BY last_checked_at DESC
                  LIMIT 1`,
          });
          const tickAdvanced = health.rows.some((row) =>
            schedulerCheckIsAfter(
              (row as { last_checked_at?: unknown }).last_checked_at,
              previousSchedulerCheck,
            ),
          );
          if (!tickAdvanced) return false;

          const recovered = await getAgentHarnessSession(sessionId);
          return (
            recovered?.generation === claimed.generation + 1 &&
            recovered.status === "idle" &&
            recovered.followUpOutcome === "not_dispatched"
          );
        }),
    );

    await withDbExec(db, async () => {
      const recovered = await getAgentHarnessSession(sessionId);
      assert.ok(recovered, "The AgentHarness session must remain persisted.");
      assert.equal(recovered.status, "idle");
      assert.equal(recovered.followUpOutcome, "not_dispatched");
      assert.equal(recovered.followUpClaimId, null);
      assert.equal(recovered.followUpDispatchedAt, null);
      assert.equal(recovered.generation, claimed.generation + 1);

      const events = await listAgentHarnessSessionEvents(sessionId);
      assert.ok(
        events.some(
          ({ operationId, event }) =>
            operationId === `follow-up:${followUpId}` &&
            event.type === "error" &&
            event.errorCode === "harness_follow_up_not_dispatched",
        ),
        "The scheduled recovery must journal the not-dispatched outcome for this follow-up.",
      );
    });
  } finally {
    await db.close?.();
  }
}

async function exerciseScheduledStaleChatContinuation(
  databaseUrl: string,
  ownerEmail: string,
): Promise<void> {
  const [
    { createThread, deleteThread },
    {
      BACKGROUND_RUN_STALE_MS,
      claimBackgroundRun,
      claimTurnExecutionLease,
      insertRun,
      persistRunCheckpointEvent,
    },
    { withExecutionFence },
    { buildUserMessage },
    { createDbExec, withDbExec },
  ] = await Promise.all([
    import("../packages/core/src/chat-threads/store.js"),
    import("../packages/core/src/agent/run-store.js"),
    import("../packages/core/src/agent/execution-fence.js"),
    import("../packages/core/src/agent/thread-data-builder.js"),
    import("../packages/core/src/db/client.js"),
  ]);
  const nonce = randomBytes(6).toString("hex");
  const runId = `agent-durability-canary-${nonce}`;
  const threadId = `${runId}:thread`;
  const turnId = `${runId}:turn`;
  const marker = `durability-result-${nonce}`;
  const prompt = `Reply with exactly ${marker} and no other text.`;
  const db = await createDbExec({ url: databaseUrl });

  try {
    const previousSchedulerCheck = await withDbExec(db, async () => {
      const health = await db.execute({
        sql: `SELECT last_checked_at
              FROM automation_scheduler_health
              WHERE runtime = 'recurring-jobs' AND last_checked_at IS NOT NULL
              ORDER BY last_checked_at DESC
              LIMIT 1`,
      });
      const value = (
        health.rows[0] as { last_checked_at?: unknown } | undefined
      )?.last_checked_at;
      assert.notEqual(
        value,
        undefined,
        "A scheduler health check must precede the stale Chat canary.",
      );
      assert.notEqual(value, null);
      const checkedAt = Number(value);
      assert.ok(
        Number.isSafeInteger(checkedAt),
        "The previous scheduler check must be a safe integer timestamp.",
      );
      return checkedAt;
    });

    await withDbExec(db, async () => {
      const userMessage = buildUserMessage({ text: prompt, runId, turnId });
      const threadData = JSON.stringify({ messages: [userMessage] });
      await createThread(ownerEmail, {
        id: threadId,
        title: "Scheduled recovery canary",
        initialData: {
          threadData,
          preview: prompt,
          messageCount: 1,
        },
      });
      await insertRun(runId, threadId, turnId, {
        dispatchMode: "background",
        dispatchPayload: JSON.stringify({ message: prompt, threadId, turnId }),
        turnInitiator: {
          email: ownerEmail,
          orgScope: "personal",
          anonymous: false,
        },
      });
      assert.equal(
        await claimBackgroundRun(runId),
        true,
        "The stale Chat canary must be claimed before its worker is lost.",
      );
      const fence = await claimTurnExecutionLease(threadId, turnId, runId);
      await withExecutionFence(fence, () =>
        persistRunCheckpointEvent(
          runId,
          { type: "auto_continue", reason: "run_timeout" },
          "run_timeout",
        ),
      );
      const staleAt = Date.now() - BACKGROUND_RUN_STALE_MS - 5_000;
      const agedRun = await db.execute({
        sql: `UPDATE agent_runs
              SET started_at = ?, heartbeat_at = ?, last_progress_at = ?, in_flight_since = NULL
              WHERE id = ? AND status = 'running'`,
        args: [staleAt, staleAt, staleAt, runId],
      });
      assert.equal(
        agedRun.rowsAffected,
        1,
        "The stale Chat canary must remain running after its worker is lost.",
      );
      const expiredLease = await db.execute({
        sql: `UPDATE agent_execution_leases
              SET lease_expires_at = clock_timestamp() - INTERVAL '1 second'
              WHERE thread_id = ? AND turn_id = ? AND owner_run_id = ?`,
        args: [threadId, turnId, runId],
      });
      assert.equal(
        expiredLease.rowsAffected,
        1,
        "The stale Chat canary must not retain a live execution lease.",
      );
    });

    const observationStartedAt = Date.now();
    let terminalFailure: string | null = null;
    let observedRouteFailure: string | null = null;
    await waitFor(
      "the naturally scheduled sweep to complete exactly one stale Chat continuation",
      SCHEDULER_WAKE_TIMEOUT_MS,
      async () =>
        withDbExec(db, async () => {
          const runRows = await db.execute({
            sql: `SELECT id, status, terminal_reason, error_code, diag_stage, worker_stage,
                         dispatch_mode, continuation_order
                  FROM agent_runs
                  WHERE thread_id = ? AND COALESCE(turn_id, id) = ?
                  ORDER BY started_at, id`,
            args: [threadId, turnId],
          });
          if (runRows.rows.length >= 2) {
            const observedSuccessor = runRows.rows.find(
              (row) => (row as { id?: unknown }).id !== runId,
            ) as { diag_stage?: unknown } | undefined;
            observedRouteFailure ??= routeFailureEvidenceSummary(
              observedSuccessor?.diag_stage,
            );
          }

          const health = await db.execute({
            sql: `SELECT last_checked_at, last_error
                  FROM automation_scheduler_health
                  WHERE runtime = 'recurring-jobs' AND last_checked_at IS NOT NULL
                  ORDER BY last_checked_at DESC
                  LIMIT 1`,
          });
          const latestHealth = health.rows[0] as
            | { last_checked_at?: unknown; last_error?: unknown }
            | undefined;
          if (
            !schedulerCheckIsAfter(
              latestHealth?.last_checked_at,
              Math.max(previousSchedulerCheck, observationStartedAt),
            )
          ) {
            return false;
          }
          assert.equal(
            latestHealth?.last_error ?? null,
            null,
            "The scheduled recovery check must not record an error.",
          );

          if (runRows.rows.length < 2) return false;
          assert.equal(
            runRows.rows.length,
            2,
            "The stale Chat canary must have exactly one successor.",
          );
          const predecessor = runRows.rows.find(
            (row) => (row as { id?: unknown }).id === runId,
          ) as
            | {
                status?: unknown;
                terminal_reason?: unknown;
                error_code?: unknown;
                continuation_order?: unknown;
              }
            | undefined;
          const successor = runRows.rows.find(
            (row) => (row as { id?: unknown }).id !== runId,
          ) as
            | {
                id?: unknown;
                status?: unknown;
                terminal_reason?: unknown;
                error_code?: unknown;
                diag_stage?: unknown;
                worker_stage?: unknown;
                dispatch_mode?: unknown;
                continuation_order?: unknown;
              }
            | undefined;
          assert.ok(
            predecessor,
            "The stale predecessor must remain persisted.",
          );
          assert.ok(successor, "The recovered successor must be persisted.");
          if (successor.status === "running") return false;
          if (successor.status !== "completed") {
            terminalFailure = [
              `successor ended ${String(successor.status)}`,
              `errorCode=${String(successor.error_code ?? "unknown")}`,
              `terminalReason=${String(successor.terminal_reason ?? "unknown")}`,
              `diagStage=${diagnosticStageName(successor.diag_stage)}`,
              `workerStage=${diagnosticStageName(successor.worker_stage)}`,
              ...(observedRouteFailure ? [observedRouteFailure] : []),
            ].join(" ");
            return false;
          }
          assert.equal(predecessor.status, "truncated");
          assert.equal(predecessor.terminal_reason, "run_timeout");
          assert.ok(
            successor.dispatch_mode === "background" ||
              successor.dispatch_mode === "background-processing",
            "The recovered successor must use background dispatch.",
          );
          assert.ok(
            Number(successor.continuation_order) >
              Number(predecessor.continuation_order),
            "The successor must follow the stale run in continuation order.",
          );

          const eventRows = await db.execute({
            sql: `SELECT run_id, event_data
                  FROM agent_run_events
                  WHERE run_id IN (?, ?)
                  ORDER BY run_id, seq`,
            args: [runId, String(successor.id)],
          });
          const events = eventRows.rows.map((row) => {
            const value = (row as { event_data?: unknown }).event_data;
            const event = typeof value === "string" ? JSON.parse(value) : value;
            assert.ok(
              typeof event === "object" && event !== null,
              "A persisted canary run event must be readable.",
            );
            return {
              runId: String((row as { run_id?: unknown }).run_id),
              event: event as Record<string, unknown>,
            };
          });
          const predecessorCheckpoints = events.filter(
            ({ runId: eventRunId, event }) =>
              eventRunId === runId &&
              event.type === "auto_continue" &&
              event.reason === "run_timeout",
          );
          const successorTerminalEvents = events.filter(
            ({ runId: eventRunId, event }) =>
              eventRunId === successor?.id &&
              [
                "done",
                "error",
                "missing_api_key",
                "loop_limit",
                "auto_continue",
              ].includes(String(event.type)),
          );
          const successorText = events
            .filter(
              ({ runId: eventRunId, event }) =>
                eventRunId === successor?.id && event.type === "text",
            )
            .map(({ event }) =>
              typeof event.text === "string" ? event.text : "",
            )
            .join("");
          assert.equal(predecessorCheckpoints.length, 1);
          assert.equal(successorTerminalEvents.length, 1);
          assert.equal(
            successorText.split(marker).length - 1,
            1,
            "The recovered continuation must emit its marker exactly once.",
          );
          log(
            "scheduled Chat recovery: predecessor=truncated successor=completed successors=1 terminalEvents=1 markerOccurrences=1",
          );
          return true;
        }),
      () => terminalFailure,
      () => observedRouteFailure,
    );
  } finally {
    try {
      await withDbExec(db, async () => {
        await db.execute({
          sql: `UPDATE agent_runs
                SET status = 'truncated', completed_at = ?, terminal_reason = 'canary_cleanup'
                WHERE thread_id = ? AND COALESCE(turn_id, id) = ? AND status = 'running'`,
          args: [Date.now(), threadId, turnId],
        });
        await db.execute({
          sql: `DELETE FROM agent_run_events
                WHERE run_id IN (
                  SELECT id FROM agent_runs
                  WHERE thread_id = ? AND COALESCE(turn_id, id) = ?
                )`,
          args: [threadId, turnId],
        });
        await db.execute({
          sql: "DELETE FROM agent_execution_steps WHERE thread_id = ? AND turn_id = ?",
          args: [threadId, turnId],
        });
        await db.execute({
          sql: "DELETE FROM agent_tool_ledger WHERE thread_id = ?",
          args: [threadId],
        });
        await db.execute({
          sql: "DELETE FROM agent_execution_leases WHERE thread_id = ? AND turn_id = ?",
          args: [threadId, turnId],
        });
        await db.execute({
          sql: "DELETE FROM agent_turn_initiators WHERE thread_id = ? AND turn_id = ?",
          args: [threadId, turnId],
        });
        await db.execute({
          sql: "DELETE FROM agent_runs WHERE thread_id = ? AND COALESCE(turn_id, id) = ?",
          args: [threadId, turnId],
        });
        await deleteThread(threadId, ownerEmail);
      });
    } finally {
      await db.close?.();
    }
  }
}

async function prepareApp(
  workDir: string,
  appDir: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await step("create the app", () => scaffoldApp(workDir));
  if (source === "local") {
    await step("vendor the local packages", () => vendorLocalPackages(appDir));
  }
  await step("enable corepack and install", async () => {
    fs.mkdirSync(path.join(workDir, "corepack-bin"), { recursive: true });
    await runLive(
      "corepack",
      ["enable", "--install-directory", path.join(workDir, "corepack-bin")],
      { cwd: appDir, env, timeoutMs: 60_000, label: "corepack" },
    );
    await runLive("pnpm", ["install"], {
      cwd: appDir,
      env,
      timeoutMs: INSTALL_TIMEOUT_MS,
      label: "install",
    });
  });
}

async function provisionDatabase(forTarget: DatabaseTarget): Promise<string> {
  if (
    (forTarget === "netlify" || forTarget === "vercel") &&
    !adminDatabaseUrlArg
  ) {
    throw new Error(
      `The ${forTarget} target needs --admin-database-url (or DEPLOY_CHECK_DATABASE_URL): a Postgres server ${forTarget} can reach. A local container is not one.`,
    );
  }
  const adminUrl =
    adminDatabaseUrlArg ??
    (await step("start a Postgres container", startLocalPostgres));
  return step("create a throwaway database", () =>
    createDatabase(adminUrl, forTarget),
  );
}

async function buildPresets(
  appDir: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  for (const preset of ["netlify", "vercel"] as const) {
    await step(`build for ${preset} and check its output`, async () => {
      await runLive("pnpm", ["build"], {
        cwd: appDir,
        env: { ...env, NITRO_PRESET: preset },
        timeoutMs: BUILD_TIMEOUT_MS,
        label: `build (${preset})`,
      });
      assertPresetShape(appDir, preset);
    });
  }
}

// The guide's Step 3, against a project that is created once and reused. The
// first run creates the site as the guide says; later runs link to it. Either
// way the run overwrites its variables and removes them again, because the
// credential that runs the check may not be allowed to delete a site, and the
// database URL carries the CI role's password: it must not outlive the run. A
// cleanup is registered before each write, because a write the provider accepted
// but whose answer was lost, or whose command was cancelled, still has to be
// removed; `env:unset` of a variable that is not there succeeds, so registering
// first is safe. Netlify commands run in `netlifyEnv()`, the only environment
// that carries the Netlify token.
async function useNetlifySite(
  appDir: string,
  databaseUrl: string,
  authSecret: string,
  a2aSecret: string,
): Promise<string> {
  const name = deployProjectName("netlify", deployProjectSlot(source, npmTag));
  const netlify = (args: string[], label: string) =>
    runLive("npx", netlifyCliArgs(args), {
      cwd: appDir,
      env: netlifyEnv(),
      timeoutMs: 5 * 60_000,
      label,
    });
  const existing = await step("look for the Netlify site", () =>
    findNetlifySite(name, netlifyAccountSlug),
  );
  if (existing) {
    await step("link the existing Netlify site", () =>
      netlify(["link", "--id", existing.id], "netlify link"),
    );
  } else {
    await step("create the Netlify site", () =>
      netlify(
        [
          "sites:create",
          "--name",
          name,
          ...(netlifyAccountSlug ? ["--account-slug", netlifyAccountSlug] : []),
        ],
        "netlify sites:create",
      ),
    );
  }
  await step("make the site public", () => makeNetlifySitePublic(name));
  await step("save the secrets in the site's environment", async () => {
    for (const [key, value] of [
      ["DATABASE_URL", databaseUrl],
      ["BETTER_AUTH_SECRET", authSecret],
      ["A2A_SECRET", a2aSecret],
    ] as const) {
      onCleanup(`netlify ${key} on ${name}`, () => {
        runQuiet("npx", netlifyCliArgs(["env:unset", key, "--force"]), {
          cwd: appDir,
          env: netlifyEnv(),
        });
      });
      await netlify(["env:set", key, value], `netlify env:set ${key}`);
    }
  });
  return name;
}

const vercelScopeArgs = vercelScope ? ["--scope", vercelScope] : [];

// The guide's Step 3 for Vercel, reused the same way. `vercel link --yes`
// links the project when it exists and creates it when it does not. `--force`
// is the one flag the guide does not have: it overwrites a variable a run left
// behind, which `env add` otherwise refuses to do. The cleanup is registered
// before each write, as for Netlify, and treats only "variable not found" as
// already removed. The values go in on stdin,
// as the guide pipes them, so they never appear in a command line.
async function useVercelProject(
  appDir: string,
  databaseUrl: string,
  authSecret: string,
): Promise<string> {
  const name = deployProjectName("vercel", deployProjectSlot(source, npmTag));
  const vercel = (args: string[], label: string, input?: string) =>
    runLive("npx", vercelCliArgs([...args, ...vercelScopeArgs]), {
      cwd: appDir,
      env: vercelEnv(),
      timeoutMs: 5 * 60_000,
      label,
      input,
    });
  await step("link the Vercel project", () =>
    vercel(["link", "--yes", "--project", name], "vercel link"),
  );
  await step("save the secrets in the project's environment", async () => {
    for (const [key, value] of [
      ["DATABASE_URL", databaseUrl],
      ["BETTER_AUTH_SECRET", authSecret],
    ] as const) {
      onCleanup(`vercel ${key} on ${name}`, () => {
        try {
          runQuiet(
            "npx",
            vercelCliArgs([
              "env",
              "rm",
              key,
              "production",
              "--yes",
              ...vercelScopeArgs,
            ]),
            { cwd: appDir, env: vercelEnv() },
          );
        } catch (error) {
          const { stdout, stderr } = error as {
            stdout?: string;
            stderr?: string;
          };
          if (!isVercelEnvVarAbsent(`${stdout ?? ""}${stderr ?? ""}`)) {
            throw error;
          }
        }
      });
      await vercel(
        ["env", "add", key, "production", "--force"],
        `vercel env add ${key}`,
        value,
      );
    }
  });
  return name;
}

async function deployToNetlify(
  appDir: string,
  env: NodeJS.ProcessEnv,
  siteName: string,
): Promise<RunningApp> {
  const marker = addDeployMarker(appDir);
  await step("build for Netlify", () =>
    runLive("pnpm", ["build"], {
      cwd: appDir,
      env: { ...env, NITRO_PRESET: "netlify" },
      timeoutMs: BUILD_TIMEOUT_MS,
      label: "build",
    }),
  );
  await step("deploy to Netlify", () =>
    runLive(
      "npx",
      netlifyCliArgs([
        "deploy",
        "--prod",
        "--dir=dist",
        "--functions=.netlify/functions-internal",
      ]),
      {
        cwd: appDir,
        env: netlifyEnv(),
        timeoutMs: 15 * 60_000,
        label: "netlify deploy",
      },
    ),
  );
  // The guide says the site name becomes the address.
  const baseUrl = `https://${siteName}.netlify.app`;
  const logs = () =>
    `No server log is available from Netlify here; the site is ${baseUrl}.`;
  const deployedAt = await step("wait for the new deploy to answer", () =>
    waitForNewDeploy(baseUrl, marker, logs),
  );
  return { baseUrl, deployedAt, logs };
}

async function deployToVercel(
  appDir: string,
  env: NodeJS.ProcessEnv,
  projectName: string,
): Promise<RunningApp> {
  const marker = addDeployMarker(appDir);
  await step("build for Vercel", () =>
    runLive("pnpm", ["build"], {
      cwd: appDir,
      env: { ...env, NITRO_PRESET: "vercel" },
      timeoutMs: BUILD_TIMEOUT_MS,
      label: "build",
    }),
  );
  // Vercel aliases a production deploy at `<project>.vercel.app`. The check
  // reaches the app there, so a deploy that was aliased anywhere else fails
  // here instead of exercising an address that may belong to someone else.
  const baseUrl = `https://${projectName}.vercel.app`;
  await step("deploy to Vercel", async () => {
    const output = await runLive(
      "npx",
      vercelCliArgs(["deploy", "--prebuilt", "--prod", ...vercelScopeArgs]),
      {
        cwd: appDir,
        env: vercelEnv(),
        timeoutMs: 15 * 60_000,
        label: "vercel deploy",
      },
    );
    assert.ok(
      output.includes(baseUrl),
      `Vercel did not publish the deploy at ${baseUrl}.`,
    );
  });
  const logs = () =>
    `No server log is available from Vercel here; the project is ${baseUrl}.`;
  await step("wait for the new deploy to answer", () =>
    waitForNewDeploy(baseUrl, marker, logs),
  );
  return { baseUrl, logs };
}

async function runTarget(): Promise<void> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "an-deploy-paths-"));
  onCleanup(`work directory ${workDir}`, () => {
    if (keep) log(`kept ${workDir}`);
    else fs.rmSync(workDir, { recursive: true, force: true });
  });
  const appDir = path.join(workDir, APP_NAME);
  const env = corepackEnv(workDir);

  await step("the guide still says what this check runs", () =>
    assertDocContract(repoRoot, target),
  );

  if (target === "presets") {
    await prepareApp(workDir, appDir, env);
    await buildPresets(appDir, env);
    return;
  }

  const databaseUrl = await provisionDatabase(target);
  await prepareApp(workDir, appDir, env);

  const authSecret = randomBytes(32).toString("hex");
  registerSecrets(authSecret);
  const a2aSecret =
    target === "netlify" ? randomBytes(32).toString("hex") : null;
  if (a2aSecret) registerSecrets(a2aSecret);

  // The guides export these in Step 2, so the migrate and build that follow
  // run with them in the shell, as they do here.
  const hostEnv = {
    ...env,
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: authSecret,
  };

  const projectName =
    target === "netlify"
      ? await useNetlifySite(appDir, databaseUrl, authSecret, a2aSecret!)
      : target === "vercel"
        ? await useVercelProject(appDir, databaseUrl, authSecret)
        : null;

  await step("migrate the database", () =>
    runLive("pnpm", ["migrate:production"], {
      cwd: appDir,
      env: hostEnv,
      timeoutMs: BUILD_TIMEOUT_MS,
      label: "migrate",
    }),
  );

  let app: RunningApp;
  if (target === "node") {
    await step("build for Node.js", () =>
      runLive("pnpm", ["build"], {
        cwd: appDir,
        env: { ...hostEnv, NITRO_PRESET: "node" },
        timeoutMs: BUILD_TIMEOUT_MS,
        label: "build",
      }),
    );
    app = await step("start the server", () =>
      startNodeServer(appDir, hostEnv),
    );
  } else if (target === "docker") {
    const docker = fs.readFileSync(
      path.join(repoRoot, DEPLOY_DOC_CONTRACTS.docker[0]!.doc),
      "utf8",
    );
    let dockerfile = extractFencedBlock(docker, "Dockerfile");
    if (source === "local") dockerfile = vendorDockerfile(dockerfile);
    fs.writeFileSync(path.join(appDir, "Dockerfile"), dockerfile);
    fs.writeFileSync(
      path.join(appDir, ".dockerignore"),
      extractFencedBlock(docker, ".dockerignore"),
    );
    // Shared runners hit Docker Hub's anonymous pull limit; a retried pull
    // keeps that from failing a build the guide's readers would not fail.
    await step("pull the base images", async () => {
      for (const baseImage of dockerfileBaseImages(dockerfile)) {
        await pullWithRetry(baseImage, appDir);
      }
    });
    const image = `an-deploy-paths-${randomBytes(3).toString("hex")}`;
    await step("docker build", async () => {
      onCleanup(`image ${image}`, () => {
        runQuiet("docker", ["image", "rm", "-f", image]);
      });
      await runLive("docker", ["build", "-t", image, "."], {
        cwd: appDir,
        env,
        timeoutMs: DOCKER_BUILD_TIMEOUT_MS,
        label: "docker build",
      });
    });
    const containerEnv = {
      ...baseEnv(),
      DATABASE_URL: containerReachableDatabaseUrl(databaseUrl),
      BETTER_AUTH_SECRET: authSecret,
    };
    app = await step("docker run", () =>
      startContainer(appDir, image, containerEnv),
    );
  } else if (target === "netlify") {
    app = await deployToNetlify(appDir, hostEnv, projectName!);
  } else {
    app = await deployToVercel(appDir, hostEnv, projectName!);
  }

  try {
    await exerciseApp(app, appDir, databaseUrl);
  } catch (error) {
    warn(`app logs:\n${app.logs()}`);
    throw error;
  }
}

function writeResult(failure: string | null, leaked: string[]): void {
  const dir = path.join(repoRoot, ".tmp", "deploy-paths");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${target}-${source}.json`),
    `${JSON.stringify({ target, source, npmTag: source === "npm" ? npmTag : null, ok: !failure && leaked.length === 0, failure, leaked, steps }, null, 2)}\n`,
  );
}

let finishing: Promise<never> | undefined;

// Ends the run once, whichever gets here first: the run's own failure or a
// cancellation. A cancelled run that could not remove something must say so
// exactly as a failed one does.
function finish(failure: string | null): Promise<never> {
  return (finishing ??= (async () => {
    const outcome = interruptedBy ? `interrupted by ${interruptedBy}` : failure;
    const leaked = (await runCleanups()).map(redact);
    if (leaked.length > 0) {
      warn(
        `LEAKED RESOURCES (clean these up by hand):\n${leaked.map((entry) => `  - ${entry}`).join("\n")}`,
      );
    }
    writeResult(outcome, leaked);

    log("summary");
    for (const result of steps) {
      log(
        `  ${result.status === "passed" ? "✔" : "✘"} ${result.name} (${(result.ms / 1000).toFixed(1)}s)`,
      );
    }
    process.exit(interruptedBy ? 130 : outcome || leaked.length > 0 ? 1 : 0);
  })());
}

async function main(): Promise<void> {
  const interrupted = async (signal: NodeJS.Signals) => {
    interruptedBy ??= signal;
    log(`received ${signal}; cleaning up`);
    await waitUpTo(
      INTERRUPT_WAIT_MS,
      Promise.all([stopActiveRuns(), Promise.allSettled([...creations])]),
    );
    await finish(null);
  };
  process.once("SIGINT", () => void interrupted("SIGINT"));
  process.once("SIGTERM", () => void interrupted("SIGTERM"));

  let failure: string | null = null;
  try {
    await runTarget();
  } catch (error) {
    failure = redact(errorMessage(error));
    warn(`FAILED: ${failure}`);
  }
  await finish(failure);
}

void main();
