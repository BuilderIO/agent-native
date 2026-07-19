import { lstat, open, rm } from "node:fs/promises";
import path from "node:path";

import type { PrivateVaultMigrationArchiveWriter } from "./content-migration-export.js";

export class PrivateVaultMigrationArchiveWriterError extends Error {
  constructor() {
    super("Private Vault migration archive was not saved");
    this.name = "PrivateVaultMigrationArchiveWriterError";
  }
}

export class PrivateVaultLocalMigrationArchiveWriter implements PrivateVaultMigrationArchiveWriter {
  readonly #selectPath: (suggestedName: string) => Promise<string | null>;

  constructor(selectPath: (suggestedName: string) => Promise<string | null>) {
    this.#selectPath = selectPath;
  }

  async save(input: {
    readonly suggestedName: string;
    readonly archive: Uint8Array;
  }): Promise<void> {
    if (
      !/^[A-Za-z0-9._-]{1,180}\.anpvault$/.test(input.suggestedName) ||
      !(input.archive instanceof Uint8Array) ||
      input.archive.byteLength === 0
    )
      throw new PrivateVaultMigrationArchiveWriterError();
    const selected = await this.#selectPath(input.suggestedName);
    if (!selected || !path.isAbsolute(selected))
      throw new PrivateVaultMigrationArchiveWriterError();
    const target = path.resolve(selected);
    const parent = path.dirname(target);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let created = false;
    const working = input.archive.slice();
    try {
      const parentMetadata = await lstat(parent);
      if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink())
        throw new Error();
      handle = await open(target, "wx", 0o600);
      created = true;
      await handle.writeFile(working);
      await handle.sync();
      await handle.chmod(0o600);
    } catch {
      await handle?.close().catch(() => undefined);
      handle = undefined;
      if (created) await rm(target, { force: true }).catch(() => undefined);
      throw new PrivateVaultMigrationArchiveWriterError();
    } finally {
      working.fill(0);
      await handle?.close().catch(() => undefined);
    }
  }
}
