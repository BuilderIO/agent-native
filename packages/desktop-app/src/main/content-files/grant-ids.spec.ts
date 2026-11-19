import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  legacyContentFilesGrantId,
  persistentContentFilesGrantId,
} from "./grant-ids";

const folder = path.join(os.tmpdir(), "Private Client Notes");

describe("persistentContentFilesGrantId", () => {
  it("names a newly linked folder without its path", () => {
    const id = persistentContentFilesGrantId(folder, {});
    expect(id).toMatch(/^folder-[0-9a-f-]{36}$/);
    expect(id).not.toContain(Buffer.from(folder).toString("base64url"));
    expect(id).not.toContain("Private");
  });

  it("gives each newly linked folder its own name", () => {
    expect(persistentContentFilesGrantId(folder, {})).not.toBe(
      persistentContentFilesGrantId(path.join(folder, "Other"), {}),
    );
  });

  it("keeps the name of a folder linked before, so its Content pages stay attached", () => {
    const id = legacyContentFilesGrantId(folder);
    expect(
      persistentContentFilesGrantId(folder, {
        [id]: { id, path: folder, kind: "persistent" },
      }),
    ).toBe(id);
  });

  it("keeps a random name once the folder has one", () => {
    const id = persistentContentFilesGrantId(folder, {});
    expect(
      persistentContentFilesGrantId(folder, {
        [id]: { id, path: folder, kind: "persistent" },
      }),
    ).toBe(id);
  });

  it("does not take the name of a temporary working copy of the same folder", () => {
    const temporary = "folder-working-copy";
    expect(
      persistentContentFilesGrantId(folder, {
        [temporary]: { id: temporary, path: folder, kind: "temporary" },
      }),
    ).not.toBe(temporary);
  });
});
