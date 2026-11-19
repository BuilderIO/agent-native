import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  resolveAgentNativeBuildId,
  resolveAgentNativeCommitSha,
} from "../shared/build-id.js";
import {
  computeAppCacheKey,
  createDeployCacheRuntime,
  hashBuildEnv,
  snapshotAppOutputs,
  treeHashOf,
  usesContentBuildId,
} from "./build-cache.js";
import {
  checkServedAppBuild,
  htmlBakedBuildId,
  readServedBuildManifest,
} from "./served-build.js";
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
    expect(
      logs.some(
        (l) =>
          l.includes("cache MISS alpha") &&
          l.includes("env:VITE_SOME_PUBLIC_FLAG"),
      ),
    ).toBe(true);
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

  it("keeps root docs out of the key but rebuilds every app for other root files", async () => {
    write(path.join(root, "AGENTS.md"), "v1");
    await deploy();
    builds = [];
    write(path.join(root, "AGENTS.md"), "v2");
    write(path.join(root, "docs.mdx"), "new");

    await deploy();

    expect(builds).toEqual([]);

    write(path.join(root, "settings.md.json"), "{}");

    await deploy();

    expect(builds.sort()).toEqual(APPS);
    builds = [];
    write(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.1'\n");

    await deploy();

    expect(builds.sort()).toEqual(APPS);
    expect(
      logs.some((l) => l.includes("cache MISS alpha") && l.includes("root")),
    ).toBe(true);
  });

  it("hits when only the launching shell's session variables change", async () => {
    vi.stubEnv("MANPATH", "/opt/homebrew/share/man:");
    vi.stubEnv("XDG_RUNTIME_DIR", "/run/user/1");
    await deploy();
    builds = [];
    vi.stubEnv("MANPATH", ":/opt/homebrew/share/man");
    vi.stubEnv("XDG_RUNTIME_DIR", "/run/user/2");
    vi.stubEnv("__CFBundleIdentifier", "com.example.terminal");

    await deploy();

    expect(builds).toEqual([]);
  });

  it("does not let the recorded split-build id change the app's key", async () => {
    await deploy();
    builds = [];
    write(path.join(root, "apps/alpha/.agent-native-app-build-id"), "abc123");

    await deploy();

    expect(builds).toEqual([]);
  });
});

describe("content build ids across workspace commits", () => {
  const COMMIT_1 = "1".repeat(40);
  const COMMIT_2 = "2".repeat(40);
  let bakedEnv: Record<string, string | undefined>;

  /** Fake build that bakes its build id into server and client output, as the real one does. */
  const bakingBuild = (async (
    _cmd: string,
    args: string[],
    options: { env: NodeJS.ProcessEnv },
  ) => {
    const app = String(args[1]);
    builds.push(app);
    bakedEnv[app] = options.env.AGENT_NATIVE_BUILD_ID;
    const appDir = path.join(root, "apps", app);
    const id = resolveAgentNativeBuildId(options.env, "development");
    const commit = resolveAgentNativeCommitSha(options.env);
    const source = fs.readFileSync(path.join(appDir, "app/root.tsx"), "utf-8");
    write(
      path.join(appDir, "dist", app, "client.js"),
      `const __AGENT_NATIVE_BUILD_ID__=${JSON.stringify(id)};const __AGENT_NATIVE_COMMIT_SHA__=${JSON.stringify(commit)};// ${source}`,
    );
    const html = `<html><script data-agent-native-build-id>globalThis.__AGENT_NATIVE_BUILD_ID__=${JSON.stringify(id)};</script></html>`;
    const server = path.join(appDir, ".netlify/functions-internal/server");
    write(
      path.join(server, "main.mjs"),
      `export default async function handler() { return new Response(${JSON.stringify(html)}, { headers: { "content-type": "text/html" } }); }\n`,
    );
    write(
      path.join(server, "server.mjs"),
      'export { default } from "./main.mjs";\nexport const config = { name: "server handler", path: "/*", preferStatic: true };\n',
    );
  }) as unknown as typeof execFileSync;

  function deployCommit(commit: string) {
    vi.stubEnv("AGENT_NATIVE_BUILD_ID", commit);
    vi.stubEnv("AGENT_NATIVE_BUILD_SHA", "");
    bakedEnv = {};
    return runWorkspaceDeploy({
      workspaceRoot: root,
      preset: "netlify",
      buildOnly: true,
      execFile: bakingBuild,
    });
  }

  function servedClient(app: string): string {
    return fs.readFileSync(
      path.join(root, "dist/_workspace_static", app, "client.js"),
      "utf-8",
    );
  }

  /** Call the deployed Netlify function the way the platform would. */
  async function serve(functionDir: string, app: string) {
    const envBefore = { ...process.env };
    try {
      const mod = await import(
        `${path.join(functionDir, `${app}-server.mjs`)}?t=${Date.now()}-${Math.random()}`
      );
      const response: Response = await mod.default(
        new Request(`https://labs.example/${app}`),
      );
      return { headers: response.headers, html: await response.text() };
    } finally {
      for (const key of Object.keys(process.env)) {
        if (!(key in envBefore)) delete process.env[key];
      }
      Object.assign(process.env, envBefore);
    }
  }

  const functionDir = (app: string) =>
    path.join(root, ".netlify/functions-internal", `${app}-server`);

  it("hits an unchanged app on a new commit with a byte-identical bundle", async () => {
    await deployCommit(COMMIT_1);
    const betaId = readServedBuildManifest(root).apps.beta;
    const betaClient = servedClient("beta");
    const betaTree = treeHashOf(
      snapshotAppOutputs(path.join(root, "apps/beta")),
    );
    builds = [];
    write(path.join(root, "apps/alpha/app/root.tsx"), "// alpha v2");

    await deployCommit(COMMIT_2);

    expect(builds).toEqual(["alpha"]);
    expect(logs.some((l) => l.includes("cache HIT beta"))).toBe(true);
    const manifest = readServedBuildManifest(root);
    expect(manifest.revision).toBe(COMMIT_2);
    expect(manifest.apps.beta).toBe(betaId);
    expect(betaId).toMatch(/^content-[0-9a-f]{32}$/);
    expect(servedClient("beta")).toBe(betaClient);
    expect(treeHashOf(snapshotAppOutputs(path.join(root, "apps/beta")))).toBe(
      betaTree,
    );
    // The build id is the content id, never the commit; the commit-SHA define
    // keeps the commit each bundle was built at.
    expect(servedClient("beta")).toContain(
      `__AGENT_NATIVE_BUILD_ID__=${JSON.stringify(betaId)}`,
    );
    expect(servedClient("beta")).toContain(
      `__AGENT_NATIVE_COMMIT_SHA__=${JSON.stringify(COMMIT_1)}`,
    );
    expect(servedClient("alpha")).toContain(
      `__AGENT_NATIVE_COMMIT_SHA__=${JSON.stringify(COMMIT_2)}`,
    );
    expect(bakedEnv.alpha).toMatch(/^content-/);
  });

  it("bakes a non-commit AGENT_NATIVE_BUILD_ID as-is and keys it", async () => {
    await deployCommit("agent-build-123");
    expect(bakedEnv.alpha).toBe("agent-build-123");
    expect(readServedBuildManifest(root).apps.alpha).toBe("agent-build-123");
    expect(servedClient("alpha")).toContain('"agent-build-123"');

    builds = [];
    await deployCommit("agent-build-124");
    expect(builds.sort()).toEqual(APPS);
    expect(bakedEnv.beta).toBe("agent-build-124");
  });

  it("stamps the app build id when the deploy names no full commit", async () => {
    vi.stubEnv("DEPLOY_ID", "a".repeat(24));
    await deployCommit("agent-build-123");
    const manifest = readServedBuildManifest(root);
    expect(manifest.revision).toBeNull();

    const served = await serve(functionDir("alpha"), "alpha");
    expect(served.headers.get("x-agent-native-build-sha")).toBeNull();
    expect(served.headers.get("x-agent-native-app-build-id")).toBe(
      "a".repeat(24),
    );
    expect(
      checkServedAppBuild(
        { revision: manifest.revision, appBuildId: manifest.apps.alpha },
        served,
      ),
    ).toEqual({ ok: true });
  });

  it("gives a changed app a new content id", async () => {
    await deployCommit(COMMIT_1);
    const before = readServedBuildManifest(root).apps.alpha;
    write(path.join(root, "apps/alpha/app/root.tsx"), "// alpha v2");

    await deployCommit(COMMIT_2);

    const after = readServedBuildManifest(root).apps.alpha;
    expect(after).not.toBe(before);
    expect(bakedEnv.alpha).toBe(after);
    expect(servedClient("alpha")).toContain(after);
  });

  it("keeps a platform DEPLOY_ID baked in and keyed", async () => {
    vi.stubEnv("DEPLOY_ID", "a".repeat(24));
    await deployCommit(COMMIT_1);

    expect(bakedEnv.alpha).toBe(COMMIT_1);
    expect(readServedBuildManifest(root).apps.alpha).toBe("a".repeat(24));
    builds = [];
    await deployCommit(COMMIT_2);
    expect(builds.sort()).toEqual(APPS);
  });

  it("passes readback for a cached app and fails it for a stale serve", async () => {
    await deployCommit(COMMIT_1);
    const staleAlpha = path.join(root, ".tmp-stale-alpha-server");
    fs.cpSync(functionDir("alpha"), staleAlpha, { recursive: true });
    write(path.join(root, "apps/alpha/app/root.tsx"), "// alpha v2");

    await deployCommit(COMMIT_2);
    const manifest = readServedBuildManifest(root);
    const expected = (app: string) => ({
      revision: manifest.revision,
      appBuildId: manifest.apps[app],
    });

    const cachedBeta = await serve(functionDir("beta"), "beta");
    expect(checkServedAppBuild(expected("beta"), cachedBeta)).toEqual({
      ok: true,
    });
    const freshAlpha = await serve(functionDir("alpha"), "alpha");
    expect(checkServedAppBuild(expected("alpha"), freshAlpha)).toEqual({
      ok: true,
    });

    // Planted fault: the previous deploy's alpha is still what is served.
    const stale = await serve(staleAlpha, "alpha");
    const staleCheck = checkServedAppBuild(expected("alpha"), stale);
    expect(staleCheck.ok).toBe(false);
    expect(!staleCheck.ok && staleCheck.problems.join("\n")).toMatch(
      /x-agent-native-build-sha is 1{40}[\s\S]*x-agent-native-app-build-id is content-[\s\S]*page build id is content-/,
    );

    // Planted fault: current deploy stamps wrapped around the old alpha bundle.
    const restamped = checkServedAppBuild(expected("alpha"), {
      headers: freshAlpha.headers,
      html: stale.html,
    });
    expect(restamped).toEqual({
      ok: false,
      problems: [
        `page build id is ${htmlBakedBuildId(stale.html)} (expected ${manifest.apps.alpha})`,
      ],
    });
  });
});

describe("build cache input and output integrity", () => {
  it("uses a content build id only for a full commit SHA", () => {
    expect(usesContentBuildId({ AGENT_NATIVE_BUILD_ID: "a".repeat(40) })).toBe(
      true,
    );
    expect(usesContentBuildId({ AGENT_NATIVE_BUILD_ID: "B".repeat(64) })).toBe(
      true,
    );
    expect(
      usesContentBuildId({ AGENT_NATIVE_BUILD_ID: "agent-build-123" }),
    ).toBe(false);
    expect(usesContentBuildId({ AGENT_NATIVE_BUILD_ID: "a".repeat(39) })).toBe(
      false,
    );
    expect(
      usesContentBuildId({
        DEPLOY_ID: "d".repeat(24),
        AGENT_NATIVE_BUILD_ID: "a".repeat(40),
      }),
    ).toBe(false);
  });

  it("leaves the commit variables out of a content-id key only", () => {
    const runtime = createDeployCacheRuntime({
      dir: path.join(root, ".cache"),
      workspaceRoot: root,
      preset: "netlify",
      envIgnore: [],
      verifySample: 0,
    });
    const keyFor = (env: NodeJS.ProcessEnv) =>
      computeAppCacheKey(
        runtime,
        "alpha",
        path.join(root, "apps/alpha"),
        env,
        "v",
      ).key;
    expect(
      keyFor({
        AGENT_NATIVE_BUILD_ID: "1".repeat(40),
        AGENT_NATIVE_BUILD_SHA: "1".repeat(40),
      }),
    ).toBe(
      keyFor({
        AGENT_NATIVE_BUILD_ID: "2".repeat(40),
        AGENT_NATIVE_BUILD_SHA: "2".repeat(40),
      }),
    );
    expect(keyFor({ AGENT_NATIVE_BUILD_ID: "agent-build-1" })).not.toBe(
      keyFor({ AGENT_NATIVE_BUILD_ID: "agent-build-2" }),
    );
  });

  it("keeps the split-build app selectors out of an app's key", () => {
    const env = { VITE_PUBLIC_FLAG: "on" };
    const baseline = hashBuildEnv(env, []);

    expect(
      hashBuildEnv({ ...env, AGENT_NATIVE_DEPLOY_ONLY_APPS: "alpha" }, []),
    ).toBe(baseline);
    expect(
      hashBuildEnv(
        { ...env, AGENT_NATIVE_DEPLOY_ONLY_APPS: "alpha,beta,gamma" },
        [],
      ),
    ).toBe(baseline);
    expect(
      hashBuildEnv({ ...env, AGENT_NATIVE_DEPLOY_PREBUILT_APPS: "beta" }, []),
    ).toBe(baseline);
    expect(
      hashBuildEnv(
        {
          ...env,
          AGENT_NATIVE_DEPLOY_ONLY_APPS: "alpha",
          VITE_PUBLIC_FLAG: "off",
        },
        [],
      ),
    ).not.toBe(baseline);
  });

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
      RUNNER_TRACKING_ID: "github_one",
      INVOCATION_ID: "one",
      JOURNAL_STREAM: "8:1",
      SYSTEMD_EXEC_PID: "100",
      GITHUB_ARTIFACTS: "a",
      GITHUB_ARTIFACTS_LIST: "a",
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
          RUNNER_TRACKING_ID: "github_two",
          INVOCATION_ID: "two",
          JOURNAL_STREAM: "9:2",
          SYSTEMD_EXEC_PID: "200",
          GITHUB_ARTIFACTS: "b",
          GITHUB_ARTIFACTS_LIST: "b",
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
    const shell = {
      ...env,
      MANPATH: "/one",
      INFOPATH: "/one",
      LESS: "-R",
      SHLVL: "1",
      OLDPWD: "/one",
      TMUX_PANE: "%1",
      XDG_SESSION_ID: "1",
      __CFBundleIdentifier: "com.example.one",
      __CF_USER_TEXT_ENCODING: "0x1F5:0:0",
    };
    expect(
      hashBuildEnv(
        {
          ...shell,
          MANPATH: "/two",
          INFOPATH: "/two",
          LESS: "-FRX",
          SHLVL: "3",
          OLDPWD: "/two",
          TMUX_PANE: "%2",
          XDG_SESSION_ID: "2",
          __CFBundleIdentifier: "com.example.two",
          __CF_USER_TEXT_ENCODING: "0x1F5:0x8000100:0",
        },
        ignored,
      ),
    ).toBe(hashBuildEnv(shell, ignored));
    for (const name of [
      "MANPATH",
      "INFOPATH",
      "PAGER",
      "MANPAGER",
      "GIT_PAGER",
      "LESS",
      "LESSOPEN",
      "LESSCLOSE",
      "LESSHISTFILE",
      "LESSKEY",
      "HISTFILE",
      "HISTSIZE",
      "HISTCONTROL",
      "TMUX",
      "TMUX_PANE",
      "STY",
      "WINDOWID",
      "XDG_RUNTIME_DIR",
      "XDG_SESSION_ID",
      "XDG_SESSION_TYPE",
      "XDG_SESSION_CLASS",
      "XDG_SEAT",
      "XDG_VTNR",
      "OSLogRateLimit",
      "LaunchInstanceID",
      "Apple_PubSub_Socket_Render",
    ]) {
      expect(hashBuildEnv({ ...env, [name]: "session" }, ignored)).toBe(
        baseline,
      );
    }
    for (const config of ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "LESSON_PLAN"]) {
      expect(hashBuildEnv({ ...env, [config]: "/two" }, ignored)).not.toBe(
        baseline,
      );
    }
    for (const stable of ["GITHUB_REPOSITORY", "GITHUB_REF"]) {
      expect(hashBuildEnv({ ...ci, [stable]: "two" }, ignored)).not.toBe(
        hashBuildEnv({ ...ci, [stable]: "one" }, ignored),
      );
    }
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
