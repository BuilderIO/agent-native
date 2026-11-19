import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { main, scanDir, signingKeyNeedles } from "./check-bundle-secrets";

const CANARY = "canary-signing-key-not-a-secret";
const HEADER = "untrusted comment: rsign encrypted secret key";

const dirs: string[] = [];

function bundle(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "bundle-secrets-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
  }
  return dir;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("check-bundle-secrets", () => {
  it("passes a bundle with no signing material", () => {
    const dir = bundle({ "assets/index-1.js": 'var a={"VITE_X":"1"};' });
    expect(scanDir(dir, signingKeyNeedles({}))).toEqual({
      files: 1,
      leaks: [],
    });
  });

  it("finds the variable name when the whole env object is inlined", () => {
    const dir = bundle({
      "assets/index-1.js":
        'var e={"VITE_X":"1","TAURI_SIGNING_PRIVATE_KEY":"x"};',
    });
    const { leaks } = scanDir(dir, signingKeyNeedles({}));
    expect(leaks.map((leak) => leak.label)).toEqual([
      "TAURI_SIGNING_ variable name",
    ]);
  });

  it("finds the key value even when its name is gone", () => {
    const dir = bundle({ "assets/index-1.js": `var k="${CANARY}";` });
    const needles = signingKeyNeedles({ TAURI_SIGNING_PRIVATE_KEY: CANARY });
    expect(scanDir(dir, needles).leaks.map((leak) => leak.label)).toEqual([
      "value of TAURI_SIGNING_PRIVATE_KEY",
    ]);
  });

  it("finds the secret-key header as text and as base64", () => {
    const plain = bundle({ "a.js": `x="${HEADER}\\nRWR"` });
    const encoded = bundle({
      "a.js": `x="${Buffer.from(`${HEADER}\nRWRFAKE`).toString("base64")}"`,
    });
    expect(scanDir(plain, signingKeyNeedles({})).leaks[0]?.label).toBe(
      "minisign secret-key header",
    );
    expect(scanDir(encoded, signingKeyNeedles({})).leaks[0]?.label).toBe(
      "base64 minisign secret-key header",
    );
  });

  it("looks in nested folders", () => {
    const dir = bundle({
      "assets/deep/chunk.js": 'k="TAURI_SIGNING_PRIVATE_KEY"',
    });
    expect(scanDir(dir, signingKeyNeedles({})).leaks).toHaveLength(1);
  });

  it("ignores env values too short to be a key", () => {
    expect(
      signingKeyNeedles({ TAURI_SIGNING_PRIVATE_KEY: "abc" }),
    ).toHaveLength(3);
  });

  it("exits 0 for a clean bundle and 1 for a leaking one", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(main([bundle({ "a.js": "ok" })])).toBe(0);
    expect(main([bundle({ "a.js": "TAURI_SIGNING_PRIVATE_KEY" })])).toBe(1);
  });

  it("never prints the matched value", () => {
    vi.stubEnv("TAURI_SIGNING_PRIVATE_KEY", CANARY);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(main([bundle({ "a.js": `k="${CANARY}"` })])).toBe(1);
    expect(JSON.stringify(errors.mock.calls)).not.toContain(CANARY);
  });

  it("exits 2 when nothing was inspected", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(main([])).toBe(2);
    expect(main([join(tmpdir(), "bundle-secrets-missing-dir")])).toBe(2);
    expect(main([bundle({})])).toBe(2);
  });
});
