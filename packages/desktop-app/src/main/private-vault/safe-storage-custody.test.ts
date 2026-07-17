import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  type DesktopSafeStorage,
  PrivateVaultCustodyError,
  SafeStorageVaultKeyCustody,
} from "./safe-storage-custody.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function root() {
  const value = fs.mkdtempSync(path.join(tmpdir(), "private-vault-custody-"));
  roots.push(value);
  return value;
}

function fakeSafeStorage(
  overrides: Partial<DesktopSafeStorage> = {},
): DesktopSafeStorage {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext) => {
      const result = Buffer.from(plaintext, "utf8");
      for (let index = 0; index < result.length; index += 1) {
        result[index] ^= 0xa5;
      }
      return result;
    },
    decryptString: (ciphertext) => {
      const result = Buffer.from(ciphertext);
      for (let index = 0; index < result.length; index += 1) {
        result[index] ^= 0xa5;
      }
      return result.toString("utf8");
    },
    getSelectedStorageBackend: () => "gnome_libsecret",
    ...overrides,
  };
}

describe("SafeStorageVaultKeyCustody", () => {
  it("stores only an opaque OS-wrapped key under a hashed filename", async () => {
    const directory = path.join(root(), "custody");
    const custody = new SafeStorageVaultKeyCustody({
      directory,
      safeStorage: fakeSafeStorage(),
      platform: "linux",
    });
    const key = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const snapshot = Uint8Array.from(key);
    await custody.initialize();
    await custody.storeVaultKey("vault:highly-sensitive-name", key);

    expect(key).toEqual(snapshot);
    const files = fs.readdirSync(directory);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f]{64}\.key$/);
    expect(files[0]).not.toContain("sensitive");
    const stored = fs.readFileSync(path.join(directory, files[0]!));
    expect(stored.includes(Buffer.from(key))).toBe(false);
    expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(directory, files[0]!)).mode & 0o777).toBe(
      0o600,
    );

    const loaded = await custody.loadVaultKey("vault:highly-sensitive-name");
    expect(loaded).toEqual(key);
    loaded!.fill(0);
    expect(key).toEqual(snapshot);
  });

  it("fails closed when safeStorage is unavailable or Linux selects basic_text", async () => {
    for (const safeStorage of [
      fakeSafeStorage({ isEncryptionAvailable: () => false }),
      fakeSafeStorage({ getSelectedStorageBackend: () => "basic_text" }),
      fakeSafeStorage({ getSelectedStorageBackend: () => "unknown" }),
      fakeSafeStorage({ getSelectedStorageBackend: undefined as never }),
    ]) {
      const custody = new SafeStorageVaultKeyCustody({
        directory: path.join(root(), "custody"),
        safeStorage,
        platform: "linux",
      });
      await expect(custody.initialize()).rejects.toEqual(
        new PrivateVaultCustodyError(),
      );
    }
  });

  it("wipes the OS-wrapped buffer after a verified durable write", async () => {
    let wrappedReference: Buffer | null = null;
    const safeStorage = fakeSafeStorage({
      encryptString: (plaintext) => {
        wrappedReference = Buffer.from(plaintext, "utf8");
        return wrappedReference;
      },
      decryptString: (ciphertext) => ciphertext.toString("utf8"),
    });
    const directory = path.join(root(), "custody");
    const custody = new SafeStorageVaultKeyCustody({
      directory,
      safeStorage,
    });
    await custody.initialize();
    await custody.storeVaultKey("vault:wipe-test", new Uint8Array(32).fill(5));

    expect(wrappedReference).not.toBeNull();
    expect(wrappedReference!.every((byte) => byte === 0)).toBe(true);
    expect(
      fs.readFileSync(path.join(directory, fs.readdirSync(directory)[0]!)),
    ).not.toEqual(wrappedReference);
  });

  it("rejects symlink paths, malformed ciphertext, and invalid key lengths", async () => {
    const base = root();
    const target = path.join(base, "target");
    const linked = path.join(base, "linked");
    fs.mkdirSync(target);
    fs.symlinkSync(target, linked);
    await expect(
      new SafeStorageVaultKeyCustody({
        directory: linked,
        safeStorage: fakeSafeStorage(),
      }).initialize(),
    ).rejects.toBeInstanceOf(PrivateVaultCustodyError);

    const directory = path.join(base, "custody");
    const custody = new SafeStorageVaultKeyCustody({
      directory,
      safeStorage: fakeSafeStorage(),
    });
    await custody.initialize();
    await expect(
      custody.storeVaultKey("vault:test", new Uint8Array(31)),
    ).rejects.toBeInstanceOf(PrivateVaultCustodyError);
    await custody.storeVaultKey("vault:test", new Uint8Array(32).fill(7));
    const [file] = fs.readdirSync(directory);
    fs.writeFileSync(path.join(directory, file!), "corrupt");
    await expect(custody.loadVaultKey("vault:test")).rejects.toBeInstanceOf(
      PrivateVaultCustodyError,
    );
  });

  it("rechecks backend safety and rejects exposed or hard-linked key files", async () => {
    let available = true;
    let backend = "gnome_libsecret";
    const directory = path.join(root(), "custody");
    const custody = new SafeStorageVaultKeyCustody({
      directory,
      safeStorage: fakeSafeStorage({
        isEncryptionAvailable: () => available,
        getSelectedStorageBackend: () => backend,
      }),
      platform: "linux",
    });
    await custody.initialize();
    await custody.storeVaultKey(
      "vault:permissions",
      new Uint8Array(32).fill(8),
    );
    const filePath = path.join(directory, fs.readdirSync(directory)[0]!);

    available = false;
    await expect(
      custody.loadVaultKey("vault:permissions"),
    ).rejects.toBeInstanceOf(PrivateVaultCustodyError);
    available = true;
    backend = "unknown";
    await expect(
      custody.loadVaultKey("vault:permissions"),
    ).rejects.toBeInstanceOf(PrivateVaultCustodyError);
    backend = "gnome_libsecret";
    fs.chmodSync(filePath, 0o644);
    await expect(
      custody.loadVaultKey("vault:permissions"),
    ).rejects.toBeInstanceOf(PrivateVaultCustodyError);
    fs.chmodSync(filePath, 0o600);
    fs.linkSync(filePath, path.join(directory, "second-link.key"));
    await expect(
      custody.loadVaultKey("vault:permissions"),
    ).rejects.toBeInstanceOf(PrivateVaultCustodyError);
  });

  it("revalidates the custody directory after initialization", async () => {
    const base = root();
    const directory = path.join(base, "custody");
    const moved = path.join(base, "custody-moved");
    const custody = new SafeStorageVaultKeyCustody({
      directory,
      safeStorage: fakeSafeStorage(),
      platform: "linux",
    });
    await custody.initialize();
    await custody.storeVaultKey(
      "vault:directory-swap",
      new Uint8Array(32).fill(9),
    );

    fs.renameSync(directory, moved);
    fs.symlinkSync(moved, directory);
    await expect(
      custody.loadVaultKey("vault:directory-swap"),
    ).rejects.toBeInstanceOf(PrivateVaultCustodyError);

    fs.unlinkSync(directory);
    fs.renameSync(moved, directory);
    fs.chmodSync(directory, 0o755);
    await expect(
      custody.loadVaultKey("vault:directory-swap"),
    ).rejects.toBeInstanceOf(PrivateVaultCustodyError);
  });

  it("deletes idempotently and refuses every operation after close", async () => {
    const custody = new SafeStorageVaultKeyCustody({
      directory: path.join(root(), "custody"),
      safeStorage: fakeSafeStorage(),
    });
    await custody.initialize();
    await custody.storeVaultKey("vault:test", new Uint8Array(32).fill(3));
    await custody.deleteVaultKey("vault:test");
    await custody.deleteVaultKey("vault:test");
    await expect(custody.loadVaultKey("vault:test")).resolves.toBeNull();
    await custody.close();
    await expect(custody.loadVaultKey("vault:test")).rejects.toBeInstanceOf(
      PrivateVaultCustodyError,
    );
  });
});
