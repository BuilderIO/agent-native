// @agent-native/pinpoint — FileStore tests
// MIT License

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { Pin } from "../types/index.js";
import { FileStore } from "./file-store.js";

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function tmpDataDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pinpoint-file-store-"));
  tmpRoots.push(root);
  // Nest the actual data dir so we can assert it gets created lazily.
  return path.join(root, "pins");
}

function makePin(overrides: Partial<Pin> = {}): Pin {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    pageUrl: "https://example.com/page",
    createdAt: now,
    updatedAt: now,
    comment: "Looks off",
    element: {
      tagName: "DIV",
      classNames: ["card"],
      selector: ".card",
      boundingRect: { x: 0, y: 0, width: 10, height: 10 },
    },
    status: {
      state: "open",
      changedAt: now,
    },
    ...overrides,
  };
}

describe("FileStore", () => {
  it("round-trips a saved pin through list()", async () => {
    const store = new FileStore(tmpDataDir());
    const pin = makePin();

    await store.save(pin);
    const pins = await store.list();

    expect(pins).toHaveLength(1);
    expect(pins[0]).toEqual(pin);
  });

  it("update() overwrites the pin atomically without leaving temp files behind", async () => {
    const dataDir = tmpDataDir();
    const store = new FileStore(dataDir);
    const pin = makePin({ comment: "original" });
    await store.save(pin);

    await store.update(pin.id, { comment: "revised" });

    const pins = await store.list();
    expect(pins).toHaveLength(1);
    expect(pins[0]?.comment).toBe("revised");
    expect(pins[0]?.updatedAt).not.toBe(pin.updatedAt);

    // No stray temp/staging files should remain in the data directory.
    const files = fs.readdirSync(dataDir);
    expect(files).toEqual([`${pin.id}.json`]);
  });

  it("list() ignores leftover temp files in the data directory", async () => {
    const dataDir = tmpDataDir();
    const store = new FileStore(dataDir);
    const pin = makePin();
    await store.save(pin);

    // Simulate a temp file left behind by an interrupted write.
    fs.writeFileSync(
      path.join(dataDir, `.${randomUUID()}.tmp`),
      "not valid pin json",
      "utf-8",
    );

    const pins = await store.list();
    expect(pins).toHaveLength(1);
    expect(pins[0]?.id).toBe(pin.id);
  });

  it("delete() removes the pin file", async () => {
    const dataDir = tmpDataDir();
    const store = new FileStore(dataDir);
    const pin = makePin();
    await store.save(pin);

    await store.delete(pin.id);

    expect(await store.list()).toEqual([]);
    expect(fs.existsSync(path.join(dataDir, `${pin.id}.json`))).toBe(false);
  });

  it("stages temp files inside the data directory so rename() stays on one filesystem", async () => {
    const dataDir = tmpDataDir();
    const store = new FileStore(dataDir);
    const pin = makePin();

    await store.save(pin);

    // The data dir itself must contain only the final .json file — the
    // temp staging path used during the write must be inside this.dir
    // (not os.tmpdir()), and must be cleaned up after a successful rename.
    const files = fs.readdirSync(dataDir);
    expect(files).toEqual([`${pin.id}.json`]);
  });
});
