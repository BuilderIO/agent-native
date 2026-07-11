// @agent-native/pinpoint — create-pin script tests
// MIT License
//
// createPin() always constructs `new FileStore()` with no explicit data
// directory, which resolves the storage path relative to `process.cwd()`.
// To exercise it against a throwaway directory (matching file-store.spec.ts's
// temp-dir style) without touching source, each test chdirs into a fresh
// temp directory before invoking the script and restores the original cwd
// afterward.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileStore } from "../storage/file-store.js";
import createPin from "./create-pin.js";

const tmpRoots: string[] = [];
const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function chdirTmp(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pinpoint-create-pin-"));
  tmpRoots.push(root);
  process.chdir(root);
  return root;
}

describe("create-pin script", () => {
  it("writes a new pin with the fields derived from CLI args", async () => {
    const root = chdirTmp();

    await createPin([
      "--pageUrl",
      "https://example.com/dashboard",
      "--selector",
      ".card:nth-child(2)",
      "--comment",
      "This card is misaligned",
      "--author",
      "steve",
    ]);

    const store = new FileStore(path.join(root, "data/pins"));
    const pins = await store.list();

    expect(pins).toHaveLength(1);
    const pin = pins[0]!;
    expect(pin.pageUrl).toBe("https://example.com/dashboard");
    expect(pin.comment).toBe("This card is misaligned");
    expect(pin.author).toBe("steve");
    expect(pin.element.selector).toBe(".card:nth-child(2)");
    expect(pin.element.tagName).toBe("unknown");
    expect(pin.status).toEqual({
      state: "open",
      changedAt: pin.status.changedAt,
      changedBy: "agent",
    });
    expect(pin.createdAt).toBe(pin.updatedAt);
    expect(pin.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("omits author when not provided", async () => {
    const root = chdirTmp();

    await createPin([
      "--pageUrl",
      "https://example.com",
      "--selector",
      "#hero",
      "--comment",
      "note",
    ]);

    const store = new FileStore(path.join(root, "data/pins"));
    const [pin] = await store.list();
    expect(pin!.author).toBeUndefined();
  });

  it("rejects when --pageUrl is missing", async () => {
    chdirTmp();
    await expect(
      createPin(["--selector", "#hero", "--comment", "note"]),
    ).rejects.toThrow("--pageUrl is required");
  });

  it("rejects when --selector is missing", async () => {
    chdirTmp();
    await expect(
      createPin(["--pageUrl", "https://example.com", "--comment", "note"]),
    ).rejects.toThrow("--selector is required");
  });

  it("rejects when --comment is missing", async () => {
    chdirTmp();
    await expect(
      createPin(["--pageUrl", "https://example.com", "--selector", "#hero"]),
    ).rejects.toThrow("--comment is required");
  });

  it("checks pageUrl before selector when both are missing", async () => {
    chdirTmp();
    await expect(createPin(["--comment", "note"])).rejects.toThrow(
      "--pageUrl is required",
    );
  });
});
