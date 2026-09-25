import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, describe, expect, it } from "vitest";

import {
  clearAgentNativeNitroPresetMarker,
  resolveAgentNativeNitroPreset,
  writeAgentNativeNitroPresetMarker,
} from "./nitro-preset.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-native-nitro-"));
  tempDirs.push(dir);
  return dir;
}

describe("Agent-Native Nitro preset marker", () => {
  it("carries the vite.config preset into the post-build process", () => {
    const cwd = tempDir();
    writeAgentNativeNitroPresetMarker("cloudflare_module", cwd);

    expect(resolveAgentNativeNitroPreset({ cwd, env: {} })).toBe(
      "cloudflare_module",
    );
  });

  it("prefers an explicit build environment preset", () => {
    const cwd = tempDir();
    writeAgentNativeNitroPresetMarker("cloudflare_module", cwd);

    expect(
      resolveAgentNativeNitroPreset({
        cwd,
        env: { NITRO_PRESET: "netlify" },
      }),
    ).toBe("netlify");
  });

  it("clears stale configuration before the next build", () => {
    const cwd = tempDir();
    writeAgentNativeNitroPresetMarker("cloudflare_module", cwd);
    clearAgentNativeNitroPresetMarker(cwd);

    expect(resolveAgentNativeNitroPreset({ cwd, env: {} })).toBeUndefined();
  });
});
