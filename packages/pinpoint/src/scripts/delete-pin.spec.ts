// @agent-native/pinpoint — delete-pin script tests
// MIT License
//
// Same temp-dir-via-chdir approach as create-pin.spec.ts / update-pin.spec.ts,
// since deletePin() always constructs `new FileStore()` with the default
// `data/pins` path resolved against `process.cwd()`.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileStore } from "../storage/file-store.js";
import type { Pin } from "../types/index.js";
import deletePin from "./delete-pin.js";

const tmpRoots: string[] = [];
const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function chdirTmp(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pinpoint-delete-pin-"));
  tmpRoots.push(root);
  process.chdir(root);
  return root;
}

function makePin(overrides: Partial<Pin> = {}): Pin {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    pageUrl: "https://example.com/page",
    createdAt: now,
    updatedAt: now,
    comment: "note",
    element: {
      tagName: "DIV",
      classNames: [],
      selector: ".card",
      boundingRect: { x: 0, y: 0, width: 10, height: 10 },
    },
    status: { state: "open", changedAt: now },
    ...overrides,
  };
}

describe("delete-pin script", () => {
  it("removes the pin file for the given id", async () => {
    const root = chdirTmp();
    const store = new FileStore(path.join(root, "data/pins"));
    const pin = makePin();
    await store.save(pin);
    expect(await store.list()).toHaveLength(1);

    await deletePin(["--id", pin.id]);

    expect(await store.list()).toEqual([]);
  });

  it("leaves other pins untouched", async () => {
    const root = chdirTmp();
    const store = new FileStore(path.join(root, "data/pins"));
    const pinA = makePin();
    const pinB = makePin();
    await store.save(pinA);
    await store.save(pinB);

    await deletePin(["--id", pinA.id]);

    const remaining = await store.list();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe(pinB.id);
  });

  it("rejects when --id is missing", async () => {
    chdirTmp();
    await expect(deletePin([])).rejects.toThrow("--id is required");
  });

  it("resolves without throwing when the id does not exist", async () => {
    chdirTmp();
    await expect(deletePin(["--id", randomUUID()])).resolves.toBeUndefined();
  });

  it("resolves without throwing for a malformed id (FileStore.delete() swallows the 'Invalid pin ID' error internally)", async () => {
    // Unlike update-pin, FileStore.delete() computes the (validated) file
    // path *inside* its own try/catch, so an invalid id is caught silently
    // rather than propagating — this documents that asymmetry.
    chdirTmp();
    await expect(deletePin(["--id", "../escape"])).resolves.toBeUndefined();
  });
});
