import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isHostedSlidesRuntime, tenantUploadDir } from "./tenant-files";
import { deleteUploadedReference } from "./uploaded-reference-storage";

const mocks = vi.hoisted(() => ({ noteExternalWrite: vi.fn() }));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  noteExternalWrite: mocks.noteExternalWrite,
}));

// The local delete path resolves its target against the working directory,
// so the working directory is a temp root and every hosted flag is cleared.
const OWNER = "owner@example.com";
const HOSTED_ENV = [
  "NETLIFY",
  "NETLIFY_LOCAL",
  "AWS_LAMBDA_FUNCTION_NAME",
  "LAMBDA_TASK_ROOT",
  "VERCEL",
  "VERCEL_ENV",
  "CF_PAGES",
  "RENDER",
  "FLY_APP_NAME",
  "K_SERVICE",
];
let root: string;

beforeEach(() => {
  mocks.noteExternalWrite.mockClear();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "slides-upload-observed-"));
  vi.spyOn(process, "cwd").mockReturnValue(root);
  for (const name of HOSTED_ENV) vi.stubEnv(name, "");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

function uploadedFile(name: string): string {
  const dir = tenantUploadDir(OWNER);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, "deck");
  return file;
}

function callOrder(spy: { mock: { invocationCallOrder: number[] } }): number {
  const order = spy.mock.invocationCallOrder.at(0);
  if (order === undefined) {
    throw new Error("Expected the spy to be called.");
  }
  return order;
}

describe("deleteUploadedReference write observation", () => {
  it("notes the delete before unlinking a local upload", async () => {
    expect(isHostedSlidesRuntime()).toBe(false);
    const file = uploadedFile("deck.pptx");
    const unlink = vi.spyOn(fs.promises, "unlink");

    await expect(
      deleteUploadedReference(path.relative(root, file), OWNER),
    ).resolves.toBe(true);

    expect(mocks.noteExternalWrite).toHaveBeenCalledWith("local-disk");
    expect(callOrder(mocks.noteExternalWrite)).toBeLessThan(callOrder(unlink));
    expect(fs.existsSync(file)).toBe(false);
  });

  it("refuses a path outside the uploads folder before noting anything", async () => {
    const outside = path.join(root, "elsewhere.pptx");
    fs.writeFileSync(outside, "deck");

    await expect(
      deleteUploadedReference(path.relative(root, outside), OWNER),
    ).rejects.toThrow();

    expect(mocks.noteExternalWrite).not.toHaveBeenCalled();
    expect(fs.existsSync(outside)).toBe(true);
  });
});
