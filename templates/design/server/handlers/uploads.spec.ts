import os from "os";
import path from "path";

import { describe, expect, it } from "vitest";

import { uploadsRootForRuntime } from "./uploads.js";

describe("uploadsRootForRuntime", () => {
  it("uses the app data directory outside serverless", () => {
    expect(uploadsRootForRuntime("/repo/templates/design", {})).toBe(
      path.join("/repo/templates/design", "data", "uploads"),
    );
  });

  it("uses writable temp storage on serverless hosts", () => {
    expect(uploadsRootForRuntime("/var/task", { NETLIFY: "true" })).toBe(
      path.join(os.tmpdir(), "agent-native-design", "data", "uploads"),
    );
  });
});
