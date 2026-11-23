import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { resolve } from "node:path";

if (
  process.argv.includes("--shared-editor-storage") &&
  !process.argv.includes("--production")
)
  throw new Error("Shared editor storage proof requires --production");
if (
  process.argv.includes("--reuse-build") &&
  !process.argv.includes("--production")
)
  throw new Error("Reusing a compiled fixture requires --production");

const requestedBase = process.env.BASE_URL; // guard:allow-env-credential — CLI test target, never a credential
if (requestedBase !== undefined) {
  const { runLive } = await import("./live/run");
  process.exit(await runLive(requestedBase, process.argv.slice(2)));
}

const root = resolve(import.meta.dirname, "../../../..");
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
const pgBin = "/opt/homebrew/opt/postgresql@18/bin";
for (const tool of ["initdb", "pg_ctl", "createdb"])
  await access(`${pgBin}/${tool}`);
const dir = await mkdtemp(resolve(root, ".tmp/p-"));
const data = resolve(dir, "data");
const sockets = resolve(dir, "sockets");
let started = false;
let active: ReturnType<typeof spawn> | undefined;
let interrupted = false;
async function run(
  command: string,
  args: string[],
  env = process.env,
  cleanup = false,
) {
  if (interrupted && !cleanup) throw new Error("Daily run interrupted");
  active = spawn(command, args, { cwd: root, env, stdio: "inherit" });
  const child = active;
  const code = await new Promise<number>((done, reject) => {
    child.once("error", reject);
    child.once("exit", (value, signal) => done(signal ? 1 : (value ?? 1)));
  });
  active = undefined;
  if (interrupted && !cleanup) throw new Error("Daily run interrupted");
  if (code !== 0) throw new Error(`${command} exited ${code}`);
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    interrupted = true;
    active?.kill(signal);
  });
try {
  await mkdir(sockets, { mode: 0o700 });
  const port = await new Promise<number>((done, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string")
        return reject(new Error("No database port"));
      server.close((error) => (error ? reject(error) : done(address.port)));
    });
  });
  const databaseUrl = `postgresql://qa_analytics2@127.0.0.1:${port}/qa_analytics2`;
  const pgEnv = {
    LC_ALL: "en_US.UTF-8",
    ...process.env,
  };
  await run(
    `${pgBin}/initdb`,
    ["-D", data, "-U", "qa_analytics2", "--auth=trust", "--no-instructions"],
    pgEnv,
  );
  started = true;
  await run(
    `${pgBin}/pg_ctl`,
    [
      "-D",
      data,
      "-l",
      resolve(dir, "postgres.log"),
      "-o",
      `-h 127.0.0.1 -p ${port} -k ${sockets}`,
      "-w",
      "start",
    ],
    pgEnv,
  );
  await run(
    `${pgBin}/createdb`,
    [
      "-h",
      "127.0.0.1",
      "-p",
      String(port),
      "-U",
      "qa_analytics2",
      "qa_analytics2",
    ],
    pgEnv,
  );
  const env = {
    ...process.env,
    HOME: dir,
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    DATABASE_URL_UNPOOLED: "",
    NETLIFY_DATABASE_URL: "",
    NETLIFY_DATABASE_URL_UNPOOLED: "",
  };
  if (
    process.argv.includes("--production") &&
    !process.argv.includes("--reuse-build")
  )
    await run("pnpm", ["--filter", "analytics-2", "build"], {
      ...env,
      AGENT_NATIVE_INCLUDE_REFERENCE_SKIN: "1",
    });
  await run("pnpm", ["--filter", "analytics-2", "migrate:production"], env);
  await run(
    "pnpm",
    [
      "exec",
      "tsx",
      process.argv.includes("--shared-editor-storage")
        ? "templates/analytics-2/e2e/shared-editor-storage.ts"
        : "templates/analytics-2/e2e/daily/run.ts",
      ...process.argv
        .slice(2)
        .filter(
          (arg) => arg !== "--reuse-build" && arg !== "--shared-editor-storage",
        ),
    ],
    { ...env, HOME: homedir() },
  );
} finally {
  if (started) {
    try {
      await run(
        `${pgBin}/pg_ctl`,
        ["-D", data, "-m", "fast", "-w", "stop"],
        process.env,
        true,
      );
    } catch (error) {
      console.error(`PostgreSQL did not stop; retained ${dir}`);
      throw error;
    }
  }
  await rm(dir, { recursive: true, force: true });
}
