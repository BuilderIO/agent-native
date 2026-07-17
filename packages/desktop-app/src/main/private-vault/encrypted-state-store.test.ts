import { createHash } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  SodiumNativeAncV1CryptoProvider,
  type AncV1CryptoProvider,
} from "@agent-native/private-vault-broker";
import { afterEach, describe, expect, it } from "vitest";

import {
  ENCRYPTED_BROKER_STATE_MAX_PLAINTEXT_BYTES,
  EncryptedBrokerStateStore,
  EncryptedBrokerStateStoreError,
  type BrokerStateEncryptionKeyScope,
  type BrokerStateFenceValue,
  type BrokerStateGenerationFence,
  type EncryptedBrokerStateFaultInjector,
  type EncryptedBrokerStateFaultPoint,
} from "./encrypted-state-store.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function temporaryRoot(): string {
  const value = fs.mkdtempSync(path.join(tmpdir(), "private-vault-state-"));
  roots.push(value);
  return value;
}

function recordId(namespace: string, key: string): string {
  return createHash("sha256")
    .update("anc/v1/private-vault-state\0")
    .update(namespace)
    .update("\0")
    .update(key)
    .digest("hex");
}

class MemoryGenerationFence implements BrokerStateGenerationFence {
  readonly values = new Map<string, BrokerStateFenceValue>();
  failNextCompare = false;
  commitThenThrowNextCompare = false;
  throwBeforeCommitNextCompare = false;
  throwReadAfterCompareThrow = false;
  throwNextRead = false;
  failWhen:
    | ((
        expected: BrokerStateFenceValue | null,
        next: BrokerStateFenceValue | null,
      ) => boolean)
    | null = null;

  #clone<T extends BrokerStateFenceValue | null>(value: T): T {
    return value === null ? value : structuredClone(value);
  }

  async read(record: string): Promise<BrokerStateFenceValue | null> {
    if (this.throwNextRead) {
      this.throwNextRead = false;
      throw new Error("trusted fence unavailable");
    }
    return this.#clone(this.values.get(record) ?? null);
  }

  async compareAndSwap(
    record: string,
    expected: BrokerStateFenceValue | null,
    next: BrokerStateFenceValue | null,
  ): Promise<boolean> {
    if (this.throwBeforeCommitNextCompare) {
      this.throwBeforeCommitNextCompare = false;
      if (this.throwReadAfterCompareThrow) {
        this.throwReadAfterCompareThrow = false;
        this.throwNextRead = true;
      }
      throw new Error("trusted fence unavailable before commit");
    }
    if (
      this.failNextCompare ||
      (this.failWhen !== null && this.failWhen(expected, next))
    ) {
      this.failNextCompare = false;
      this.failWhen = null;
      return false;
    }
    const current = this.values.get(record) ?? null;
    const matches = JSON.stringify(current) === JSON.stringify(expected);
    if (!matches) return false;
    if (next === null) this.values.delete(record);
    else this.values.set(record, this.#clone(next));
    if (this.commitThenThrowNextCompare) {
      this.commitThenThrowNextCompare = false;
      throw new Error("trusted fence response lost after commit");
    }
    return true;
  }
}

class TrackingCrypto extends SodiumNativeAncV1CryptoProvider {
  readonly zeroized: Uint8Array[] = [];
  readonly encryptedPlaintexts: Uint8Array[] = [];

  override aeadEncrypt(
    ...args: Parameters<SodiumNativeAncV1CryptoProvider["aeadEncrypt"]>
  ): Uint8Array {
    this.encryptedPlaintexts.push(args[1]);
    return super.aeadEncrypt(...args);
  }

  override zeroize(value: Uint8Array): void {
    this.zeroized.push(value);
    super.zeroize(value);
  }
}

class OneShotFaults implements EncryptedBrokerStateFaultInjector {
  constructor(readonly point: EncryptedBrokerStateFaultPoint) {}

  hit(point: EncryptedBrokerStateFaultPoint): void {
    if (point === this.point) throw new Error("simulated process stop");
  }
}

class BlockingFaults implements EncryptedBrokerStateFaultInjector {
  readonly entered: Promise<void>;
  #markEntered!: () => void;
  #released: Promise<void>;
  #release!: () => void;

  constructor(readonly point: EncryptedBrokerStateFaultPoint) {
    this.entered = new Promise<void>((resolve) => {
      this.#markEntered = resolve;
    });
    this.#released = new Promise<void>((resolve) => {
      this.#release = resolve;
    });
  }

  async hit(point: EncryptedBrokerStateFaultPoint): Promise<void> {
    if (point !== this.point) return;
    this.#markEntered();
    await this.#released;
  }

  release(): void {
    this.#release();
  }
}

function keyScope(
  key: Uint8Array,
  borrowedReferences: Uint8Array[] = [],
): BrokerStateEncryptionKeyScope {
  return {
    async withStateEncryptionKey(_vaultId, operation) {
      const borrowed = Uint8Array.from(key);
      borrowedReferences.push(borrowed);
      try {
        return await operation(borrowed);
      } finally {
        borrowed.fill(0);
      }
    },
  };
}

function fixture(
  options: {
    directory?: string;
    key?: Uint8Array;
    fence?: MemoryGenerationFence;
    borrowedReferences?: Uint8Array[];
    crypto?: AncV1CryptoProvider;
    keys?: BrokerStateEncryptionKeyScope;
    faults?: EncryptedBrokerStateFaultInjector;
  } = {},
) {
  const directory = options.directory ?? path.join(temporaryRoot(), "state");
  const encryptionKey = options.key ?? new Uint8Array(32).fill(0x41);
  const fence = options.fence ?? new MemoryGenerationFence();
  const store = new EncryptedBrokerStateStore({
    directory,
    keys: options.keys ?? keyScope(encryptionKey, options.borrowedReferences),
    generationFence: fence,
    crypto: options.crypto,
    platform: "linux",
    faults: options.faults,
  });
  return { directory, encryptionKey, fence, store };
}

const vault = "vault-state-0001";
const stateKey = "broker-session";

describe("EncryptedBrokerStateStore", () => {
  it("durably stores only opaque ciphertext with strict permissions", async () => {
    const borrowedReferences: Uint8Array[] = [];
    const crypto = new TrackingCrypto();
    const { directory, store } = fixture({ borrowedReferences, crypto });
    const plaintext = new TextEncoder().encode(
      "highly sensitive broker state that must not appear on disk",
    );
    const snapshot = Uint8Array.from(plaintext);

    await store.initialize();
    await store.write(vault, stateKey, plaintext);

    expect(plaintext).toEqual(snapshot);
    expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
    const files = fs.readdirSync(directory);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f]{64}\.state$/);
    expect(files[0]).not.toContain(vault);
    const filePath = path.join(directory, files[0]!);
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(filePath).includes(Buffer.from(plaintext))).toBe(
      false,
    );
    expect(files.some((file) => file.endsWith(".tmp"))).toBe(false);
    const loaded = await store.read(vault, stateKey);
    expect(loaded).toEqual(plaintext);
    loaded!.fill(0);
    expect(plaintext).toEqual(snapshot);
    expect(
      borrowedReferences.every((value) => value.every((byte) => byte === 0)),
    ).toBe(true);
    expect(crypto.zeroized.length).toBeGreaterThan(0);
    expect(
      crypto.zeroized.every((value) => value.every((byte) => byte === 0)),
    ).toBe(true);
  });

  it("removes secure orphan ciphertext temp files during restart", async () => {
    const directory = path.join(temporaryRoot(), "state");
    fs.mkdirSync(directory, { mode: 0o700 });
    const orphan = path.join(
      directory,
      `.${recordId(vault, stateKey)}.state.123.12345678-1234-1234-1234-123456789abc.tmp`,
    );
    fs.writeFileSync(orphan, Buffer.alloc(64, 0x7a), { mode: 0o600 });

    const { store } = fixture({ directory });
    await store.initialize();
    expect(fs.existsSync(orphan)).toBe(false);
    await expect(store.read(vault, stateKey)).resolves.toBeNull();
  });

  it("fails closed instead of following an orphan temp symlink", async () => {
    const base = temporaryRoot();
    const directory = path.join(base, "state");
    fs.mkdirSync(directory, { mode: 0o700 });
    const target = path.join(base, "outside");
    fs.writeFileSync(target, "outside", { mode: 0o600 });
    const orphan = path.join(
      directory,
      `.${recordId(vault, stateKey)}.state.123.12345678-1234-1234-1234-123456789abc.tmp`,
    );
    fs.symlinkSync(target, orphan);

    await expect(
      fixture({ directory }).store.initialize(),
    ).rejects.toBeInstanceOf(EncryptedBrokerStateStoreError);
    expect(fs.readFileSync(target, "utf8")).toBe("outside");
  });

  it("advances a trusted generation fence and rejects rollback", async () => {
    const { directory, fence, store } = fixture();
    await store.initialize();
    await store.write(vault, stateKey, Uint8Array.of(1));
    const filePath = path.join(directory, fs.readdirSync(directory)[0]!);
    const firstGeneration = fs.readFileSync(filePath);

    await store.write(vault, stateKey, Uint8Array.of(2));
    expect(fence.values.get(recordId(vault, stateKey))).toEqual({
      kind: "stable",
      generation: 2,
      status: "present",
      frameDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(await store.read(vault, stateKey)).toEqual(Uint8Array.of(2));

    fs.writeFileSync(filePath, firstGeneration, { mode: 0o600 });
    await expect(store.read(vault, stateKey)).rejects.toEqual(
      new EncryptedBrokerStateStoreError(),
    );
  });

  it("rejects a pending fence that skips a generation", async () => {
    const { fence, store } = fixture();
    await store.initialize();
    await store.write(vault, stateKey, Uint8Array.of(1));
    const id = recordId(vault, stateKey);
    const previous = fence.values.get(id);
    if (previous?.kind !== "stable") throw new Error("expected stable fence");
    fence.values.set(id, {
      kind: "pending",
      operation: "write",
      generation: 3,
      previous,
      stagingFile: `${id}.12345678-1234-1234-1234-123456789abc.staging`,
      target: {
        kind: "stable",
        generation: 3,
        status: "present",
        frameDigest: "0".repeat(64),
      },
    });

    await expect(store.read(vault, stateKey)).rejects.toBeInstanceOf(
      EncryptedBrokerStateStoreError,
    );
  });

  it("fences deletion before unlink and rejects a restored deleted file", async () => {
    const { directory, fence, store } = fixture();
    await store.initialize();
    await store.write(vault, stateKey, Uint8Array.of(3));
    const filePath = path.join(directory, fs.readdirSync(directory)[0]!);
    const deletedFrame = fs.readFileSync(filePath);

    await store.delete(vault, stateKey);
    expect(fence.values.get(recordId(vault, stateKey))).toEqual({
      kind: "stable",
      generation: 2,
      status: "deleted",
      frameDigest: null,
    });
    await expect(store.read(vault, stateKey)).resolves.toBeNull();

    fs.writeFileSync(filePath, deletedFrame, { mode: 0o600 });
    await expect(store.read(vault, stateKey)).rejects.toBeInstanceOf(
      EncryptedBrokerStateStoreError,
    );
  });

  it("fails closed when the trusted generation compare-and-swap loses", async () => {
    const { directory, fence, store } = fixture();
    await store.initialize();
    fence.failNextCompare = true;
    await expect(
      store.write(vault, stateKey, Uint8Array.of(1, 2, 3)),
    ).rejects.toEqual(new EncryptedBrokerStateStoreError());
    expect(fs.readdirSync(directory)).toEqual([]);
    expect(fence.values.size).toBe(0);
  });

  it("recovers when the pending CAS commits but its response is lost", async () => {
    const { fence, store } = fixture();
    await store.initialize();
    fence.commitThenThrowNextCompare = true;

    await expect(
      store.write(vault, stateKey, Uint8Array.of(1, 2, 3)),
    ).resolves.toBeUndefined();
    await expect(store.read(vault, stateKey)).resolves.toEqual(
      Uint8Array.of(1, 2, 3),
    );
    expect(fence.values.get(recordId(vault, stateKey))).toMatchObject({
      kind: "stable",
      generation: 1,
      status: "present",
    });
  });

  it("preserves staging when an ambiguous CAS cannot be reread", async () => {
    const directory = path.join(temporaryRoot(), "state");
    const fence = new MemoryGenerationFence();
    const { store } = fixture({ directory, fence });
    await store.initialize();
    fence.throwBeforeCommitNextCompare = true;
    fence.throwReadAfterCompareThrow = true;

    await expect(
      store.write(vault, stateKey, Uint8Array.of(1, 2, 3)),
    ).rejects.toBeInstanceOf(EncryptedBrokerStateStoreError);
    expect(fence.values.size).toBe(0);
    expect(fs.readdirSync(directory)).toEqual([
      expect.stringMatching(/\.staging$/),
    ]);

    const restarted = fixture({ directory, fence }).store;
    await restarted.initialize();
    expect(fs.readdirSync(directory)).toEqual([]);
  });

  it("rejects wrong keys, ciphertext corruption, and frame malleation", async () => {
    const sharedRoot = temporaryRoot();
    const directory = path.join(sharedRoot, "state");
    const fence = new MemoryGenerationFence();
    const original = fixture({ directory, fence });
    await original.store.initialize();
    await original.store.write(vault, stateKey, Uint8Array.of(5, 6, 7));
    await original.store.close();
    const filePath = path.join(directory, fs.readdirSync(directory)[0]!);
    const valid = fs.readFileSync(filePath);

    const wrongKey = fixture({
      directory,
      fence,
      key: new Uint8Array(32).fill(0x42),
    }).store;
    await wrongKey.initialize();
    await expect(wrongKey.read(vault, stateKey)).rejects.toEqual(
      new EncryptedBrokerStateStoreError(),
    );
    await wrongKey.close();

    const correct = fixture({ directory, fence }).store;
    await correct.initialize();
    for (const corrupted of [
      (() => {
        const value = Buffer.from(valid);
        value[0] ^= 1;
        return value;
      })(),
      valid.subarray(0, valid.byteLength - 1),
      Buffer.concat([valid, Buffer.from([0])]),
      (() => {
        const value = Buffer.from(valid);
        value[value.length - 1] ^= 1;
        return value;
      })(),
    ]) {
      fs.writeFileSync(filePath, corrupted, { mode: 0o600 });
      await expect(correct.read(vault, stateKey)).rejects.toEqual(
        new EncryptedBrokerStateStoreError(),
      );
    }
    await expect(
      correct.write(vault, stateKey, Uint8Array.of(8)),
    ).rejects.toEqual(new EncryptedBrokerStateStoreError());
  });

  it("binds ciphertext to the vault namespace and logical key", async () => {
    const { directory, fence, store } = fixture();
    await store.initialize();
    await store.write(vault, stateKey, Uint8Array.of(7, 8, 9));
    const sourceId = recordId(vault, stateKey);
    const source = path.join(directory, `${sourceId}.state`);
    const otherVault = "vault-state-0002";
    const destinationId = recordId(otherVault, stateKey);
    fs.copyFileSync(source, path.join(directory, `${destinationId}.state`));
    fs.chmodSync(path.join(directory, `${destinationId}.state`), 0o600);
    fence.values.set(destinationId, {
      kind: "stable",
      generation: 1,
      status: "present",
      frameDigest: createHash("sha256")
        .update(fs.readFileSync(source))
        .digest("hex"),
    });

    await expect(store.read(otherVault, stateKey)).rejects.toEqual(
      new EncryptedBrokerStateStoreError(),
    );
  });

  it("rejects insecure directories, symlinks, hardlinks, and exposed modes", async () => {
    const base = temporaryRoot();
    const target = path.join(base, "target");
    const linkedDirectory = path.join(base, "linked");
    fs.mkdirSync(target, { mode: 0o700 });
    fs.symlinkSync(target, linkedDirectory);
    await expect(
      fixture({ directory: linkedDirectory }).store.initialize(),
    ).rejects.toBeInstanceOf(EncryptedBrokerStateStoreError);

    const insecureDirectory = path.join(base, "insecure");
    fs.mkdirSync(insecureDirectory, { mode: 0o755 });
    await expect(
      fixture({ directory: insecureDirectory }).store.initialize(),
    ).rejects.toBeInstanceOf(EncryptedBrokerStateStoreError);

    const { directory, store } = fixture({
      directory: path.join(base, "secure"),
    });
    await store.initialize();
    await store.write(vault, stateKey, Uint8Array.of(1));
    const filePath = path.join(directory, fs.readdirSync(directory)[0]!);
    fs.chmodSync(filePath, 0o644);
    await expect(store.read(vault, stateKey)).rejects.toBeInstanceOf(
      EncryptedBrokerStateStoreError,
    );
    fs.chmodSync(filePath, 0o600);
    fs.linkSync(filePath, path.join(directory, "second-link.state"));
    await expect(store.read(vault, stateKey)).rejects.toBeInstanceOf(
      EncryptedBrokerStateStoreError,
    );
    fs.unlinkSync(path.join(directory, "second-link.state"));
    const linkTarget = path.join(base, "link-target.state");
    fs.renameSync(filePath, linkTarget);
    fs.symlinkSync(linkTarget, filePath);
    await expect(store.read(vault, stateKey)).rejects.toBeInstanceOf(
      EncryptedBrokerStateStoreError,
    );
  });

  it("does not recreate missing directory ancestors", async () => {
    const base = temporaryRoot();
    const missingParent = path.join(base, "missing");
    const directory = path.join(missingParent, "state");

    await expect(
      fixture({ directory }).store.initialize(),
    ).rejects.toBeInstanceOf(EncryptedBrokerStateStoreError);
    expect(fs.existsSync(missingParent)).toBe(false);
  });

  it("revalidates the trusted directory identity on every operation", async () => {
    const base = temporaryRoot();
    const directory = path.join(base, "state");
    const moved = path.join(base, "moved");
    const { store } = fixture({ directory });
    await store.initialize();
    await store.write(vault, stateKey, Uint8Array.of(1));

    fs.renameSync(directory, moved);
    fs.mkdirSync(directory, { mode: 0o700 });
    await expect(store.read(vault, stateKey)).rejects.toEqual(
      new EncryptedBrokerStateStoreError(),
    );
  });

  it("enforces identifiers, plaintext bounds, and lifecycle", async () => {
    const { store } = fixture();
    await expect(store.read(vault, stateKey)).rejects.toBeInstanceOf(
      EncryptedBrokerStateStoreError,
    );
    await store.initialize();
    await expect(store.read("../escape", stateKey)).rejects.toBeInstanceOf(
      EncryptedBrokerStateStoreError,
    );
    await expect(
      store.write(
        vault,
        stateKey,
        new Uint8Array(ENCRYPTED_BROKER_STATE_MAX_PLAINTEXT_BYTES + 1),
      ),
    ).rejects.toBeInstanceOf(EncryptedBrokerStateStoreError);
    await store.close();
    await store.close();
    await expect(store.read(vault, stateKey)).rejects.toBeInstanceOf(
      EncryptedBrokerStateStoreError,
    );
  });

  it("serializes concurrent writes through monotonic generations", async () => {
    const { fence, store } = fixture();
    await store.initialize();
    await Promise.all([
      store.write(vault, stateKey, Uint8Array.of(1)),
      store.write(vault, stateKey, Uint8Array.of(2)),
      store.write(vault, stateKey, Uint8Array.of(3)),
    ]);
    expect(fence.values.get(recordId(vault, stateKey))).toEqual({
      kind: "stable",
      generation: 3,
      status: "present",
      frameDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(await store.read(vault, stateKey)).toEqual(Uint8Array.of(3));
  });

  it("copies queued plaintext synchronously and wipes its owned copy", async () => {
    const encryptionKey = new Uint8Array(32).fill(0x41);
    const crypto = new TrackingCrypto();
    let releaseFirst!: () => void;
    let markEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let keyCalls = 0;
    const keys: BrokerStateEncryptionKeyScope = {
      async withStateEncryptionKey(_vaultId, operation) {
        keyCalls += 1;
        if (keyCalls === 1) {
          markEntered();
          await released;
        }
        const borrowed = Uint8Array.from(encryptionKey);
        try {
          return await operation(borrowed);
        } finally {
          borrowed.fill(0);
        }
      },
    };
    const { store } = fixture({ keys, crypto });
    await store.initialize();
    const first = store.write(vault, stateKey, Uint8Array.of(1));
    await entered;
    const callerOwned = Uint8Array.of(2, 3, 4);
    const queued = store.write(vault, stateKey, callerOwned);
    callerOwned.fill(9);
    releaseFirst();

    await Promise.all([first, queued]);
    expect(await store.read(vault, stateKey)).toEqual(Uint8Array.of(2, 3, 4));
    expect(callerOwned).toEqual(Uint8Array.of(9, 9, 9));
    expect(crypto.encryptedPlaintexts).toHaveLength(2);
    expect(
      crypto.encryptedPlaintexts.every((plaintext) =>
        plaintext.every((byte) => byte === 0),
      ),
    ).toBe(true);
  });

  it("wipes its owned plaintext copy when a write rejects", async () => {
    const crypto = new TrackingCrypto();
    const { fence, store } = fixture({ crypto });
    await store.initialize();
    fence.failWhen = (expected) => expected?.kind === "pending";

    await expect(
      store.write(vault, stateKey, Uint8Array.of(4, 5, 6)),
    ).rejects.toBeInstanceOf(EncryptedBrokerStateStoreError);
    expect(crypto.encryptedPlaintexts).toHaveLength(1);
    expect(crypto.encryptedPlaintexts[0]).toEqual(Uint8Array.of(0, 0, 0));
  });

  it("rolls a pending first write forward from its durable staging frame", async () => {
    const directory = path.join(temporaryRoot(), "state");
    const fence = new MemoryGenerationFence();
    const stopped = fixture({
      directory,
      fence,
      faults: new OneShotFaults("after-pending"),
    }).store;
    await stopped.initialize();
    await expect(
      stopped.write(vault, stateKey, Uint8Array.of(1)),
    ).rejects.toBeInstanceOf(EncryptedBrokerStateStoreError);
    expect(fence.values.get(recordId(vault, stateKey))?.kind).toBe("pending");

    const restarted = fixture({ directory, fence }).store;
    await restarted.initialize();
    await expect(restarted.read(vault, stateKey)).resolves.toEqual(
      Uint8Array.of(1),
    );
    expect(fence.values.get(recordId(vault, stateKey))).toMatchObject({
      kind: "stable",
      generation: 1,
      status: "present",
    });
  });

  it("cleans an unreferenced durable stage after a pre-CAS process stop", async () => {
    const directory = path.join(temporaryRoot(), "state");
    const fence = new MemoryGenerationFence();
    const stopped = fixture({
      directory,
      fence,
      faults: new OneShotFaults("after-staging"),
    }).store;
    await stopped.initialize();
    await expect(
      stopped.write(vault, stateKey, Uint8Array.of(1)),
    ).rejects.toBeInstanceOf(EncryptedBrokerStateStoreError);
    expect(fence.values.size).toBe(0);
    expect(fs.readdirSync(directory)).toEqual([
      expect.stringMatching(/\.staging$/),
    ]);

    const restarted = fixture({ directory, fence }).store;
    await restarted.initialize();
    expect(fs.readdirSync(directory)).toEqual([]);
    await restarted.write(vault, stateKey, Uint8Array.of(2));
    await expect(restarted.read(vault, stateKey)).resolves.toEqual(
      Uint8Array.of(2),
    );
  });

  it("does not let a stable observer delete a live pre-CAS stage", async () => {
    const directory = path.join(temporaryRoot(), "state");
    const fence = new MemoryGenerationFence();
    const blocked = new BlockingFaults("after-staging");
    const writer = fixture({ directory, fence, faults: blocked }).store;
    const observer = fixture({ directory, fence }).store;
    await writer.initialize();
    await observer.initialize();
    const writing = writer.write(vault, stateKey, Uint8Array.of(6));
    await blocked.entered;

    await expect(observer.read(vault, stateKey)).resolves.toBeNull();
    expect(fs.readdirSync(directory)).toEqual([
      expect.stringMatching(/\.staging$/),
    ]);
    blocked.release();
    await expect(writing).resolves.toBeUndefined();
    await expect(observer.read(vault, stateKey)).resolves.toEqual(
      Uint8Array.of(6),
    );
  });

  it("rolls a pending replacement forward when the old frame remains", async () => {
    const directory = path.join(temporaryRoot(), "state");
    const fence = new MemoryGenerationFence();
    const original = fixture({ directory, fence }).store;
    await original.initialize();
    await original.write(vault, stateKey, Uint8Array.of(7));
    const stopped = fixture({
      directory,
      fence,
      faults: new OneShotFaults("after-pending"),
    }).store;
    await stopped.initialize();
    await expect(
      stopped.write(vault, stateKey, Uint8Array.of(8)),
    ).rejects.toBeInstanceOf(EncryptedBrokerStateStoreError);

    const restarted = fixture({ directory, fence }).store;
    await restarted.initialize();
    await expect(restarted.read(vault, stateKey)).resolves.toEqual(
      Uint8Array.of(8),
    );
    expect(fence.values.get(recordId(vault, stateKey))).toMatchObject({
      kind: "stable",
      generation: 2,
      status: "present",
    });
  });

  it("fails closed when a pending target stage is tampered", async () => {
    const directory = path.join(temporaryRoot(), "state");
    const fence = new MemoryGenerationFence();
    const stopped = fixture({
      directory,
      fence,
      faults: new OneShotFaults("after-pending"),
    }).store;
    await stopped.initialize();
    await expect(
      stopped.write(vault, stateKey, Uint8Array.of(8)),
    ).rejects.toBeInstanceOf(EncryptedBrokerStateStoreError);
    const stagingName = fs
      .readdirSync(directory)
      .find((name) => name.endsWith(".staging"));
    if (!stagingName) throw new Error("expected durable staging frame");
    const stagingPath = path.join(directory, stagingName);
    const tampered = fs.readFileSync(stagingPath);
    tampered[tampered.length - 1] ^= 1;
    fs.writeFileSync(stagingPath, tampered, { mode: 0o600 });

    const restarted = fixture({ directory, fence }).store;
    await restarted.initialize();
    await expect(restarted.read(vault, stateKey)).rejects.toBeInstanceOf(
      EncryptedBrokerStateStoreError,
    );
    expect(fence.values.get(recordId(vault, stateKey))?.kind).toBe("pending");
  });

  it("never blesses a restored previous frame after a write becomes pending", async () => {
    const directory = path.join(temporaryRoot(), "state");
    const fence = new MemoryGenerationFence();
    const original = fixture({ directory, fence }).store;
    await original.initialize();
    await original.write(vault, stateKey, Uint8Array.of(7));
    const filePath = path.join(directory, `${recordId(vault, stateKey)}.state`);
    const previousFrame = fs.readFileSync(filePath);
    const stopped = fixture({
      directory,
      fence,
      faults: new OneShotFaults("after-install"),
    }).store;
    await stopped.initialize();
    await expect(
      stopped.write(vault, stateKey, Uint8Array.of(8)),
    ).rejects.toBeInstanceOf(EncryptedBrokerStateStoreError);
    fs.writeFileSync(filePath, previousFrame, { mode: 0o600 });

    const restarted = fixture({ directory, fence }).store;
    await restarted.initialize();
    await expect(restarted.read(vault, stateKey)).resolves.toEqual(
      Uint8Array.of(8),
    );
    expect(fence.values.get(recordId(vault, stateKey))).toMatchObject({
      kind: "stable",
      generation: 2,
      status: "present",
    });
  });

  it("lets a second store roll a visible pending write forward", async () => {
    const directory = path.join(temporaryRoot(), "state");
    const fence = new MemoryGenerationFence();
    const blocked = new BlockingFaults("after-pending");
    const writer = fixture({ directory, fence, faults: blocked }).store;
    const observer = fixture({ directory, fence }).store;
    await writer.initialize();
    await observer.initialize();
    const writing = writer.write(vault, stateKey, Uint8Array.of(4, 2));
    await blocked.entered;

    expect(fence.values.get(recordId(vault, stateKey))).toMatchObject({
      kind: "pending",
      operation: "write",
      generation: 1,
    });
    await expect(observer.read(vault, stateKey)).resolves.toEqual(
      Uint8Array.of(4, 2),
    );
    blocked.release();
    await expect(writing).resolves.toBeUndefined();
    await expect(writer.read(vault, stateKey)).resolves.toEqual(
      Uint8Array.of(4, 2),
    );
  });

  it.each(["after-install", "before-finalize"] as const)(
    "finalizes an installed pending write after a stop at %s",
    async (point) => {
      const directory = path.join(temporaryRoot(), "state");
      const fence = new MemoryGenerationFence();
      const stopped = fixture({
        directory,
        fence,
        faults: new OneShotFaults(point),
      }).store;
      await stopped.initialize();
      await expect(
        stopped.write(vault, stateKey, Uint8Array.of(2, 4)),
      ).rejects.toBeInstanceOf(EncryptedBrokerStateStoreError);

      const restarted = fixture({ directory, fence }).store;
      await restarted.initialize();
      await expect(restarted.read(vault, stateKey)).resolves.toEqual(
        Uint8Array.of(2, 4),
      );
      expect(fence.values.get(recordId(vault, stateKey))).toMatchObject({
        kind: "stable",
        generation: 1,
        status: "present",
      });
    },
  );

  it.each(["after-pending", "after-install", "before-finalize"] as const)(
    "completes a pending delete after a stop at %s",
    async (point) => {
      const directory = path.join(temporaryRoot(), "state");
      const fence = new MemoryGenerationFence();
      const original = fixture({ directory, fence }).store;
      await original.initialize();
      await original.write(vault, stateKey, Uint8Array.of(9));
      const stopped = fixture({
        directory,
        fence,
        faults: new OneShotFaults(point),
      }).store;
      await stopped.initialize();
      await expect(stopped.delete(vault, stateKey)).rejects.toBeInstanceOf(
        EncryptedBrokerStateStoreError,
      );

      const restarted = fixture({ directory, fence }).store;
      await restarted.initialize();
      await expect(restarted.read(vault, stateKey)).resolves.toBeNull();
      expect(fence.values.get(recordId(vault, stateKey))).toEqual({
        kind: "stable",
        generation: 2,
        status: "deleted",
        frameDigest: null,
      });
    },
  );

  it("lets a second store finalize a pending delete idempotently", async () => {
    const directory = path.join(temporaryRoot(), "state");
    const fence = new MemoryGenerationFence();
    const seed = fixture({ directory, fence }).store;
    await seed.initialize();
    await seed.write(vault, stateKey, Uint8Array.of(9));
    const blocked = new BlockingFaults("after-pending");
    const deleter = fixture({ directory, fence, faults: blocked }).store;
    const observer = fixture({ directory, fence }).store;
    await deleter.initialize();
    await observer.initialize();
    const deleting = deleter.delete(vault, stateKey);
    await blocked.entered;

    await expect(observer.read(vault, stateKey)).resolves.toBeNull();
    blocked.release();
    await expect(deleting).resolves.toBeUndefined();
    await expect(deleter.read(vault, stateKey)).resolves.toBeNull();
    expect(fence.values.get(recordId(vault, stateKey))).toEqual({
      kind: "stable",
      generation: 2,
      status: "deleted",
      frameDigest: null,
    });
  });

  it("leaves an installed frame recoverable when final CAS fails", async () => {
    const directory = path.join(temporaryRoot(), "state");
    const fence = new MemoryGenerationFence();
    const stopped = fixture({ directory, fence }).store;
    await stopped.initialize();
    fence.failWhen = (expected) => expected?.kind === "pending";
    await expect(
      stopped.write(vault, stateKey, Uint8Array.of(3)),
    ).rejects.toBeInstanceOf(EncryptedBrokerStateStoreError);
    expect(fence.values.get(recordId(vault, stateKey))?.kind).toBe("pending");

    fence.failNextCompare = true;
    const restarted = fixture({ directory, fence }).store;
    await restarted.initialize();
    await expect(restarted.read(vault, stateKey)).rejects.toBeInstanceOf(
      EncryptedBrokerStateStoreError,
    );
    expect(fence.values.get(recordId(vault, stateKey))?.kind).toBe("pending");
    await expect(restarted.read(vault, stateKey)).resolves.toEqual(
      Uint8Array.of(3),
    );
  });

  it("rejects concurrent duplicate initialization without corrupting state", async () => {
    const { store } = fixture();
    const first = store.initialize();
    const second = store.initialize();
    await expect(first).resolves.toBeUndefined();
    await expect(second).rejects.toBeInstanceOf(EncryptedBrokerStateStoreError);
    await expect(store.read(vault, stateKey)).resolves.toBeNull();
  });

  it("keeps failures content-free", async () => {
    const { store } = fixture({ key: new Uint8Array(31) });
    await store.initialize();
    const error = await store
      .write(vault, stateKey, new TextEncoder().encode("secret diagnostic"))
      .catch((value) => value);
    expect(error).toEqual(new EncryptedBrokerStateStoreError());
    expect(error.message).toBe("Private Vault state storage failed");
    expect(JSON.stringify(error)).not.toContain("secret diagnostic");
  });
});
