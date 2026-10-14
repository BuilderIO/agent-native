#!/usr/bin/env tsx
/**
 * Proves one documented standalone deploy path end to end: scaffold a Chat
 * app, install, migrate a real Postgres, build, run it the way the guide says,
 * then sign up, call the `hello` action, and confirm the account landed in
 * Postgres and survived a restart.
 *
 *   pnpm qa:deploy-paths --target node|docker [--source local|npm]
 *
 * `--source local` (the default) installs the packages from this checkout, so
 * the check can fail before anything is published. `--source npm` runs the
 * guide's own `npx @agent-native/core@<tag> create`, so the check proves what
 * readers get from npm.
 *
 * The database comes from `--admin-database-url`, a Postgres server the check
 * creates one throwaway database on. Without it the check starts a Postgres
 * container. Every resource registers its cleanup the moment it exists, and a
 * cleanup that fails fails the run: a leaked database or container is a
 * failure, never a footnote.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  assertDocContract,
  containerReachableDatabaseUrl,
  databaseUrlFor,
  DEPLOY_DOC_CONTRACTS,
  DEPLOY_TARGETS,
  deployDatabaseName,
  dockerfileBaseImages,
  extractFencedBlock,
  findFileUrls,
  VENDOR_DIR,
  vendorDockerfile,
  vendorSpecifier,
  type DeployTarget,
} from "./qa-deploy-paths-lib";

type Source = "local" | "npm";

interface Sql {
  (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<Array<Record<string, unknown>>>;
  unsafe(query: string): Promise<unknown>;
  end(): Promise<void>;
}

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const requireFromCore = createRequire(
  path.join(repoRoot, "packages/core/package.json"),
);
const postgres = requireFromCore("postgres") as (
  url: string,
  options?: Record<string, unknown>,
) => Sql;

const APP_NAME = "my-app";
const INSTALL_TIMEOUT_MS = 10 * 60_000;
const BUILD_TIMEOUT_MS = 10 * 60_000;
const DOCKER_BUILD_TIMEOUT_MS = 20 * 60_000;
const READY_TIMEOUT_MS = 3 * 60_000;
const PASSWORD = `Dp-${randomBytes(12).toString("hex")}`;

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    target: { type: "string" },
    source: { type: "string", default: "local" },
    "npm-tag": { type: "string", default: "latest" },
    "admin-database-url": { type: "string" },
    keep: { type: "boolean", default: false },
  },
});

const target = values.target as DeployTarget;
const source = values.source as Source;
const npmTag = values["npm-tag"] as string;
const adminDatabaseUrlArg = values["admin-database-url"];
const keep = values.keep === true;

if (!DEPLOY_TARGETS.includes(target)) {
  console.error(`--target must be one of: ${DEPLOY_TARGETS.join(", ")}`);
  process.exit(2);
}
if (source !== "local" && source !== "npm") {
  console.error("--source must be local or npm");
  process.exit(2);
}

const tag = `[deploy-paths:${target}:${source}]`;
const log = (message: string) => console.log(`${tag} ${message}`);

interface StepResult {
  name: string;
  ms: number;
  status: "passed" | "failed";
}

const steps: StepResult[] = [];

async function step<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
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

async function runCleanups(): Promise<string[]> {
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

// The app under test gets exactly the settings this check sets, never ones
// left in the shell or inherited from the `pnpm` run that started it.
function baseEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1" };
  for (const key of Object.keys(env)) {
    if (/^(npm_|PNPM_)/i.test(key)) delete env[key];
  }
  for (const key of [
    "INIT_CWD",
    "NODE_ENV",
    "NITRO_PRESET",
    "DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "A2A_SECRET",
    "AUTH_DISABLED",
  ]) {
    delete env[key];
  }
  return env;
}

interface RunOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  label: string;
}

async function runLive(
  cmd: string,
  args: string[],
  options: RunOptions,
): Promise<string> {
  log(`${options.label}: ${cmd} ${args.join(" ")}`);
  const child = spawn(cmd, args, {
    cwd: options.cwd,
    env: options.env ?? baseEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output: string[] = [];
  const append = (chunk: Buffer | string) => {
    const text = chunk.toString();
    output.push(text);
    if (output.length > 400) output.shift();
    process.stdout.write(text);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
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

function runQuiet(
  cmd: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): string {
  return execFileSync(cmd, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? baseEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
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
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for ${label}${
      lastError ? ` (last error: ${errorMessage(lastError)})` : ""
    }.`,
  );
}

async function withSql<T>(
  url: string,
  fn: (sql: Sql) => Promise<T>,
): Promise<T> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
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
  await waitFor("the Postgres container", 90_000, () =>
    withSql(
      url.toString(),
      async (sql) => (await sql`select 1 as ok`).length === 1,
    ),
  );
  return url.toString();
}

async function createDatabase(adminUrl: string): Promise<string> {
  const name = deployDatabaseName(
    target,
    Date.now(),
    randomBytes(3).toString("hex"),
  );
  await withSql(adminUrl, (sql) => sql.unsafe(`CREATE DATABASE "${name}"`));
  onCleanup(`database ${name}`, async () => {
    await withSql(adminUrl, (sql) =>
      sql.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`),
    );
  });
  return databaseUrlFor(adminUrl, name);
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
  restart(): Promise<void>;
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
      async () => (await fetch(`${baseUrl}/_agent-native/ping`)).status === 200,
      exited,
    );
  } catch (error) {
    console.error(`${tag} app logs:\n${logs()}`);
    throw error;
  }
}

async function startNodeServer(
  appDir: string,
  env: NodeJS.ProcessEnv,
): Promise<RunningApp> {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let child: ChildProcess | undefined;
  let exitMessage: string | null = null;
  const output: string[] = [];

  const launch = () => {
    exitMessage = null;
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
    child = next;
  };

  const stop = async () => {
    const running = child;
    if (!running?.pid || running.exitCode !== null) return;
    const closed = new Promise<void>((resolve) =>
      running.once("close", () => resolve()),
    );
    process.kill(-running.pid, "SIGTERM");
    const killer = setTimeout(() => {
      try {
        process.kill(-running.pid!, "SIGKILL");
      } catch (error) {
        // ESRCH is the group having exited between the checks; anything else
        // means the server may still be running.
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
          console.error(
            `${tag} could not kill the server: ${errorMessage(error)}`,
          );
        }
      }
    }, 10_000);
    await closed;
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

interface Session {
  cookie: string;
}

function sessionFrom(response: Response): Session {
  const cookie = response.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0]!)
    .filter((pair) => !pair.endsWith("="))
    .join("; ");
  assert.ok(
    cookie.includes("session_token="),
    "The auth response should set a session cookie.",
  );
  return { cookie };
}

async function authenticate(
  baseUrl: string,
  action: "sign-up" | "sign-in",
  email: string,
): Promise<Session> {
  const response = await fetch(
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
  return sessionFrom(response);
}

async function callHello(baseUrl: string, session: Session): Promise<void> {
  const response = await fetch(
    `${baseUrl}/_agent-native/actions/hello?name=deploy-paths`,
    { headers: { cookie: session.cookie } },
  );
  const body = await response.text();
  assert.equal(response.status, 200, `hello failed: ${body}`);
  assert.deepEqual(JSON.parse(body), { message: "Hello, deploy-paths!" });
}

async function exerciseApp(
  app: RunningApp,
  appDir: string,
  databaseUrl: string,
): Promise<void> {
  const email = `deploy-paths-${randomBytes(4).toString("hex")}@example.com`;

  await step("the server reports no missing deploy settings", async () => {
    const response = await fetch(
      `${app.baseUrl}/_agent-native/ping?configuration=1`,
    );
    const body = (await response.json()) as {
      configuration?: { ok?: boolean; issues?: unknown[] };
    };
    assert.equal(response.status, 200);
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

  await step("restart, then sign in with the same account", async () => {
    await app.restart();
    const again = await authenticate(app.baseUrl, "sign-in", email);
    await callHello(app.baseUrl, again);
  });
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

  const adminUrl =
    adminDatabaseUrlArg ??
    (await step("start a Postgres container", startLocalPostgres));
  const databaseUrl = await step("create a throwaway database", () =>
    createDatabase(adminUrl),
  );

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

  const authSecret = randomBytes(32).toString("hex");

  await step("migrate the database", () =>
    runLive("pnpm", ["migrate:production"], {
      cwd: appDir,
      env: {
        ...env,
        DATABASE_URL: databaseUrl,
        BETTER_AUTH_SECRET: authSecret,
      },
      timeoutMs: BUILD_TIMEOUT_MS,
      label: "migrate",
    }),
  );

  let app: RunningApp;
  if (target === "node") {
    await step("build for Node.js", () =>
      runLive("pnpm", ["build"], {
        cwd: appDir,
        env: { ...env, NITRO_PRESET: "node" },
        timeoutMs: BUILD_TIMEOUT_MS,
        label: "build",
      }),
    );
    app = await step("start the server", () =>
      startNodeServer(appDir, {
        ...env,
        DATABASE_URL: databaseUrl,
        BETTER_AUTH_SECRET: authSecret,
      }),
    );
  } else {
    const docker = fs.readFileSync(
      path.join(repoRoot, DEPLOY_DOC_CONTRACTS.docker.doc),
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
  }

  try {
    await exerciseApp(app, appDir, databaseUrl);
  } catch (error) {
    console.error(`${tag} app logs:\n${app.logs()}`);
    throw error;
  }
}

function writeResult(failure: string | null, leaked: string[]): void {
  const dir = path.join(repoRoot, ".tmp", "deploy-paths");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${target}-${source}.json`),
    `${JSON.stringify({ target, source, ok: !failure && leaked.length === 0, failure, leaked, steps }, null, 2)}\n`,
  );
}

async function main(): Promise<void> {
  let failure: string | null = null;
  const interrupted = async (signal: NodeJS.Signals) => {
    log(`received ${signal}; cleaning up`);
    await runCleanups();
    process.exit(130);
  };
  process.once("SIGINT", () => void interrupted("SIGINT"));
  process.once("SIGTERM", () => void interrupted("SIGTERM"));

  try {
    await runTarget();
  } catch (error) {
    failure = errorMessage(error);
    console.error(`${tag} FAILED: ${failure}`);
  }
  const leaked = await runCleanups();
  if (leaked.length > 0) {
    console.error(
      `${tag} LEAKED RESOURCES (clean these up by hand):\n${leaked.map((entry) => `  - ${entry}`).join("\n")}`,
    );
  }
  writeResult(failure, leaked);

  console.log(`\n${tag} summary`);
  for (const result of steps) {
    console.log(
      `  ${result.status === "passed" ? "✔" : "✘"} ${result.name} (${(result.ms / 1000).toFixed(1)}s)`,
    );
  }
  process.exit(failure || leaked.length > 0 ? 1 : 0);
}

void main();
