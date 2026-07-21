import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentNativeEjectManifest } from "../package-lifecycle/eject-manifest.js";
import { runEject, type EjectIO, type LoadedEjectManifest } from "./eject.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "eject-test-"));
  tempDirs.push(root);
  fs.mkdirSync(path.join(root, "app"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify({ name: "example-app", dependencies: {} }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(root, "app", "page.tsx"),
    [
      'import { ChatHistoryList } from "@agent-native/toolkit/chat-history";',
      'import "@agent-native/toolkit/chat-history.css";',
      'const runtimeValue = "@agent-native/toolkit/chat-history";',
      "export { ChatHistoryList };",
      "",
    ].join("\n"),
  );

  const packageDir = path.join(root, "fixture-toolkit");
  fs.mkdirSync(path.join(packageDir, "src", "chat-history"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(packageDir, "src", "chat-history", "index.ts"),
    'export { ChatHistoryList } from "./ChatHistoryList.js";\n',
  );
  fs.writeFileSync(
    path.join(packageDir, "src", "chat-history", "ChatHistoryList.tsx"),
    'import { cn } from "../utils.js";\nexport const ChatHistoryList = () => cn("chat");\n',
  );
  fs.writeFileSync(
    path.join(packageDir, "src", "chat-history", "ignored.spec.tsx"),
    "throw new Error('do not copy');\n",
  );
  fs.writeFileSync(
    path.join(packageDir, "src", "utils.ts"),
    "export const cn = (...values: string[]) => values.join(' ');\n",
  );
  fs.writeFileSync(
    path.join(packageDir, "src", "chat-history.css"),
    '@import "./chat-history/theme.css";\n.chat { color: red; }\n',
  );
  fs.writeFileSync(
    path.join(packageDir, "src", "chat-history", "theme.css"),
    ".theme { color: blue; }\n",
  );
  fs.writeFileSync(
    path.join(packageDir, "package.json"),
    `${JSON.stringify(
      {
        name: "@agent-native/toolkit",
        version: "1.2.3",
        dependencies: { clsx: "^2.1.0" },
      },
      null,
      2,
    )}\n`,
  );
  const manifest: AgentNativeEjectManifest = {
    manifestVersion: 1,
    package: "@agent-native/toolkit",
    catalogs: ["toolkit-ui"],
    units: [
      {
        id: "toolkit/chat-history",
        label: "Chat history",
        catalog: "toolkit-ui",
        catalogItems: ["./chat-history", "./chat-history/*"],
        entrypoints: ["./chat-history", "./chat-history/*"],
        strategy: "source-copy",
        sourceEntries: ["src/chat-history"],
        targetRoot: "app/ejected/toolkit",
        styles: [
          {
            entrypoint: "./chat-history.css",
            source: "src/chat-history.css",
          },
        ],
        protectedImports: ["@agent-native/core/runtime"],
        verification: ["pnpm typecheck"],
      },
    ],
  };
  const loaded: LoadedEjectManifest = {
    manifest,
    manifestDigest: "manifest-sha256",
    packageDir,
    packageVersion: "1.2.3",
  };
  return { root, loaded };
}

function capture() {
  let out = "";
  let err = "";
  const io: EjectIO = {
    out(message) {
      out += `${message}\n`;
    },
    err(message) {
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

describe("feature eject CLI", () => {
  it("lists and inspects manifest-defined units without writing", async () => {
    const { root, loaded } = fixture();
    const listed = capture();
    expect(
      await runEject(["--list", "--json"], {
        cwd: root,
        io: listed.io,
        loadManifests: async () => [loaded],
      }),
    ).toBe(0);
    expect(JSON.parse(listed.out).units).toEqual([
      expect.objectContaining({
        id: "toolkit/chat-history",
        package: "@agent-native/toolkit",
      }),
    ]);

    const inspected = capture();
    expect(
      await runEject(["inspect", "toolkit/chat-history", "--json"], {
        cwd: root,
        io: inspected.io,
        loadManifests: async () => [loaded],
      }),
    ).toBe(0);
    const report = JSON.parse(inspected.out);
    expect(report.files).toContain("src/chat-history/ChatHistoryList.tsx");
    expect(report.files).toContain("src/utils.ts");
    expect(report.files).not.toContain("src/chat-history/ignored.spec.tsx");
    expect(fs.existsSync(path.join(root, "agent-native.ejections.json"))).toBe(
      false,
    );
  });

  it("copies a transitive closure, rewrites consumers, and records committed provenance", async () => {
    const { root, loaded } = fixture();
    const dryRun = capture();
    expect(
      await runEject(["toolkit/chat-history"], {
        cwd: root,
        io: dryRun.io,
        loadManifests: async () => [loaded],
      }),
    ).toBe(0);
    expect(dryRun.out).toContain(
      "configure -> compose -> eject -> propose a shared seam",
    );
    expect(dryRun.out).toContain(
      "Protected imports: @agent-native/core/runtime",
    );
    expect(fs.existsSync(path.join(root, "agent-native.ejections.json"))).toBe(
      false,
    );

    const applied = capture();
    expect(
      await runEject(["toolkit/chat-history", "--apply"], {
        cwd: root,
        io: applied.io,
        loadManifests: async () => [loaded],
      }),
    ).toBe(0);
    expect(
      fs.existsSync(
        path.join(root, "app/ejected/toolkit/chat-history/ChatHistoryList.tsx"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(root, "app/ejected/toolkit/chat-history/ignored.spec.tsx"),
      ),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(root, "app/ejected/toolkit/chat-history/theme.css"),
      ),
    ).toBe(true);
    expect(
      fs.readFileSync(path.join(root, "app", "page.tsx"), "utf8"),
    ).toContain('from "./ejected/toolkit/chat-history"');
    expect(
      fs.readFileSync(path.join(root, "app", "page.tsx"), "utf8"),
    ).toContain('runtimeValue = "@agent-native/toolkit/chat-history"');
    const provenance = JSON.parse(
      fs.readFileSync(path.join(root, "agent-native.ejections.json"), "utf8"),
    );
    expect(provenance.ejections["toolkit/chat-history"]).toMatchObject({
      source: {
        package: "@agent-native/toolkit",
        version: "1.2.3",
        manifestDigest: "manifest-sha256",
      },
    });
    expect(
      provenance.ejections["toolkit/chat-history"].targets.every(
        (target: { hash?: string }) => target.hash?.length === 64,
      ),
    ).toBe(true);
  });

  it("reports drift and refuses restore until target hashes match", async () => {
    const { root, loaded } = fixture();
    expect(
      await runEject(["toolkit/chat-history", "--apply"], {
        cwd: root,
        io: capture().io,
        loadManifests: async () => [loaded],
      }),
    ).toBe(0);
    const target = path.join(
      root,
      "app/ejected/toolkit/chat-history/ChatHistoryList.tsx",
    );
    const original = fs.readFileSync(target);
    fs.appendFileSync(target, "// locally edited\n");

    const diff = capture();
    expect(
      await runEject(["diff", "toolkit/chat-history"], {
        cwd: root,
        io: diff.io,
        loadManifests: async () => [loaded],
      }),
    ).toBe(1);
    expect(diff.out).toContain("Changed target");

    const refused = capture();
    expect(
      await runEject(["restore", "toolkit/chat-history", "--apply"], {
        cwd: root,
        io: refused.io,
        loadManifests: async () => [loaded],
      }),
    ).toBe(1);
    expect(refused.err).toContain("Restore refused");
    expect(fs.existsSync(target)).toBe(true);

    fs.writeFileSync(target, original);
    const restored = capture();
    expect(
      await runEject(["restore", "toolkit/chat-history", "--apply"], {
        cwd: root,
        io: restored.io,
        loadManifests: async () => [loaded],
      }),
    ).toBe(0);
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.existsSync(path.join(root, "agent-native.ejections.json"))).toBe(
      false,
    );
    expect(
      fs.readFileSync(path.join(root, "app", "page.tsx"), "utf8"),
    ).toContain('from "@agent-native/toolkit/chat-history"');
  });

  it("adds declared dependencies and reverses them after an upstream upgrade", async () => {
    const { root, loaded } = fixture();
    loaded.manifest.units[0].dependencies = ["clsx"];
    const spawn = spawnResult(0);
    expect(
      await runEject(["toolkit/chat-history", "--apply"], {
        cwd: root,
        io: capture().io,
        loadManifests: async () => [loaded],
        spawn,
      }),
    ).toBe(0);
    expect(
      (
        JSON.parse(
          fs.readFileSync(path.join(root, "package.json"), "utf8"),
        ) as {
          dependencies: Record<string, string>;
        }
      ).dependencies.clsx,
    ).toBe("^2.1.0");

    loaded.packageVersion = "2.0.0";
    loaded.manifestDigest = "new-manifest-digest";
    const diff = capture();
    expect(
      await runEject(["diff", "toolkit/chat-history"], {
        cwd: root,
        io: diff.io,
        loadManifests: async () => [loaded],
      }),
    ).toBe(1);
    expect(diff.out).toContain("Source version changed");

    expect(
      await runEject(["restore", "toolkit/chat-history", "--apply"], {
        cwd: root,
        io: capture().io,
        loadManifests: async () => [loaded],
        spawn,
      }),
    ).toBe(0);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(
      (
        JSON.parse(
          fs.readFileSync(path.join(root, "package.json"), "utf8"),
        ) as {
          dependencies: Record<string, string>;
        }
      ).dependencies.clsx,
    ).toBeUndefined();
  });

  it("ejects a whole package into a pnpm workspace without rewriting canonical imports", async () => {
    const { root, loaded } = fixture();
    fs.writeFileSync(
      path.join(root, "package.json"),
      `${JSON.stringify(
        {
          name: "workspace",
          "agent-native": { workspaceCore: "workspace-core" },
        },
        null,
        2,
      )}\n`,
    );
    fs.writeFileSync(
      path.join(root, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\n",
    );
    fs.writeFileSync(
      path.join(root, "pnpm-workspace.yaml"),
      'packages:\n  - "apps/*"\n  - "packages/*"\n',
    );
    fs.mkdirSync(path.join(root, "apps", "demo", "app"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "apps", "demo", "package.json"),
      `${JSON.stringify(
        {
          name: "demo",
          dependencies: { "@agent-native/scheduling": "^1.2.3" },
        },
        null,
        2,
      )}\n`,
    );
    fs.writeFileSync(
      path.join(root, "apps", "demo", "app", "page.ts"),
      'export { schedule } from "@agent-native/scheduling";\n',
    );
    fs.mkdirSync(path.join(root, "node_modules", "@agent-native", "core"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(root, "node_modules", "@agent-native", "core", "package.json"),
      JSON.stringify({ name: "@agent-native/core", version: "0.112.0" }),
    );
    loaded.manifest.package = "@agent-native/scheduling";
    loaded.manifest.catalogs = ["domain-packages"];
    loaded.manifest.units = [
      {
        id: "package/scheduling",
        label: "Scheduling package",
        catalog: "domain-packages",
        catalogItems: ["scheduling"],
        entrypoints: [".", "./actions/*"],
        strategy: "package-eject",
        sourceEntries: ["src", "package.json", "agent-native.eject.json"],
        targetRoot: "packages/scheduling",
        protectedImports: ["@agent-native/core"],
      },
    ];
    fs.writeFileSync(
      path.join(loaded.packageDir, "package.json"),
      `${JSON.stringify(
        {
          name: "@agent-native/scheduling",
          version: "1.2.3",
          agentNativeEjectManifest: "agent-native.eject.json",
          dependencies: { "@agent-native/core": "workspace:^" },
        },
        null,
        2,
      )}\n`,
    );
    fs.writeFileSync(
      path.join(loaded.packageDir, "src", "index.ts"),
      'export { defineAction } from "@agent-native/core";\nexport const schedule = true;\n',
    );
    fs.writeFileSync(
      path.join(loaded.packageDir, "agent-native.eject.json"),
      `${JSON.stringify(loaded.manifest, null, 2)}\n`,
    );
    const spawn = spawnResult(0);

    expect(
      await runEject(["package/scheduling", "--app", "demo", "--apply"], {
        cwd: root,
        io: capture().io,
        loadManifests: async () => [loaded],
        spawn,
      }),
    ).toBe(0);
    expect(
      fs.readFileSync(
        path.join(root, "packages", "scheduling", "src", "index.ts"),
        "utf8",
      ),
    ).toContain('from "@agent-native/core"');
    expect(
      fs.readFileSync(
        path.join(root, "apps", "demo", "app", "page.ts"),
        "utf8",
      ),
    ).toContain('from "@agent-native/scheduling"');
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(root, "apps", "demo", "package.json"),
          "utf8",
        ),
      ).dependencies["@agent-native/scheduling"],
    ).toBe("workspace:*");
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(root, "packages", "scheduling", "package.json"),
          "utf8",
        ),
      ).dependencies["@agent-native/core"],
    ).toBe("^0.112.0");

    const installedPackageDirectory = path.join(
      root,
      "apps",
      "demo",
      "node_modules",
      "@agent-native",
      "scheduling",
    );
    fs.mkdirSync(path.dirname(installedPackageDirectory), { recursive: true });
    fs.symlinkSync(
      path.join(root, "packages", "scheduling"),
      installedPackageDirectory,
      "dir",
    );

    expect(
      await runEject(
        ["restore", "package/scheduling", "--app", "demo", "--apply"],
        {
          cwd: root,
          io: capture().io,
          spawn,
        },
      ),
    ).toBe(0);
    expect(
      fs.existsSync(path.join(root, "packages", "scheduling", "package.json")),
    ).toBe(false);
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(root, "apps", "demo", "package.json"),
          "utf8",
        ),
      ).dependencies["@agent-native/scheduling"],
    ).toBe("^1.2.3");
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn).toHaveBeenCalledWith(
      "pnpm",
      ["install"],
      expect.objectContaining({ cwd: root }),
    );
  });

  it("rolls back files, provenance, package metadata, and lockfiles when install fails", async () => {
    const { root, loaded } = fixture();
    loaded.manifest.units[0].dependencies = ["clsx"];
    const packageJsonBefore = fs.readFileSync(path.join(root, "package.json"));
    fs.writeFileSync(
      path.join(root, "package-lock.json"),
      '{"lockfileVersion":3}\n',
    );
    const lockfileBefore = fs.readFileSync(
      path.join(root, "package-lock.json"),
    );
    const spawn = vi.fn(() => {
      fs.writeFileSync(path.join(root, "package-lock.json"), "changed\n");
      return { status: 1 };
    }) as unknown as typeof spawnSync;
    const output = capture();

    expect(
      await runEject(["toolkit/chat-history", "--apply"], {
        cwd: root,
        io: output.io,
        loadManifests: async () => [loaded],
        spawn,
      }),
    ).toBe(1);
    expect(output.err).toContain("npm install failed");
    expect(fs.readFileSync(path.join(root, "package.json"))).toEqual(
      packageJsonBefore,
    );
    expect(fs.readFileSync(path.join(root, "package-lock.json"))).toEqual(
      lockfileBefore,
    );
    expect(fs.existsSync(path.join(root, "agent-native.ejections.json"))).toBe(
      false,
    );
    expect(
      fs.existsSync(
        path.join(root, "app/ejected/toolkit/chat-history/ChatHistoryList.tsx"),
      ),
    ).toBe(false);
  });

  it("routes protected runtime units to their supported seam", async () => {
    const { root, loaded } = fixture();
    loaded.manifest.units = [
      {
        id: "core/runtime",
        label: "Core runtime",
        catalog: "toolkit-ui",
        catalogItems: ["runtime"],
        entrypoints: ["./runtime"],
        strategy: "protected-seam",
        seam: "@agent-native/core/plugins",
      },
    ];
    const output = capture();
    expect(
      await runEject(["core/runtime"], {
        cwd: root,
        io: output.io,
        loadManifests: async () => [loaded],
      }),
    ).toBe(0);
    expect(output.out).toContain("stays package-owned");
    expect(output.out).toContain("@agent-native/core/plugins");
  });

  it("emits an add-style blueprint when no package owns a unit", async () => {
    const { root } = fixture();
    const output = capture();
    expect(
      await runEject(["acme/widget"], {
        cwd: root,
        io: output.io,
        loadManifests: async () => [],
      }),
    ).toBe(1);
    expect(output.err).toContain("third-party");
    expect(output.out).toContain('"agentNativeEjectManifest"');
  });

  it("treats missing first-party units as coverage defects without inventing a blueprint", async () => {
    const { root } = fixture();
    const output = capture();
    expect(
      await runEject(["toolkit/missing"], {
        cwd: root,
        io: output.io,
        loadManifests: async () => [],
      }),
    ).toBe(1);
    expect(output.err).toContain("first-party manifest guard must fail");
    expect(output.out).not.toContain('"agentNativeEjectManifest"');
  });

  it("restores from committed provenance when the published unit is no longer discoverable", async () => {
    const { root, loaded } = fixture();
    const spawn = spawnResult(0);
    loaded.manifest.units[0].dependencies = ["clsx"];
    expect(
      await runEject(["toolkit/chat-history", "--apply"], {
        cwd: root,
        io: capture().io,
        loadManifests: async () => [loaded],
        spawn,
      }),
    ).toBe(0);

    const restored = capture();
    expect(
      await runEject(["restore", "toolkit/chat-history", "--apply"], {
        cwd: root,
        io: restored.io,
        loadManifests: async () => [],
        spawn,
      }),
    ).toBe(0);
    expect(fs.existsSync(path.join(root, "agent-native.ejections.json"))).toBe(
      false,
    );
  });
});
