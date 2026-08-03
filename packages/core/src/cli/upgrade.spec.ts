import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildUpgradeDoctorReport,
  detectUpgradeProject,
  isPinnedOrLocalVersion,
  parseUpgradeArgs,
  pinResolvedAgentNativeVersions,
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

/** Stand in for what `pnpm install` leaves behind for @agent-native/core. */
function writeInstalledPackage(
  dir: string,
  version: string,
  name = "@agent-native/core",
): void {
  const packageDir = path.join(dir, "node_modules", ...name.split("/"));
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(
    path.join(packageDir, "package.json"),
    `${JSON.stringify({ name, version })}\n`,
  );
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
        "--codemods",
        "--yes",
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
      codemods: true,
      yes: true,
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

  it("reports a manifest it could not parse instead of scanning around it", () => {
    const root = makeTempProject({
      kind: "workspace",
      rootPkg: {
        name: "ws",
        dependencies: { "@agent-native/core": "latest" },
      },
      apps: { mail: { name: "mail" } },
    });
    fs.writeFileSync(
      path.join(root, "apps", "mail", "package.json"),
      "{ not json",
    );

    const report = buildUpgradeDoctorReport(detectUpgradeProject(root)!);
    expect(report.unreadable).toHaveLength(1);
    expect(report.unreadable[0]).toContain(
      path.join("apps", "mail", "package.json"),
    );
  });
});

describe("pinResolvedAgentNativeVersions", () => {
  it("reports an unparseable manifest instead of silently skipping it", () => {
    const root = makeTempProject({
      kind: "workspace",
      rootPkg: {
        name: "ws",
        dependencies: { "@agent-native/core": "latest" },
      },
      apps: {
        mail: {
          name: "mail",
          dependencies: { "@agent-native/core": "latest" },
        },
      },
    });
    writeInstalledPackage(root, "0.131.4");
    fs.writeFileSync(
      path.join(root, "apps", "mail", "package.json"),
      "{ not json",
    );

    const result = pinResolvedAgentNativeVersions(detectUpgradeProject(root)!);
    expect(result.pins.map((pin) => pin.version)).toEqual(["0.131.4"]);
    expect(result.unresolved).toEqual([]);
    expect(result.unreadable).toHaveLength(1);
    expect(result.unreadable[0]).toContain(
      path.join("apps", "mail", "package.json"),
    );
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
        if (args.includes("install")) writeInstalledPackage(root, "0.131.4");
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
    expect(pkg.dependencies["@agent-native/core"]).toBe("0.131.4");
  });

  it("adds a missing migration dependency before install and applies source afterward", async () => {
    const root = makeTempProject({
      rootPkg: {
        name: "old-app",
        dependencies: { "@agent-native/core": "0.110.2" },
      },
    });
    const source = path.join(root, "src/index.tsx");
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(
      source,
      'import { RichMarkdownEditor } from "@agent-native/core/client/editor";\nvoid RichMarkdownEditor;\n',
    );
    const installDependencies: Array<Record<string, string>> = [];
    const { io } = captureIo({
      spawn: (_command, args) => {
        if (args.includes("install")) {
          expect(fs.readFileSync(source, "utf-8")).toContain(
            'from "@agent-native/core/client/editor"',
          );
          const packageJson = JSON.parse(
            fs.readFileSync(path.join(root, "package.json"), "utf-8"),
          ) as { dependencies: Record<string, string> };
          installDependencies.push({ ...packageJson.dependencies });
          writeInstalledPackage(root, "0.131.4");
          const toolkitDir = path.join(
            root,
            "node_modules/@agent-native/toolkit",
          );
          fs.mkdirSync(toolkitDir, { recursive: true });
          fs.writeFileSync(
            path.join(toolkitDir, "package.json"),
            `${JSON.stringify({
              name: "@agent-native/toolkit",
              version: "0.5.2",
              exports: { "./editor": "./editor.js" },
            })}\n`,
          );
          fs.writeFileSync(
            path.join(toolkitDir, "editor.js"),
            "export const RichMarkdownEditor = {};\n",
          );
        }
        return {
          status: 0,
          pid: 1,
          output: [],
          stdout: "",
          stderr: "",
          signal: null,
        };
      },
    });

    const code = await runUpgrade(
      ["--cwd", root, "--codemods", "--yes", "--skip-skills", "--skip-verify"],
      io,
    );

    expect(code).toBe(0);
    expect(installDependencies).toEqual([
      expect.objectContaining({
        "@agent-native/core": "latest",
        "@agent-native/toolkit": "latest",
      }),
    ]);
    expect(fs.readFileSync(source, "utf-8")).toContain(
      'from "@agent-native/toolkit/editor"',
    );
  });

  it("keeps an installed but unresolved migration subpath unchanged", async () => {
    const root = makeTempProject({
      rootPkg: {
        name: "old-app",
        dependencies: {
          "@agent-native/core": "0.110.2",
          "@agent-native/toolkit": "0.5.1",
        },
      },
    });
    const source = path.join(root, "src/index.tsx");
    fs.mkdirSync(path.dirname(source), { recursive: true });
    const original =
      'import { RichMarkdownEditor } from "@agent-native/core/client/editor";\nvoid RichMarkdownEditor;\n';
    fs.writeFileSync(source, original);
    writeInstalledPackage(root, "0.131.4");
    const toolkitDir = path.join(root, "node_modules/@agent-native/toolkit");
    fs.mkdirSync(toolkitDir, { recursive: true });
    fs.writeFileSync(
      path.join(toolkitDir, "package.json"),
      `${JSON.stringify({
        name: "@agent-native/toolkit",
        version: "0.5.2",
        exports: { ".": "./index.js" },
      })}\n`,
    );
    fs.writeFileSync(path.join(toolkitDir, "index.js"), "export {};\n");
    const { io, err } = captureIo();

    const code = await runUpgrade(
      ["--cwd", root, "--codemods", "--yes", "--skip-skills", "--skip-verify"],
      io,
    );

    expect(code).toBe(0);
    expect(fs.readFileSync(source, "utf-8")).toBe(original);
    expect(err.join("\n")).toContain("not exported by an installed package");
  });

  it("reports only changes applied after post-install target verification", async () => {
    const root = makeTempProject({
      rootPkg: {
        name: "old-app",
        dependencies: { "@agent-native/core": "0.110.2" },
      },
    });
    const source = path.join(root, "src/index.tsx");
    fs.mkdirSync(path.dirname(source), { recursive: true });
    const original =
      'import { RichMarkdownEditor } from "@agent-native/core/client/editor";\nvoid RichMarkdownEditor;\n';
    fs.writeFileSync(source, original);
    const { io, out, err } = captureIo({
      spawn: (_command, args) => {
        if (args.includes("install")) {
          writeInstalledPackage(root, "0.131.4");
          const toolkitDir = path.join(
            root,
            "node_modules/@agent-native/toolkit",
          );
          fs.mkdirSync(toolkitDir, { recursive: true });
          fs.writeFileSync(
            path.join(toolkitDir, "package.json"),
            `${JSON.stringify({
              name: "@agent-native/toolkit",
              version: "0.5.2",
              exports: { ".": "./index.js" },
            })}\n`,
          );
          fs.writeFileSync(path.join(toolkitDir, "index.js"), "export {};\n");
        }
        return {
          status: 0,
          pid: 1,
          output: [],
          stdout: "",
          stderr: "",
          signal: null,
        };
      },
    });

    const code = await runUpgrade(
      ["--cwd", root, "--codemods", "--yes", "--skip-skills", "--skip-verify"],
      io,
    );

    expect(code).toBe(0);
    expect(fs.readFileSync(source, "utf-8")).toBe(original);
    expect(out.join("\n")).not.toContain("+++ b/src/index.tsx");
    expect(err.join("\n")).toContain("not exported by an installed package");
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf-8"),
    ) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@agent-native/toolkit"]).toBe("0.5.2");
  });

  it("reports dependency changes when installation fails before source rewrites", async () => {
    const root = makeTempProject({
      rootPkg: {
        name: "old-app",
        dependencies: { "@agent-native/core": "0.110.2" },
      },
    });
    const source = path.join(root, "src/index.tsx");
    fs.mkdirSync(path.dirname(source), { recursive: true });
    const original =
      'import { RichMarkdownEditor } from "@agent-native/core/client/editor";\nvoid RichMarkdownEditor;\n';
    fs.writeFileSync(source, original);
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
      [
        "--cwd",
        root,
        "--codemods",
        "--yes",
        "--json",
        "--skip-skills",
        "--skip-verify",
      ],
      io,
    );

    expect(code).toBe(1);
    expect(fs.readFileSync(source, "utf-8")).toBe(original);
    const result = JSON.parse(err.join("\n")) as {
      codemod: { files: string[]; diff: string };
    };
    expect(result.codemod.files).toEqual(["package.json"]);
    expect(result.codemod.diff).toContain('"@agent-native/toolkit": "latest"');
  });

  it("reports codemods applied while dependency installation is skipped", async () => {
    const root = makeTempProject({
      rootPkg: {
        name: "old-app",
        dependencies: { "@agent-native/core": "0.110.2" },
      },
    });
    const source = path.join(root, "src/index.tsx");
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(
      source,
      'import { RichMarkdownEditor } from "@agent-native/core/client/editor";\nvoid RichMarkdownEditor;\n',
    );
    const { io, out } = captureIo();

    const code = await runUpgrade(
      [
        "--cwd",
        root,
        "--codemods",
        "--yes",
        "--skip-install",
        "--skip-skills",
        "--skip-verify",
      ],
      io,
    );

    expect(code).toBe(0);
    expect(out.join("\n")).toContain("without installing dependencies");
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

  it("pins every workspace manifest to the version install resolved", async () => {
    const root = makeTempProject({
      kind: "workspace",
      rootPkg: {
        name: "ws",
        dependencies: { "@agent-native/core": "0.120.3" },
      },
      apps: {
        mail: {
          name: "mail",
          dependencies: { "@agent-native/core": "0.125.0" },
          devDependencies: { "@agent-native/dispatch": "latest" },
        },
        tasks: {
          name: "tasks",
          dependencies: {
            "@agent-native/core": "^0.130.0",
            "@agent-native/scheduling": "workspace:*",
          },
        },
      },
    });
    const { io } = captureIo({
      spawn: (_command, args) => {
        if (args.includes("install")) {
          writeInstalledPackage(root, "0.131.4");
          writeInstalledPackage(root, "0.131.4", "@agent-native/dispatch");
        }
        return {
          status: 0,
          pid: 1,
          output: [],
          stdout: "",
          stderr: "",
          signal: null,
        };
      },
    });

    const code = await runUpgrade(
      ["--cwd", root, "--skip-skills", "--skip-verify"],
      io,
    );
    expect(code).toBe(0);

    const read = (...segments: string[]) =>
      JSON.parse(
        fs.readFileSync(path.join(root, ...segments, "package.json"), "utf-8"),
      );
    expect(read().dependencies["@agent-native/core"]).toBe("0.131.4");
    expect(read("apps", "mail").dependencies["@agent-native/core"]).toBe(
      "0.131.4",
    );
    expect(read("apps", "mail").devDependencies["@agent-native/dispatch"]).toBe(
      "0.131.4",
    );
    expect(read("apps", "tasks").dependencies["@agent-native/core"]).toBe(
      "0.131.4",
    );
    // Local links are not ours to repin.
    expect(read("apps", "tasks").dependencies["@agent-native/scheduling"]).toBe(
      "workspace:*",
    );
  });

  it("fails loudly instead of leaving a spec floating on latest", async () => {
    const root = makeTempProject({
      rootPkg: {
        name: "old-app",
        dependencies: { "@agent-native/core": "^0.8.0" },
      },
    });
    const { io, err } = captureIo();

    const code = await runUpgrade(
      ["--cwd", root, "--skip-skills", "--skip-verify"],
      io,
    );
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("@agent-native/core");
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf-8"),
    );
    expect(pkg.dependencies["@agent-native/core"]).toBe("latest");
  });

  it("stops the run when a manifest cannot be parsed", async () => {
    const root = makeTempProject({
      kind: "workspace",
      rootPkg: {
        name: "ws",
        dependencies: { "@agent-native/core": "^0.8.0" },
      },
      apps: { mail: { name: "mail" } },
    });
    fs.writeFileSync(
      path.join(root, "apps", "mail", "package.json"),
      "{ not json",
    );
    const { io, err } = captureIo();

    const code = await runUpgrade(
      ["--cwd", root, "--skip-skills", "--skip-verify"],
      io,
    );
    expect(code).toBe(1);
    expect(err.join("\n")).toContain(path.join("apps", "mail", "package.json"));
    // Nothing was bumped behind a manifest nobody could check.
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf-8"),
    );
    expect(pkg.dependencies["@agent-native/core"]).toBe("^0.8.0");
  });

  it("check exits non-zero when a manifest cannot be parsed", async () => {
    const root = makeTempProject({
      kind: "workspace",
      rootPkg: {
        name: "ws",
        dependencies: { "@agent-native/core": "latest" },
      },
      apps: { mail: { name: "mail" } },
    });
    fs.writeFileSync(
      path.join(root, "apps", "mail", "package.json"),
      "{ not json",
    );
    const { io, out } = captureIo();

    const code = await runUpgrade(["check", "--cwd", root], io);
    expect(code).toBe(1);
    expect(out.join("\n")).toContain("Unreadable package.json");
  });

  it("skips pinning when install was skipped", async () => {
    const root = makeTempProject({
      rootPkg: {
        name: "old-app",
        dependencies: { "@agent-native/core": "^0.8.0" },
      },
    });
    const { io, out } = captureIo();

    const code = await runUpgrade(
      ["--cwd", root, "--skip-install", "--skip-skills", "--skip-verify"],
      io,
    );
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("[skipped] pin");
  });
});
