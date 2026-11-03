import fs from "fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { storeLocalImportedAsset } from "./import-asset-storage";
import { tenantFileKey } from "./tenant-files";

const mocks = vi.hoisted(() => ({ noteExternalWrite: vi.fn() }));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  noteExternalWrite: mocks.noteExternalWrite,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdir: vi.fn(actual.mkdir),
    writeFile: vi.fn(actual.writeFile),
  };
});

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  getConfiguredAppBasePath: () => "",
}));

// Local imports are a dev-only fallback: the write goes to the working
// directory, so the working directory is a temp root and hosted flags are off.
const EMAIL = "owner@example.com";
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
  vi.mocked(mkdir).mockClear();
  vi.mocked(writeFile).mockClear();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "slides-import-observed-"));
  vi.spyOn(process, "cwd").mockReturnValue(root);
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("SECRETS_ENCRYPTION_KEY", "import-asset-storage-test");
  for (const name of HOSTED_ENV) vi.stubEnv(name, "");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

function callOrder(spy: { mock: { invocationCallOrder: number[] } }): number {
  const order = spy.mock.invocationCallOrder.at(0);
  if (order === undefined) {
    throw new Error("Expected the spy to be called.");
  }
  return order;
}

describe("storeLocalImportedAsset write observation", () => {
  it("notes the write before creating the folder and saving the file", async () => {
    const url = await storeLocalImportedAsset({
      email: EMAIL,
      filename: "Pic 1.png",
      mimeType: "image/png",
      data: new Uint8Array([1, 2, 3]),
    });

    const directory = path.join(
      root,
      "data",
      "import-assets",
      tenantFileKey(EMAIL),
    );
    expect(url).toMatch(/\/api\/import-assets\//);
    expect(mocks.noteExternalWrite).toHaveBeenCalledWith("local-disk");
    expect(callOrder(mocks.noteExternalWrite)).toBeLessThan(
      callOrder(vi.mocked(mkdir)),
    );
    expect(mkdir).toHaveBeenCalledWith(directory, { recursive: true });
    expect(callOrder(vi.mocked(mkdir))).toBeLessThan(
      callOrder(vi.mocked(writeFile)),
    );
    const [saved] = fs.readdirSync(directory);
    expect(saved).toMatch(/-Pic-1\.png$/);
  });

  it("returns null and notes nothing on a hosted runtime", async () => {
    vi.stubEnv("NETLIFY", "true");

    await expect(
      storeLocalImportedAsset({
        email: EMAIL,
        filename: "pic.png",
        mimeType: "image/png",
        data: new Uint8Array([1]),
      }),
    ).resolves.toBeNull();

    expect(mocks.noteExternalWrite).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });
});
