import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";

import { app, safeStorage } from "electron";

import {
  decodePrivateVaultContentDocument,
  decodePrivateVaultContentManifest,
  encodePrivateVaultContentDocument,
  encodePrivateVaultContentManifest,
  type PrivateVaultContentDocument,
  type PrivateVaultContentManifest,
} from "./content-document-codec.js";

const OPAQUE_ID = /^[0-9a-f]{32}$/;
const MAXIMUM_PLAINTEXT_BYTES = 1024 * 1024;
const MAXIMUM_CIPHERTEXT_BYTES = 2 * 1024 * 1024;

export class EncryptedContentIndexStoreError extends Error {
  constructor() {
    super("Encrypted Content index unavailable");
    this.name = "EncryptedContentIndexStoreError";
  }
}

export interface ContentIndexCipher {
  available(): boolean;
  seal(value: Uint8Array): Uint8Array;
  open(value: Uint8Array): Uint8Array;
}

function opaqueId(value: string): string {
  if (!OPAQUE_ID.test(value)) throw new EncryptedContentIndexStoreError();
  return value;
}

export class EncryptedContentIndexStore {
  readonly #root: string;
  readonly #cipher: ContentIndexCipher;
  #initialized = false;
  #closed = false;

  constructor(input: { directory: string; cipher: ContentIndexCipher }) {
    if (!path.isAbsolute(input.directory))
      throw new EncryptedContentIndexStoreError();
    this.#root = path.resolve(input.directory);
    this.#cipher = input.cipher;
  }

  async initialize(): Promise<void> {
    if (this.#initialized || this.#closed || !this.#cipher.available())
      throw new EncryptedContentIndexStoreError();
    await this.#ensureDirectory(this.#root);
    this.#initialized = true;
  }

  async readManifest(
    vaultId: string,
  ): Promise<PrivateVaultContentManifest | null> {
    const bytes = await this.#read(vaultId, "manifest.enc");
    if (!bytes) return null;
    try {
      const manifest = decodePrivateVaultContentManifest(bytes);
      if (manifest.vaultId !== vaultId)
        throw new EncryptedContentIndexStoreError();
      return manifest;
    } finally {
      bytes.fill(0);
    }
  }

  async writeManifest(manifest: PrivateVaultContentManifest): Promise<void> {
    const bytes = encodePrivateVaultContentManifest(manifest);
    try {
      await this.#write(manifest.vaultId, "manifest.enc", bytes);
    } finally {
      bytes.fill(0);
    }
  }

  async readDocument(
    vaultId: string,
    objectId: string,
  ): Promise<PrivateVaultContentDocument | null> {
    const bytes = await this.#read(vaultId, `${opaqueId(objectId)}.enc`);
    if (!bytes) return null;
    try {
      const document = decodePrivateVaultContentDocument(bytes);
      if (document.id !== objectId) throw new EncryptedContentIndexStoreError();
      return document;
    } finally {
      bytes.fill(0);
    }
  }

  async writeDocument(
    vaultId: string,
    document: PrivateVaultContentDocument,
  ): Promise<void> {
    const bytes = encodePrivateVaultContentDocument(document);
    try {
      await this.#write(vaultId, `${opaqueId(document.id)}.enc`, bytes);
    } finally {
      bytes.fill(0);
    }
  }

  async listDocumentIds(vaultId: string): Promise<readonly string[]> {
    this.#assertReady();
    const directory = await this.#vaultDirectory(vaultId, false);
    if (!directory) return Object.freeze([]);
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      const ids: string[] = [];
      for (const entry of entries) {
        if (entry.name === "manifest.enc") continue;
        if (!entry.isFile() || entry.isSymbolicLink())
          throw new EncryptedContentIndexStoreError();
        const match = /^([0-9a-f]{32})\.enc$/.exec(entry.name);
        if (!match) throw new EncryptedContentIndexStoreError();
        ids.push(match[1]);
      }
      return Object.freeze(ids.sort());
    } catch (error) {
      if (error instanceof EncryptedContentIndexStoreError) throw error;
      throw new EncryptedContentIndexStoreError();
    }
  }

  async deleteDocument(vaultId: string, objectId: string): Promise<void> {
    this.#assertReady();
    const directory = await this.#vaultDirectory(vaultId, false);
    if (!directory) return;
    await rm(path.join(directory, `${opaqueId(objectId)}.enc`), {
      force: true,
    }).catch(() => {
      throw new EncryptedContentIndexStoreError();
    });
  }

  close(): void {
    this.#closed = true;
    this.#initialized = false;
  }

  async #read(vaultId: string, fileName: string): Promise<Uint8Array | null> {
    this.#assertReady();
    const directory = await this.#vaultDirectory(vaultId, false);
    if (!directory) return null;
    const target = path.join(directory, fileName);
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
        ciphertext.byteLength < 1 ||
        ciphertext.byteLength > MAXIMUM_CIPHERTEXT_BYTES
      )
        throw new Error();
      const plaintext = this.#cipher.open(ciphertext);
      if (
        plaintext.byteLength < 1 ||
        plaintext.byteLength > MAXIMUM_PLAINTEXT_BYTES
      )
        throw new Error();
      return Uint8Array.from(plaintext);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
      throw new EncryptedContentIndexStoreError();
    }
  }

  async #write(
    vaultId: string,
    fileName: string,
    plaintext: Uint8Array,
  ): Promise<void> {
    this.#assertReady();
    if (
      !(plaintext instanceof Uint8Array) ||
      plaintext.byteLength < 1 ||
      plaintext.byteLength > MAXIMUM_PLAINTEXT_BYTES
    )
      throw new EncryptedContentIndexStoreError();
    const directory = await this.#vaultDirectory(vaultId, true);
    if (!directory) throw new EncryptedContentIndexStoreError();
    const target = path.join(directory, fileName);
    const temporary = `${target}.tmp-${randomUUID()}`;
    let ciphertext: Uint8Array | null = null;
    try {
      ciphertext = this.#cipher.seal(Uint8Array.from(plaintext));
      if (
        ciphertext.byteLength < 1 ||
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
      const directoryHandle = await open(directory, "r");
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw new EncryptedContentIndexStoreError();
    } finally {
      ciphertext?.fill(0);
    }
  }

  async #vaultDirectory(
    vaultIdInput: string,
    create: boolean,
  ): Promise<string | null> {
    const vaultId = opaqueId(vaultIdInput);
    const directory = path.join(this.#root, vaultId);
    if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      await this.#ensureDirectory(directory);
      return directory;
    } catch (error) {
      if (!create && (error as NodeJS.ErrnoException)?.code === "ENOENT")
        return null;
      throw new EncryptedContentIndexStoreError();
    }
  }

  async #ensureDirectory(directory: string): Promise<void> {
    const [resolved, resolvedParent, metadata] = await Promise.all([
      realpath(directory),
      realpath(path.dirname(directory)),
      lstat(directory),
    ]);
    if (
      resolved !== path.join(resolvedParent, path.basename(directory)) ||
      !metadata.isDirectory() ||
      metadata.isSymbolicLink()
    )
      throw new EncryptedContentIndexStoreError();
  }

  #assertReady(): void {
    if (!this.#initialized || this.#closed)
      throw new EncryptedContentIndexStoreError();
  }
}

export function createEncryptedContentIndexStore(): EncryptedContentIndexStore {
  return new EncryptedContentIndexStore({
    directory: path.join(
      app.getPath("userData"),
      "private-vault",
      "content-index",
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
          throw new EncryptedContentIndexStoreError();
        return Uint8Array.from(bytes);
      },
    },
  });
}
