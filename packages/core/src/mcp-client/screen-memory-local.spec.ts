import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  configureScreenMemory,
  queryScreenMemoryContext,
  readScreenMemoryStatus,
} from "./screen-memory-local.js";

async function tempScreenMemoryEnv() {
  const root = await mkdtemp(join(tmpdir(), "screen-memory-"));
  return {
    root,
    options: {
      env: {
        AGENT_NATIVE_SCREEN_MEMORY_DIR: root,
        AGENT_NATIVE_SCREEN_MEMORY_CONFIG: join(root, "feature-config.json"),
      },
      homeDir: root,
      platform: "darwin" as const,
    },
  };
}

describe("local Screen Memory helpers", () => {
  it("defaults to disabled with no local captures", async () => {
    const { options } = await tempScreenMemoryEnv();

    const status = await readScreenMemoryStatus(options);

    expect(status.enabled).toBe(false);
    expect(status.state).toBe("disabled");
    expect(status.captureCount).toBe(0);
  });

  it("updates local config and queries bounded context records", async () => {
    const { root, options } = await tempScreenMemoryEnv();
    await writeFile(
      join(root, "context.jsonl"),
      `${JSON.stringify({
        capturedAt: "2026-06-29T12:00:00.000Z",
        appName: "Clips",
        windowTitle: "Settings",
        text: "Screen Memory is enabled",
      })}\n`,
      "utf8",
    );

    const status = await configureScreenMemory({ enabled: true }, options);
    const result = await queryScreenMemoryContext(
      { query: "enabled", limit: 5 },
      options,
    );

    expect(status.enabled).toBe(true);
    expect(status.state).toBe("ready");
    expect(result.count).toBe(1);
    expect(result.items[0]).toMatchObject({
      appName: "Clips",
      windowTitle: "Settings",
      text: "Screen Memory is enabled",
    });
  });
});
