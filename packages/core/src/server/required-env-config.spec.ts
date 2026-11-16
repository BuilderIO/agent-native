import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadRequiredEnv } from "./required-env-config.js";

describe("loadRequiredEnv", () => {
  const temporaryRoots: string[] = [];

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const root of temporaryRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  function appRoot(required: string[]): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "required-env-config-"));
    temporaryRoots.push(root);
    fs.writeFileSync(
      path.join(root, "agent-native.mts"),
      `export default ${JSON.stringify({
        runtime: { environment: { required } },
      })};\n`,
    );
    return root;
  }

  it("prefers the names the build embedded over the config on disk", async () => {
    const root = appRoot(["GOOGLE_CLIENT_ID"]);
    vi.stubEnv("AGENT_NATIVE_BUILD_REQUIRED_ENV", '["NOTION_API_KEY"]');

    await expect(loadRequiredEnv(root)).resolves.toEqual(["NOTION_API_KEY"]);
  });

  it("keeps an empty list the build embedded", async () => {
    const root = appRoot(["GOOGLE_CLIENT_ID"]);
    vi.stubEnv("AGENT_NATIVE_BUILD_REQUIRED_ENV", "[]");

    await expect(loadRequiredEnv(root)).resolves.toEqual([]);
  });

  it("reads the app's config when the build recorded nothing", async () => {
    const root = appRoot(["NOTION_API_KEY"]);
    vi.stubEnv("AGENT_NATIVE_BUILD_REQUIRED_ENV", undefined);

    await expect(loadRequiredEnv(root)).resolves.toEqual(["NOTION_API_KEY"]);
  });
});
