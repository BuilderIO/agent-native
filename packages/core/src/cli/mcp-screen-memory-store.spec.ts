import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveScreenMemoryStoreDir } from "./mcp.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function home(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clips-store-resolve-"));
  roots.push(root);
  return root;
}

describe("resolveScreenMemoryStoreDir", () => {
  it("prefers an existing explicit directory, then an existing environment override", () => {
    const root = home();
    const explicit = path.join(root, "explicit-clips-store");
    const override = path.join(root, "env-clips-store");
    fs.mkdirSync(explicit, { recursive: true });
    fs.mkdirSync(override, { recursive: true });

    expect(
      resolveScreenMemoryStoreDir({
        explicitDir: explicit,
        env: { CLIPS_SCREEN_MEMORY_DIR: override },
      }),
    ).toBe(explicit);
    expect(
      resolveScreenMemoryStoreDir({
        env: { AGENT_NATIVE_SCREEN_MEMORY_DIR: override },
      }),
    ).toBe(override);
  });

  it("rejects explicit and environment overrides that are not directories", () => {
    const root = home();
    const missing = path.join(root, "missing-store");
    const file = path.join(root, "not-a-store");
    fs.writeFileSync(file, "not a directory");

    expect(
      resolveScreenMemoryStoreDir({ explicitDir: missing }),
    ).toBeUndefined();
    expect(
      resolveScreenMemoryStoreDir({
        env: { CLIPS_SCREEN_MEMORY_DIR: missing },
      }),
    ).toBeUndefined();
    expect(resolveScreenMemoryStoreDir({ explicitDir: file })).toBeUndefined();
  });

  it("discovers whichever Clips store was most recently active", () => {
    const root = home();
    const appData = path.join(root, "Library", "Application Support");
    const stable = path.join(appData, "com.clips.tray", "screen-memory");
    const alpha = path.join(appData, "com.clips.tray.alpha", "screen-memory");
    fs.mkdirSync(stable, { recursive: true });
    fs.mkdirSync(alpha, { recursive: true });
    const now = new Date();
    fs.utimesSync(
      stable,
      new Date(now.getTime() - 60_000),
      new Date(now.getTime() - 60_000),
    );
    fs.utimesSync(alpha, now, now);

    expect(
      resolveScreenMemoryStoreDir({ platform: "darwin", homeDir: root }),
    ).toBe(alpha);
  });

  it("returns undefined when Rewind has not created a store", () => {
    expect(
      resolveScreenMemoryStoreDir({ platform: "darwin", homeDir: home() }),
    ).toBeUndefined();
  });
});
