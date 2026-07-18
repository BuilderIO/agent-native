import { randomUUID } from "node:crypto";
import {
  open,
  mkdir,
  lstat,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";

import type { BrokerStateStore } from "@agent-native/private-vault-broker";
import { app, safeStorage } from "electron";

const TOKEN = /^[a-z][a-z0-9-]{0,63}$/;
const MAXIMUM_PLAINTEXT_BYTES = 64 * 1024;
const MAXIMUM_CIPHERTEXT_BYTES = 128 * 1024;

export class EncryptedBrokerStateStoreError extends Error {
  constructor() {
    super("Encrypted broker state unavailable");
    this.name = "EncryptedBrokerStateStoreError";
  }
}

export interface BrokerStateCipher {
  available(): boolean;
  seal(value: Uint8Array): Uint8Array;
  open(value: Uint8Array): Uint8Array;
}

function fileName(namespace: string, key: string): string {
  if (!TOKEN.test(namespace) || !TOKEN.test(key))
    throw new EncryptedBrokerStateStoreError();
  return `${namespace}--${key}.enc`;
}

export class EncryptedBrokerStateStore implements BrokerStateStore {
  readonly #directory: string;
  readonly #cipher: BrokerStateCipher;
  #initialized = false;
  #closed = false;

  constructor(input: { directory: string; cipher: BrokerStateCipher }) {
    if (!path.isAbsolute(input.directory))
      throw new EncryptedBrokerStateStoreError();
    this.#directory = path.resolve(input.directory);
    this.#cipher = input.cipher;
  }

  async initialize(): Promise<void> {
    if (this.#initialized || this.#closed || !this.#cipher.available())
      throw new EncryptedBrokerStateStoreError();
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    const [resolved, resolvedParent, metadata] = await Promise.all([
      realpath(this.#directory),
      realpath(path.dirname(this.#directory)),
      lstat(this.#directory),
    ]);
    if (
      resolved !== path.join(resolvedParent, path.basename(this.#directory)) ||
      !metadata.isDirectory() ||
      metadata.isSymbolicLink()
    )
      throw new EncryptedBrokerStateStoreError();
    this.#initialized = true;
  }

  async read(namespace: string, key: string): Promise<Uint8Array | null> {
    this.#assertReady();
    const target = path.join(this.#directory, fileName(namespace, key));
    try {
      const metadata = await lstat(target);
      if (
        !metadata.isFile() ||
        metadata.isSymbolicLink() ||
        metadata.nlink !== 1
      )
        throw new Error();
      const ciphertext = await readFile(target);
      if (
        ciphertext.byteLength === 0 ||
        ciphertext.byteLength > MAXIMUM_CIPHERTEXT_BYTES
      )
        throw new Error();
      const plaintext = this.#cipher.open(ciphertext);
      if (plaintext.byteLength > MAXIMUM_PLAINTEXT_BYTES) throw new Error();
      return Uint8Array.from(plaintext);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
      throw new EncryptedBrokerStateStoreError();
    }
  }

  async write(
    namespace: string,
    key: string,
    value: Uint8Array,
  ): Promise<void> {
    this.#assertReady();
    if (
      !(value instanceof Uint8Array) ||
      value.byteLength > MAXIMUM_PLAINTEXT_BYTES
    )
      throw new EncryptedBrokerStateStoreError();
    const target = path.join(this.#directory, fileName(namespace, key));
    const temporary = `${target}.tmp-${randomUUID()}`;
    let ciphertext: Uint8Array | null = null;
    try {
      ciphertext = this.#cipher.seal(Uint8Array.from(value));
      if (
        ciphertext.byteLength === 0 ||
        ciphertext.byteLength > MAXIMUM_CIPHERTEXT_BYTES
      )
        throw new Error();
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(ciphertext);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, target);
      const directory = await open(this.#directory, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } catch {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw new EncryptedBrokerStateStoreError();
    } finally {
      ciphertext?.fill(0);
    }
  }

  async delete(namespace: string, key: string): Promise<void> {
    this.#assertReady();
    await rm(path.join(this.#directory, fileName(namespace, key)), {
      force: true,
    }).catch(() => {
      throw new EncryptedBrokerStateStoreError();
    });
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#initialized = false;
  }

  #assertReady(): void {
    if (!this.#initialized || this.#closed)
      throw new EncryptedBrokerStateStoreError();
  }
}

export function createEncryptedBrokerStateStore(): EncryptedBrokerStateStore {
  return new EncryptedBrokerStateStore({
    directory: path.join(
      app.getPath("userData"),
      "private-vault",
      "broker-state",
    ),
    cipher: {
      available: () => safeStorage.isEncryptionAvailable(),
      seal: (value) =>
        Uint8Array.from(
          safeStorage.encryptString(Buffer.from(value).toString("base64")),
        ),
      open: (value) => {
        const encoded = safeStorage.decryptString(Buffer.from(value));
        const bytes = Buffer.from(encoded, "base64");
        if (bytes.toString("base64") !== encoded)
          throw new EncryptedBrokerStateStoreError();
        return Uint8Array.from(bytes);
      },
    },
  });
}
