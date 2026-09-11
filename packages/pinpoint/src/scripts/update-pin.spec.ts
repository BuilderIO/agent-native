// @agent-native/pinpoint — update-pin script tests
// MIT License
//
// Same temp-dir-via-chdir approach as create-pin.spec.ts, since updatePin()
// always constructs `new FileStore()` with the default `data/pins` path
// resolved against `process.cwd()`.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileStore } from "../storage/file-store.js";
import type { Pin } from "../types/index.js";
import updatePin from "./update-pin.js";

const tmpRoots: string[] = [];
const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function chdirTmp(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pinpoint-update-pin-"));
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
    comment: "original comment",
    element: {
      tagName: "DIV",
      classNames: ["card"],
      selector: ".card",
      boundingRect: { x: 0, y: 0, width: 10, height: 10 },
    },
    status: { state: "open", changedAt: now, changedBy: "user" },
    ...overrides,
  };
}

describe("update-pin script", () => {
  it("updates the comment and bumps updatedAt, leaving status untouched", async () => {
    const root = chdirTmp();
    const store = new FileStore(path.join(root, "data/pins"));
    const pin = makePin();
    await store.save(pin);

    await updatePin(["--id", pin.id, "--comment", "revised comment"]);

    const [updated] = await store.list();
    expect(updated!.comment).toBe("revised comment");
    expect(updated!.updatedAt).not.toBe(pin.updatedAt);
    expect(updated!.status).toEqual(pin.status);
  });

  it("updates status and always stamps changedBy as 'agent', overwriting any prior value", async () => {
    const root = chdirTmp();
    const store = new FileStore(path.join(root, "data/pins"));
    // Default fixture status already has changedBy: "user" — confirms the
    // script always overwrites it with "agent" rather than preserving it.
    const pin = makePin();
    await store.save(pin);

    await updatePin(["--id", pin.id, "--status", "resolved"]);

    const [updated] = await store.list();
    expect(updated!.status.state).toBe("resolved");
    expect(updated!.status.changedBy).toBe("agent");
    expect(updated!.comment).toBe(pin.comment); // untouched
  });

  it("can update comment and status together in one call", async () => {
    const root = chdirTmp();
    const store = new FileStore(path.join(root, "data/pins"));
    const pin = makePin();
    await store.save(pin);

    await updatePin([
      "--id",
      pin.id,
      "--comment",
      "both changed",
      "--status",
      "dismissed",
    ]);

    const [updated] = await store.list();
    expect(updated!.comment).toBe("both changed");
    expect(updated!.status.state).toBe("dismissed");
  });

  it("rejects when --id is missing", async () => {
    chdirTmp();
    await expect(updatePin(["--comment", "x"])).rejects.toThrow(
      "--id is required",
    );
  });

  it("rejects when neither --comment nor --status is given", async () => {
    chdirTmp();
    await expect(updatePin(["--id", randomUUID()])).rejects.toThrow(
      "--comment or --status is required",
    );
  });

  it("resolves without writing a file when the pin id does not exist (FileStore.update() is a silent no-op)", async () => {
    const root = chdirTmp();
    const missingId = randomUUID();

    await expect(
      updatePin(["--id", missingId, "--comment", "irrelevant"]),
    ).resolves.toBeUndefined();

    const store = new FileStore(path.join(root, "data/pins"));
    expect(await store.list()).toEqual([]);
  });

  it("rejects with 'Invalid pin ID' for a malformed id (unlike delete, FileStore.update does not swallow this)", async () => {
    chdirTmp();
    await expect(
      updatePin(["--id", "../escape", "--comment", "x"]),
    ).rejects.toThrow(/Invalid pin ID/);
  });
});
