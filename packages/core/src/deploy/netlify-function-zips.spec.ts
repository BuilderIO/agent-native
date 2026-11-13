import { createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";

import { normalizeZip } from "./deterministic-zip.js";
import {
  NetlifyManifestExpiredError,
  assertManifestFresh,
  assertSupportedZipItVersion,
  findNetlifyCli,
  prepareNetlifyFunctionZips,
  type ZipItModule,
} from "./netlify-function-zips.js";

const tmpDirs: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "netlify-zips-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

async function zipOf(
  files: Array<[string, string]>,
  date: Date,
): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, body] of files) {
    zip.file(name, body, { date, unixPermissions: 0o755 });
  }
  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    platform: "UNIX",
  });
}

const FILES: Array<[string, string]> = [
  ["server.mjs", "export default 1;\n".repeat(50)],
  ["chunks/a.mjs", "a".repeat(400)],
  ["chunks/b.mjs", "b".repeat(400)],
  ["package.json", '{"type":"module"}'],
];

describe("normalizeZip", () => {
  it("gives byte-identical output for any entry order and mtime", async () => {
    const first = await zipOf(FILES, new Date("2025-03-01T10:00:00Z"));
    const second = await zipOf(
      [...FILES].reverse(),
      new Date("2026-11-13T22:30:00Z"),
    );
    expect(first.equals(second)).toBe(false);
    const a = normalizeZip(first);
    const b = normalizeZip(second);
    expect(a.equals(b)).toBe(true);
  });

  it("keeps contents and unix permissions", async () => {
    const out = normalizeZip(await zipOf(FILES, new Date()));
    const read = await JSZip.loadAsync(out);
    const names = Object.keys(read.files);
    expect(names).toEqual([...names].sort());
    expect(names).toEqual(expect.arrayContaining(FILES.map(([name]) => name)));
    for (const [name, body] of FILES) {
      expect(await read.file(name)!.async("string")).toBe(body);
      expect(read.file(name)!.unixPermissions).toBe(0o755);
    }
  });

  it("rejects bytes that are not a zip", () => {
    expect(() => normalizeZip(Buffer.from("nope"))).toThrow(/not a zip/);
  });
});

function fakeZipIt(order: "forward" | "reverse", date: string): ZipItModule {
  const config = [
    {
      name: "forms-server",
      generator: "agent-native",
      routes: [{ pattern: "/forms/*", literal: "" }],
    },
    { name: "recurring-jobs", schedule: "*/5 * * * *" },
    { name: "forms-agent-background", invocationMode: "background" },
  ];
  return {
    zipFunctions: async (_input, dest, options) => {
      const results = [];
      const list = order === "forward" ? config : [...config].reverse();
      for (const fn of list) {
        const zipPath = path.join(dest, `${fn.name}.zip`);
        const files = order === "forward" ? FILES : [...FILES].reverse();
        fs.writeFileSync(zipPath, await zipOf(files, new Date(date)));
        results.push({ ...fn, path: zipPath });
      }
      fs.writeFileSync(
        options!.manifest as string,
        JSON.stringify({
          functions: results,
          system: { arch: "arm64", platform: "darwin" },
          timestamp: 1,
          version: 1,
        }),
      );
      return results;
    },
  };
}

const sha = (file: string) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");

describe("prepareNetlifyFunctionZips", () => {
  it("produces identical digests across runs and keeps per-function config", async () => {
    const root = tmp();
    const functionsDir = path.join(root, ".netlify", "functions-internal");
    fs.mkdirSync(functionsDir, { recursive: true });

    const run = async (order: "forward" | "reverse", date: string) => {
      const out = await prepareNetlifyFunctionZips({
        siteRoot: root,
        functionsDir,
        zipIt: fakeZipIt(order, date),
        now: () => 1_000,
      });
      const manifest = JSON.parse(fs.readFileSync(out.manifestPath, "utf-8"));
      return {
        digests: Object.fromEntries(
          out.functions.map((f) => [f.name, f.sha256]),
        ),
        manifest,
      };
    };

    const one = await run("forward", "2025-01-01T00:00:00Z");
    const two = await run("reverse", "2026-06-01T00:00:00Z");
    expect(two.digests).toEqual(one.digests);

    const byName = Object.fromEntries(
      two.manifest.functions.map((f: { name: string }) => [f.name, f]),
    );
    expect(byName["forms-server"].routes).toEqual([
      { pattern: "/forms/*", literal: "" },
    ]);
    expect(byName["recurring-jobs"].schedule).toBe("*/5 * * * *");
    expect(byName["forms-agent-background"].invocationMode).toBe("background");
    expect(two.manifest.timestamp).toBe(1_000);
    for (const fn of two.manifest.functions) {
      expect(sha(fn.path)).toBe(two.digests[fn.name]);
    }
  });

  it("fails when a function is not zipped", async () => {
    const root = tmp();
    const zipIt: ZipItModule = {
      zipFunctions: async (_i, dest, options) => {
        fs.writeFileSync(options!.manifest as string, "{}");
        return [{ name: "x", path: path.join(dest, "x.mjs") }];
      },
    };
    await expect(
      prepareNetlifyFunctionZips({ siteRoot: root, functionsDir: root, zipIt }),
    ).rejects.toThrow(/was not zipped/);
  });
});

describe("assertManifestFresh", () => {
  it("throws a typed manifest-expired error past the TTL", () => {
    const file = path.join(tmp(), "manifest.json");
    fs.writeFileSync(file, JSON.stringify({ timestamp: 1_000 }));
    expect(() => assertManifestFresh(file, 100_000, 120_000)).not.toThrow();
    expect(() => assertManifestFresh(file, 200_000, 120_000)).toThrow(
      NetlifyManifestExpiredError,
    );
    expect(() => assertManifestFresh(file, 200_000, 120_000)).toThrow(
      /manifest-expired/,
    );
  });

  it("does not treat a missing timestamp as fresh", () => {
    const file = path.join(tmp(), "manifest.json");
    fs.writeFileSync(file, "{}");
    expect(() => assertManifestFresh(file, 1)).toThrow(/no numeric timestamp/);
  });
});

describe("assertSupportedZipItVersion", () => {
  it("accepts the verified major and rejects drift", () => {
    expect(() =>
      assertSupportedZipItVersion("16.6.0", "27.16.1"),
    ).not.toThrow();
    expect(() => assertSupportedZipItVersion("17.0.0", "28.0.0")).toThrow(
      /verified against major 16/,
    );
  });
});

describe("prepareNetlifyFunctionZips input safety", () => {
  it("refuses a functions dir inside the cleaned output dir", async () => {
    const root = tmp();
    const functionsDir = path.join(root, ".netlify", "functions");
    fs.mkdirSync(functionsDir, { recursive: true });
    fs.writeFileSync(path.join(functionsDir, "keep.mjs"), "x");
    await expect(
      prepareNetlifyFunctionZips({
        siteRoot: root,
        functionsDir,
        zipIt: fakeZipIt("forward", "2025-01-01T00:00:00Z"),
      }),
    ).rejects.toThrow(/inside the output directory/);
    expect(fs.existsSync(path.join(functionsDir, "keep.mjs"))).toBe(true);
  });
});

describe("findNetlifyCli", () => {
  it("finds the package beside a Windows-style .cmd shim", () => {
    const bin = tmp();
    const pkg = path.join(bin, "node_modules", "netlify-cli");
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(
      path.join(pkg, "package.json"),
      JSON.stringify({
        name: "netlify-cli",
        version: "27.16.1",
        bin: { netlify: "bin/run.js" },
      }),
    );
    fs.writeFileSync(path.join(bin, "netlify.cmd"), "@echo off");
    const cli = findNetlifyCli(bin);
    expect(cli.version).toBe("27.16.1");
    expect(cli.entryPoint).toBe(path.join(pkg, "bin", "run.js"));
  });
});
