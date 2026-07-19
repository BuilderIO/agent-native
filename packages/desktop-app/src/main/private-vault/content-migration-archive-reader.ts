import { lstat, open } from "node:fs/promises";
import path from "node:path";

import { E2EE_SIZE_LIMITS } from "@agent-native/core/e2ee";

export class PrivateVaultMigrationArchiveReaderError extends Error {
  constructor() {
    super("Private Vault migration archive was not opened");
    this.name = "PrivateVaultMigrationArchiveReaderError";
  }
}

export interface PrivateVaultMigrationArchiveReader {
  read(): Promise<Uint8Array>;
}

export class PrivateVaultLocalMigrationArchiveReader implements PrivateVaultMigrationArchiveReader {
  readonly #selectPath: () => Promise<string | null>;

  constructor(selectPath: () => Promise<string | null>) {
    this.#selectPath = selectPath;
  }

  async read(): Promise<Uint8Array> {
    const selected = await this.#selectPath();
    if (!selected || !path.isAbsolute(selected))
      throw new PrivateVaultMigrationArchiveReaderError();
    const target = path.resolve(selected);
    let bytes: Uint8Array | undefined;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const metadata = await lstat(target);
      if (
        !metadata.isFile() ||
        metadata.isSymbolicLink() ||
        metadata.size <= 0 ||
        metadata.size > E2EE_SIZE_LIMITS.exportPlaintextBytes + 64 * 1024
      )
        throw new Error();
      handle = await open(target, "r");
      const afterOpen = await handle.stat();
      if (
        !afterOpen.isFile() ||
        afterOpen.size !== metadata.size ||
        afterOpen.dev !== metadata.dev ||
        afterOpen.ino !== metadata.ino
      )
        throw new Error();
      bytes = new Uint8Array(metadata.size);
      const read = await handle.read(bytes, 0, bytes.byteLength, 0);
      if (read.bytesRead !== bytes.byteLength) throw new Error();
      return bytes;
    } catch {
      bytes?.fill(0);
      throw new PrivateVaultMigrationArchiveReaderError();
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }
}
