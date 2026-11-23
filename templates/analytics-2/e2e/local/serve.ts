import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import { startFakeProviders } from "./fake-providers";
import { waitForSsr } from "./ssr-readiness";

// Starts the real analytics dev server on isolated PostgreSQL with every external provider replaced by the
// loopback fake, signs in the local dev user and prints `READY <base> fake=<url> cookie-file=<path>`.
// Stays up until SIGINT/SIGTERM. Test-only.
const { values } = parseArgs({
  options: {
    port: { type: "string" },
    "fake-port": { type: "string" },
    "cache-dir": { type: "string" },
    production: { type: "boolean", default: false },
  },
});
const port = Number(values.port ?? 8105);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Daily server requires a non-privileged local port");
const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
if (
  databaseUrl.protocol !== "postgresql:" ||
  databaseUrl.hostname !== "127.0.0.1" ||
  !databaseUrl.port ||
  databaseUrl.username !== "qa_analytics2" ||
  databaseUrl.password ||
  databaseUrl.pathname !== "/qa_analytics2" ||
  databaseUrl.search ||
  databaseUrl.hash
)
  throw new Error("Daily server requires an isolated QA PostgreSQL database");
const profile = JSON.parse(
  await readFile(
    resolve(homedir(), ".config/agent-native-qa/analytics-2-profile.json"),
    "utf8",
  ),
);
if (
  profile.email !== "qa-fleet@builder.io" ||
  typeof profile.workspaceId !== "string" ||
  !profile.workspaceId
)
  throw new Error("Invalid QA profile fixture");
const root = resolve(import.meta.dirname, "../../../..");
const app = resolve(root, "templates/analytics-2");
await mkdir(resolve(root, ".tmp"), { recursive: true });
const output = await mkdtemp(resolve(root, ".tmp/analytics-serve-"));
const pidFile = resolve(output, "pids");
await writeFile(pidFile, "");
const fake = await startFakeProviders(
  values["fake-port"]
    ? { port: Number(values["fake-port"]), appPort: port }
    : { appPort: port },
);
const preload = new URL("./preload.ts", import.meta.url);
preload.searchParams.set("fakeUrl", fake.url);
preload.searchParams.set("pidFile", pidFile);
const require = createRequire(resolve(app, "package.json"));
const base = `http://127.0.0.1:${port}`;
const env: NodeJS.ProcessEnv = {
  PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
  HOME: resolve(output, "home"),
  XDG_CONFIG_HOME: resolve(output, "config"),
  TMPDIR: values["cache-dir"] ? resolve(values["cache-dir"]) : output,
  NODE_ENV: values.production ? "production" : "development",
  PORT: String(port),
  NITRO_PORT: String(port),
  APP_URL: values.production ? undefined : base,
  BETTER_AUTH_URL: values.production ? undefined : base,
  AUTH_SKIP_EMAIL_VERIFICATION: "1",
  AUTH_MAGIC_LINK: "0",
  AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT: "1",
  DATABASE_URL: databaseUrl.href,
  DATABASE_URL_UNPOOLED: "",
  SECRETS_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
  // A placeholder: the model host is rewritten to the loopback fake, which ignores it.
  ANTHROPIC_API_KEY: "sk-ant-local-fake",
  NITRO_DEV_RUNNER: "node-process",
  NODE_OPTIONS: `--import ${preload.href}`,
  AGENT_NATIVE_CONFIG_RUNTIME_AUTH_ENABLED: "true",
};
const vite = require
  .resolve("vite/package.json")
  .replace(/package\.json$/, "bin/vite.js");
let logs = "";
const child = spawn(
  process.execPath,
  values.production
    ? [resolve(app, ".output/server/index.mjs")]
    : [
        vite,
        "--configLoader",
        "runner",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--strictPort",
        "--config",
        resolve(import.meta.dirname, "vite.config.ts"),
      ],
  { cwd: app, env, stdio: ["ignore", "pipe", "pipe"] },
);
for (const stream of [child.stdout, child.stderr])
  stream.on("data", (chunk) => {
    logs += chunk;
    if (logs.length > 200_000) logs = logs.slice(-100_000);
    void appendFile(resolve(output, "dev.log"), chunk);
  });
const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));
let tornDown = false;

function signalUnlessGone(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function teardown() {
  if (tornDown) return;
  tornDown = true;
  // Only processes this run started: the Vite child and the PIDs the preload recorded.
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return (e as NodeJS.ErrnoException).code !== "ESRCH";
    }
  };
  const pids = [
    ...new Set([
      child.pid,
      ...(await readFile(pidFile, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(Number),
    ]),
  ].filter((pid): pid is number => !!pid && pid !== process.pid);
  for (const pid of pids) signalUnlessGone(pid, "SIGTERM");
  for (let i = 0; i < 20 && pids.some(alive); i++) await delay(250);
  for (const pid of pids.filter(alive)) signalUnlessGone(pid, "SIGKILL");
  await fake.close();
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void teardown().then(() => process.exit(0));
  });

let lastProbe = "none";
try {
  for (let i = 0; ; i++) {
    if (child.exitCode !== null)
      throw new Error(
        `Dev server exited ${child.exitCode}: ${logs.slice(-3500)}`,
      );
    if (i === 480)
      throw new Error(
        `Dev startup timed out (last probe: ${lastProbe}): ${logs.slice(-3500)}`,
      );
    try {
      const probe = await fetch(`${base}/_agent-native/ping`, {
        signal: AbortSignal.timeout(3000),
      });
      if (probe.ok) break;
      lastProbe = `HTTP ${probe.status}`;
    } catch (error) {
      lastProbe = error instanceof Error ? error.message : String(error);
    }
    await delay(500);
  }
  await waitForSsr(base);
  if (!values.production) {
    const client = await fetch(`${base}/__analytics-local/client-ready`, {
      signal: AbortSignal.timeout(120_000),
    });
    if (client.status !== 204)
      throw new Error(`Client startup failed: HTTP ${client.status}`);
  }
  const password = randomBytes(24).toString("hex");
  const authHeaders = { "content-type": "application/json", origin: base };
  const registration = await fetch(`${base}/_agent-native/auth/register`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ email: profile.email, password, callbackURL: base }),
  });
  if (!registration.ok)
    throw new Error(`QA registration HTTP ${registration.status}`);
  const login = await fetch(`${base}/_agent-native/auth/login`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ email: profile.email, password }),
  });
  if (!login.ok) throw new Error(`QA login HTTP ${login.status}`);
  const cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  if (!cookie) throw new Error("QA login returned no session");
  const sessionResponse = await fetch(`${base}/_agent-native/auth/session`, {
    headers: { cookie },
  });
  if (!sessionResponse.ok)
    throw new Error(`QA session read HTTP ${sessionResponse.status}`);
  const session = await sessionResponse.json();
  const orgResponse = await fetch(`${base}/_agent-native/org/me`, {
    headers: { cookie },
  });
  if (!orgResponse.ok)
    throw new Error(`QA org read HTTP ${orgResponse.status}`);
  const org = await orgResponse.json();
  if (
    session.email !== profile.email ||
    org.email !== profile.email ||
    !org.orgId ||
    org.orgId === profile.workspaceId ||
    !["owner", "admin"].includes(org.role)
  )
    throw new Error("QA identity or isolated workspace did not match");
  const homeStateKey = `get-started-dismissed:${org.orgId}`;
  const homeStateResponse = await fetch(
    `${base}/_agent-native/application-state?keys=${encodeURIComponent(homeStateKey)}`,
    { headers: { cookie }, signal: AbortSignal.timeout(120_000) },
  );
  if (!homeStateResponse.ok)
    throw new Error(`QA Home state HTTP ${homeStateResponse.status}`);
  const homeState = await homeStateResponse.json();
  if (
    !homeState.missing?.includes(homeStateKey) ||
    homeState.values?.[homeStateKey] !== undefined
  )
    throw new Error("QA Home state was not fresh");
  const cookieFile = resolve(output, "cookie");
  await writeFile(cookieFile, cookie, { mode: 0o600 });
  console.log(
    `READY ${base} fake=${fake.url} cookie-file=${cookieFile} log=${resolve(output, "dev.log")}`,
  );
} catch (error) {
  console.error(String(error));
  await teardown();
  process.exit(1);
}
setInterval(() => {
  if (child.exitCode !== null) {
    console.error(`Dev server exited ${child.exitCode}`);
    void teardown().then(() => process.exit(1));
  }
}, 2000);
