import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, describe, expect, it } from "vitest";

import {
  HOSTED_PPTX_EXPORT_TTL_MS,
  MAX_HOSTED_PPTX_EXPORTS_PER_TENANT,
  isHostedSlidesRuntime,
  pruneHostedPptxExports,
  pptxDeckBindingPath,
  tenantExportDir,
  tenantFileKey,
  tenantUploadDir,
} from "./tenant-files";

const EMPTY_ENV = {} as NodeJS.ProcessEnv;
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

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
    const expected = path.join(
      os.tmpdir(),
      "agent-native-slides",
      "exports",
      key,
    );

    for (const env of [
      { NETLIFY: "true" },
      { VERCEL_ENV: "production" },
      { CF_PAGES: "1" },
      { RENDER: "true" },
      { FLY_APP_NAME: "slides" },
      { K_SERVICE: "slides" },
    ]) {
      expect(
        tenantExportDir("owner@example.com", "/workspace/slides", env),
      ).toBe(expected);
    }
  });

  it("shares hosted-runtime detection with upload storage", () => {
    expect(isHostedSlidesRuntime("/workspace/slides", EMPTY_ENV)).toBe(false);
    expect(
      isHostedSlidesRuntime("/workspace/slides", {
        NETLIFY: "true",
        NETLIFY_LOCAL: "true",
      }),
    ).toBe(false);
    expect(isHostedSlidesRuntime("/var/task", EMPTY_ENV)).toBe(true);
  });

  it("expires old hosted PPTX files and keeps unrelated files", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "slides-pptx-retention-"),
    );
    temporaryDirectories.push(directory);
    const now = Date.now();
    const expired = path.join(directory, "expired.pptx");
    const recent = path.join(directory, "recent.pptx");
    const unrelated = path.join(directory, "notes.txt");
    fs.writeFileSync(expired, "expired");
    fs.writeFileSync(
      pptxDeckBindingPath(directory, "expired.pptx"),
      "deck-key",
    );
    fs.writeFileSync(recent, "recent");
    fs.writeFileSync(pptxDeckBindingPath(directory, "recent.pptx"), "deck-key");
    fs.writeFileSync(unrelated, "keep");
    const expiredAt = now - HOSTED_PPTX_EXPORT_TTL_MS - 1_000;
    fs.utimesSync(expired, new Date(expiredAt), new Date(expiredAt));

    pruneHostedPptxExports(directory, now);

    expect(fs.existsSync(expired)).toBe(false);
    expect(fs.existsSync(pptxDeckBindingPath(directory, "expired.pptx"))).toBe(
      false,
    );
    expect(fs.existsSync(recent)).toBe(true);
    expect(fs.existsSync(pptxDeckBindingPath(directory, "recent.pptx"))).toBe(
      true,
    );
    expect(fs.existsSync(unrelated)).toBe(true);
  });

  it("keeps only the newest hosted PPTX files within the tenant cap", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "slides-pptx-retention-"),
    );
    temporaryDirectories.push(directory);
    const now = Date.now();
    const files = Array.from(
      { length: MAX_HOSTED_PPTX_EXPORTS_PER_TENANT + 1 },
      (_, index) => path.join(directory, `export-${index}.pptx`),
    );
    files.forEach((file, index) => {
      const modified = now - index * 1_000;
      fs.writeFileSync(file, "pptx");
      fs.utimesSync(file, new Date(modified), new Date(modified));
    });

    pruneHostedPptxExports(directory, now, path.basename(files.at(-1)!));

    expect(fs.readdirSync(directory)).toHaveLength(
      MAX_HOSTED_PPTX_EXPORTS_PER_TENANT,
    );
    expect(fs.existsSync(files[0])).toBe(true);
    expect(fs.existsSync(files.at(-1)!)).toBe(true);
    expect(fs.existsSync(files.at(-2)!)).toBe(false);
  });
});
