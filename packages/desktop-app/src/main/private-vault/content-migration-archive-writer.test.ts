import {
  lstat,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  PrivateVaultLocalMigrationArchiveWriter,
  PrivateVaultMigrationArchiveWriterError,
} from "./content-migration-archive-writer.js";

const roots: string[] = [];

async function directory() {
  const root = path.join(
    tmpdir(),
    `private-vault-export-writer-${process.pid}-${Date.now()}-${roots.length}`,
  );
  await mkdir(root, { recursive: false, mode: 0o700 });
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("Private Vault local migration archive writer", () => {
  it("creates a non-overwriting mode-0600 archive", async () => {
    const root = await directory();
    const target = path.join(root, "private-content.anpvault");
    const writer = new PrivateVaultLocalMigrationArchiveWriter(
      async () => target,
    );
    const archive = Uint8Array.of(0xa4, 1, 2, 3);
    await expect(
      writer.save({ suggestedName: "private-content.anpvault", archive }),
    ).resolves.toBeUndefined();
    expect(await readFile(target)).toEqual(Buffer.from(archive));
    expect((await lstat(target)).mode & 0o777).toBe(0o600);
    await expect(
      writer.save({ suggestedName: "private-content.anpvault", archive }),
    ).rejects.toBeInstanceOf(PrivateVaultMigrationArchiveWriterError);
    expect(await readFile(target)).toEqual(Buffer.from(archive));
  });

  it("rejects cancellation, relative paths, existing symlinks, and symlinked parent directories", async () => {
    const archive = Uint8Array.of(1);
    await expect(
      new PrivateVaultLocalMigrationArchiveWriter(async () => null).save({
        suggestedName: "private-content.anpvault",
        archive,
      }),
    ).rejects.toBeInstanceOf(PrivateVaultMigrationArchiveWriterError);
    await expect(
      new PrivateVaultLocalMigrationArchiveWriter(
        async () => "relative.anpvault",
      ).save({
        suggestedName: "private-content.anpvault",
        archive,
      }),
    ).rejects.toBeInstanceOf(PrivateVaultMigrationArchiveWriterError);

    const root = await directory();
    const existing = path.join(root, "existing");
    const target = path.join(root, "private-content.anpvault");
    await writeFile(existing, "unchanged", { mode: 0o600 });
    await symlink(existing, target);
    await expect(
      new PrivateVaultLocalMigrationArchiveWriter(async () => target).save({
        suggestedName: "private-content.anpvault",
        archive,
      }),
    ).rejects.toBeInstanceOf(PrivateVaultMigrationArchiveWriterError);
    expect(await readFile(existing, "utf8")).toBe("unchanged");

    const real = path.join(root, "real");
    const linked = path.join(root, "linked");
    await mkdir(real);
    await symlink(real, linked);
    await expect(
      new PrivateVaultLocalMigrationArchiveWriter(async () =>
        path.join(linked, "private-content.anpvault"),
      ).save({ suggestedName: "private-content.anpvault", archive }),
    ).rejects.toBeInstanceOf(PrivateVaultMigrationArchiveWriterError);
  });
});
