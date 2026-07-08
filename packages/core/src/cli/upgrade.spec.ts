import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildUpgradeDoctorReport,
  detectUpgradeProject,
  isPinnedOrLocalVersion,
  parseUpgradeArgs,
  runUpgrade,
  shouldBumpAgentNativeVersion,
  type UpgradeIo,
} from "./upgrade.js";

const tmpRoots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeTempProject(layout: {
  kind?: "standalone" | "workspace";
  rootPkg: Record<string, unknown>;
  workspaceYaml?: string;
  apps?: Record<string, Record<string, unknown>>;
  workspaces?: Record<string, Record<string, unknown>>;
}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-upgrade-"));
  tmpRoots.push(root);
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify(layout.rootPkg, null, 2),
  );
  if (layout.kind === "workspace") {
    fs.writeFileSync(
      path.join(root, "pnpm-workspace.yaml"),
      layout.workspaceYaml ?? "packages:\n  - apps/*\n  - packages/*\n",
    );
    if (layout.apps) {
      for (const [name, pkg] of Object.entries(layout.apps)) {
        const appDir = path.join(root, "apps", name);
        fs.mkdirSync(appDir, { recursive: true });
        fs.writeFileSync(
          path.join(appDir, "package.json"),
          JSON.stringify(pkg, null, 2),
        );
      }
    }
    if (layout.workspaces) {
      for (const [relativePath, pkg] of Object.entries(layout.workspaces)) {
        const packageDir = path.join(root, relativePath);
        fs.mkdirSync(packageDir, { recursive: true });
        fs.writeFileSync(
          path.join(packageDir, "package.json"),
          JSON.stringify(pkg, null, 2),
        );
      }
    }
  }
  return root;
}

function captureIo(overrides: Partial<UpgradeIo> = {}): {
  io: UpgradeIo;
  out: string[];
  err: string[];
} {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      log: (m) => out.push(m),
      err: (m) => err.push(m),
      spawn: () => ({
        status: 0,
        pid: 1,
        output: [],
        stdout: "",
        stderr: "",
        signal: null,
      }),
      runSkillsUpdate: async () => {},
      ...overrides,
    },
  };
}

describe("parseUpgradeArgs", () => {
  it("defaults to run", () => {
    expect(parseUpgradeArgs([])).toEqual({ command: "run" });
  });

  it("parses check/doctor and flags", () => {
    expect(
      parseUpgradeArgs([
        "check",
        "--dry-run",
        "--skip-install",
        "--skip-skills",
        "--skip-verify",
        "--force",
        "--json",
        "--cwd",
        "/tmp/app",
      ]),
    ).toEqual({
      command: "check",
      dryRun: true,
      skipInstall: true,
      skipSkills: true,
      skipVerify: true,
      force: true,
      json: true,
      cwd: "/tmp/app",
    });
  });
});

describe("version helpers", () => {
  it("detects local pins", () => {
    expect(isPinnedOrLocalVersion("file:../core")).toBe(true);
    expect(isPinnedOrLocalVersion("workspace:*")).toBe(true);
    expect(isPinnedOrLocalVersion("link:../core")).toBe(true);
    expect(isPinnedOrLocalVersion("^0.9.0")).toBe(false);
  });

  it("only bumps non-latest published ranges", () => {
    expect(shouldBumpAgentNativeVersion("latest")).toBe(false);
    expect(shouldBumpAgentNativeVersion("workspace:*")).toBe(false);
    expect(shouldBumpAgentNativeVersion("^0.8.1")).toBe(true);
    expect(shouldBumpAgentNativeVersion("0.9.0")).toBe(true);
  });
});

describe("detectUpgradeProject + doctor", () => {
  it("detects standalone apps and finds overrides/bumps", () => {
    const root = makeTempProject({
      rootPkg: {
        name: "old-app",
        dependencies: {
          "@agent-native/core": "^0.8.0",
          "@agent-native/dispatch": "latest",
        },
        pnpm: {
          overrides: {
            "@agent-native/dispatch": "file:./vendor/dispatch",
          },
          patchedDependencies: {
            "@agent-native/core@0.8.0": "patches/core.patch",
          },
        },
      },
    });

    const project = detectUpgradeProject(root);
    expect(project).toMatchObject({ root, kind: "standalone" });
    const report = buildUpgradeDoctorReport(project!);
    expect(report.findings).toHaveLength(2);
    expect(report.bumps).toEqual([
      expect.objectContaining({
        name: "@agent-native/core",
        from: "^0.8.0",
        to: "latest",
      }),
    ]);
  });

  it("walks workspace apps for bumps", () => {
    const root = makeTempProject({
      kind: "workspace",
      rootPkg: {
        name: "ws",
        dependencies: { "@agent-native/core": "latest" },
      },
      apps: {
        analytics: {
          name: "analytics",
          dependencies: {
            "@agent-native/core": "0.7.0",
            "@agent-native/dispatch": "^0.7.0",
          },
        },
      },
    });

    const project = detectUpgradeProject(root);
    expect(project?.kind).toBe("workspace");
    const report = buildUpgradeDoctorReport(project!);
    expect(report.bumps.map((b) => b.name).sort()).toEqual([
      "@agent-native/core",
      "@agent-native/dispatch",
    ]);
  });

  it("walks package globs from pnpm-workspace.yaml", () => {
    const root = makeTempProject({
      kind: "workspace",
      workspaceYaml: "packages:\n  - templates/*\n  - tools/**\n",
      rootPkg: {
        name: "ws",
        dependencies: { "@agent-native/core": "latest" },
      },
      workspaces: {
        "templates/analytics": {
          name: "analytics",
          dependencies: { "@agent-native/core": "0.7.0" },
        },
        "tools/internal/worker": {
          name: "worker",
          dependencies: { "@agent-native/dispatch": "^0.7.0" },
        },
      },
    });

    const project = detectUpgradeProject(root);
    expect(
      project?.packageFiles.map((file) => path.relative(root, file)),
    ).toEqual([
      "package.json",
      "templates/analytics/package.json",
      "tools/internal/worker/package.json",
    ]);
    const report = buildUpgradeDoctorReport(project!);
    expect(report.bumps.map((b) => b.name).sort()).toEqual([
      "@agent-native/core",
      "@agent-native/dispatch",
    ]);
  });
});

describe("runUpgrade", () => {
  it("check exits non-zero when overrides are present", async () => {
    const root = makeTempProject({
      rootPkg: {
        name: "old-app",
        dependencies: { "@agent-native/core": "latest" },
        overrides: { "@agent-native/core": "1.0.0" },
      },
    });
    const { io, err } = captureIo();
    const code = await runUpgrade(["check", "--cwd", root], io);
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("Do not paper over");
  });

  it("blocks run when overrides exist unless --force", async () => {
    const root = makeTempProject({
      rootPkg: {
        name: "old-app",
        dependencies: { "@agent-native/core": "^0.8.0" },
        pnpm: { overrides: { "@agent-native/dispatch": "1.0.0" } },
      },
    });
    const { io } = captureIo();
    expect(await runUpgrade(["--cwd", root, "--skip-install"], io)).toBe(1);

    const forced = captureIo();
    expect(
      await runUpgrade(
        [
          "--cwd",
          root,
          "--force",
          "--skip-install",
          "--skip-skills",
          "--skip-verify",
        ],
        forced.io,
      ),
    ).toBe(0);
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf-8"),
    );
    expect(pkg.dependencies["@agent-native/core"]).toBe("latest");
  });

  it("dry-run plans bumps without writing", async () => {
    const root = makeTempProject({
      rootPkg: {
        name: "old-app",
        dependencies: { "@agent-native/core": "^0.8.0" },
        scripts: { typecheck: "echo ok" },
      },
    });
    const { io, out } = captureIo();
    const code = await runUpgrade(["--cwd", root, "--dry-run"], io);
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("[planned] bump");
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf-8"),
    );
    expect(pkg.dependencies["@agent-native/core"]).toBe("^0.8.0");
  });

  it("runs install + skills + verify through injected io", async () => {
    const root = makeTempProject({
      rootPkg: {
        name: "old-app",
        dependencies: { "@agent-native/core": "^0.8.0" },
        scripts: { typecheck: "echo ok" },
      },
    });
    const spawnCalls: string[][] = [];
    const skills = vi.fn(async () => {});
    const { io } = captureIo({
      spawn: (command, args) => {
        spawnCalls.push([command, ...args]);
        return {
          status: 0,
          pid: 1,
          output: [],
          stdout: "",
          stderr: "",
          signal: null,
        };
      },
      runSkillsUpdate: skills,
    });

    const code = await runUpgrade(["--cwd", root], io);
    expect(code).toBe(0);
    expect(skills).toHaveBeenCalledOnce();
    expect(spawnCalls.some((c) => c.includes("install"))).toBe(true);
    expect(spawnCalls.some((c) => c.includes("typecheck"))).toBe(true);
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf-8"),
    );
    expect(pkg.dependencies["@agent-native/core"]).toBe("latest");
  });

  it("prints failure guidance when install fails", async () => {
    const root = makeTempProject({
      rootPkg: {
        name: "old-app",
        dependencies: { "@agent-native/core": "latest" },
      },
    });
    const { io, err } = captureIo({
      spawn: () => ({
        status: 1,
        pid: 1,
        output: [],
        stdout: "",
        stderr: "boom",
        signal: null,
      }),
    });
    const code = await runUpgrade(
      ["--cwd", root, "--skip-skills", "--skip-verify"],
      io,
    );
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("pnpm.overrides");
  });
});
