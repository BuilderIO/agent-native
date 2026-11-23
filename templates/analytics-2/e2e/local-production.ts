import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { localFlowBase, requestedLocalFlowBase } from "./local-flow-base.js";
import { qaBrowserEndpoint } from "./qa-browser.js";

const base = localFlowBase(requestedLocalFlowBase(), "8105");
if (new URL(base).port !== "8105")
  throw new Error("Local production flow requires app port 8105");
if (
  process.env.AGENT_NATIVE_ANALYTICS_QA_BROWSER_PORT !== undefined &&
  process.env.AGENT_NATIVE_ANALYTICS_QA_BROWSER_PORT !== "9455"
)
  throw new Error("Local production flow requires QA browser port 9455");
await qaBrowserEndpoint();
const pgBin = "/opt/homebrew/opt/postgresql@18/bin";
try {
  await access(`${pgBin}/initdb`);
  await access(`${pgBin}/pg_ctl`);
  await access(`${pgBin}/createdb`);
} catch {
  console.error(
    "COULD-NOT-RUN local fixture: PostgreSQL 18 tools are unavailable",
  );
  process.exit(2);
}

let active: ReturnType<typeof spawn> | undefined;
let interrupted = false;
let cleaning = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    interrupted = true;
    if (!cleaning) active?.kill(signal);
  });

async function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  cleanup = false,
) {
  if (interrupted && !cleanup) throw new Error("Local QA run interrupted");
  const child = spawn(command, args, { env, stdio: "inherit" });
  active = child;
  try {
    const code = await new Promise<number>((done, reject) => {
      child.once("error", reject);
      child.once("exit", (value, signal) => done(signal ? 1 : (value ?? 1)));
    });
    if (interrupted && !cleanup) throw new Error("Local QA run interrupted");
    return code;
  } finally {
    active = undefined;
  }
}

const dir = await mkdtemp(resolve(".tmp/p-"));
const data = `${dir}/data`;
const sockets = `${dir}/sockets`;
let started = false;
async function freePort() {
  return new Promise<number>((done, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string")
        return reject(new Error("No local fixture port"));
      server.close((error) => (error ? reject(error) : done(address.port)));
    });
  });
}
try {
  await mkdir(sockets, { mode: 0o700 });
  const port = await freePort();
  const databaseUrl = `postgresql://qa_analytics2@127.0.0.1:${port}/qa_analytics2`;
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    DATABASE_URL_UNPOOLED: "",
    NETLIFY_DATABASE_URL: "",
    NETLIFY_DATABASE_URL_UNPOOLED: "",
  };
  if (
    (await run(`${pgBin}/initdb`, [
      "-D",
      data,
      "-U",
      "qa_analytics2",
      "--auth=trust",
      "--no-instructions",
    ])) !== 0
  )
    throw new Error("Local QA initdb failed");
  started = true;
  if (
    (await run(
      `${pgBin}/pg_ctl`,
      [
        "-D",
        data,
        "-l",
        `${dir}/postgres.log`,
        "-o",
        `-h 127.0.0.1 -p ${port} -k ${sockets}`,
        "-w",
        "start",
      ],
      { ...process.env, LC_ALL: "en_US.UTF-8" },
    )) !== 0
  )
    throw new Error("Local QA PostgreSQL failed to start");
  if (
    (await run(`${pgBin}/createdb`, [
      "-h",
      "127.0.0.1",
      "-p",
      String(port),
      "-U",
      "qa_analytics2",
      "qa_analytics2",
    ])) !== 0
  )
    throw new Error("Local QA database creation failed");
  const build = await run("pnpm", ["--filter", "analytics-2", "build"], {
    ...env,
    AGENT_NATIVE_INCLUDE_REFERENCE_SKIN: "1",
  });
  if (build !== 0) throw new Error(`Production build failed: ${build}`);
  const serverDir = await realpath(
    resolve("templates/analytics-2/.output/server"),
  );
  const requireFromServer = createRequire(`${serverDir}/index.mjs`);
  const pgliteEntry = await realpath(
    requireFromServer.resolve("@electric-sql/pglite"),
  );
  const pgliteRelative = relative(serverDir, pgliteEntry);
  if (pgliteRelative === ".." || pgliteRelative.startsWith(`..${sep}`))
    throw new Error(
      "Production artifact resolves PGlite outside its server directory",
    );
  await access(resolve(dirname(pgliteEntry), "pglite.wasm"));
  await access(resolve(dirname(pgliteEntry), "initdb.wasm"));
  await access(resolve(dirname(pgliteEntry), "pglite.data"));
  console.log("Production artifact includes PGlite and its WASM assets");
  const storageEntry = await realpath(
    requireFromServer.resolve("@google-cloud/bigquery-storage"),
  );
  const storageRelative = relative(serverDir, storageEntry);
  if (storageRelative === ".." || storageRelative.startsWith(`..${sep}`))
    throw new Error(
      "Production artifact resolves BigQuery Storage outside its server directory",
    );
  const { BigQueryReadClient } = await import(pathToFileURL(storageEntry).href);
  const storageClient = new BigQueryReadClient({
    projectId: "fixture-project",
    credentials: {
      client_email: "fixture@example.invalid",
      private_key: "fixture",
    },
  });
  await storageClient.close();
  console.log("Production artifact report 960 initializes BigQuery Storage");
  const migration = await run(
    "pnpm",
    ["--filter", "analytics-2", "migrate:production"],
    env,
  );
  if (migration !== 0) process.exitCode = migration;
  else {
    process.exitCode = await run(
      "pnpm",
      [
        "exec",
        "tsx",
        "templates/analytics-2/e2e/first-run-local.ts",
        `--server-database-url=${databaseUrl}`,
        ...process.argv.slice(2),
      ],
      {
        ...process.env,
        FLOW_BASE_URL: base,
        AGENT_NATIVE_ANALYTICS_LOCAL_FIXTURE_PORT: "8105",
        AGENT_NATIVE_ANALYTICS_QA_BROWSER_PORT: "9455",
      },
    );
  }
} finally {
  cleaning = true;
  const stopped =
    !started ||
    (await run(
      `${pgBin}/pg_ctl`,
      ["-D", data, "-m", "fast", "-w", "stop"],
      process.env,
      true,
    )) === 0 ||
    (await run(
      `${pgBin}/pg_ctl`,
      ["-D", data, "status"],
      process.env,
      true,
    )) === 3;
  if (!stopped) {
    console.error(
      `Local QA PostgreSQL did not stop; fixture retained at ${dir}`,
    );
    process.exitCode = 1;
  } else {
    await rm(dir, { recursive: true, force: true });
  }
}
