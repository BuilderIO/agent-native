import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

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
  "apps/mail/package.json": JSON.stringify({
    name: "mail",
    dependencies: { "@agent-native/core": "1.0.0" },
  }),
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
  "package.json": JSON.stringify({
    name: "solo-app",
    dependencies: { "@agent-native/core": "1.0.0" },
  }),
  "node_modules/.vite/deps/dep.js": "x".repeat(120),
  "node_modules/.nitro/cache.json": "x".repeat(30),
  "data/notes.db": "x".repeat(9000),
  "build/client/bundle.js": "x".repeat(70),
};

function targetPaths(root: string, targets: { path: string }[]): string[] {
  return targets.map((t) => path.relative(root, t.path)).sort();
}

const AGENT_NATIVE_PACKAGE_JSON = JSON.stringify({
  name: "solo-app",
  dependencies: { "@agent-native/core": "1.0.0" },
});

/** macOS APFS is case-insensitive and case-preserving; ext4 and most CI
 * runners are not. The `Build/` case only exists on the former, so probe
 * rather than assert a pass that means nothing on the other. */
const CASE_INSENSITIVE_FS = (() => {
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), "an-clean-case-"));
  try {
    fs.mkdirSync(path.join(probe, "Build"));
    return fs.existsSync(path.join(probe, "build"));
  } finally {
    fs.rmSync(probe, { recursive: true, force: true });
  }
})();

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

  it("protects data/ whatever its casing, while targets stay case-exact", () => {
    // On a case-insensitive filesystem `Data/` and `data/` are one directory,
    // so case-exact protection walks into the app's data through the other
    // spelling. The two directions are deliberately asymmetric: widening
    // protection can only spare a cache, widening targets deletes files.
    expect(isSafeTarget(root, "/ws/Data/node_modules/.vite")).toBe(false);
    expect(isSafeTarget(root, "/ws/apps/mail/DATA/uploads")).toBe(false);
    expect(isSafeTarget(root, "/ws/.GIT/objects")).toBe(false);
    expect(isSafeTarget(root, "/ws/Node_Modules/.vite")).toBe(true);
    expect(isSafeTarget(root, "/ws/apps/mail/.ENV.local")).toBe(false);
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

  it("counts a hard link shared by two targets once across the whole run", () => {
    // The workspace deploy hard-links apps/<app>/.netlify/functions-internal/
    // server into <root>/.netlify/functions-internal/<app>-server and
    // <app>-agent-background — two separate top-level targets, one inode.
    const root = makeTempRoot({
      "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
      "package.json": JSON.stringify({ name: "workspace" }),
      "apps/mail/package.json": AGENT_NATIVE_PACKAGE_JSON,
      "apps/mail/.netlify/functions-internal/server/bundle.js": "x".repeat(
        1000,
      ),
    });
    const bundle = path.join(
      root,
      "apps/mail/.netlify/functions-internal/server/bundle.js",
    );
    for (const fn of ["mail-server", "mail-agent-background"]) {
      const dir = path.join(root, ".netlify/functions-internal", fn);
      fs.mkdirSync(dir, { recursive: true });
      fs.linkSync(bundle, path.join(dir, "bundle.js"));
    }

    const scan = scanCleanTargets({ root, builds: true });
    expect(targetPaths(root, scan.targets)).toEqual([
      ".netlify/functions-internal",
      path.join("apps", "mail", ".netlify", "functions-internal"),
    ]);
    // The run frees 1000 bytes, whichever target is deleted first.
    expect(scan.targets.reduce((total, t) => total + t.bytes, 0)).toBe(1000);
  });

  it("counts nothing for a file still hard-linked outside the delete set", () => {
    // Deleting one link of a file whose other link lives in node_modules
    // returns zero bytes to the disk, so promising them is a lie about the
    // one number this command exists to report.
    const root = makeTempRoot({
      "package.json": JSON.stringify({ name: "solo-app" }),
      "node_modules/@acme/cli/blob.bin": "x".repeat(1000),
      ".netlify/functions-internal/server/meta.json": "y".repeat(7),
    });
    fs.linkSync(
      path.join(root, "node_modules/@acme/cli/blob.bin"),
      path.join(root, ".netlify/functions-internal/server/blob.bin"),
    );

    const deploy = scanCleanTargets({ root, builds: true }).targets.find(
      (t) =>
        path.relative(root, t.path) ===
        path.join(".netlify", "functions-internal"),
    );
    expect(deploy?.bytes).toBe(7);
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

  it("never deletes through a symlinked apps/ that leaves the root", () => {
    const outside = makeTempRoot({
      "mail/build/keepme.txt": "x".repeat(230),
    });
    const root = makeTempRoot({
      "package.json": JSON.stringify({
        name: "workspace",
        dependencies: { "@agent-native/core": "1.0.0" },
      }),
    });
    // Lexically apps/mail/build is inside the root; physically it is not, and
    // the delete lands on the physical one.
    fs.symlinkSync(outside, path.join(root, "apps"));

    const report = performClean({ root, builds: true, apply: true });

    expect(report.targets).toEqual([]);
    expect(report.bytesReclaimed).toBe(0);
    expect(fs.existsSync(path.join(outside, "mail/build/keepme.txt"))).toBe(
      true,
    );
  });

  it("reports a failure when a parent is swapped between scan and delete", () => {
    const outside = makeTempRoot({ "build/victim.txt": "x".repeat(500) });
    const root = makeTempRoot({
      "package.json": AGENT_NATIVE_PACKAGE_JSON,
      "apps/a/package.json": AGENT_NATIVE_PACKAGE_JSON,
      "apps/a/build/out.js": "x".repeat(10),
      "apps/b/package.json": AGENT_NATIVE_PACKAGE_JSON,
      "apps/b/build/out.js": "x".repeat(20),
    });

    // Swap apps/b for a symlink out of the root while the first target is
    // being removed — rmSync lstats only the last component, so the kernel
    // resolves the swapped parent and the delete lands outside.
    const rmSync = fs.rmSync;
    let swapped = false;
    const spy = vi.spyOn(fs, "rmSync").mockImplementation(((
      target: fs.PathLike,
      opts?: fs.RmOptions,
    ) => {
      if (!swapped) {
        swapped = true;
        fs.renameSync(
          path.join(root, "apps", "b"),
          path.join(root, "apps", "b-moved"),
        );
        fs.symlinkSync(outside, path.join(root, "apps", "b"));
      }
      return rmSync(target, opts);
    }) as typeof fs.rmSync);

    try {
      const report = performClean({ root, builds: true, apply: true });

      expect(report.failures.map((f) => f.path)).toEqual([
        path.join(root, "apps", "b", "build"),
      ]);
      expect(fs.existsSync(path.join(outside, "build/victim.txt"))).toBe(true);
      // The swapped target's bytes are not claimed as reclaimed.
      expect(report.bytesReclaimed).toBe(10);
    } finally {
      spy.mockRestore();
    }
  });

  it.skipIf(!CASE_INSENSITIVE_FS)(
    "does not match a hand-written Build/ against the build rule",
    () => {
      const root = makeTempRoot({
        "package.json": AGENT_NATIVE_PACKAGE_JSON,
        "Build/notes/draft.txt": "x".repeat(400),
      });

      const report = performClean({ root, builds: true, apply: true });

      expect(report.targets).toEqual([]);
      expect(fs.existsSync(path.join(root, "Build/notes/draft.txt"))).toBe(
        true,
      );
    },
  );

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

/**
 * One rule, checked from every side it can be broken: a byte is credited only
 * where the run observed it removed. Anything it could not observe — a tree
 * someone else deleted, a directory it could not read, a mount point, a scan
 * cut short — is a typed outcome, never a number.
 */
describe("performClean byte accounting", () => {
  /** A `.vite` holding 64 KB nobody can read, and a `.nitro` it can. */
  function lockedViteRoot(): { root: string; locked: string } {
    const root = makeTempRoot({
      "package.json": AGENT_NATIVE_PACKAGE_JSON,
      "node_modules/.vite/deps/dep.js": "x".repeat(120),
      "node_modules/.vite/locked/big.bin": "x".repeat(64 * 1024),
    });
    const locked = path.join(root, "node_modules", ".vite", "locked");
    fs.chmodSync(locked, 0o000);
    return { root, locked };
  }

  it("credits nothing for a tree another process removed first", () => {
    const root = makeTempRoot(APP_FILES);
    const vite = path.join(root, "node_modules", ".vite");
    const realRm = fs.rmSync;
    // Two `clean --apply` runs on one root, or one racing the delete-and-
    // recreate of a Vite re-optimize: the loser's rmSync finds nothing.
    // `force: true` swallowed that ENOENT, so both runs credited the same
    // bytes and the two reports summed to more than the disk ever held.
    const spy = vi.spyOn(fs, "rmSync").mockImplementationOnce(((
      target: fs.PathLike,
      opts?: fs.RmOptions,
    ) => {
      realRm(vite, { recursive: true, force: true });
      return realRm(target, opts);
    }) as typeof fs.rmSync);

    try {
      const report = performClean({ root, apply: true });

      expect(report.failures).toEqual([]);
      expect(report.bytesFound).toBe(150);
      // The 120 belong to whoever actually freed them. Only .nitro is ours.
      expect(report.bytesReclaimed).toBe(30);
    } finally {
      spy.mockRestore();
    }
  });

  it("treats a target already deleted at re-verify as a no-op, not a failure", () => {
    const root = makeTempRoot(APP_FILES);
    const nitro = path.join(root, "node_modules", ".nitro");
    const realRm = fs.rmSync;
    const spy = vi.spyOn(fs, "rmSync").mockImplementationOnce(((
      target: fs.PathLike,
      opts?: fs.RmOptions,
    ) => {
      const result = realRm(target, opts);
      realRm(nitro, { recursive: true, force: true });
      return result;
    }) as typeof fs.rmSync);

    try {
      const report = performClean({ root, apply: true });

      // ENOENT at re-verify means the directory is gone, which is what this
      // run wanted. Exiting 1 with "could not re-check" was over-loud in
      // exactly the spot the delete one line later was over-quiet.
      expect(report.failures).toEqual([]);
      expect(report.bytesFound).toBe(150);
      expect(report.bytesReclaimed).toBe(120);
    } finally {
      spy.mockRestore();
    }
  });

  it("leaves remaining bytes unmeasured, not zero, for a tree it cannot read", () => {
    const { root, locked } = lockedViteRoot();

    let report;
    try {
      report = performClean({ root, apply: true });
    } finally {
      // Restore first: nothing inside a 0o000 directory can even be stat'd.
      fs.chmodSync(locked, 0o700);
    }
    const failure = report.failures.find(
      (f) => f.path === path.join(root, "node_modules", ".vite"),
    );

    expect(failure).toBeDefined();
    expect(failure?.remainingBytes).toBeUndefined();
    // 64 KB is still there, so no byte of this target is creditable.
    expect(report.bytesReclaimed).toBe(0);
    expect(fs.existsSync(path.join(locked, "big.bin"))).toBe(true);
  });

  it("does not print '0 B still on disk' for a tree it never measured", async () => {
    const { root, locked } = lockedViteRoot();

    try {
      const { io, out } = captureIo();
      expect(await runClean(["--cwd", root, "--apply"], io)).toBe(1);
      expect(out.join("\n")).not.toContain("0 B still on disk");
    } finally {
      fs.chmodSync(locked, 0o700);
    }
  });

  it("records one unreadable directory once, not once per pass", () => {
    const root = makeTempRoot({
      "package.json": JSON.stringify({ name: "workspace" }),
      "apps/mail/package.json": AGENT_NATIVE_PACKAGE_JSON,
      "apps/mail/build/out.js": "x".repeat(40),
    });
    const build = path.join(root, "apps", "mail", "build");
    fs.chmodSync(build, 0o000);

    try {
      const report = performClean({ root, builds: true, apply: true });
      // The cache walk, the measure pass and the post-delete re-measure all
      // reach the one unreadable directory in this tree. Three lines — one of
      // them naming it /private/var/… because that pass walks the realpath —
      // read as three separate problems.
      const reads = report.failures.filter((f) =>
        f.message.startsWith("could not read"),
      );

      expect(reads).toEqual([
        {
          path: build,
          message: `could not read: EACCES: permission denied, scandir '${build}'`,
        },
      ]);
    } finally {
      fs.chmodSync(build, 0o700);
    }
  });

  it("reports the depth cap instead of silently truncating the scan", () => {
    // The last directory the walk scans sits MAX_WALK_DEPTH below the root;
    // the first one it refuses sits one deeper.
    const scanned = Array.from({ length: 64 }, (_, i) => `d${i + 1}`).join("/");
    const truncated = `${scanned}/d65`;
    const root = makeTempRoot({
      "package.json": AGENT_NATIVE_PACKAGE_JSON,
      [`${scanned}/node_modules/.vite/dep.js`]: "x".repeat(11),
      [`${truncated}/node_modules/.vite/dep.js`]: "x".repeat(22),
    });

    const scan = scanCleanTargets({ root });

    expect(targetPaths(root, scan.targets)).toEqual([
      path.join(scanned, "node_modules", ".vite"),
    ]);
    // Returning quietly here made the 22 bytes below the cap look like
    // nothing found — no target, no bytes, and no failure saying so.
    expect(scan.failures).toContainEqual({
      path: path.join(root, truncated),
      message: "not scanned: more than 64 directories below the root",
    });
  });

  it("does not trip the depth cap on a workspace-nested app source tree", () => {
    // apps/<app>/ plus the 19 levels this repo's deepest template actually
    // reaches. A cap that fires here would make every real workspace exit 1,
    // and a failure block users learn to ignore reports nothing at all.
    const source = Array.from({ length: 19 }, (_, i) => `s${i + 1}`).join("/");
    const root = makeTempRoot({
      "package.json": JSON.stringify({ name: "workspace" }),
      "apps/mail/package.json": AGENT_NATIVE_PACKAGE_JSON,
      [`apps/mail/${source}/keep.ts`]: "export const kept = true;\n",
      "apps/mail/node_modules/.vite/dep.js": "x".repeat(11),
    });

    expect(scanCleanTargets({ root }).failures).toEqual([]);
  });

  it("does not count or delete across a mount boundary inside a target", () => {
    const root = makeTempRoot({
      "package.json": AGENT_NATIVE_PACKAGE_JSON,
      "build/client/bundle.js": "x".repeat(40),
      "build/vol/image.bin": "x".repeat(4096),
    });
    const mount = path.join(root, "build", "vol");
    const realLstat = fs.lstatSync;
    // A unit test cannot mount an APFS image, so report the one thing a mount
    // point actually changes about a directory: its st_dev.
    const spy = vi.spyOn(fs, "lstatSync").mockImplementation(((
      target: fs.PathLike,
      opts?: fs.StatSyncOptions,
    ) => {
      const stat = realLstat(target, opts as undefined) as fs.Stats;
      // Both spellings: the cache walk reaches it through the root as given,
      // the measure pass through the target's realpath.
      if (String(target).endsWith(path.join("build", "vol"))) stat.dev += 1;
      return stat;
    }) as typeof fs.lstatSync);

    try {
      const report = performClean({ root, builds: true, apply: true });

      expect(report.targets).toEqual([]);
      expect(report.bytesFound).toBe(0);
      expect(report.failures.map((f) => f.path)).toContain(mount);
      expect(fs.existsSync(path.join(mount, "image.bin"))).toBe(true);
      // build/ is not deleted around the mount either.
      expect(fs.existsSync(path.join(root, "build/client/bundle.js"))).toBe(
        true,
      );
    } finally {
      spy.mockRestore();
    }
  });
});

describe("apps/ scoping", () => {
  it("one Agent Native app does not license cleaning its neighbours", async () => {
    // `build/`, `dist/` and `.output/` are ordinary directory names. A Rust
    // project and a personal folder can sit beside the app that authorized
    // the run, and neither is Agent Native build output.
    const root = makeTempRoot({
      "package.json": JSON.stringify({ name: "workspace" }),
      "apps/realapp/package.json": AGENT_NATIVE_PACKAGE_JSON,
      "apps/realapp/build/client/bundle.js": "x".repeat(40),
      "apps/my_rust_toy/Cargo.toml": '[package]\nname = "toy"\n',
      "apps/my_rust_toy/build/HAND_WRITTEN_BINARY": "x".repeat(1000),
      "apps/my_rust_toy/dist/RELEASE_ARTIFACT": "x".repeat(1000),
      "apps/my_rust_toy/node_modules/.vite/deps/dep.js": "x".repeat(1000),
      "apps/photos/dist/vacation.raw": "x".repeat(1000),
    });

    expect(
      targetPaths(root, scanCleanTargets({ root, builds: true }).targets),
    ).toEqual([path.join("apps", "realapp", "build")]);

    const { io } = captureIo();
    expect(await runClean(["--cwd", root, "--builds", "--apply"], io)).toBe(0);

    expect(fs.existsSync(path.join(root, "apps/realapp/build"))).toBe(false);
    for (const kept of [
      "apps/my_rust_toy/build/HAND_WRITTEN_BINARY",
      "apps/my_rust_toy/dist/RELEASE_ARTIFACT",
      "apps/my_rust_toy/node_modules/.vite/deps/dep.js",
      "apps/photos/dist/vacation.raw",
    ]) {
      expect(fs.existsSync(path.join(root, kept)), kept).toBe(true);
    }
  });

  it("never descends into data/ through a different casing", () => {
    const root = makeTempRoot({
      "package.json": AGENT_NATIVE_PACKAGE_JSON,
      "Data/node_modules/.vite/deps/dep.js": "x".repeat(300),
      "node_modules/.vite/deps/dep.js": "x".repeat(120),
    });

    const report = performClean({ root, apply: true });

    expect(targetPaths(root, report.targets)).toEqual([
      path.join("node_modules", ".vite"),
    ]);
    expect(
      fs.existsSync(path.join(root, "Data/node_modules/.vite/deps/dep.js")),
    ).toBe(true);
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

  it("escapes a path containing a newline instead of printing two lines", async () => {
    const root = makeTempRoot({
      "package.json": AGENT_NATIVE_PACKAGE_JSON,
      "apps/we\nird/package.json": AGENT_NATIVE_PACKAGE_JSON,
    });
    fs.mkdirSync(path.join(root, "apps", "we\nird", "build"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(root, "apps", "we\nird", "build", "out.js"),
      "x".repeat(30),
    );
    const { io, out } = captureIo();

    expect(await runClean(["--cwd", root, "--builds"], io)).toBe(0);
    const printed = out.join("\n");
    expect(printed).toContain(
      JSON.stringify(path.join(root, "apps", "we\nird", "build")),
    );
    expect(printed).not.toMatch(/^\s*ird[/\\]build/m);
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
    expect(err.join("\n")).toMatch(/not the root of an Agent Native project/);
    expect(fs.existsSync(path.join(root, "build/notes/draft.txt"))).toBe(true);
  });

  it("refuses a plain npm project — package.json is not an Agent Native marker", async () => {
    const root = makeTempRoot({
      "package.json": JSON.stringify({ name: "my-photo-scripts" }),
      "build/vacation/IMG_0001.raw": "x".repeat(400),
      "dist/report.pdf": "x".repeat(400),
    });
    const { io, err } = captureIo();

    expect(await runClean(["--cwd", root, "--builds", "--apply"], io)).toBe(2);
    expect(err.join("\n")).toMatch(/not the root of an Agent Native project/);
    expect(fs.existsSync(path.join(root, "build/vacation/IMG_0001.raw"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(root, "dist/report.pdf"))).toBe(true);
  });

  it("refuses a bare apps/ directory with no manifest at all", async () => {
    // Any `~/Documents` with an `apps` folder in it would otherwise qualify.
    const root = makeTempRoot({
      "apps/mail/build/client/bundle.js": "x".repeat(40),
    });
    const { io, err } = captureIo();

    expect(await runClean(["--cwd", root, "--builds", "--apply"], io)).toBe(2);
    expect(err.join("\n")).toMatch(/not the root of an Agent Native project/);
    expect(
      fs.existsSync(path.join(root, "apps/mail/build/client/bundle.js")),
    ).toBe(true);
  });

  it("refuses a pnpm-workspace.yaml root with no Agent Native app under it", async () => {
    // A workspace marker says "monorepo", not "Agent Native monorepo" — every
    // pnpm repo on the machine has one, `$HOME` included for some setups.
    const root = makeTempRoot({
      "package.json": JSON.stringify({ name: "other-monorepo" }),
      "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
      "apps/mail/build/client/bundle.js": "x".repeat(40),
    });
    const { io, err } = captureIo();

    expect(await runClean(["--cwd", root, "--builds", "--apply"], io)).toBe(2);
    expect(err.join("\n")).toMatch(/not the root of an Agent Native project/);
    expect(
      fs.existsSync(path.join(root, "apps/mail/build/client/bundle.js")),
    ).toBe(true);
  });

  it("refuses an npm workspaces root with no Agent Native app under it", async () => {
    const root = makeTempRoot({
      "package.json": JSON.stringify({
        name: "other-monorepo",
        workspaces: ["packages/*"],
      }),
      "build/site/index.html": "x".repeat(400),
      "dist/bundle.js": "x".repeat(400),
      ".output/server.mjs": "x".repeat(400),
    });
    const { io, err } = captureIo();

    expect(await runClean(["--cwd", root, "--builds", "--apply"], io)).toBe(2);
    expect(err.join("\n")).toMatch(/not the root of an Agent Native project/);
    expect(fs.existsSync(path.join(root, "build/site/index.html"))).toBe(true);
    expect(fs.existsSync(path.join(root, "dist/bundle.js"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".output/server.mjs"))).toBe(true);
  });

  it("accepts a workspace root once an app under apps/ is Agent Native", async () => {
    const root = makeTempRoot({
      "package.json": JSON.stringify({ name: "workspace" }),
      "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
      "apps/mail/package.json": AGENT_NATIVE_PACKAGE_JSON,
      "apps/mail/build/client/bundle.js": "x".repeat(40),
    });
    const { io } = captureIo();

    expect(await runClean(["--cwd", root, "--builds"], io)).toBe(0);
  });

  it("accepts a root marked by agent-native.json", async () => {
    const root = makeTempRoot({
      "agent-native.json": JSON.stringify({ name: "solo-app" }),
      "build/client/bundle.js": "x".repeat(40),
    });
    const { io } = captureIo();

    expect(await runClean(["--cwd", root, "--builds"], io)).toBe(0);
  });

  it("refuses a package.json it cannot parse or read rather than assuming a project", async () => {
    // "I could not read this manifest" must not become "yes, delete this
    // project's build output".
    const broken: Array<[string, (root: string) => void]> = [
      [
        "invalid JSON",
        (root) =>
          fs.writeFileSync(
            path.join(root, "package.json"),
            '{"name": "half-written"',
          ),
      ],
      [
        "zero bytes",
        (root) => fs.writeFileSync(path.join(root, "package.json"), ""),
      ],
      [
        "unreadable mode",
        (root) => {
          fs.writeFileSync(
            path.join(root, "package.json"),
            JSON.stringify({ name: "x" }),
          );
          fs.chmodSync(path.join(root, "package.json"), 0o000);
        },
      ],
      ["a directory", (root) => fs.mkdirSync(path.join(root, "package.json"))],
    ];

    for (const [label, write] of broken) {
      const root = makeTempRoot({ "build/notes/draft.txt": "x".repeat(400) });
      write(root);
      const { io, err } = captureIo();

      expect(
        await runClean(["--cwd", root, "--builds", "--apply"], io),
        label,
      ).toBe(2);
      expect(err.join("\n"), label).toMatch(/could not be read/);
      expect(
        fs.existsSync(path.join(root, "build/notes/draft.txt")),
        label,
      ).toBe(true);
    }
  });

  it("cleans a root reached through a symlink", async () => {
    const real = makeTempRoot(APP_FILES);
    const link = path.join(path.dirname(real), `${path.basename(real)}-link`);
    fs.symlinkSync(real, link);
    const { io } = captureIo();

    try {
      expect(await runClean(["--cwd", link, "--apply"], io)).toBe(0);
      expect(fs.existsSync(path.join(real, "node_modules/.vite"))).toBe(false);
    } finally {
      fs.rmSync(link, { force: true });
    }
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

  it("--json --help answers in JSON, the one success path that ignored it", async () => {
    const { io, out } = captureIo();

    expect(await runClean(["--json", "--help"], io)).toBe(0);
    const parsed = JSON.parse(out.join(""));
    expect(parsed.ok).toBe(true);
    expect(parsed.help.join("\n")).toMatch(/Usage:/);
  });

  it("does not round a partial run into a headline that reads as complete", async () => {
    const root = makeTempRoot({
      "package.json": AGENT_NATIVE_PACKAGE_JSON,
      "node_modules/.vite/deps/dep.js": "x".repeat(1024 * 1024),
      "node_modules/.nitro/cache.json": "x".repeat(10),
    });
    const nitro = path.join(root, "node_modules", ".nitro");
    fs.chmodSync(nitro, 0o500);

    try {
      const { io, out } = captureIo();
      expect(await runClean(["--cwd", root, "--apply"], io)).toBe(1);
      const printed = out.join("\n");

      // 1048586 found against 1048576 reclaimed: both round to "1.0 MB", so
      // the headline said the run succeeded while the block below said it did
      // not. The shortfall is exact because rounding is what hid it.
      expect(printed).not.toMatch(/^Reclaimed 1\.0 MB of 1\.0 MB\.$/m);
      expect(printed).toContain("10 bytes not reclaimed");
    } finally {
      fs.chmodSync(nitro, 0o700);
    }
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
