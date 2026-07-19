import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  PrivateVaultLocalMigrationArchiveReader,
  PrivateVaultMigrationArchiveReaderError,
} from "./content-migration-archive-reader.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("Private Vault local migration archive reader", () => {
  it("reads one bounded regular archive selected by the signed shell", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "an-pv-read-"));
    roots.push(root);
    const file = path.join(root, "recovery.anpvault");
    await writeFile(file, Uint8Array.of(0xa1, 1, 2));
    const reader = new PrivateVaultLocalMigrationArchiveReader(
      async () => file,
    );
    await expect(reader.read()).resolves.toEqual(Uint8Array.of(0xa1, 1, 2));
  });

  it("rejects cancellation, relative paths, directories, and symlinks", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "an-pv-read-"));
    roots.push(root);
    const file = path.join(root, "recovery.anpvault");
    const link = path.join(root, "linked.anpvault");
    await writeFile(file, Uint8Array.of(1));
    await symlink(file, link);
    for (const selected of [null, "relative.anpvault", root, link]) {
      const reader = new PrivateVaultLocalMigrationArchiveReader(
        async () => selected,
      );
      await expect(reader.read()).rejects.toBeInstanceOf(
        PrivateVaultMigrationArchiveReaderError,
      );
    }
  });
});
