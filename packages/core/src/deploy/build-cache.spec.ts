import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hashBuildEnv, snapshotAppOutputs, treeHashOf } from "./build-cache.js";
import { runWorkspaceDeploy } from "./workspace-deploy.js";

let root: string;
let builds: string[];
let logs: string[];
let buildCounter: number;
let deterministic = false;

const APPS = ["alpha", "beta"];

function write(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function makeWorkspace() {
  execFileSync("git", ["init", "-q"], { cwd: root });
  write(path.join(root, ".gitignore"), "node_modules\ndist\n.netlify\n");
  write(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  write(
    path.join(root, "packages/shared/package.json"),
    JSON.stringify({ name: "@acme/shared", version: "1.0.0" }),
  );
  write(path.join(root, "packages/shared/src/index.ts"), "export const a = 1;");
  write(path.join(root, "packages/shared/dist/index.js"), "export const a=1;");
  for (const app of APPS) {
    write(
      path.join(root, "apps", app, "package.json"),
      JSON.stringify({
        name: app,
        scripts: { build: "agent-native build" },
        dependencies: { "@acme/shared": "workspace:*" },
      }),
    );
    write(path.join(root, "apps", app, "app/root.tsx"), `// ${app} v1`);
    fs.mkdirSync(path.join(root, "apps", app, "node_modules/@acme"), {
      recursive: true,
    });
    fs.symlinkSync(
      path.join(root, "packages/shared"),
      path.join(root, "apps", app, "node_modules/@acme/shared"),
    );
  }
}

/** Fake `pnpm --filter <app> build`: output depends on a per-call counter. */
const fakeBuild = (async (_cmd: string, args: string[]) => {
  const app = String(args[1]);
  builds.push(app);
  const appDir = path.join(root, "apps", app);
  const n = deterministic ? 0 : ++buildCounter;
  const perBuild = `2026-01-01T00:00:0${++buildCounter % 10}.000Z`;
  write(path.join(appDir, "dist", app, "marker.txt"), `build-${n}`);
  write(path.join(appDir, "dist", app, "favicon.svg"), "<svg></svg>");
  write(
    path.join(appDir, ".netlify/functions-internal/nitro.json"),
    `{ "date": "${perBuild}" }`,
  );
  const server = path.join(appDir, ".netlify/functions-internal/server");
  write(
    path.join(server, "main.mjs"),
    `export default async function handler() { return new Response("${app}-${n}"); }\n`,
  );
  write(
    path.join(server, "server.mjs"),
    'export { default } from "./main.mjs";\nexport const config = { name: "server handler", path: "/*", preferStatic: true };\n',
  );
}) as unknown as typeof execFileSync;

function deploy() {
  return runWorkspaceDeploy({
    workspaceRoot: root,
    preset: "netlify",
    buildOnly: true,
    execFile: fakeBuild,
  });
}

function builtMarker(app: string): string {
  return fs.readFileSync(
    path.join(root, "dist/_workspace_static", app, "marker.txt"),
    "utf-8",
  );
}

function entryOutputs(app: string): string {
  const appCache = path.join(
    root,
    "node_modules/.cache/agent-native/deploy-build",
    app,
  );
  const [key] = fs.readdirSync(appCache);
  return path.join(appCache, key, "outputs");
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "an-build-cache-"));
  builds = [];
  logs = [];
  buildCounter = 0;
  deterministic = false;
  vi.spyOn(console, "log").mockImplementation((m: unknown) => {
    logs.push(String(m));
  });
  vi.stubEnv("AGENT_NATIVE_DEPLOY_CONCURRENCY", "1");
  vi.stubEnv("NITRO_PRESET", "");
  makeWorkspace();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("workspace deploy build cache", () => {
  it("rebuilds nothing when no input changed", async () => {
    await deploy();
    expect(builds.sort()).toEqual(APPS);
    const first = builtMarker("alpha");
    builds = [];

    await deploy();

    expect(builds).toEqual([]);
    expect(builtMarker("alpha")).toBe(first);
    expect(logs.some((l) => l.includes("cache HIT alpha"))).toBe(true);
    expect(
      fs.readFileSync(
        path.join(root, ".netlify/functions-internal/alpha-server/main.mjs"),
        "utf-8",
      ),
    ).toContain("alpha-");
  });

  it("rebuilds only the app whose source changed", async () => {
    await deploy();
    builds = [];
    write(path.join(root, "apps/alpha/app/root.tsx"), "// alpha v2");

    await deploy();

    expect(builds).toEqual(["alpha"]);
    expect(
      logs.some((l) => l.includes("cache MISS alpha") && l.includes("source")),
    ).toBe(true);
  });

  it("rebuilds every app when a workspace package's dist changes", async () => {
    await deploy();
    builds = [];
    write(
      path.join(root, "packages/shared/dist/index.js"),
      "export const a=2;",
    );

    await deploy();

    expect(builds.sort()).toEqual(APPS);
  });

  it("ignores a workspace package's src edit that was never built into dist", async () => {
    await deploy();
    builds = [];
    write(
      path.join(root, "packages/shared/src/index.ts"),
      "export const a = 2;",
    );

    await deploy();

    expect(builds).toEqual([]);
  });

  it("rebuilds every app when a build-affecting env var changes", async () => {
    await deploy();
    builds = [];
    vi.stubEnv("VITE_SOME_PUBLIC_FLAG", "on");

    await deploy();

    expect(builds.sort()).toEqual(APPS);
  });

  it("rebuilds loudly when a cache entry is corrupt and never ships it", async () => {
    await deploy();
    builds = [];
    const marker = path.join(entryOutputs("alpha"), "dist/alpha/marker.txt");
    fs.writeFileSync(marker, "tampered");

    await deploy();

    expect(builds).toEqual(["alpha"]);
    expect(builtMarker("alpha")).not.toBe("tampered");
    expect(
      logs.some(
        (l) => l.includes("cache MISS alpha") && l.includes("restore-failed"),
      ),
    ).toBe(true);
  });

  it("treats an unreadable manifest as a typed miss", async () => {
    await deploy();
    builds = [];
    const manifest = path.join(entryOutputs("beta"), "..", "manifest.json");
    fs.writeFileSync(manifest, "{ not json");

    await deploy();

    expect(builds).toEqual(["beta"]);
    expect(
      logs.some(
        (l) => l.includes("cache MISS beta") && l.includes("entry-unreadable"),
      ),
    ).toBe(true);
  });

  it("treats an unhashable workspace as a miss, not a hit", async () => {
    fs.rmSync(path.join(root, ".git"), { recursive: true, force: true });

    await deploy();
    builds = [];
    await deploy();

    expect(builds.sort()).toEqual(APPS);
    expect(logs.some((l) => l.includes("hash-failed"))).toBe(true);
  });

  it("builds every app when the cache is switched off", async () => {
    vi.stubEnv("AGENT_NATIVE_DEPLOY_CACHE", "false");
    await deploy();
    builds = [];

    await deploy();

    expect(builds.sort()).toEqual(APPS);
    expect(fs.existsSync(path.join(root, "node_modules/.cache"))).toBe(false);
  });

  it("fails verification when a rebuild differs from the cached output", async () => {
    await deploy();
    vi.stubEnv("AGENT_NATIVE_DEPLOY_CACHE_VERIFY", "1");

    // fakeBuild embeds a per-call counter, so the rebuild is not identical.
    await expect(deploy()).rejects.toThrow(/cache verification FAILED/);
  });

  it("passes verification when only per-build values differ", async () => {
    deterministic = true;
    await deploy();
    vi.stubEnv("AGENT_NATIVE_DEPLOY_CACHE_VERIFY", "2");
    builds = [];

    await deploy();

    expect(builds.sort()).toEqual(APPS);
    expect(logs.some((l) => l.includes("verified by rebuild"))).toBe(true);
  });

  it("ignores files outside a package's published files", async () => {
    write(
      path.join(root, "packages/shared/package.json"),
      JSON.stringify({
        name: "@acme/shared",
        version: "1.0.0",
        files: ["dist"],
      }),
    );
    write(path.join(root, "packages/shared/README.md"), "v1");
    await deploy();
    builds = [];
    write(path.join(root, "packages/shared/README.md"), "v2");

    await deploy();

    expect(builds).toEqual([]);
  });

  it("hashes the whole package when a files entry starts with a glob", async () => {
    write(
      path.join(root, "packages/shared/package.json"),
      JSON.stringify({
        name: "@acme/shared",
        version: "1.0.0",
        files: ["**/*.js"],
      }),
    );
    write(path.join(root, "packages/shared/lib/extra.js"), "v1");
    await deploy();
    builds = [];
    write(path.join(root, "packages/shared/lib/extra.js"), "v2");

    await deploy();

    expect(builds.sort()).toEqual(APPS);
  });

  it("tracks same-named local dependencies at different paths separately", async () => {
    for (const dir of ["util-one", "util-two"]) {
      write(
        path.join(root, "packages", dir, "package.json"),
        JSON.stringify({ name: "util", version: "1.0.0" }),
      );
      write(path.join(root, "packages", dir, "index.js"), `// ${dir} v1`);
    }
    write(
      path.join(root, "packages/shared/package.json"),
      JSON.stringify({
        name: "@acme/shared",
        version: "1.0.0",
        dependencies: { util: "workspace:*" },
      }),
    );
    fs.mkdirSync(path.join(root, "packages/shared/node_modules"), {
      recursive: true,
    });
    fs.symlinkSync(
      path.join(root, "packages/util-one"),
      path.join(root, "packages/shared/node_modules/util"),
    );
    write(
      path.join(root, "apps/alpha/package.json"),
      JSON.stringify({
        name: "alpha",
        scripts: { build: "agent-native build" },
        dependencies: { "@acme/shared": "workspace:*", util: "workspace:*" },
      }),
    );
    fs.symlinkSync(
      path.join(root, "packages/util-two"),
      path.join(root, "apps/alpha/node_modules/util"),
    );
    await deploy();
    builds = [];
    write(path.join(root, "packages/util-two/index.js"), "// util-two v2");

    await deploy();

    expect(builds).toEqual(["alpha"]);
  });

  it("does not let files a build generates change the app's own key", async () => {
    await deploy();
    builds = [];
    write(path.join(root, "apps/alpha/.agent-native/build-config.json"), "{}");

    await deploy();

    expect(builds).toEqual([]);
  });
});

describe("build cache input and output integrity", () => {
  it("excludes volatile variables and configured exact or prefix matches from the environment key", () => {
    const env = {
      VITE_PUBLIC_FLAG: "on",
      HOME: "/home/one",
      NPM_CONFIG_CACHE: "/cache/one",
      AGENT_NATIVE_DEPLOY_CACHE_VERIFY: "0",
      CI_JOB_ID: "one",
      TRACE_SPAN: "one",
    };
    const ignored = ["CI_JOB_ID", "TRACE_*"];
    const baseline = hashBuildEnv(env, ignored);

    expect(
      hashBuildEnv(
        {
          ...env,
          HOME: "/home/two",
          NPM_CONFIG_CACHE: "/cache/two",
          AGENT_NATIVE_DEPLOY_CACHE_VERIFY: "2",
          CI_JOB_ID: "two",
          TRACE_SPAN: "two",
        },
        ignored,
      ),
    ).toBe(baseline);
    expect(hashBuildEnv({ ...env, VITE_PUBLIC_FLAG: "off" }, ignored)).not.toBe(
      baseline,
    );
    expect(hashBuildEnv({ ...env, CI_JOB_ID_EXTRA: "two" }, ignored)).not.toBe(
      baseline,
    );
    expect(hashBuildEnv({ ...env, TRACE: "two" }, ignored)).not.toBe(baseline);
    expect(hashBuildEnv({ ...env, UNSET: undefined }, ignored)).toBe(baseline);
    const ci = {
      ...env,
      GITHUB_SHA: "one",
      GITHUB_RUN_ID: "1",
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_STEP_SUMMARY: "/tmp/one",
      RUNNER_TEMP: "/tmp/one",
      ACTIONS_RUNTIME_TOKEN: "one",
    };
    expect(
      hashBuildEnv(
        {
          ...ci,
          GITHUB_SHA: "two",
          GITHUB_RUN_ID: "2",
          GITHUB_RUN_ATTEMPT: "2",
          GITHUB_STEP_SUMMARY: "/tmp/two",
          RUNNER_TEMP: "/tmp/two",
          ACTIONS_RUNTIME_TOKEN: "two",
        },
        ignored,
      ),
    ).toBe(hashBuildEnv(ci, ignored));
    expect(hashBuildEnv({ ...env, GITHUB_CLIENT_ID: "two" }, ignored)).not.toBe(
      baseline,
    );
    expect(
      hashBuildEnv({ ...env, NODE_PATH: "/modules/one" }, ignored),
    ).not.toBe(baseline);
    expect(hashBuildEnv({ ...ci, RUNNER_ARCH: "ARM64" }, ignored)).not.toBe(
      hashBuildEnv({ ...ci, RUNNER_ARCH: "X64" }, ignored),
    );
    expect(
      hashBuildEnv(Object.fromEntries(Object.entries(env).reverse()), ignored),
    ).toBe(baseline);
  });

  it("records empty directories, symlink targets, and executable modes in output identity", () => {
    const appDir = path.join(root, "apps/alpha");
    const output = path.join(appDir, "dist");
    fs.mkdirSync(path.join(output, "empty"), { recursive: true });
    write(path.join(output, "script"), "run");
    fs.symlinkSync("script", path.join(output, "link"));
    const before = snapshotAppOutputs(appDir);

    expect(before["dist/empty"]).toBe("d");
    expect(before["dist/link"]).toBe("l:script");
    expect(before["dist/script"]).toMatch(/^f:-:/);
    fs.chmodSync(path.join(output, "script"), 0o755);
    const executable = snapshotAppOutputs(appDir);
    expect(executable["dist/script"]).toMatch(/^f:x:/);
    expect(treeHashOf(executable)).not.toBe(treeHashOf(before));
    expect(
      treeHashOf(Object.fromEntries(Object.entries(before).reverse())),
    ).toBe(treeHashOf(before));
    fs.unlinkSync(path.join(output, "link"));
    fs.symlinkSync("empty", path.join(output, "link"));
    expect(treeHashOf(snapshotAppOutputs(appDir))).not.toBe(
      treeHashOf(executable),
    );
  });

  it("masks per-build values only in small function code and metadata, preserving public assets", () => {
    const appDir = path.join(root, "apps/alpha");
    const metadata = path.join(
      appDir,
      ".netlify/functions-internal/nitro.json",
    );
    const asset = path.join(appDir, "dist/config.json");
    const initial = JSON.stringify({ date: "2026-01-01", FLAG: "on" });
    write(metadata, initial);
    write(asset, initial);
    const before = snapshotAppOutputs(appDir, "stable");
    const raw = snapshotAppOutputs(appDir);
    const updated = JSON.stringify({ date: "2026-01-02", FLAG: "on" });
    write(metadata, updated);
    write(asset, updated);

    const after = snapshotAppOutputs(appDir, "stable");
    expect(after[".netlify/functions-internal/nitro.json"]).toBe(
      before[".netlify/functions-internal/nitro.json"],
    );
    expect(after["dist/config.json"]).not.toBe(before["dist/config.json"]);
    expect(
      snapshotAppOutputs(appDir)[".netlify/functions-internal/nitro.json"],
    ).not.toBe(raw[".netlify/functions-internal/nitro.json"]);
    write(metadata, JSON.stringify({ date: "2026-01-02", FLAG: "off" }));
    expect(
      snapshotAppOutputs(appDir, "stable")[
        ".netlify/functions-internal/nitro.json"
      ],
    ).not.toBe(after[".netlify/functions-internal/nitro.json"]);
  });
});
