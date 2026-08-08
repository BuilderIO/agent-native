import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ALL_GUARD_NAMES,
  checkDisk,
  LOW_DISK_FREE_BYTES,
  parseDoctorArgs,
  runDoctor,
  runDoctorBuildHook,
  runDoctorScan,
  shouldFailBuild,
  type DoctorIo,
} from "./doctor.js";

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeTempAppRoot(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-doctor-cli-"));
  tmpRoots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

function captureIo(): { io: DoctorIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { log: (m) => out.push(m), err: (m) => err.push(m) } };
}

const VIOLATION_FILES = {
  "package.json": JSON.stringify({
    name: "app",
    scripts: { build: "drizzle-kit push --force" },
  }),
};

const CLEAN_FILES = {
  "package.json": JSON.stringify({
    name: "app",
    scripts: { build: "vite build" },
  }),
};

describe("parseDoctorArgs", () => {
  it("parses all flags", () => {
    expect(
      parseDoctorArgs([
        "--json",
        "--strict",
        "--only",
        "no-drizzle-push,no-env-mutation",
        "--cwd",
        "/tmp/app",
      ]),
    ).toEqual({
      json: true,
      strict: true,
      only: ["no-drizzle-push", "no-env-mutation"],
      cwd: "/tmp/app",
    });
  });

  it("parses --help, --fix and --disk", () => {
    expect(parseDoctorArgs(["--help"])).toEqual({ help: true });
    expect(parseDoctorArgs(["--fix"])).toEqual({ fix: true });
    expect(parseDoctorArgs(["--disk"])).toEqual({ disk: true });
  });
});

describe("runDoctorScan", () => {
  it("finds no violations in a clean app root", () => {
    const root = makeTempAppRoot(CLEAN_FILES);
    const report = runDoctorScan({ root });
    expect(report.ok).toBe(true);
    expect(report.findings).toHaveLength(0);
    expect(report.warnings).toHaveLength(0);
    expect(report.guardsRun.sort()).toEqual([...ALL_GUARD_NAMES].sort());
  });

  it("reports violations from a bad app root", () => {
    const root = makeTempAppRoot(VIOLATION_FILES);
    const report = runDoctorScan({ root });
    expect(report.ok).toBe(false);
    expect(report.findings.some((f) => f.guard === "no-drizzle-push")).toBe(
      true,
    );
  });

  it("reports empty migration plugins before they reach a generated app build", () => {
    const root = makeTempAppRoot({
      ...CLEAN_FILES,
      "server/plugins/db.ts":
        'export default runMigrations([], { table: "app_migrations" });\n',
    });
    const report = runDoctorScan({ root });

    expect(report.ok).toBe(false);
    expect(report.findings).toEqual([
      expect.objectContaining({
        guard: "no-empty-migrations",
        file: "server/plugins/db.ts",
      }),
    ]);
  });

  it("respects disabledGuards from agent-native.json", () => {
    const root = makeTempAppRoot({
      ...VIOLATION_FILES,
      "agent-native.json": JSON.stringify({
        doctor: { disabledGuards: ["no-drizzle-push"] },
      }),
    });
    const report = runDoctorScan({ root });
    expect(report.guardsRun).not.toContain("no-drizzle-push");
    expect(report.findings.some((f) => f.guard === "no-drizzle-push")).toBe(
      false,
    );
  });

  it("--only restricts the guard set", () => {
    const root = makeTempAppRoot(VIOLATION_FILES);
    const report = runDoctorScan({ root, only: ["no-env-mutation"] });
    expect(report.guardsRun).toEqual(["no-env-mutation"]);
    expect(report.findings.some((f) => f.guard === "no-drizzle-push")).toBe(
      false,
    );
  });

  it("reports implicit collab access while accepting legacy resourceType", () => {
    const root = makeTempAppRoot({
      ...CLEAN_FILES,
      "server/plugins/implicit.ts":
        'export default createCollabPlugin({ table: "todos" });\n',
      "server/plugins/legacy.ts":
        'export default createCollabPlugin({ table: "docs", resourceType: "document" });\n',
    });
    const report = runDoctorScan({
      root,
      only: ["explicit-collab-access"],
    });

    expect(report.guardsRun).toEqual(["explicit-collab-access"]);
    expect(report.findings).toEqual([
      expect.objectContaining({
        guard: "explicit-collab-access",
        file: "server/plugins/implicit.ts",
      }),
    ]);
  });

  it("warns before an import listed in the migration manifest breaks", () => {
    const root = makeTempAppRoot({
      ...CLEAN_FILES,
      "app/root.tsx":
        'import { PromptComposer } from "@agent-native/core/client/composer";\nvoid PromptComposer;\n',
    });
    const report = runDoctorScan({
      root,
      only: ["migration-manifest"],
      migrationManifests: [
        {
          sinceVersion: "0.110.0",
          moves: {
            "@agent-native/core/client/composer": {
              to: "@agent-native/toolkit/composer",
            },
          },
        },
      ],
    });
    expect(report.ok).toBe(false);
    expect(report.findings).toEqual([
      expect.objectContaining({
        guard: "migration-manifest",
        file: "app/root.tsx",
        message: expect.stringContaining(
          "npx @agent-native/core@latest upgrade --codemods",
        ),
      }),
    ]);
  });

  it("reports planned imports as non-blocking warnings", () => {
    const root = makeTempAppRoot({
      ...CLEAN_FILES,
      "app/root.tsx":
        'import { PromptComposer } from "@agent-native/core/client/composer";\nvoid PromptComposer;\n',
    });
    const report = runDoctorScan({
      root,
      only: ["migration-manifest"],
      migrationManifests: [
        {
          sinceVersion: "0.111.0",
          moves: {
            "@agent-native/core/client/composer": {
              to: "@agent-native/toolkit/composer",
              status: "planned",
            },
          },
        },
      ],
    });

    expect(report.ok).toBe(true);
    expect(report.findings).toEqual([]);
    expect(report.warnings).toEqual([
      expect.objectContaining({
        guard: "migration-manifest",
        file: "app/root.tsx",
        message: expect.stringContaining("planned to move"),
      }),
    ]);
  });
});

describe("runDoctor (CLI)", () => {
  it("--help exits 0 and prints usage", async () => {
    const { io, out } = captureIo();
    const code = await runDoctor(["--help"], io);
    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/Usage:/);
  });

  it("--fix exits 2 with a 'not implemented' message", async () => {
    const { io, err } = captureIo();
    const code = await runDoctor(["--fix"], io);
    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/not implemented/i);
  });

  it("a bad --cwd exits 2", async () => {
    const { io, err } = captureIo();
    const code = await runDoctor(
      ["--cwd", "/definitely/not/a/real/path/xyz"],
      io,
    );
    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/does not exist/);
  });

  it("an unknown --only guard name exits 2", async () => {
    const root = makeTempAppRoot(CLEAN_FILES);
    const { io, err } = captureIo();
    const code = await runDoctor(
      ["--cwd", root, "--only", "not-a-real-guard"],
      io,
    );
    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/Unknown guard name/);
  });

  it("exits 0 for a clean app root", async () => {
    const root = makeTempAppRoot(CLEAN_FILES);
    const { io, out } = captureIo();
    const code = await runDoctor(["--cwd", root], io);
    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/Clean/);
  });

  it("exits 1 for a bad app root, findings printed", async () => {
    const root = makeTempAppRoot(VIOLATION_FILES);
    const { io, out } = captureIo();
    const code = await runDoctor(["--cwd", root], io);
    expect(code).toBe(1);
    expect(out.join("\n")).toMatch(/no-drizzle-push/);
  });

  it("scans every app from a workspace root and prefixes findings with its app path", async () => {
    const root = makeTempAppRoot({
      "package.json": JSON.stringify({
        name: "workspace",
        "agent-native": { workspaceCore: "@workspace/shared" },
      }),
      "apps/clean/package.json": JSON.stringify({ name: "clean" }),
      "apps/bad/package.json": JSON.stringify({
        name: "bad",
        scripts: { build: "drizzle-kit push" },
      }),
    });
    const { io, out } = captureIo();

    const code = await runDoctor(["--cwd", root], io);

    expect(code).toBe(1);
    expect(out.join("\n")).toContain(
      "Workspace apps scanned: apps/bad, apps/clean",
    );
    expect(out.join("\n")).toContain("apps/bad/package.json");
    expect(out.join("\n")).toContain("no-drizzle-push");
  });

  it("scans the empty migration guard across workspace apps", async () => {
    const root = makeTempAppRoot({
      "package.json": JSON.stringify({
        name: "workspace",
        "agent-native": { workspaceCore: "@workspace/shared" },
      }),
      "apps/docs/package.json": JSON.stringify({ name: "docs" }),
      "apps/docs/server/plugins/db.ts":
        'export default runMigrations([], { table: "docs_migrations" });\n',
    });
    const { io, out } = captureIo();

    const code = await runDoctor(["--cwd", root], io);

    expect(code).toBe(1);
    expect(out.join("\n")).toContain("apps/docs/server/plugins/db.ts");
    expect(out.join("\n")).toContain("no-empty-migrations");
  });

  it("reports workspace app findings in machine-readable output", async () => {
    const root = makeTempAppRoot({
      "package.json": JSON.stringify({
        name: "workspace",
        "agent-native": { workspaceCore: "@workspace/shared" },
      }),
      "apps/bad/package.json": JSON.stringify({
        name: "bad",
        scripts: { build: "drizzle-kit push" },
      }),
    });
    const { io, out } = captureIo();

    const code = await runDoctor(["--cwd", root, "--json"], io);

    expect(code).toBe(1);
    const report = JSON.parse(out.join(""));
    expect(report.workspaceApps).toEqual(["apps/bad"]);
    expect(report.findings).toEqual([
      expect.objectContaining({
        file: "apps/bad/package.json",
        guard: "no-drizzle-push",
      }),
    ]);
  });

  it("does not treat unreadable workspace metadata as a clean standalone app", async () => {
    const root = makeTempAppRoot({
      "package.json": "{",
      "apps/bad/package.json": JSON.stringify({ name: "bad" }),
    });
    const { io } = captureIo();

    await expect(runDoctor(["--cwd", root], io)).rejects.toThrow(
      "Could not read workspace metadata",
    );
  });

  it("does not treat an unreadable Doctor manifest as a clean scan", () => {
    const root = makeTempAppRoot({
      ...CLEAN_FILES,
      "agent-native.json": "{",
    });

    expect(() => runDoctorScan({ root })).toThrow(
      "Could not read Doctor configuration",
    );
  });

  it("--json emits { ok, findings, warnings, guardsRun, strict } shape", async () => {
    const root = makeTempAppRoot(VIOLATION_FILES);
    const { io, out } = captureIo();
    const code = await runDoctor(["--cwd", root, "--json"], io);
    expect(code).toBe(1);
    const parsed = JSON.parse(out.join(""));
    expect(parsed.ok).toBe(false);
    expect(Array.isArray(parsed.findings)).toBe(true);
    expect(Array.isArray(parsed.warnings)).toBe(true);
    expect(Array.isArray(parsed.guardsRun)).toBe(true);
    expect(parsed.strict).toBe(false);
  });

  it("--json delivers the report via stdout (io.log), never stderr, even with findings present (regression: report used to route to io.err when findings existed, silently breaking `doctor --json > report.json` CI capture)", async () => {
    const root = makeTempAppRoot(VIOLATION_FILES);
    const { io, out, err } = captureIo();
    const code = await runDoctor(["--cwd", root, "--json"], io);
    expect(code).toBe(1);
    expect(err.join("\n")).toBe("");
    const parsed = JSON.parse(out.join(""));
    expect(parsed.ok).toBe(false);
    expect(parsed.findings.length).toBeGreaterThan(0);
  });

  it("--only filters which guards run end-to-end via the CLI", async () => {
    const root = makeTempAppRoot(VIOLATION_FILES);
    const { io, out } = captureIo();
    const code = await runDoctor(
      ["--cwd", root, "--json", "--only", "no-env-mutation"],
      io,
    );
    // The violation fixture only trips no-drizzle-push; restricting to
    // no-env-mutation means the scan comes back clean (exit 0), and the
    // JSON report goes to stdout (io.log) rather than stderr.
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join(""));
    expect(parsed.ok).toBe(true);
    expect(parsed.guardsRun).toEqual(["no-env-mutation"]);
  });

  it("supports explicit-collab-access through --only", async () => {
    const root = makeTempAppRoot({
      ...CLEAN_FILES,
      "server/plugins/collab.ts":
        'export default createCollabPlugin({ table: "todos" });\n',
    });
    const { io, out } = captureIo();
    const code = await runDoctor(
      ["--cwd", root, "--json", "--only", "explicit-collab-access"],
      io,
    );

    expect(code).toBe(1);
    const parsed = JSON.parse(out.join(""));
    expect(parsed.guardsRun).toEqual(["explicit-collab-access"]);
    expect(parsed.findings).toEqual([
      expect.objectContaining({ guard: "explicit-collab-access" }),
    ]);
  });
});

describe("--strict escalation (shouldFailBuild / runDoctorBuildHook)", () => {
  it("shouldFailBuild only escalates when strict or failOnBuild is set", () => {
    expect(shouldFailBuild(true, {})).toBe(false);
    expect(shouldFailBuild(true, { strict: true })).toBe(true);
    expect(shouldFailBuild(true, { failOnBuild: true })).toBe(true);
    expect(shouldFailBuild(false, { strict: true })).toBe(false);
    expect(shouldFailBuild(false, { failOnBuild: true })).toBe(false);
  });

  it("build hook fails by default when findings exist", async () => {
    const root = makeTempAppRoot(VIOLATION_FILES);
    const { io, err } = captureIo();
    const result = await runDoctorBuildHook({ cwd: root }, io);
    expect(result.report.ok).toBe(false);
    expect(result.ok).toBe(false);
    expect(err.join("\n")).toMatch(/fix them before the build can continue/);
  });

  it("build hook fails when --strict (build) is passed and findings exist", async () => {
    const root = makeTempAppRoot(VIOLATION_FILES);
    const { io } = captureIo();
    const result = await runDoctorBuildHook({ cwd: root, strict: true }, io);
    expect(result.ok).toBe(false);
  });

  it("build hook fails when agent-native.json sets doctor.failOnBuild without --strict", async () => {
    const root = makeTempAppRoot({
      ...VIOLATION_FILES,
      "agent-native.json": JSON.stringify({ doctor: { failOnBuild: true } }),
    });
    const { io } = captureIo();
    const result = await runDoctorBuildHook({ cwd: root }, io);
    expect(result.ok).toBe(false);
  });

  it("build hook scans workspace apps instead of missing nested queries", async () => {
    const root = makeTempAppRoot({
      "package.json": JSON.stringify({
        name: "workspace",
        "agent-native": { workspaceCore: "@workspace/shared" },
      }),
      "apps/bad/package.json": JSON.stringify({ name: "bad" }),
      "packages/shared/package.json": JSON.stringify({
        name: "@workspace/shared",
        scripts: { build: "drizzle-kit push" },
      }),
      "apps/bad/server/db/schema.ts":
        'export const todos = sqliteTable("todos", {});\n',
    });
    const { io } = captureIo();

    const result = await runDoctorBuildHook({ cwd: root }, io);

    expect(result.ok).toBe(false);
    expect(result.report.findings).toEqual([
      expect.objectContaining({
        file: "apps/bad/server/db/schema.ts",
        guard: "db-tool-scoping",
      }),
      expect.objectContaining({
        file: "packages/shared/package.json",
        guard: "no-drizzle-push",
      }),
    ]);
  });

  it("build hook stays ok on a clean app root even with --strict", async () => {
    const root = makeTempAppRoot(CLEAN_FILES);
    const { io } = captureIo();
    const result = await runDoctorBuildHook({ cwd: root, strict: true }, io);
    expect(result.ok).toBe(true);
  });

  it("allows an explicit non-strict opt-out while preserving --strict", async () => {
    const root = makeTempAppRoot({
      ...VIOLATION_FILES,
      "agent-native.json": JSON.stringify({
        doctor: { failOnBuild: false },
      }),
    });
    const { io } = captureIo();

    const warnOnly = await runDoctorBuildHook({ cwd: root }, io);
    const strict = await runDoctorBuildHook({ cwd: root, strict: true }, io);

    expect(warnOnly.ok).toBe(true);
    expect(strict.ok).toBe(false);
  });
});

describe("disk check", () => {
  it("reports free space plus what `agent-native clean` would reclaim", () => {
    const root = makeTempAppRoot({
      ...CLEAN_FILES,
      "node_modules/.vite/deps/dep.js": "x".repeat(4096),
    });
    const disk = checkDisk(root, { measureReclaimable: true });
    if ("error" in disk) throw new Error(disk.error);

    expect(disk.totalBytes).toBeGreaterThan(0);
    expect(disk.freeBytes).toBeGreaterThan(0);
    expect(disk.reclaimableBytes).toBe(4096);
    expect(disk.scanFailures).toBe(0);
    expect(disk.low).toBe(disk.freeBytes < LOW_DISK_FREE_BYTES);
  });

  it("skips the cache scan by default, leaving reclaimable unmeasured (not 0)", () => {
    const root = makeTempAppRoot({
      ...CLEAN_FILES,
      "node_modules/.vite/deps/dep.js": "x".repeat(4096),
    });
    const spy = vi.spyOn(fs, "readdirSync");

    try {
      const disk = checkDisk(root);
      if ("error" in disk) throw new Error(disk.error);

      expect(disk.freeBytes).toBeGreaterThan(0);
      expect(disk.reclaimableBytes).toBeUndefined();
      expect(disk.scanFailures).toBeUndefined();
      // The walk is the whole cost: a default run must not touch the tree.
      expect(spy).not.toHaveBeenCalled();
      checkDisk(root, { measureReclaimable: true });
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("returns an error rather than a zero reading when the volume is unreadable", () => {
    const disk = checkDisk("/definitely/not/a/real/path/xyz");
    expect(disk).toEqual({ error: expect.stringContaining("free space") });
  });

  it("the CLI prints free space, and only `--disk` prices the caches", async () => {
    const root = makeTempAppRoot({
      ...CLEAN_FILES,
      "node_modules/.vite/deps/dep.js": "x".repeat(2048),
    });

    const plain = captureIo();
    expect(await runDoctor(["--cwd", root], plain.io)).toBe(0);
    expect(plain.out.join("\n")).toMatch(/Disk: .* free of [^\n]*\.$/m);
    expect(plain.out.join("\n")).not.toContain("can reclaim");

    const scanned = captureIo();
    expect(await runDoctor(["--cwd", root, "--disk"], scanned.io)).toBe(0);
    expect(scanned.out.join("\n")).toMatch(
      /Disk: .* free of .*`agent-native clean` can reclaim 2\.0 KB/,
    );
  });

  it("calls out LOW and the clean command when free space is short", async () => {
    const root = makeTempAppRoot({
      ...CLEAN_FILES,
      "node_modules/.vite/deps/dep.js": "x".repeat(2048),
    });
    const real = fs.statfsSync(root);
    const spy = vi.spyOn(fs, "statfsSync").mockReturnValue({
      ...real,
      bsize: 1024,
      bavail: 1024,
      blocks: 4_960_000,
    });

    try {
      const { io, out } = captureIo();
      const code = await runDoctor(["--cwd", root], io);
      // Low disk is advisory: it reports, it does not fail the run.
      expect(code).toBe(0);
      // Still points at `agent-native clean` without paying for the scan.
      expect(out.join("\n")).toMatch(
        /Disk: 1\.0 MB free of 4\.7 GB — LOW\. `agent-native clean` frees build caches/,
      );

      const scanned = captureIo();
      expect(await runDoctor(["--cwd", root, "--disk"], scanned.io)).toBe(0);
      expect(scanned.out.join("\n")).toMatch(
        /Disk: 1\.0 MB free of 4\.7 GB — LOW\. `agent-native clean` can reclaim 2\.0 KB/,
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("--json carries the disk reading and disk never changes the exit code", async () => {
    const root = makeTempAppRoot(CLEAN_FILES);
    const { io, out } = captureIo();
    const code = await runDoctor(["--cwd", root, "--json"], io);
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join(""));
    expect(parsed.disk.freeBytes).toBeGreaterThan(0);
    // Unmeasured stays absent in JSON too — a 0 would read as "nothing to clean".
    expect(parsed.disk).not.toHaveProperty("reclaimableBytes");
    expect(parsed.ok).toBe(true);
  });
});

describe("end-to-end: scaffold template is clean", () => {
  it("the default scaffold has zero doctor findings", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const scaffoldRoot = path.resolve(here, "../templates/default");
    expect(fs.existsSync(scaffoldRoot)).toBe(true);
    const report = runDoctorScan({ root: scaffoldRoot });
    expect(report.findings).toEqual([]);
    expect(report.ok).toBe(true);
  });
});
