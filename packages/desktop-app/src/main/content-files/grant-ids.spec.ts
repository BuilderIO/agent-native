import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  contentFilesIdKey,
  legacyContentFilesGrantId,
  persistentContentFilesGrantId,
} from "./grant-ids";

const folder = path.join(os.tmpdir(), "Private Client Notes");
const key = "a".repeat(43);
const otherKey = "b".repeat(43);
const directories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("persistentContentFilesGrantId", () => {
  it("names a newly linked folder without its path", () => {
    const id = persistentContentFilesGrantId(folder, {}, key);
    expect(id).toMatch(/^folder-[A-Za-z0-9_-]{32}$/);
    expect(id).not.toContain(Buffer.from(folder).toString("base64url"));
    expect(id).not.toContain("Private");
  });

  it("gives a folder the same name when it's unlinked and linked again, so its Content pages stay attached", () => {
    expect(persistentContentFilesGrantId(folder, {}, key)).toBe(
      persistentContentFilesGrantId(folder, {}, key),
    );
  });

  it("gives each folder its own name", () => {
    expect(persistentContentFilesGrantId(folder, {}, key)).not.toBe(
      persistentContentFilesGrantId(path.join(folder, "Other"), {}, key),
    );
  });

  it("can't be matched to a path without this device's key", () => {
    expect(persistentContentFilesGrantId(folder, {}, key)).not.toBe(
      persistentContentFilesGrantId(folder, {}, otherKey),
    );
  });

  it("keeps the name of a folder linked before, so its Content pages stay attached", () => {
    const id = legacyContentFilesGrantId(folder);
    expect(
      persistentContentFilesGrantId(
        folder,
        { [id]: { id, path: folder, kind: "persistent" } },
        key,
      ),
    ).toBe(id);
  });

  it("does not take the name of a temporary working copy of the same folder", () => {
    const temporary = "folder-working-copy";
    expect(
      persistentContentFilesGrantId(
        folder,
        { [temporary]: { id: temporary, path: folder, kind: "temporary" } },
        key,
      ),
    ).not.toBe(temporary);
  });
});

describe("contentFilesIdKey", () => {
  it("makes this device's key once and reads the same key afterwards", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "content-files-"));
    directories.push(directory);
    const first = contentFilesIdKey(directory);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(contentFilesIdKey(directory)).toBe(first);
  });

  it("keeps an unreadable key aside instead of writing over it", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "content-files-"));
    directories.push(directory);
    fs.writeFileSync(path.join(directory, "content-file-id-key"), "damaged");

    const replacement = contentFilesIdKey(directory);

    expect(replacement).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(contentFilesIdKey(directory)).toBe(replacement);
    const keptAside = fs
      .readdirSync(directory)
      .filter((name) => name.startsWith("content-file-id-key.unreadable-"));
    expect(keptAside).toHaveLength(1);
    expect(
      fs.readFileSync(path.join(directory, keptAside[0] ?? ""), "utf-8"),
    ).toBe("damaged");
    expect(fs.readdirSync(directory)).toHaveLength(2);
  });
});
