import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { KeyCustodyAdapter } from "@agent-native/private-vault-broker";

const VAULT_KEY_BYTES = 32;
const MAX_WRAPPED_KEY_BYTES = 64 * 1024;

export interface DesktopSafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(plaintext: string): Buffer;
  decryptString(ciphertext: Buffer): string;
  getSelectedStorageBackend(): string;
}

export class PrivateVaultCustodyError extends Error {
  constructor() {
    super("Private Vault key custody failed");
    this.name = "PrivateVaultCustodyError";
  }
}

export interface SafeStorageVaultKeyCustodyOptions {
  readonly directory: string;
  readonly safeStorage: DesktopSafeStorage;
  readonly platform?: NodeJS.Platform;
}

function strictBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new PrivateVaultCustodyError();
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    decoded.fill(0);
    throw new PrivateVaultCustodyError();
  }
  const result = Uint8Array.from(decoded);
  decoded.fill(0);
  return result;
}

function assertRegularPath(
  filePath: string,
  allowMissing: boolean,
  platform: NodeJS.Platform,
): void {
  try {
    const stat = fs.lstatSync(filePath);
    if (
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      stat.nlink !== 1 ||
      (platform !== "win32" && (stat.mode & 0o077) !== 0)
    ) {
      throw new PrivateVaultCustodyError();
    }
  } catch (error) {
    if (
      allowMissing &&
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }
    throw error instanceof PrivateVaultCustodyError
      ? error
      : new PrivateVaultCustodyError();
  }
}

function assertSecureDirectory(
  directory: string,
  platform: NodeJS.Platform,
  prepare: boolean,
): void {
  if (prepare) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new PrivateVaultCustodyError();
  }
  if (prepare) fs.chmodSync(directory, 0o700);
  const secured = fs.lstatSync(directory);
  if (
    secured.isSymbolicLink() ||
    !secured.isDirectory() ||
    (platform !== "win32" && (secured.mode & 0o077) !== 0) ||
    (platform !== "win32" &&
      typeof process.getuid === "function" &&
      secured.uid !== process.getuid())
  ) {
    throw new PrivateVaultCustodyError();
  }
}

function fsyncDirectory(directory: string, platform: NodeJS.Platform): void {
  let fd: number | null = null;
  try {
    fd = fs.openSync(directory, fs.constants.O_RDONLY);
    fs.fsyncSync(fd);
  } catch (error) {
    if (platform !== "win32") throw error;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

function writeOpaqueFileAtomic(
  filePath: string,
  value: Uint8Array,
  platform: NodeJS.Platform,
): void {
  assertRegularPath(filePath, true, platform);
  const directory = path.dirname(filePath);
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let fd: number | null = null;
  try {
    const noFollow = fs.constants.O_NOFOLLOW ?? 0;
    fd = fs.openSync(
      tempPath,
      fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_WRONLY |
        noFollow,
      0o600,
    );
    const buffer = Buffer.from(
      value.buffer,
      value.byteOffset,
      value.byteLength,
    );
    let offset = 0;
    while (offset < buffer.byteLength) {
      const written = fs.writeSync(
        fd,
        buffer,
        offset,
        buffer.byteLength - offset,
      );
      if (written <= 0) throw new PrivateVaultCustodyError();
      offset += written;
    }
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tempPath, filePath);
    fs.chmodSync(filePath, 0o600);
    fsyncDirectory(directory, platform);
  } catch {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // The content-free custody error below remains authoritative.
      }
    }
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // The content-free custody error below remains authoritative.
    }
    throw new PrivateVaultCustodyError();
  }
}

function readOpaqueFile(
  filePath: string,
  platform: NodeJS.Platform,
): Buffer | null {
  let value: Buffer | null = null;
  try {
    assertRegularPath(filePath, true, platform);
    const noFollow = fs.constants.O_NOFOLLOW ?? 0;
    const fd = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
    try {
      const stat = fs.fstatSync(fd);
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        (platform !== "win32" && (stat.mode & 0o077) !== 0) ||
        stat.size <= 0 ||
        stat.size > MAX_WRAPPED_KEY_BYTES
      ) {
        throw new PrivateVaultCustodyError();
      }
      value = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < value.byteLength) {
        const read = fs.readSync(
          fd,
          value,
          offset,
          value.byteLength - offset,
          null,
        );
        if (read === 0) throw new PrivateVaultCustodyError();
        offset += read;
      }
      return value;
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    value?.fill(0);
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error instanceof PrivateVaultCustodyError
      ? error
      : new PrivateVaultCustodyError();
  }
}

export class SafeStorageVaultKeyCustody implements KeyCustodyAdapter {
  readonly #directory: string;
  readonly #safeStorage: DesktopSafeStorage;
  readonly #platform: NodeJS.Platform;
  #initialized = false;
  #closed = false;

  constructor(options: SafeStorageVaultKeyCustodyOptions) {
    this.#directory = path.resolve(options.directory);
    this.#safeStorage = options.safeStorage;
    this.#platform = options.platform ?? process.platform;
  }

  async initialize(): Promise<void> {
    if (this.#initialized || this.#closed) throw new PrivateVaultCustodyError();
    try {
      this.#assertSafeStorageAvailable();
      assertSecureDirectory(this.#directory, this.#platform, true);
      this.#initialized = true;
    } catch {
      throw new PrivateVaultCustodyError();
    }
  }

  async loadVaultKey(vaultId: string): Promise<Uint8Array | null> {
    this.#assertReady();
    const wrapped = readOpaqueFile(this.#pathFor(vaultId), this.#platform);
    if (wrapped === null) return null;
    try {
      const encoded = this.#safeStorage.decryptString(wrapped);
      const key = strictBase64(encoded);
      if (key.byteLength !== VAULT_KEY_BYTES) {
        key.fill(0);
        throw new PrivateVaultCustodyError();
      }
      return key;
    } catch {
      throw new PrivateVaultCustodyError();
    } finally {
      wrapped.fill(0);
    }
  }

  async storeVaultKey(vaultId: string, key: Uint8Array): Promise<void> {
    this.#assertReady();
    if (!(key instanceof Uint8Array) || key.byteLength !== VAULT_KEY_BYTES) {
      throw new PrivateVaultCustodyError();
    }
    let wrapped: Buffer | null = null;
    let plaintextCopy: Buffer | null = null;
    let persisted: Buffer | null = null;
    try {
      // Electron safeStorage accepts strings only. The immutable base64 string
      // is kept in this narrow scope; the caller-owned key is never retained.
      plaintextCopy = Buffer.from(key);
      wrapped = this.#safeStorage.encryptString(
        plaintextCopy.toString("base64"),
      );
      if (
        wrapped.byteLength === 0 ||
        wrapped.byteLength > MAX_WRAPPED_KEY_BYTES
      ) {
        throw new PrivateVaultCustodyError();
      }
      writeOpaqueFileAtomic(this.#pathFor(vaultId), wrapped, this.#platform);
      persisted = readOpaqueFile(this.#pathFor(vaultId), this.#platform);
      if (
        persisted === null ||
        persisted.byteLength !== wrapped.byteLength ||
        !timingSafeEqual(persisted, wrapped)
      ) {
        throw new PrivateVaultCustodyError();
      }
    } catch {
      throw new PrivateVaultCustodyError();
    } finally {
      plaintextCopy?.fill(0);
      wrapped?.fill(0);
      persisted?.fill(0);
    }
  }

  async deleteVaultKey(vaultId: string): Promise<void> {
    this.#assertReady();
    const filePath = this.#pathFor(vaultId);
    try {
      assertRegularPath(filePath, true, this.#platform);
      fs.unlinkSync(filePath);
      fsyncDirectory(this.#directory, this.#platform);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return;
      }
      throw new PrivateVaultCustodyError();
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#initialized = false;
  }

  #assertReady(): void {
    if (!this.#initialized || this.#closed)
      throw new PrivateVaultCustodyError();
    this.#assertSafeStorageAvailable();
    try {
      assertSecureDirectory(this.#directory, this.#platform, false);
    } catch {
      throw new PrivateVaultCustodyError();
    }
  }

  #assertSafeStorageAvailable(): void {
    try {
      if (!this.#safeStorage.isEncryptionAvailable()) {
        throw new PrivateVaultCustodyError();
      }
      if (
        this.#platform === "linux" &&
        !new Set(["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"]).has(
          this.#safeStorage.getSelectedStorageBackend(),
        )
      ) {
        throw new PrivateVaultCustodyError();
      }
    } catch {
      throw new PrivateVaultCustodyError();
    }
  }

  #pathFor(vaultId: string): string {
    if (!vaultId.trim() || vaultId.length > 160) {
      throw new PrivateVaultCustodyError();
    }
    const digest = createHash("sha256").update(vaultId).digest("hex");
    return path.join(this.#directory, `${digest}.key`);
  }
}
