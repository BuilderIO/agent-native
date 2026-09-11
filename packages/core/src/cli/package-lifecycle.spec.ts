import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentNativePackageManifest } from "../package-lifecycle/manifest.js";
import {
  loadLifecyclePackage,
  runPackageLifecycle,
  type LoadedLifecyclePackage,
  type PackageLifecycleIO,
} from "./package-lifecycle.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function fixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "package-lifecycle-test-"),
  );
  tempDirs.push(root);
  fs.mkdirSync(path.join(root, "actions"), { recursive: true });
  fs.mkdirSync(path.join(root, "server", "db"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "example-app", dependencies: {} }, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(root, "server", "db", "schema.ts"),
    'export * from "@agent-native/core/db/schema";\n',
  );
  const packageDir = path.join(root, "fixture-package");
  fs.mkdirSync(path.join(packageDir, "docs", "skills", "scheduling-basics"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(packageDir, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(packageDir, "docs", "skills", "scheduling-basics", "SKILL.md"),
    "# Scheduling basics\n",
  );
  fs.writeFileSync(path.join(packageDir, "src", "index.ts"), "export {};\n");
  fs.writeFileSync(
    path.join(packageDir, "package.json"),
    JSON.stringify({ name: "@agent-native/scheduling", version: "1.2.3" }),
  );
  fs.writeFileSync(path.join(packageDir, "tsconfig.json"), "{}\n");
  fs.writeFileSync(path.join(packageDir, "agent-native.package.json"), "{}\n");
  fs.mkdirSync(path.join(root, "node_modules", "@agent-native", "core"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(root, "node_modules", "@agent-native", "core", "package.json"),
    JSON.stringify({ name: "@agent-native/core", version: "4.5.6" }),
  );
  const manifest: AgentNativePackageManifest = {
    manifestVersion: 1,
    name: "@agent-native/scheduling",
    actions: ["create-booking", "list-bookings"],
    schemaEntryPoint: "@agent-native/scheduling/schema",
    docs: {
      llms: "docs/llms.txt",
      llmsFull: "docs/llms-full.txt",
      skills: ["scheduling-basics"],
    },
    requiredSecrets: [
      {
        key: "MICROSOFT_CLIENT_ID",
        label: "Microsoft client id",
        optional: true,
      },
    ],
    peerProviders: ["teams"],
    eject: { sourceRoot: "src", targetDirectory: "packages/scheduling" },
  };
  const loaded: LoadedLifecyclePackage = {
    manifest,
    packageVersion: "1.2.3",
    packageDir,
    packageJson: {
      name: manifest.name,
      version: "1.2.3",
      agentNativeManifest: "agent-native.package.json",
      dependencies: { "@agent-native/core": "workspace:^" },
    },
  };
  return { root, packageDir, manifest, loaded };
}

function capture() {
  let out = "";
  let err = "";
  const io: PackageLifecycleIO = {
    out: (message) => {
      out += `${message}\n`;
    },
    err: (message) => {
      err += `${message}\n`;
    },
  };
  return {
    io,
    get out() {
      return out;
    },
    get err() {
      return err;
    },
  };
}

function spawnResult(status: number) {
  return vi.fn(() => ({ status })) as unknown as typeof spawnSync;
}

describe("package lifecycle CLI", () => {
  it("inspects contributions as machine-readable JSON without writing", async () => {
    const { root, loaded } = fixture();
    const output = capture();
    const before = fs.readFileSync(path.join(root, "package.json"), "utf8");
    const code = await runPackageLifecycle(
      ["inspect", "@agent-native/scheduling", "--json"],
      { cwd: root, io: output.io, loadPackage: async () => loaded },
    );
    expect(code).toBe(0);
    const report = JSON.parse(output.out);
    expect(report).toMatchObject({
      command: "inspect",
      package: "@agent-native/scheduling",
      manifestVersion: 1,
      compatible: true,
    });
    expect(report.contributions).toMatchObject({
      actions: ["create-booking", "list-bookings"],
      requiredSecretKeys: ["MICROSOFT_CLIENT_ID"],
      peerProviders: ["teams"],
    });
    expect(fs.readFileSync(path.join(root, "package.json"), "utf8")).toBe(
      before,
    );
  });

  it("loads only static JSON, never an executable manifest, and uses package.json version", async () => {
    const { root, manifest } = fixture();
    const packageDir = path.join(
      root,
      "node_modules",
      "@agent-native",
      "static-example",
    );
    fs.mkdirSync(path.join(packageDir, "dist"), { recursive: true });
    fs.writeFileSync(
      path.join(packageDir, "package.json"),
      JSON.stringify({
        name: "@agent-native/static-example",
        version: "9.8.7",
        agentNativeManifest: "agent-native.package.json",
      }),
    );
    fs.writeFileSync(
      path.join(packageDir, "agent-native.package.json"),
      JSON.stringify({
        ...manifest,
        name: "@agent-native/static-example",
        schemaEntryPoint: "@agent-native/static-example/schema",
      }),
    );
    const executionMarker = path.join(root, "malicious-manifest-executed");
    fs.writeFileSync(
      path.join(packageDir, "dist", "manifest.js"),
      `require("node:fs").writeFileSync(${JSON.stringify(executionMarker)}, "bad");`,
    );
    const loaded = await loadLifecyclePackage(
      "@agent-native/static-example",
      root,
    );
    expect(loaded.packageVersion).toBe("9.8.7");
    expect(fs.existsSync(executionMarker)).toBe(false);
  });

  it("stages an uninstalled registry package without lifecycle scripts", async () => {
    const { root, manifest } = fixture();
    const calls: string[][] = [];
    const spawn = vi.fn((command: string, args: readonly string[]) => {
      calls.push([command, ...args]);
      if (command === "npm") {
        return {
          status: 0,
          stdout: JSON.stringify([
            { filename: "agent-native-remote-example-2.3.4.tgz" },
          ]),
        };
      }
      if (args.includes("-tzf")) {
        return {
          status: 0,
          stdout:
            "package/package.json\npackage/agent-native.package.json\npackage/docs/skills/scheduling-basics/SKILL.md\n",
        };
      }
      const destination = args[args.indexOf("-C") + 1];
      const packageDir = path.join(destination, "package");
      fs.mkdirSync(
        path.join(packageDir, "docs", "skills", "scheduling-basics"),
        {
          recursive: true,
        },
      );
      fs.writeFileSync(
        path.join(
          packageDir,
          "docs",
          "skills",
          "scheduling-basics",
          "SKILL.md",
        ),
        "# Example\n",
      );
      fs.writeFileSync(
        path.join(packageDir, "package.json"),
        JSON.stringify({
          name: "@agent-native/remote-example",
          version: "2.3.4",
          agentNativeManifest: "agent-native.package.json",
        }),
      );
      fs.writeFileSync(
        path.join(packageDir, "agent-native.package.json"),
        JSON.stringify({
          ...manifest,
          name: "@agent-native/remote-example",
          schemaEntryPoint: "@agent-native/remote-example/schema",
        }),
      );
      return { status: 0, stdout: "" };
    }) as unknown as typeof spawnSync;
    const loaded = await loadLifecyclePackage(
      "@agent-native/remote-example",
      root,
      spawn,
    );
    expect(loaded.packageVersion).toBe("2.3.4");
    expect(calls[0]).toContain("--ignore-scripts");
    expect(calls[0]?.slice(0, 3)).toEqual([
      "npm",
      "pack",
      "@agent-native/remote-example",
    ]);
    loaded.cleanup?.();
  });

  it("refuses a static manifest symlink even when it resolves inside the package", async () => {
    const { root, manifest } = fixture();
    const packageDir = path.join(
      root,
      "node_modules",
      "symlink-manifest-example",
    );
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(
      path.join(packageDir, "package.json"),
      JSON.stringify({
        name: "symlink-manifest-example",
        version: "1.0.0",
        agentNativeManifest: "agent-native.package.json",
      }),
    );
    fs.writeFileSync(
      path.join(packageDir, "manifest-target.json"),
      JSON.stringify({
        ...manifest,
        name: "symlink-manifest-example",
        schemaEntryPoint: "symlink-manifest-example/schema",
      }),
    );
    fs.symlinkSync(
      "manifest-target.json",
      path.join(packageDir, "agent-native.package.json"),
    );
    await expect(
      loadLifecyclePackage("symlink-manifest-example", root),
    ).rejects.toThrow("regular file");
  });

  it("keeps add dry-run by default", async () => {
    const { root, loaded } = fixture();
    const output = capture();
    const spawn = spawnResult(0);
    const code = await runPackageLifecycle(
      ["add", "@agent-native/scheduling", "--json"],
      { cwd: root, io: output.io, loadPackage: async () => loaded, spawn },
    );
    expect(code).toBe(0);
    expect(JSON.parse(output.out).apply).toBe(false);
    expect(fs.existsSync(path.join(root, "actions", "create-booking.ts"))).toBe(
      false,
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it("applies action stubs, schema wiring, skills, dependency, and provenance", async () => {
    const { root, loaded } = fixture();
    const output = capture();
    const spawn = spawnResult(0);
    const code = await runPackageLifecycle(
      ["add", "@agent-native/scheduling", "--apply"],
      { cwd: root, io: output.io, loadPackage: async () => loaded, spawn },
    );
    expect(code).toBe(0);
    expect(
      fs.readFileSync(path.join(root, "actions", "create-booking.ts"), "utf8"),
    ).toContain("@agent-native/scheduling/actions/create-booking");
    expect(
      fs.readFileSync(path.join(root, "server", "db", "schema.ts"), "utf8"),
    ).toContain("agent-native-package:@agent-native/scheduling");
    expect(
      fs.existsSync(
        path.join(root, ".agents", "skills", "scheduling-basics", "SKILL.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          root,
          ".agent-native",
          "packages",
          "@agent-native__scheduling.json",
        ),
      ),
    ).toBe(true);
    expect(
      JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
        .dependencies,
    ).toEqual({
      "@agent-native/scheduling": "^1.2.3",
    });
    expect(spawn).toHaveBeenCalledWith("npm", ["install"], {
      cwd: root,
      stdio: "inherit",
    });
  });

  it("is idempotent after a successful add", async () => {
    const { root, loaded } = fixture();
    const spawn = spawnResult(0);
    await runPackageLifecycle(["add", loaded.manifest.name, "--apply"], {
      cwd: root,
      io: capture().io,
      loadPackage: async () => loaded,
      spawn,
    });
    const output = capture();
    const code = await runPackageLifecycle(
      ["add", loaded.manifest.name, "--json"],
      {
        cwd: root,
        io: output.io,
        loadPackage: async () => loaded,
        spawn,
      },
    );
    expect(code).toBe(0);
    expect(
      JSON.parse(output.out).changes.every(
        (change: { action: string }) => change.action === "noop",
      ),
    ).toBe(true);
  });

  it("refuses an action collision before mutation", async () => {
    const { root, loaded } = fixture();
    fs.writeFileSync(
      path.join(root, "actions", "create-booking.ts"),
      "export default 1;\n",
    );
    const output = capture();
    const code = await runPackageLifecycle(
      ["add", loaded.manifest.name, "--json", "--apply"],
      {
        cwd: root,
        io: output.io,
        loadPackage: async () => loaded,
        spawn: spawnResult(0),
      },
    );
    expect(code).toBe(1);
    expect(JSON.parse(output.out).collisions).toContain(
      "Refusing to overwrite actions/create-booking.ts",
    );
    expect(
      JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
        .dependencies,
    ).toEqual({});
  });

  it("rolls every file back when package installation fails", async () => {
    const { root, loaded } = fixture();
    const packageBefore = fs.readFileSync(
      path.join(root, "package.json"),
      "utf8",
    );
    const code = await runPackageLifecycle(
      ["add", loaded.manifest.name, "--apply"],
      {
        cwd: root,
        io: capture().io,
        loadPackage: async () => loaded,
        spawn: spawnResult(7),
      },
    );
    expect(code).toBe(1);
    expect(fs.readFileSync(path.join(root, "package.json"), "utf8")).toBe(
      packageBefore,
    );
    expect(fs.existsSync(path.join(root, "actions", "create-booking.ts"))).toBe(
      false,
    );
    expect(
      fs
        .readdirSync(root)
        .some((name) => name.startsWith(".agent-native-package-stage-")),
    ).toBe(false);
  });

  it("ejects Scheduling locally while preserving canonical imports", async () => {
    const { root, loaded } = fixture();
    fs.writeFileSync(
      path.join(root, "pnpm-workspace.yaml"),
      'packages:\n  - "packages/*"\n',
    );
    const output = capture();
    const code = await runPackageLifecycle(
      ["eject", loaded.manifest.name, "--apply", "--json"],
      {
        cwd: root,
        io: output.io,
        loadPackage: async () => loaded,
        spawn: spawnResult(0),
      },
    );
    expect(code).toBe(0);
    expect(
      fs.existsSync(
        path.join(root, "packages", "scheduling", "src", "index.ts"),
      ),
    ).toBe(true);
    expect(
      JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
        .dependencies,
    ).toEqual({
      "@agent-native/scheduling": "workspace:*",
    });
    expect(JSON.parse(output.out).warnings.join(" ")).toContain("canonical");
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(root, "packages", "scheduling", "package.json"),
          "utf8",
        ),
      ).dependencies,
    ).toEqual({ "@agent-native/core": "^4.5.6" });
  });

  it("refuses ambiguous workspace-root add", async () => {
    const { root, loaded } = fixture();
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8"),
    );
    pkg["agent-native"] = { workspaceCore: "apps/chat" };
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(pkg));
    fs.mkdirSync(path.join(root, "apps"));
    const output = capture();
    const code = await runPackageLifecycle(
      ["add", loaded.manifest.name, "--json"],
      {
        cwd: root,
        io: output.io,
        loadPackage: async () => loaded,
      },
    );
    expect(code).toBe(1);
    expect(JSON.parse(output.out).collisions[0]).toContain("--app");
  });
});
