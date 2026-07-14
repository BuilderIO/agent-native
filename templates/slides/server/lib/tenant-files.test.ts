import os from "os";
import path from "path";

import { describe, expect, it } from "vitest";

import {
  tenantExportDir,
  tenantFileKey,
  tenantUploadDir,
} from "./tenant-files";

const EMPTY_ENV = {} as NodeJS.ProcessEnv;

describe("Slides tenant file storage", () => {
  it("keeps local uploads and exports under the app data directory", () => {
    const cwd = "/workspace/slides";
    const key = tenantFileKey("owner@example.com");

    expect(tenantUploadDir("owner@example.com", cwd)).toBe(
      path.join(cwd, "data", "uploads", key),
    );
    expect(tenantExportDir("owner@example.com", cwd, EMPTY_ENV)).toBe(
      path.join(cwd, "data", "exports", key),
    );
  });

  it("keeps upload paths tenant-scoped for local file compatibility", () => {
    const key = tenantFileKey("owner@example.com");

    expect(tenantUploadDir("owner@example.com", "/workspace/slides")).toBe(
      path.join("/workspace/slides", "data", "uploads", key),
    );
  });

  it("uses writable temp storage for same-request hosted exports", () => {
    const key = tenantFileKey("owner@example.com");
    expect(
      tenantExportDir("owner@example.com", "/workspace/slides", {
        NETLIFY: "true",
      }),
    ).toBe(path.join(os.tmpdir(), "agent-native-slides", "exports", key));
  });
});
