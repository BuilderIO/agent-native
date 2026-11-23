import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function measureArgs(argv = process.argv.slice(2), env = process.env) {
  const args = [];
  let app = env.MEASURE_APP || null;
  let supplied = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--app" || arg.startsWith("--app=")) {
      if (supplied) throw Error("duplicate --app");
      app = arg === "--app" ? argv[++i] : arg.slice(6);
      supplied = true;
      if (!app || app.startsWith("-")) throw Error("--app needs an app name");
    } else args.push(arg);
  }
  if (app && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(app))
    throw Error("invalid measurement app");
  return { app, args };
}

export function measureConfig(env = process.env) {
  const file = env.FLEET_CONFIG;
  if (!file) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw Error("measurement config is missing or invalid");
  }
}

const expand = (value) =>
  value.startsWith("~/")
    ? path.join(os.homedir(), value.slice(2))
    : path.resolve(value);

function pair(value) {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    value.some((p) => !Number.isInteger(p) || p < 1024 || p > 65535) ||
    value[0] === value[1]
  )
    throw Error(
      "measurement ports must be two distinct integers from 1024 to 65535",
    );
  return value;
}

export function measureEndpoint({
  app = measureArgs().app,
  config = measureConfig(),
  note = (message) => console.error(message),
} = {}) {
  const shared = pair([
    config.measure_cdp_port ?? 9445,
    config.measure_proxy_port ?? 9444,
  ]);
  if (!app) {
    note("measure: no app selected; using the shared measurement browser");
    return {
      app: null,
      cdpPort: shared[0],
      proxyPort: shared[1],
      endpoint: `http://127.0.0.1:${shared[1]}`,
    };
  }
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(app))
    throw Error("invalid measurement app");
  const mapped = config.measure_ports ?? {};
  const hashed = (name) => {
    const port =
      20000 +
      (createHash("sha256").update(name).digest().readUInt32BE(0) % 10000) * 2;
    return [port, port + 1];
  };
  const ports = pair(mapped[app] ?? hashed(app));
  if (ports.some((port) => shared.includes(port)))
    throw Error("app measurement ports overlap the shared browser");
  for (const [name, value] of Object.entries(mapped)) {
    const other = pair(value);
    if (name !== app && other.some((port) => ports.includes(port)))
      throw Error("app measurement port collision; set distinct measure_ports");
  }
  const root = expand(config.measure_pool_dir || "~/.replicate/measure");
  return {
    app,
    root,
    cdpPort: ports[0],
    sharedCdpPort: shared[0],
    proxyPort: ports[1],
    endpoint: `http://127.0.0.1:${ports[1]}`,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { app, args } = measureArgs();
    if (args.length) throw Error("unsupported measurement arguments");
    console.log(JSON.stringify(measureEndpoint({ app })));
  } catch (error) {
    console.error(`measure: ${error.message}`);
    process.exitCode = 2;
  }
}
