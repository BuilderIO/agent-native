import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  ALL_GUARD_NAMES,
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

  it("parses --help and --fix", () => {
    expect(parseDoctorArgs(["--help"])).toEqual({ help: true });
    expect(parseDoctorArgs(["--fix"])).toEqual({ fix: true });
  });
});

describe("runDoctorScan", () => {
  it("finds no violations in a clean app root", () => {
    const root = makeTempAppRoot(CLEAN_FILES);
    const report = runDoctorScan({ root });
    expect(report.ok).toBe(true);
    expect(report.findings).toHaveLength(0);
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

  it("--json emits { ok, findings, guardsRun, strict } shape", async () => {
    const root = makeTempAppRoot(VIOLATION_FILES);
    const { io, out } = captureIo();
    const code = await runDoctor(["--cwd", root, "--json"], io);
    expect(code).toBe(1);
    const parsed = JSON.parse(out.join(""));
    expect(parsed.ok).toBe(false);
    expect(Array.isArray(parsed.findings)).toBe(true);
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
});

describe("--strict escalation (shouldFailBuild / runDoctorBuildHook)", () => {
  it("shouldFailBuild only escalates when strict or failOnBuild is set", () => {
    expect(shouldFailBuild(true, {})).toBe(false);
    expect(shouldFailBuild(true, { strict: true })).toBe(true);
    expect(shouldFailBuild(true, { failOnBuild: true })).toBe(true);
    expect(shouldFailBuild(false, { strict: true })).toBe(false);
    expect(shouldFailBuild(false, { failOnBuild: true })).toBe(false);
  });

  it("build hook is ok:true (warn-only) by default even with findings", async () => {
    const root = makeTempAppRoot(VIOLATION_FILES);
    const { io, err } = captureIo();
    const result = await runDoctorBuildHook({ cwd: root }, io);
    expect(result.report.ok).toBe(false);
    expect(result.ok).toBe(true);
    expect(err.join("\n")).toMatch(/does not fail the build/);
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

  it("build hook stays ok on a clean app root even with --strict", async () => {
    const root = makeTempAppRoot(CLEAN_FILES);
    const { io } = captureIo();
    const result = await runDoctorBuildHook({ cwd: root, strict: true }, io);
    expect(result.ok).toBe(true);
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
