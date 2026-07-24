import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  baselineExists,
  baselineRefName,
  baselineTarballPath,
  clearBaseline,
  ensureBaselineRefspecs,
  materializeBaseline,
  promoteBaseline,
  resolveBaselineStore,
  sanitizeRefPath,
  writeBaseline,
} from "./template-baseline.js";

let tmpDir: string;

const META = {
  template: "chat",
  templateRef: "@agent-native/core@1.2.3",
  coreVersion: "1.2.3",
};

beforeEach(() => {
  tmpDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "an-baseline-spec-")),
  );
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

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

function makeRepo(): { repoRoot: string; appDir: string } {
  const repoRoot = path.join(tmpDir, "repo");
  fs.mkdirSync(repoRoot, { recursive: true });
  git(repoRoot, ["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(repoRoot, "README.md"), "root\n");
  git(repoRoot, ["add", "-A"]);
  git(repoRoot, ["commit", "-qm", "initial"]);

  const appDir = path.join(repoRoot, "apps", "demo");
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(path.join(appDir, "package.json"), '{"name":"demo"}\n');
  git(repoRoot, ["add", "-A"]);
  git(repoRoot, ["commit", "-qm", "add app"]);
  return { repoRoot, appDir };
}

function makeUpstream(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(tmpDir, "upstream-"));
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return dir;
}

describe("template baseline store", () => {
  it("writes a baseline without touching HEAD, the index, or the working tree", () => {
    const { repoRoot, appDir } = makeRepo();
    const headBefore = git(repoRoot, ["rev-parse", "HEAD"]).trim();
    const statusBefore = git(repoRoot, ["status", "--porcelain"]);
    const branchBefore = git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const indexBefore = fs.readFileSync(path.join(repoRoot, ".git", "index"));

    const store = resolveBaselineStore(appDir);
    const upstream = makeUpstream({
      "package.json": '{"name":"demo"}\n',
      "app/root.tsx": "export const root = 1;\n",
    });
    const written = writeBaseline(store, upstream, "baseline", META);

    expect(written.kind).toBe("git-ref");
    expect(written.location).toBe(
      "refs/agent-native/template-baseline/apps/demo",
    );
    expect(git(repoRoot, ["rev-parse", "HEAD"]).trim()).toBe(headBefore);
    expect(git(repoRoot, ["status", "--porcelain"])).toBe(statusBefore);
    expect(git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
      branchBefore,
    );
    expect(fs.readFileSync(path.join(repoRoot, ".git", "index"))).toEqual(
      indexBefore,
    );
    expect(fs.existsSync(path.join(appDir, "app", "root.tsx"))).toBe(false);
  });

  it("stores files at the app's repo-relative prefix", () => {
    const { repoRoot, appDir } = makeRepo();
    const store = resolveBaselineStore(appDir);
    writeBaseline(
      store,
      makeUpstream({ "app/root.tsx": "x\n" }),
      "baseline",
      META,
    );
    const listed = git(repoRoot, [
      "ls-tree",
      "-r",
      "--name-only",
      baselineRefName(store, "baseline"),
    ]);
    expect(listed.split("\n").filter(Boolean).sort()).toEqual([
      "apps/demo/app/root.tsx",
    ]);
  });

  it("records template metadata and chains commits so the ref carries history", () => {
    const { repoRoot, appDir } = makeRepo();
    const store = resolveBaselineStore(appDir);
    const first = writeBaseline(
      store,
      makeUpstream({ "a.txt": "1\n" }),
      "baseline",
      META,
    );
    const second = writeBaseline(
      store,
      makeUpstream({ "a.txt": "2\n" }),
      "baseline",
      { ...META, templateRef: "@agent-native/core@1.3.0" },
    );

    const message = git(repoRoot, [
      "log",
      "-1",
      "--format=%B",
      second.commit!,
    ]);
    expect(message).toContain("template: chat");
    expect(message).toContain("templateRef: @agent-native/core@1.3.0");
    expect(message).toContain("coreVersion: 1.2.3");
    expect(
      git(repoRoot, ["rev-parse", `${second.commit}^`]).trim(),
    ).toBe(first.commit);
  });

  it("round-trips a baseline back to a flat app-rooted directory", () => {
    const { appDir } = makeRepo();
    const store = resolveBaselineStore(appDir);
    writeBaseline(
      store,
      makeUpstream({
        "package.json": '{"name":"demo"}\n',
        "app/nested/deep.ts": "deep\n",
      }),
      "baseline",
      META,
    );
    const out = materializeBaseline(store, "baseline")!;
    expect(fs.readFileSync(path.join(out, "package.json"), "utf-8")).toBe(
      '{"name":"demo"}\n',
    );
    expect(
      fs.readFileSync(path.join(out, "app", "nested", "deep.ts"), "utf-8"),
    ).toBe("deep\n");
    fs.rmSync(out, { recursive: true, force: true });
  });

  it("keeps ignored scaffold files in the baseline", () => {
    const { appDir } = makeRepo();
    const store = resolveBaselineStore(appDir);
    writeBaseline(
      store,
      makeUpstream({
        ".gitignore": "data/\n",
        "data/seed.json": "{}\n",
      }),
      "baseline",
      META,
    );
    const out = materializeBaseline(store, "baseline")!;
    expect(fs.existsSync(path.join(out, "data", "seed.json"))).toBe(true);
    fs.rmSync(out, { recursive: true, force: true });
  });

  it("configures fetch and push refspecs once, on first baseline", () => {
    const { repoRoot, appDir } = makeRepo();
    git(repoRoot, [
      "remote",
      "add",
      "origin",
      "https://example.invalid/demo.git",
    ]);
    const store = resolveBaselineStore(appDir);
    const first = writeBaseline(
      store,
      makeUpstream({ "a.txt": "1\n" }),
      "baseline",
      META,
    );
    expect(first.configuredRefspecs).toEqual([
      "remote.origin.fetch",
      "remote.origin.push",
    ]);
    expect(git(repoRoot, ["config", "--get-all", "remote.origin.push"])).toContain(
      "+refs/agent-native/*:refs/agent-native/*",
    );
    expect(ensureBaselineRefspecs(store)).toEqual([]);
  });

  it("promotes pending to baseline and clears the pending slot", () => {
    const { appDir } = makeRepo();
    const store = resolveBaselineStore(appDir);
    writeBaseline(store, makeUpstream({ "a.txt": "1\n" }), "baseline", META);
    writeBaseline(store, makeUpstream({ "a.txt": "2\n" }), "pending", META);

    expect(promoteBaseline(store, "pending", "baseline")).toBe(true);
    expect(baselineExists(store, "pending")).toBe(false);
    const out = materializeBaseline(store, "baseline")!;
    expect(fs.readFileSync(path.join(out, "a.txt"), "utf-8")).toBe("2\n");
    fs.rmSync(out, { recursive: true, force: true });

    clearBaseline(store, "baseline");
    expect(baselineExists(store, "baseline")).toBe(false);
  });

  it("falls back to a gzipped tar under .agent-native outside a git repo", () => {
    const appDir = path.join(tmpDir, "loose-app");
    fs.mkdirSync(appDir, { recursive: true });
    const store = resolveBaselineStore(appDir);
    expect(store.gitDir).toBe(null);

    const written = writeBaseline(
      store,
      makeUpstream({ "app/root.tsx": "x\n" }),
      "baseline",
      META,
    );
    expect(written.kind).toBe("tarball");
    expect(written.location).toBe(baselineTarballPath(store, "baseline"));
    expect(written.location).toContain(
      path.join(".agent-native", "template-baseline"),
    );

    const out = materializeBaseline(store, "baseline")!;
    expect(fs.readFileSync(path.join(out, "app", "root.tsx"), "utf-8")).toBe(
      "x\n",
    );
    fs.rmSync(out, { recursive: true, force: true });
  });

  it("returns null when a slot is empty", () => {
    const { appDir } = makeRepo();
    const store = resolveBaselineStore(appDir);
    expect(materializeBaseline(store, "baseline")).toBe(null);
    expect(baselineExists(store, "baseline")).toBe(false);
  });

  it("sanitizes ref path segments", () => {
    expect(sanitizeRefPath("apps/slides")).toBe("apps/slides");
    expect(sanitizeRefPath("apps/.hidden")).toBe("apps/hidden");
    expect(sanitizeRefPath("apps/we ird~name")).toBe("apps/we-ird-name");
    expect(sanitizeRefPath("apps/a..b")).toBe("apps/a-b");
    expect(sanitizeRefPath("apps/thing.lock")).toBe("apps/thing-lock");
    expect(sanitizeRefPath("")).toBe("app");
  });
});
