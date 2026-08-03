import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  formatBytes,
  isSafeTarget,
  parseCleanArgs,
  performClean,
  runClean,
  scanCleanTargets,
  type CleanIo,
} from "./clean.js";

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeTempRoot(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-clean-cli-"));
  tmpRoots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

function captureIo(): { io: CleanIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { log: (m) => out.push(m), err: (m) => err.push(m) } };
}

/** A workspace with one cache dir per app, plus everything clean must not
 * touch: real user data, git internals, env files, installed packages. */
const WORKSPACE_FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "workspace" }),
  ".env": "SECRET=placeholder\n",
  ".git/HEAD": "ref: refs/heads/main\n",
  "node_modules/.vite/deps/chunk.js": "x".repeat(100),
  "node_modules/.vite/deps_temp_a1b2/orphan.js": "x".repeat(50),
  "node_modules/.vite-temp/config.mjs": "x".repeat(10),
  "node_modules/react/index.js": "x".repeat(1000),
  "node_modules/.pnpm/react@19/index.js": "x".repeat(1000),
  "apps/mail/package.json": JSON.stringify({ name: "mail" }),
  "apps/mail/node_modules/.vite/deps/dep.js": "x".repeat(200),
  "apps/mail/node_modules/.nitro/cache.json": "x".repeat(25),
  "apps/mail/data/uploads/user-file.bin": "x".repeat(5000),
  "apps/mail/.env.local": "KEY=placeholder\n",
  "apps/mail/build/client/bundle.js": "x".repeat(400),
  "apps/mail/dist/server.js": "x".repeat(300),
  "apps/mail/.output/server/index.mjs": "x".repeat(600),
  ".netlify/functions-internal/handler.zip": "x".repeat(800),
  "apps/mail/src/dist/keep-me.ts": "export const kept = true;\n",
};

const APP_FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "solo-app" }),
  "node_modules/.vite/deps/dep.js": "x".repeat(120),
  "node_modules/.nitro/cache.json": "x".repeat(30),
  "data/notes.db": "x".repeat(9000),
  "build/client/bundle.js": "x".repeat(70),
};

function targetPaths(root: string, targets: { path: string }[]): string[] {
  return targets.map((t) => path.relative(root, t.path)).sort();
}

describe("parseCleanArgs", () => {
  it("parses all flags", () => {
    expect(
      parseCleanArgs(["--apply", "--builds", "--json", "--cwd", "/tmp/app"]),
    ).toEqual({ apply: true, builds: true, json: true, cwd: "/tmp/app" });
  });

  it("parses --dry-run, -n and --help", () => {
    expect(parseCleanArgs(["--dry-run"])).toEqual({ dryRun: true });
    expect(parseCleanArgs(["-n"])).toEqual({ dryRun: true });
    expect(parseCleanArgs(["--help"])).toEqual({ help: true });
  });

  it("errors on --cwd with a missing or empty value instead of dropping it", () => {
    expect(parseCleanArgs(["--builds", "--apply", "--cwd"]).error).toMatch(
      /--cwd requires a directory path/,
    );
    expect(parseCleanArgs(["--cwd="]).error).toMatch(
      /--cwd requires a directory path/,
    );
    expect(parseCleanArgs(["--cwd="]).cwd).toBeUndefined();
  });

  it("errors on an unrecognized argument rather than degrading quietly", () => {
    // `--aply` silently ignored is the difference between a dry run and a
    // real delete.
    expect(parseCleanArgs(["--builds", "--aply"]).error).toMatch(
      /Unknown argument: --aply/,
    );
    expect(parseCleanArgs(["--build"]).error).toMatch(
      /Unknown argument: --build/,
    );
    expect(parseCleanArgs(["--builds", "--aply"]).apply).toBeUndefined();
  });
});

describe("isSafeTarget", () => {
  const root = "/ws";

  it("accepts caches nested under node_modules", () => {
    expect(isSafeTarget(root, "/ws/node_modules/.vite")).toBe(true);
    expect(isSafeTarget(root, "/ws/apps/mail/node_modules/.nitro")).toBe(true);
  });

  it("rejects protected names, protected parents, and paths outside root", () => {
    expect(isSafeTarget(root, "/ws/node_modules")).toBe(false);
    expect(isSafeTarget(root, "/ws/.git")).toBe(false);
    expect(isSafeTarget(root, "/ws/apps/mail/data")).toBe(false);
    expect(isSafeTarget(root, "/ws/apps/mail/data/uploads")).toBe(false);
    expect(isSafeTarget(root, "/ws/.git/objects")).toBe(false);
    expect(isSafeTarget(root, "/ws/node_modules/.pnpm")).toBe(false);
    expect(isSafeTarget(root, "/ws/.env")).toBe(false);
    expect(isSafeTarget(root, "/ws/apps/mail/.env.local")).toBe(false);
    expect(isSafeTarget(root, "/ws")).toBe(false);
    expect(isSafeTarget(root, "/etc")).toBe(false);
  });
});

describe("scanCleanTargets", () => {
  it("selects only caches by default, across a workspace", () => {
    const root = makeTempRoot(WORKSPACE_FILES);
    const scan = scanCleanTargets({ root });

    expect(scan.scope).toBe("workspace");
    expect(targetPaths(root, scan.targets)).toEqual([
      "apps/mail/node_modules/.nitro",
      "apps/mail/node_modules/.vite",
      "node_modules/.vite",
      "node_modules/.vite-temp",
    ]);
    expect(scan.failures).toEqual([]);
  });

  it("detects a single app directory rather than assuming a workspace", () => {
    const root = makeTempRoot(APP_FILES);
    const scan = scanCleanTargets({ root });

    expect(scan.scope).toBe("app");
    expect(targetPaths(root, scan.targets)).toEqual([
      "node_modules/.nitro",
      "node_modules/.vite",
    ]);
  });

  it("adds build outputs and deploy bundles only with --builds", () => {
    const root = makeTempRoot(WORKSPACE_FILES);
    const scan = scanCleanTargets({ root, builds: true });

    expect(targetPaths(root, scan.targets)).toEqual([
      ".netlify/functions-internal",
      "apps/mail/.output",
      "apps/mail/build",
      "apps/mail/dist",
      "apps/mail/node_modules/.nitro",
      "apps/mail/node_modules/.vite",
      "node_modules/.vite",
      "node_modules/.vite-temp",
    ]);
  });

  it("never selects data, .git, node_modules, .env or installed packages", () => {
    const root = makeTempRoot(WORKSPACE_FILES);
    const selected = scanCleanTargets({ root, builds: true }).targets.map((t) =>
      path.relative(root, t.path),
    );

    for (const forbidden of [
      "node_modules",
      "node_modules/react",
      "node_modules/.pnpm",
      ".git",
      ".env",
      "apps/mail/data",
      "apps/mail/.env.local",
      "apps/mail/src/dist",
    ]) {
      expect(selected).not.toContain(forbidden);
    }
  });

  it("counts a hard-linked file once, not once per link", () => {
    const root = makeTempRoot({
      "package.json": JSON.stringify({ name: "solo-app" }),
      ".netlify/functions-internal/server/bundle.js": "x".repeat(1000),
      ".netlify/functions-internal/server/meta.json": "y".repeat(1000),
    });
    // The deploy step hard-links the server bundle into each function
    // directory, so the tree holds 2000 bytes however many links point at it.
    const bundle = path.join(
      root,
      ".netlify/functions-internal/server/bundle.js",
    );
    for (const fn of ["agent-background", "integration-recovery"]) {
      const dir = path.join(root, ".netlify/functions-internal", fn);
      fs.mkdirSync(dir, { recursive: true });
      fs.linkSync(bundle, path.join(dir, "bundle.js"));
    }

    const deploy = scanCleanTargets({ root, builds: true }).targets.find(
      (t) =>
        path.relative(root, t.path) ===
        path.join(".netlify", "functions-internal"),
    );
    expect(deploy?.bytes).toBe(2000);
  });

  it("counts the deps_temp_* orphans inside .vite once, not twice", () => {
    const root = makeTempRoot(WORKSPACE_FILES);
    const vite = scanCleanTargets({ root }).targets.find(
      (t) => path.relative(root, t.path) === "node_modules/.vite",
    );
    // deps/chunk.js (100) + deps_temp_a1b2/orphan.js (50), each counted once.
    expect(vite?.bytes).toBe(150);
  });
});

describe("performClean", () => {
  it("a dry run deletes nothing and reclaims nothing", () => {
    const root = makeTempRoot(WORKSPACE_FILES);
    const report = performClean({ root, builds: true });

    expect(report.applied).toBe(false);
    expect(report.bytesFound).toBeGreaterThan(0);
    expect(report.bytesReclaimed).toBe(0);
    for (const target of report.targets) {
      expect(fs.existsSync(target.path)).toBe(true);
    }
  });

  it("--apply removes the caches and leaves data, .git and node_modules alone", () => {
    const root = makeTempRoot(WORKSPACE_FILES);
    const report = performClean({ root, apply: true });

    expect(report.applied).toBe(true);
    expect(report.failures).toEqual([]);
    expect(report.bytesReclaimed).toBe(report.bytesFound);
    expect(report.byCategory["vite-cache"]?.reclaimed).toBe(360);
    expect(report.byCategory["nitro-cache"]?.reclaimed).toBe(25);

    expect(fs.existsSync(path.join(root, "node_modules/.vite"))).toBe(false);
    expect(
      fs.existsSync(path.join(root, "apps/mail/node_modules/.nitro")),
    ).toBe(false);
    expect(fs.existsSync(path.join(root, "node_modules/react/index.js"))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(root, "apps/mail/data/uploads/user-file.bin")),
    ).toBe(true);
    expect(fs.existsSync(path.join(root, ".git/HEAD"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".env"))).toBe(true);
    // Build outputs need --builds.
    expect(fs.existsSync(path.join(root, "apps/mail/build"))).toBe(true);
  });

  it("reports a failed delete instead of a clean total", () => {
    const root = makeTempRoot(APP_FILES);
    const stuck = path.join(root, "node_modules/.vite");
    const readOnlyParent = path.join(stuck, "deps");
    fs.chmodSync(readOnlyParent, 0o500);

    try {
      const report = performClean({ root, apply: true });

      expect(report.failures).toHaveLength(1);
      expect(report.failures[0].path).toBe(stuck);
      expect(report.failures[0].remainingBytes).toBe(120);
      expect(fs.existsSync(stuck)).toBe(true);
      // The stuck 120 bytes are not counted; the .nitro cache that really
      // went away still is.
      expect(report.bytesFound).toBe(150);
      expect(report.bytesReclaimed).toBe(30);
    } finally {
      fs.chmodSync(readOnlyParent, 0o700);
    }
  });
});

describe("runClean (CLI)", () => {
  it("--help exits 0 and prints usage", async () => {
    const { io, out } = captureIo();
    expect(await runClean(["--help"], io)).toBe(0);
    expect(out.join("\n")).toMatch(/Usage:/);
  });

  it("defaults to a dry run, printing paths and bytes without deleting", async () => {
    const root = makeTempRoot(APP_FILES);
    const { io, out } = captureIo();

    expect(await runClean(["--cwd", root], io)).toBe(0);
    const printed = out.join("\n");
    expect(printed).toMatch(/Would reclaim/);
    expect(printed).toMatch(/re-run with --apply/);
    expect(printed).toContain(path.join(root, "node_modules", ".vite"));
    expect(fs.existsSync(path.join(root, "node_modules/.vite"))).toBe(true);
  });

  it("rejects --apply together with --dry-run", async () => {
    const { io, err } = captureIo();
    expect(await runClean(["--apply", "--dry-run"], io)).toBe(2);
    expect(err.join("\n")).toMatch(/not both/);
  });

  it("a bad --cwd exits 2", async () => {
    const { io, err } = captureIo();
    expect(
      await runClean(["--cwd", "/definitely/not/a/real/path/xyz"], io),
    ).toBe(2);
    expect(err.join("\n")).toMatch(/does not exist/);
  });

  it("refuses a directory with no project marker instead of deleting build/", async () => {
    // `~/Documents/build` is a plausible personal folder, and isSafeTarget
    // only vouches for the name.
    const root = makeTempRoot({ "build/notes/draft.txt": "x".repeat(400) });
    const { io, err } = captureIo();

    expect(await runClean(["--cwd", root, "--builds", "--apply"], io)).toBe(2);
    expect(err.join("\n")).toMatch(/not a project root/);
    expect(fs.existsSync(path.join(root, "build/notes/draft.txt"))).toBe(true);
  });

  it("accepts a root marked by agent-native.json or apps/ alone", async () => {
    const manifestOnly = makeTempRoot({
      "agent-native.json": "{}",
      "build/client/bundle.js": "x".repeat(40),
    });
    const appsOnly = makeTempRoot({
      "apps/mail/build/client/bundle.js": "x".repeat(40),
    });
    const { io } = captureIo();

    expect(await runClean(["--cwd", manifestOnly, "--builds"], io)).toBe(0);
    expect(await runClean(["--cwd", appsOnly, "--builds"], io)).toBe(0);
  });

  it("a --cwd with no value is a usage error, not a clean of the current directory", async () => {
    const { io, err } = captureIo();
    expect(await runClean(["--builds", "--apply", "--cwd"], io)).toBe(2);
    expect(err.join("\n")).toMatch(/--cwd requires a directory path/);
  });

  it("an unrecognized flag is a usage error", async () => {
    const { io, err } = captureIo();
    expect(await runClean(["--builds", "--aply"], io)).toBe(2);
    expect(err.join("\n")).toMatch(/Unknown argument: --aply/);
  });

  it("--json reports per-category bytes and ok", async () => {
    const root = makeTempRoot(APP_FILES);
    const { io, out } = captureIo();

    expect(await runClean(["--cwd", root, "--json", "--apply"], io)).toBe(0);
    const parsed = JSON.parse(out.join(""));
    expect(parsed.ok).toBe(true);
    expect(parsed.scope).toBe("app");
    expect(parsed.applied).toBe(true);
    expect(parsed.byCategory["vite-cache"]).toEqual({
      found: 120,
      reclaimed: 120,
      count: 1,
    });
    expect(parsed.bytesReclaimed).toBe(150);
  });

  it("exits 1 and names the path when a delete fails", async () => {
    const root = makeTempRoot(APP_FILES);
    const readOnlyParent = path.join(root, "node_modules");
    fs.chmodSync(readOnlyParent, 0o500);

    try {
      const { io, out } = captureIo();
      expect(await runClean(["--cwd", root, "--apply"], io)).toBe(1);
      const printed = out.join("\n");
      expect(printed).toMatch(/failure\(s\) — this run is incomplete/);
      expect(printed).toContain(path.join(root, "node_modules", ".vite"));
      expect(printed).toMatch(/still on disk/);
    } finally {
      fs.chmodSync(readOnlyParent, 0o700);
    }
  });
});

describe("formatBytes", () => {
  it("scales to the largest whole unit", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(487 * 1024 * 1024)).toBe("487.0 MB");
  });
});
