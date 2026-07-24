import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  _appTitleForScaffold,
  _fixPackageJsonName,
  _fixWebManifestName,
  _getCoreDependencyVersion,
  _getDispatchDependencyVersion,
  _getToolkitDependencyVersion,
  _postProcessStandalone,
  _renameGitignore,
  _replacePlaceholders,
  _rewriteNetlifyToml,
  _rewriteTrackingAppId,
  _scaffoldAppTemplate,
  _shouldSkipScaffoldEntry,
} from "./create.js";
import {
  baselineExists,
  materializeBaseline,
  resolveBaselineStore,
} from "./template-baseline.js";
import {
  isMergeExcluded,
  materializeTemplate,
  mergeTemplateTrees,
  readProvenance,
  resolveTargets,
  runTemplate,
} from "./template-sync.js";
import { workspacifyApp } from "./workspacify.js";

let tmpDir: string;
let origCwd: string;

beforeEach(() => {
  origCwd = process.cwd();
  tmpDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "an-template-spec-")),
  );
});

afterEach(() => {
  process.chdir(origCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function tree(files: Record<string, string | Buffer>): string {
  const dir = fs.mkdtempSync(path.join(tmpDir, "tree-"));
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return dir;
}

function read(dir: string, rel: string): string | null {
  try {
    return fs.readFileSync(path.join(dir, rel), "utf-8");
  } catch {
    return null;
  }
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Regular files only, skipping symlinks and never-scaffolded entries. */
function scaffoldFileList(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const abs = path.join(dir, entry.name);
      if (_shouldSkipScaffoldEntry(entry.name, abs)) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(abs, rel);
      else if (entry.isFile()) out.push(rel);
    }
  };
  walk(root, "");
  return out.sort();
}

function collectIO() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: { out: (m: string) => out.push(m), err: (m: string) => err.push(m) },
    text: () => `${out.join("\n")}\n${err.join("\n")}`,
  };
}

describe("isMergeExcluded", () => {
  it("never touches secrets, lockfiles, generated output, or personal memory", () => {
    for (const rel of [
      ".env",
      ".env.local",
      ".env.production",
      "pnpm-lock.yaml",
      "node_modules/foo/index.js",
      "learnings.md",
      "changelog/pending-thing.md",
      "dist/index.js",
      "data/app.db",
      ".git/config",
      ".agent-native/template-baseline/x.tar.gz",
    ]) {
      expect(isMergeExcluded(rel)).toBe(true);
    }
  });

  it("merges ordinary app source", () => {
    for (const rel of [
      "package.json",
      "app/root.tsx",
      "actions/hello.ts",
      ".gitignore",
      "CHANGELOG.md",
    ]) {
      expect(isMergeExcluded(rel)).toBe(false);
    }
  });
});

describe("mergeTemplateTrees", () => {
  it("leaves local edits alone when upstream did not change the file", () => {
    const base = tree({ "a.ts": "one\n" });
    const theirs = tree({ "a.ts": "one\n" });
    const app = tree({ "a.ts": "my edit\n" });
    const result = mergeTemplateTrees(app, base, theirs);
    expect(read(app, "a.ts")).toBe("my edit\n");
    expect(result.updated).toEqual([]);
  });

  it("fast-forwards unmodified files to the upstream version", () => {
    const base = tree({ "a.ts": "one\n" });
    const theirs = tree({ "a.ts": "two\n" });
    const app = tree({ "a.ts": "one\n" });
    const result = mergeTemplateTrees(app, base, theirs);
    expect(read(app, "a.ts")).toBe("two\n");
    expect(result.updated).toEqual(["a.ts"]);
  });

  it("adds files introduced upstream", () => {
    const base = tree({ "a.ts": "one\n" });
    const theirs = tree({ "a.ts": "one\n", "nested/new.ts": "new\n" });
    const app = tree({ "a.ts": "one\n" });
    const result = mergeTemplateTrees(app, base, theirs);
    expect(read(app, "nested/new.ts")).toBe("new\n");
    expect(result.added).toEqual(["nested/new.ts"]);
  });

  it("deletes files removed upstream when they are locally unmodified", () => {
    const base = tree({ "gone.ts": "bye\n" });
    const theirs = tree({ "keep.ts": "hi\n" });
    const app = tree({ "gone.ts": "bye\n" });
    const result = mergeTemplateTrees(app, base, theirs);
    expect(fs.existsSync(path.join(app, "gone.ts"))).toBe(false);
    expect(result.deleted).toEqual(["gone.ts"]);
    expect(result.added).toEqual(["keep.ts"]);
  });

  it("keeps and reports locally modified files that upstream deleted", () => {
    const base = tree({ "gone.ts": "bye\n" });
    const theirs = tree({ "other.ts": "hi\n" });
    const app = tree({ "gone.ts": "mine\n" });
    const result = mergeTemplateTrees(app, base, theirs);
    expect(read(app, "gone.ts")).toBe("mine\n");
    expect(result.keptLocal).toEqual(["gone.ts"]);
  });

  it("three-way merges non-overlapping edits without conflict markers", () => {
    const base = tree({ "a.ts": "one\ntwo\nthree\nfour\nfive\n" });
    const theirs = tree({ "a.ts": "ONE\ntwo\nthree\nfour\nfive\n" });
    const app = tree({ "a.ts": "one\ntwo\nthree\nfour\nFIVE\n" });
    const result = mergeTemplateTrees(app, base, theirs);
    expect(read(app, "a.ts")).toBe("ONE\ntwo\nthree\nfour\nFIVE\n");
    expect(result.conflicted).toEqual([]);
    expect(result.updated).toEqual(["a.ts"]);
  });

  it("writes conflict markers and counts overlapping edits", () => {
    const base = tree({ "a.ts": "one\ntwo\nthree\n" });
    const theirs = tree({ "a.ts": "one\nUPSTREAM\nthree\n" });
    const app = tree({ "a.ts": "one\nLOCAL\nthree\n" });
    const result = mergeTemplateTrees(app, base, theirs);
    expect(result.conflicted).toEqual(["a.ts"]);
    const merged = read(app, "a.ts")!;
    expect(merged).toContain("<<<<<<< ours");
    expect(merged).toContain("LOCAL");
    expect(merged).toContain("UPSTREAM");
    expect(merged).toContain(">>>>>>> theirs");
  });

  it("never marker-merges binary files changed on both sides", () => {
    const base = tree({ "logo.png": Buffer.from([0x89, 0x50, 0x00, 0x01]) });
    const theirs = tree({ "logo.png": Buffer.from([0x89, 0x50, 0x00, 0x02]) });
    const app = tree({ "logo.png": Buffer.from([0x89, 0x50, 0x00, 0x03]) });
    const result = mergeTemplateTrees(app, base, theirs);
    expect(fs.readFileSync(path.join(app, "logo.png"))).toEqual(
      Buffer.from([0x89, 0x50, 0x00, 0x03]),
    );
    expect(result.manual).toEqual(["logo.png (binary changed on both sides)"]);
    expect(result.conflicted).toEqual([]);
  });

  it("honors the never-touch list on both sides", () => {
    const base = tree({ ".env": "A=1\n", "learnings.md": "old\n" });
    const theirs = tree({ ".env": "A=2\n", "learnings.md": "new\n" });
    const app = tree({ ".env": "A=secret\n", "learnings.md": "mine\n" });
    const result = mergeTemplateTrees(app, base, theirs);
    expect(read(app, ".env")).toBe("A=secret\n");
    expect(read(app, "learnings.md")).toBe("mine\n");
    expect(result.updated).toEqual([]);
    expect(result.added).toEqual([]);
  });

  it("does not write anything in dry-run mode", () => {
    const base = tree({ "a.ts": "one\n" });
    const theirs = tree({ "a.ts": "two\n", "b.ts": "new\n" });
    const app = tree({ "a.ts": "one\n" });
    const result = mergeTemplateTrees(app, base, theirs, { dryRun: true });
    expect(read(app, "a.ts")).toBe("one\n");
    expect(fs.existsSync(path.join(app, "b.ts"))).toBe(false);
    expect(result.updated).toEqual(["a.ts"]);
    expect(result.added).toEqual(["b.ts"]);
  });

  it("reports local symlinks as manual instead of clobbering them", () => {
    const base = tree({});
    const theirs = tree({ "CLAUDE.md": "upstream\n" });
    const app = tree({ "AGENTS.md": "agents\n" });
    fs.symlinkSync("AGENTS.md", path.join(app, "CLAUDE.md"));
    const result = mergeTemplateTrees(app, base, theirs);
    expect(fs.lstatSync(path.join(app, "CLAUDE.md")).isSymbolicLink()).toBe(
      true,
    );
    expect(result.manual).toEqual(["CLAUDE.md (local symlink)"]);
  });
});

describe("materializeTemplate", () => {
  it("reproduces a standalone scaffold byte-for-byte", async () => {
    const appDir = path.join(tmpDir, "scaffolded");
    const resolution = await _scaffoldAppTemplate(appDir, "headless");
    _postProcessStandalone("scaffolded", appDir, "headless", resolution);

    const materialized = await materializeTemplate({
      appName: "scaffolded",
      template: "headless",
      ref: null,
      shape: "standalone",
    });

    const scaffoldFiles = scaffoldFileList(appDir);
    expect(scaffoldFileList(materialized.dir)).toEqual(scaffoldFiles);
    for (const rel of scaffoldFiles) {
      expect(
        fs.readFileSync(path.join(materialized.dir, rel)),
        `mismatch at ${rel}`,
      ).toEqual(fs.readFileSync(path.join(appDir, rel)));
    }
    fs.rmSync(materialized.dir, { recursive: true, force: true });
  }, 120_000);

  it("reproduces a full first-party template scaffold byte-for-byte", async () => {
    const appDir = path.join(tmpDir, "my-chat");
    const resolution = await _scaffoldAppTemplate(appDir, "chat");
    _postProcessStandalone("my-chat", appDir, "chat", resolution);

    const materialized = await materializeTemplate({
      appName: "my-chat",
      template: "chat",
      ref: null,
      shape: "standalone",
    });

    const scaffoldFiles = scaffoldFileList(appDir);
    expect(scaffoldFiles.length).toBeGreaterThan(20);
    expect(scaffoldFileList(materialized.dir)).toEqual(scaffoldFiles);
    for (const rel of scaffoldFiles) {
      expect(
        fs.readFileSync(path.join(materialized.dir, rel)),
        `mismatch at ${rel}`,
      ).toEqual(fs.readFileSync(path.join(appDir, rel)));
    }
    fs.rmSync(materialized.dir, { recursive: true, force: true });
  }, 180_000);

  it("reproduces a workspace app scaffold byte-for-byte", async () => {
    const workspaceRoot = path.join(tmpDir, "my-ws");
    const appDir = path.join(workspaceRoot, "apps", "crm");
    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "my-ws",
          private: true,
          "agent-native": { workspaceCore: "@my-ws/shared" },
        },
        null,
        2,
      )}\n`,
    );

    // Mirrors scaffoldOneAppIntoWorkspace's transform order exactly.
    const resolution = await _scaffoldAppTemplate(appDir, "chat");
    _replacePlaceholders(appDir, "crm", _appTitleForScaffold("crm"), "my-ws");
    _rewriteTrackingAppId(appDir, "crm", "chat");
    workspacifyApp({
      appDir,
      appName: "crm",
      templateName: "chat",
      workspaceRoot,
      workspaceCoreName: "@my-ws/shared",
      coreDependencyVersion: _getCoreDependencyVersion(),
      dispatchDependencyVersion: _getDispatchDependencyVersion(),
      toolkitDependencyVersion: _getToolkitDependencyVersion(),
    });
    _fixPackageJsonName(appDir, "crm", "chat", {
      ...resolution,
      shape: "workspace",
    });
    _fixWebManifestName(appDir, "crm", "chat");
    _rewriteNetlifyToml(appDir, "crm", "workspace");
    _renameGitignore(appDir);

    const materialized = await materializeTemplate({
      appName: "crm",
      template: "chat",
      ref: null,
      shape: "workspace",
      workspaceRoot,
      workspaceCoreName: "@my-ws/shared",
    });

    const scaffoldFiles = scaffoldFileList(appDir);
    expect(scaffoldFiles.length).toBeGreaterThan(20);
    expect(scaffoldFileList(materialized.dir)).toEqual(scaffoldFiles);
    for (const rel of scaffoldFiles) {
      expect(
        fs.readFileSync(path.join(materialized.dir, rel)),
        `mismatch at ${rel}`,
      ).toEqual(fs.readFileSync(path.join(appDir, rel)));
    }
    fs.rmSync(materialized.dir, { recursive: true, force: true });
  }, 180_000);

  it("records provenance the scaffolder can round-trip", async () => {
    const appDir = path.join(tmpDir, "prov");
    const resolution = await _scaffoldAppTemplate(appDir, "headless");
    _postProcessStandalone("prov", appDir, "headless", resolution);
    const provenance = readProvenance(appDir);
    expect(provenance.template).toBe("headless");
    expect(provenance.shape).toBe("standalone");
    expect(provenance.templateSource).toBe("bundled");
    expect(typeof provenance.templateRef).toBe("string");
    expect(typeof provenance.coreVersion).toBe("string");
  }, 120_000);
});

describe("agent-native template commands", () => {
  async function scaffoldInRepo(): Promise<{
    repoRoot: string;
    appDir: string;
  }> {
    const repoRoot = path.join(tmpDir, "repo");
    fs.mkdirSync(repoRoot, { recursive: true });
    git(repoRoot, ["init", "-q", "-b", "main"]);
    const appDir = path.join(repoRoot, "my-app");
    const resolution = await _scaffoldAppTemplate(appDir, "headless");
    _postProcessStandalone("my-app", appDir, "headless", resolution);
    git(repoRoot, ["add", "-A"]);
    git(repoRoot, ["commit", "-qm", "scaffold"]);
    return { repoRoot, appDir };
  }

  it("resolves the current app from a nested directory", async () => {
    const { appDir } = await scaffoldInRepo();
    const nested = path.join(appDir, "actions");
    fs.mkdirSync(nested, { recursive: true });
    const targets = resolveTargets(nested);
    expect(targets).toHaveLength(1);
    expect(targets[0]!.appDir).toBe(appDir);
    expect(targets[0]!.shape).toBe("standalone");
  }, 120_000);

  it("records a baseline and reports clean status, then a local edit", async () => {
    const { appDir } = await scaffoldInRepo();
    process.chdir(appDir);

    const baseline = collectIO();
    expect(await runTemplate(["baseline"], baseline.io)).toBe(0);
    expect(baseline.text()).toContain("baseline recorded at");

    const store = resolveBaselineStore(appDir);
    expect(baselineExists(store, "baseline")).toBe(true);

    const clean = collectIO();
    expect(await runTemplate(["status"], clean.io)).toBe(0);
    expect(clean.text()).toContain("locally modified files: 0");
    expect(clean.text()).toContain("upstream-changed files: 0");

    fs.writeFileSync(path.join(appDir, "AGENTS.md"), "my own guidance\n");
    const dirty = collectIO();
    expect(await runTemplate(["status"], dirty.io)).toBe(0);
    expect(dirty.text()).toContain("locally modified files: 1");
  }, 180_000);

  it("syncing against an unchanged upstream is a no-op that advances the baseline", async () => {
    const { appDir } = await scaffoldInRepo();
    process.chdir(appDir);
    await runTemplate(["baseline"], collectIO().io);

    const sync = collectIO();
    expect(await runTemplate(["sync"], sync.io)).toBe(0);
    expect(sync.text()).toContain("added:      0");
    expect(sync.text()).toContain("updated:    0");
    expect(sync.text()).toContain("conflicted: 0");
    expect(sync.text()).toContain("Baseline advanced to");
  }, 180_000);

  it("refuses to sync a dirty app directory unless forced", async () => {
    const { appDir } = await scaffoldInRepo();
    process.chdir(appDir);
    await runTemplate(["baseline"], collectIO().io);
    fs.writeFileSync(path.join(appDir, "AGENTS.md"), "dirty\n");

    const refused = collectIO();
    expect(await runTemplate(["sync"], refused.io)).toBe(1);
    expect(refused.text()).toContain(
      "Sync refused because the app directory has uncommitted changes",
    );

    const forced = collectIO();
    expect(await runTemplate(["sync", "--force"], forced.io)).toBe(0);
  }, 180_000);

  it("merges real upstream changes into the app", async () => {
    const { appDir } = await scaffoldInRepo();
    process.chdir(appDir);
    await runTemplate(["baseline"], collectIO().io);

    // Rewrite the baseline as if the app had been generated from an older
    // upstream, so the current template really is "newer".
    const store = resolveBaselineStore(appDir);
    const older = materializeBaseline(store, "baseline")!;
    fs.writeFileSync(path.join(older, "AGENTS.md"), "ancient guidance\n");
    fs.writeFileSync(path.join(older, "removed-upstream.md"), "gone later\n");
    fs.rmSync(path.join(older, "package.json"));
    const { writeBaseline } = await import("./template-baseline.js");
    writeBaseline(store, older, "baseline", {
      template: "headless",
      templateRef: "older",
    });
    fs.rmSync(older, { recursive: true, force: true });

    fs.writeFileSync(path.join(appDir, "AGENTS.md"), "ancient guidance\n");
    fs.writeFileSync(path.join(appDir, "removed-upstream.md"), "gone later\n");
    git(path.dirname(appDir), ["add", "-A"]);
    git(path.dirname(appDir), ["commit", "-qm", "older state"]);

    const sync = collectIO();
    expect(await runTemplate(["sync"], sync.io)).toBe(0);
    expect(fs.readFileSync(path.join(appDir, "AGENTS.md"), "utf-8")).not.toBe(
      "ancient guidance\n",
    );
    expect(fs.existsSync(path.join(appDir, "removed-upstream.md"))).toBe(false);
    expect(fs.existsSync(path.join(appDir, "package.json"))).toBe(true);
    expect(sync.text()).toContain("Baseline advanced to");
  }, 180_000);

  it("holds the baseline back and refuses accept while conflict markers remain", async () => {
    const { appDir } = await scaffoldInRepo();
    process.chdir(appDir);
    await runTemplate(["baseline"], collectIO().io);

    const store = resolveBaselineStore(appDir);
    const older = materializeBaseline(store, "baseline")!;
    fs.writeFileSync(path.join(older, "AGENTS.md"), "line1\nbase\nline3\n");
    const { writeBaseline } = await import("./template-baseline.js");
    writeBaseline(store, older, "baseline", {
      template: "headless",
      templateRef: "older",
    });
    fs.rmSync(older, { recursive: true, force: true });

    fs.writeFileSync(path.join(appDir, "AGENTS.md"), "line1\nmine\nline3\n");
    git(path.dirname(appDir), ["add", "-A"]);
    git(path.dirname(appDir), ["commit", "-qm", "local edit"]);

    const sync = collectIO();
    expect(await runTemplate(["sync"], sync.io)).toBe(1);
    expect(sync.text()).toContain("agent-native template accept");
    expect(fs.readFileSync(path.join(appDir, "AGENTS.md"), "utf-8")).toContain(
      "<<<<<<< ours",
    );
    expect(baselineExists(store, "pending")).toBe(true);

    const blocked = collectIO();
    expect(await runTemplate(["accept"], blocked.io)).toBe(1);
    expect(blocked.text()).toContain("accept refused because conflict markers");

    fs.writeFileSync(path.join(appDir, "AGENTS.md"), "resolved\n");
    const accepted = collectIO();
    expect(await runTemplate(["accept"], accepted.io)).toBe(0);
    expect(baselineExists(store, "pending")).toBe(false);
  }, 180_000);

  it("diff reports upstream changes without writing", async () => {
    const { appDir } = await scaffoldInRepo();
    process.chdir(appDir);
    await runTemplate(["baseline"], collectIO().io);

    const store = resolveBaselineStore(appDir);
    const older = materializeBaseline(store, "baseline")!;
    fs.writeFileSync(path.join(older, "AGENTS.md"), "ancient\n");
    const { writeBaseline } = await import("./template-baseline.js");
    writeBaseline(store, older, "baseline", {
      template: "headless",
      templateRef: "older",
    });
    fs.rmSync(older, { recursive: true, force: true });

    const before = fs.readFileSync(path.join(appDir, "AGENTS.md"), "utf-8");
    const diff = collectIO();
    expect(await runTemplate(["diff"], diff.io)).toBe(0);
    expect(diff.text()).toContain("AGENTS.md");
    expect(diff.text()).toContain("-ancient");
    expect(fs.readFileSync(path.join(appDir, "AGENTS.md"), "utf-8")).toBe(
      before,
    );
  }, 180_000);

  it("prints usage for an unknown or missing command", async () => {
    const { appDir } = await scaffoldInRepo();
    process.chdir(appDir);
    const help = collectIO();
    expect(await runTemplate([], help.io)).toBe(1);
    expect(help.text()).toContain("agent-native template <command>");

    const bad = collectIO();
    expect(await runTemplate(["nope"], bad.io)).toBe(1);
    expect(bad.text()).toContain('Unknown template command "nope"');
  }, 120_000);
});
