import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { resolve } from "node:path";

import { required } from "../local/required";

const app = resolve(import.meta.dirname, "../..");
const root = resolve(app, "../..");
export type DailyServer = { base: string; fake: string; cookie: string };

export async function startServer(
  workerIndex: number,
  production = false,
  requestedPort?: number,
): Promise<{ server: DailyServer; child?: ChildProcess }> {
  if (workerIndex !== 0)
    throw new Error("Daily runner requires its own isolated server");
  const appPort =
    requestedPort ??
    (await new Promise<number>((done, fail) => {
      const listener = createServer();
      listener.once("error", fail);
      listener.listen(0, "127.0.0.1", () => {
        const address = listener.address();
        if (!address || typeof address === "string")
          return fail(new Error("No isolated app port"));
        listener.close((error) => (error ? fail(error) : done(address.port)));
      });
    }));
  const dailyDir = resolve(root, ".tmp/analytics-daily");
  mkdirSync(dailyDir, { recursive: true });
  const cacheDir = mkdtempSync(resolve(dailyDir, "cache-"));
  const require = createRequire(resolve(app, "package.json"));
  const tsx = require.resolve("tsx/cli");
  const child = spawn(
    process.execPath,
    [
      tsx,
      "e2e/local/serve.ts",
      "--port",
      String(appPort),
      "--cache-dir",
      cacheDir,
      ...(production ? ["--production"] : []),
    ],
    {
      cwd: app,
      env: { ...process.env, VITE_CONFIG_NATIVE_IGNORE_WARNING: "true" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let out = "";
  const ready = await new Promise<string>((done, fail) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      fail(new Error(`local server did not start: ${out.slice(-3000)}`));
    }, 420_000);
    const onData = (chunk: Buffer) => {
      out += chunk;
      const line = /READY (\S+) fake=(\S+) cookie-file=(\S+)/.exec(out);
      if (line) {
        clearTimeout(timer);
        done(line[0]);
      }
    };
    required(child.stdout).on("data", onData);
    required(child.stderr).on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timer);
      fail(new Error(`local server exited ${code}: ${out.slice(-3000)}`));
    });
  });
  const [, baseUrl, fake, cookieFile] = required(
    /READY (\S+) fake=(\S+) cookie-file=(\S+)/.exec(ready),
  );
  return {
    server: {
      base: required(baseUrl),
      fake: required(fake),
      cookie: readFileSync(required(cookieFile), "utf8"),
    },
    child,
  };
}
