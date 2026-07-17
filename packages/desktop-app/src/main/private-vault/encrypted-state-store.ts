import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  SodiumNativeAncV1CryptoProvider,
  type AncV1CryptoProvider,
  type BrokerStateStore,
} from "@agent-native/private-vault-broker";

const FRAME_MAGIC = Buffer.from("ANVS", "ascii");
const FRAME_VERSION = 1;
const FRAME_HEADER_BYTES = 4 + 1 + 8 + 4 + 24;
const AEAD_TAG_BYTES = 16;
export const ENCRYPTED_BROKER_STATE_MAX_PLAINTEXT_BYTES = 1024 * 1024;
const ENCRYPTED_BROKER_STATE_MAX_FRAME_BYTES =
  FRAME_HEADER_BYTES +
  ENCRYPTED_BROKER_STATE_MAX_PLAINTEXT_BYTES +
  AEAD_TAG_BYTES;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const ORPHAN_TEMP_FILE =
  /^\.[0-9a-f]{64}\.state\.[0-9]+\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/;
const STAGING_FILE =
  /^([0-9a-f]{64})\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.staging$/;
const MAX_ORPHAN_FILES = 1024;

export type BrokerStateFenceStatus = "present" | "deleted";

export interface BrokerStateStableFenceValue {
  readonly kind: "stable";
  readonly generation: number;
  readonly status: BrokerStateFenceStatus;
  readonly frameDigest: string | null;
}

export interface BrokerStatePendingFenceValue {
  readonly kind: "pending";
  readonly operation: "write" | "delete";
  readonly generation: number;
  readonly previous: BrokerStateStableFenceValue | null;
  readonly target: BrokerStateStableFenceValue;
  readonly stagingFile?: string;
}

export type BrokerStateFenceValue =
  | BrokerStateStableFenceValue
  | BrokerStatePendingFenceValue;

/**
 * A rollback-resistant store outside the encrypted state directory. Its
 * compare-and-swap must be atomic and durable before it resolves true.
 */
export interface BrokerStateGenerationFence {
  read(recordId: string): Promise<BrokerStateFenceValue | null>;
  compareAndSwap(
    recordId: string,
    expected: BrokerStateFenceValue | null,
    next: BrokerStateFenceValue | null,
  ): Promise<boolean>;
}

export type EncryptedBrokerStateFaultPoint =
  | "after-staging"
  | "after-pending"
  | "after-install"
  | "before-finalize";

export interface EncryptedBrokerStateFaultInjector {
  hit(
    point: EncryptedBrokerStateFaultPoint,
    recordId: string,
  ): Promise<void> | void;
}

/** Supplies a borrowed 32-byte vault state key for one operation only. */
export interface BrokerStateEncryptionKeyScope {
  withStateEncryptionKey<T>(
    vaultId: string,
    operation: (key: Uint8Array) => Promise<T> | T,
  ): Promise<T>;
}

export interface EncryptedBrokerStateStoreOptions {
  readonly directory: string;
  readonly keys: BrokerStateEncryptionKeyScope;
  readonly generationFence: BrokerStateGenerationFence;
  readonly crypto?: AncV1CryptoProvider;
  readonly platform?: NodeJS.Platform;
  readonly faults?: EncryptedBrokerStateFaultInjector;
}

export class EncryptedBrokerStateStoreError extends Error {
  constructor() {
    super("Private Vault state storage failed");
    this.name = "EncryptedBrokerStateStoreError";
  }
}

interface DirectoryIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly uid: number;
}

interface DecodedFrame {
  readonly generation: number;
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
}

interface StateRecord {
  readonly id: string;
  readonly namespace: string;
  readonly key: string;
  readonly filePath: string;
}

const encoder = new TextEncoder();

function fail(): never {
  throw new EncryptedBrokerStateStoreError();
}

function isMissing(error: unknown): boolean {
  return Boolean(
    error instanceof Error && "code" in error && error.code === "ENOENT",
  );
}

function isAlreadyExists(error: unknown): boolean {
  return Boolean(
    error instanceof Error && "code" in error && error.code === "EEXIST",
  );
}

function validateIdentifier(value: string): void {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 160 ||
    !IDENTIFIER.test(value)
  ) {
    fail();
  }
}

function validateStableFence(value: BrokerStateStableFenceValue | null): void {
  if (value === null) return;
  if (
    value.kind !== "stable" ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 1 ||
    (value.status !== "present" && value.status !== "deleted") ||
    (value.status === "present"
      ? typeof value.frameDigest !== "string" ||
        !/^[0-9a-f]{64}$/.test(value.frameDigest)
      : value.frameDigest !== null)
  ) {
    fail();
  }
}

function validateFence(value: BrokerStateFenceValue | null): void {
  if (value === null || value.kind === "stable") {
    validateStableFence(value);
    return;
  }
  validateStableFence(value.previous);
  validateStableFence(value.target);
  if (
    value.kind !== "pending" ||
    (value.operation !== "write" && value.operation !== "delete") ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 1 ||
    value.target.generation !== value.generation ||
    value.generation !== (value.previous?.generation ?? 0) + 1 ||
    (value.operation === "write" && value.target.status !== "present") ||
    (value.operation === "delete" && value.target.status !== "deleted") ||
    (value.operation === "write"
      ? typeof value.stagingFile !== "string" ||
        !/^[0-9a-f]{64}\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.staging$/.test(
          value.stagingFile,
        )
      : value.stagingFile !== undefined)
  ) {
    fail();
  }
}

function digestFrame(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertSecureStat(
  stat: fs.Stats,
  kind: "directory" | "file",
  platform: NodeJS.Platform,
): void {
  const expectedType =
    kind === "directory" ? stat.isDirectory() : stat.isFile();
  const expectedMode = kind === "directory" ? 0o700 : 0o600;
  if (
    stat.isSymbolicLink() ||
    !expectedType ||
    (kind === "file" && stat.nlink !== 1) ||
    (platform !== "win32" && (stat.mode & 0o777) !== expectedMode) ||
    (platform !== "win32" &&
      typeof process.getuid === "function" &&
      stat.uid !== process.getuid())
  ) {
    fail();
  }
}

function directoryIdentity(stat: fs.Stats): DirectoryIdentity {
  return {
    dev: BigInt(stat.dev),
    ino: BigInt(stat.ino),
    uid: stat.uid,
  };
}

function sameDirectory(
  expected: DirectoryIdentity,
  actual: DirectoryIdentity,
): boolean {
  return (
    expected.dev === actual.dev &&
    expected.ino === actual.ino &&
    expected.uid === actual.uid
  );
}

function fsyncDirectory(directory: string, platform: NodeJS.Platform): void {
  let fd: number | null = null;
  try {
    fd = fs.openSync(directory, fs.constants.O_RDONLY);
    fs.fsyncSync(fd);
  } catch {
    if (platform !== "win32") fail();
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

function decodeFrame(value: Uint8Array): DecodedFrame {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength < FRAME_HEADER_BYTES + AEAD_TAG_BYTES ||
    value.byteLength > ENCRYPTED_BROKER_STATE_MAX_FRAME_BYTES
  ) {
    fail();
  }
  const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (!timingSafeEqual(bytes.subarray(0, 4), FRAME_MAGIC)) fail();
  if (bytes[4] !== FRAME_VERSION) fail();
  const generationBig = bytes.readBigUInt64BE(5);
  if (generationBig < 1n || generationBig > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail();
  }
  const ciphertextLength = bytes.readUInt32BE(13);
  if (
    ciphertextLength < AEAD_TAG_BYTES ||
    ciphertextLength >
      ENCRYPTED_BROKER_STATE_MAX_PLAINTEXT_BYTES + AEAD_TAG_BYTES ||
    FRAME_HEADER_BYTES + ciphertextLength !== bytes.byteLength
  ) {
    fail();
  }
  return {
    generation: Number(generationBig),
    nonce: bytes.slice(17, 41),
    ciphertext: bytes.slice(FRAME_HEADER_BYTES),
  };
}

function encodeFrame(
  generation: number,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
): Buffer {
  if (
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    nonce.byteLength !== 24 ||
    ciphertext.byteLength < AEAD_TAG_BYTES ||
    ciphertext.byteLength >
      ENCRYPTED_BROKER_STATE_MAX_PLAINTEXT_BYTES + AEAD_TAG_BYTES
  ) {
    fail();
  }
  const frame = Buffer.alloc(FRAME_HEADER_BYTES + ciphertext.byteLength);
  FRAME_MAGIC.copy(frame, 0);
  frame[4] = FRAME_VERSION;
  frame.writeBigUInt64BE(BigInt(generation), 5);
  frame.writeUInt32BE(ciphertext.byteLength, 13);
  frame.set(nonce, 17);
  frame.set(ciphertext, FRAME_HEADER_BYTES);
  return frame;
}

export class EncryptedBrokerStateStore implements BrokerStateStore {
  readonly #directory: string;
  readonly #keys: BrokerStateEncryptionKeyScope;
  readonly #generationFence: BrokerStateGenerationFence;
  readonly #crypto: AncV1CryptoProvider;
  readonly #platform: NodeJS.Platform;
  readonly #faults: EncryptedBrokerStateFaultInjector | null;
  #directoryIdentity: DirectoryIdentity | null = null;
  #initialized = false;
  #closing = false;
  #closed = false;
  #queue: Promise<void> = Promise.resolve();

  constructor(options: EncryptedBrokerStateStoreOptions) {
    this.#directory = path.resolve(options.directory);
    this.#keys = options.keys;
    this.#generationFence = options.generationFence;
    this.#crypto = options.crypto ?? new SodiumNativeAncV1CryptoProvider();
    this.#platform = options.platform ?? process.platform;
    this.#faults = options.faults ?? null;
  }

  async initialize(): Promise<void> {
    if (this.#initialized || this.#closing || this.#closed) fail();
    return this.#serialized(async () => {
      if (this.#initialized || this.#closing || this.#closed) fail();
      try {
        const parent = fs.lstatSync(path.dirname(this.#directory));
        assertSecureStat(parent, "directory", this.#platform);
        try {
          fs.mkdirSync(this.#directory, { mode: 0o700 });
        } catch (error) {
          if (!isAlreadyExists(error)) throw error;
        }
        const stat = fs.lstatSync(this.#directory);
        assertSecureStat(stat, "directory", this.#platform);
        this.#directoryIdentity = directoryIdentity(stat);
        await this.#removeOrphanFiles();
        this.#initialized = true;
      } catch {
        this.#directoryIdentity = null;
        this.#initialized = false;
        fail();
      }
    });
  }

  async read(namespace: string, key: string): Promise<Uint8Array | null> {
    return this.#serialized(async () => {
      this.#assertReady();
      const record = this.#record(namespace, key);
      try {
        const stable = await this.#recover(
          record,
          await this.#readFence(record.id),
        );
        if (stable === null || stable.status === "deleted") return null;
        const frame = this.#readFile(record.filePath);
        try {
          if (frame === null) fail();
          await this.#assertFrameMatchesStable(record, frame, stable);
          const decoded = decodeFrame(frame);
          return await this.#decrypt(record, decoded);
        } finally {
          frame?.fill(0);
        }
      } catch {
        fail();
      }
    });
  }

  write(namespace: string, key: string, value: Uint8Array): Promise<void> {
    validateIdentifier(namespace);
    validateIdentifier(key);
    if (
      !(value instanceof Uint8Array) ||
      value.byteLength > ENCRYPTED_BROKER_STATE_MAX_PLAINTEXT_BYTES
    ) {
      return Promise.reject(new EncryptedBrokerStateStoreError());
    }
    const ownedValue = Uint8Array.from(value);
    const operation = this.#serialized(async () => {
      this.#assertReady();
      const record = this.#record(namespace, key);
      let nonce: Uint8Array | null = null;
      let ciphertext: Uint8Array | null = null;
      let frame: Buffer | null = null;
      let persisted: Buffer | null = null;
      let verified: Uint8Array | null = null;
      let stagingCreated = false;
      let pendingDurable = false;
      let simulatedCrashAfterStaging = false;
      let cleanupUncommittedStaging = false;
      let stagingPath: string | null = null;
      try {
        const current = await this.#recover(
          record,
          await this.#readFence(record.id),
        );
        const generation = (current?.generation ?? 0) + 1;
        if (!Number.isSafeInteger(generation)) fail();
        nonce = this.#crypto.randomBytes(24);
        ciphertext = await this.#keys.withStateEncryptionKey(
          namespace,
          async (encryptionKey) => {
            this.#assertEncryptionKey(encryptionKey);
            const aad = this.#aad(namespace, key, generation);
            try {
              return this.#crypto.aeadEncrypt(
                "manifest",
                ownedValue,
                aad,
                nonce!,
                encryptionKey,
              );
            } finally {
              this.#crypto.zeroize(aad);
            }
          },
        );
        frame = encodeFrame(generation, nonce, ciphertext);
        const target: BrokerStateStableFenceValue = {
          kind: "stable",
          generation,
          status: "present",
          frameDigest: digestFrame(frame),
        };
        const pending: BrokerStatePendingFenceValue = {
          kind: "pending",
          operation: "write",
          generation,
          previous: current,
          target,
          stagingFile: `${record.id}.${randomUUID()}.staging`,
        };
        stagingPath = this.#stagingPath(record, pending);
        this.#writeFileExclusiveDurable(stagingPath, frame);
        stagingCreated = true;
        simulatedCrashAfterStaging = true;
        await this.#fault("after-staging", record.id);
        simulatedCrashAfterStaging = false;
        if (!(await this.#enterWritePending(record.id, current, pending))) {
          cleanupUncommittedStaging = true;
          fail();
        }
        pendingDurable = true;
        await this.#fault("after-pending", record.id);
        await this.#installPendingWrite(record, pending);
        await this.#fault("after-install", record.id);
        persisted = this.#readFile(record.filePath);
        if (
          persisted === null ||
          persisted.byteLength !== frame.byteLength ||
          !timingSafeEqual(persisted, frame)
        ) {
          fail();
        }
        const decoded = decodeFrame(persisted);
        verified = await this.#decrypt(record, decoded);
        if (
          verified.byteLength !== ownedValue.byteLength ||
          !timingSafeEqual(verified, ownedValue)
        ) {
          fail();
        }
        await this.#fault("before-finalize", record.id);
        await this.#finalizePending(record.id, pending);
        this.#removeStagingFile(record, pending);
      } catch {
        fail();
      } finally {
        if (
          stagingCreated &&
          !pendingDurable &&
          !simulatedCrashAfterStaging &&
          cleanupUncommittedStaging
        ) {
          try {
            if (stagingPath) this.#removeFileDurable(stagingPath);
          } catch {
            // The content-free storage error below remains authoritative.
          }
        }
        if (nonce) this.#crypto.zeroize(nonce);
        if (ciphertext) this.#crypto.zeroize(ciphertext);
        frame?.fill(0);
        persisted?.fill(0);
        if (verified) this.#crypto.zeroize(verified);
      }
    });
    return operation.finally(() => {
      try {
        this.#crypto.zeroize(ownedValue);
      } catch {
        ownedValue.fill(0);
        fail();
      }
    });
  }

  async delete(namespace: string, key: string): Promise<void> {
    return this.#serialized(async () => {
      this.#assertReady();
      const record = this.#record(namespace, key);
      try {
        const current = await this.#recover(
          record,
          await this.#readFence(record.id),
        );
        const generation = (current?.generation ?? 0) + 1;
        if (!Number.isSafeInteger(generation)) fail();
        const target: BrokerStateStableFenceValue = {
          kind: "stable",
          generation,
          status: "deleted",
          frameDigest: null,
        };
        const pending: BrokerStatePendingFenceValue = {
          kind: "pending",
          operation: "delete",
          generation,
          previous: current,
          target,
        };
        if (
          !(await this.#generationFence.compareAndSwap(
            record.id,
            current,
            pending,
          ))
        ) {
          fail();
        }
        await this.#fault("after-pending", record.id);
        try {
          fs.unlinkSync(record.filePath);
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
        fsyncDirectory(this.#directory, this.#platform);
        this.#assertDirectoryIdentity();
        await this.#fault("after-install", record.id);
        const remaining = this.#readFile(record.filePath);
        try {
          if (remaining !== null) fail();
        } finally {
          remaining?.fill(0);
        }
        await this.#fault("before-finalize", record.id);
        await this.#finalizePending(record.id, pending);
      } catch {
        fail();
      }
    });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    if (this.#closing) fail();
    this.#closing = true;
    await this.#queue;
    this.#directoryIdentity = null;
    this.#initialized = false;
    this.#closed = true;
    this.#closing = false;
  }

  #serialized<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#closing || this.#closed)
      return Promise.reject(new EncryptedBrokerStateStoreError());
    const result = this.#queue.then(operation, operation);
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  #assertReady(): void {
    if (!this.#initialized || this.#closing || this.#closed) fail();
    this.#assertDirectoryIdentity();
  }

  #assertDirectoryIdentity(): void {
    try {
      if (!this.#directoryIdentity) fail();
      const stat = fs.lstatSync(this.#directory);
      assertSecureStat(stat, "directory", this.#platform);
      if (!sameDirectory(this.#directoryIdentity, directoryIdentity(stat))) {
        fail();
      }
    } catch {
      return fail();
    }
  }

  async #removeOrphanFiles(): Promise<void> {
    this.#assertDirectoryIdentity();
    const candidates: string[] = [];
    let directory: fs.Dir | null = null;
    try {
      directory = fs.opendirSync(this.#directory);
      for (;;) {
        const entry = directory.readSync();
        if (entry === null) break;
        if (
          !ORPHAN_TEMP_FILE.test(entry.name) &&
          !STAGING_FILE.test(entry.name)
        )
          continue;
        candidates.push(entry.name);
        if (candidates.length > MAX_ORPHAN_FILES) fail();
      }
    } catch {
      return fail();
    } finally {
      try {
        directory?.closeSync();
      } catch {
        fail();
      }
    }

    let removed = false;
    for (const name of candidates) {
      const staging = STAGING_FILE.exec(name);
      if (staging) {
        // Desktop initialization runs behind the single-instance gate. Reads
        // never sweep staging, so an already-running observer cannot delete a
        // writer's durable pre-CAS target.
        const fence = await this.#readFence(staging[1]!);
        if (
          fence?.kind === "pending" &&
          fence.operation === "write" &&
          fence.stagingFile === name
        ) {
          continue;
        }
      }
      const orphanPath = path.join(this.#directory, name);
      try {
        const stat = fs.lstatSync(orphanPath);
        assertSecureStat(stat, "file", this.#platform);
        fs.unlinkSync(orphanPath);
        removed = true;
      } catch (error) {
        if (!isMissing(error)) fail();
      }
    }
    if (removed) {
      fsyncDirectory(this.#directory, this.#platform);
      this.#assertDirectoryIdentity();
    }
  }

  #record(namespace: string, key: string): StateRecord {
    validateIdentifier(namespace);
    validateIdentifier(key);
    const id = createHash("sha256")
      .update("anc/v1/private-vault-state\0")
      .update(namespace)
      .update("\0")
      .update(key)
      .digest("hex");
    return {
      id,
      namespace,
      key,
      filePath: path.join(this.#directory, `${id}.state`),
    };
  }

  #aad(namespace: string, key: string, generation: number): Uint8Array {
    return encoder.encode(
      `anc/v1/private-vault-state\0${namespace}\0${key}\0${generation}`,
    );
  }

  #assertEncryptionKey(key: Uint8Array): void {
    if (!(key instanceof Uint8Array) || key.byteLength !== 32) fail();
  }

  async #readFence(recordId: string): Promise<BrokerStateFenceValue | null> {
    const value = await this.#generationFence.read(recordId);
    validateFence(value);
    return value;
  }

  async #recover(
    record: StateRecord,
    fence: BrokerStateFenceValue | null,
  ): Promise<BrokerStateStableFenceValue | null> {
    if (fence?.kind === "pending" && fence.operation === "write") {
      await this.#installPendingWrite(record, fence);
      await this.#finalizePending(record.id, fence);
      this.#removeStagingFile(record, fence);
      return fence.target;
    }

    const frame = this.#readFile(record.filePath);
    try {
      if (fence === null) {
        if (frame !== null) fail();
        return null;
      }

      if (fence.kind === "stable") {
        if (fence.status === "deleted") {
          if (frame !== null) fail();
        } else {
          if (frame === null) fail();
          await this.#assertFrameMatchesStable(record, frame, fence);
        }
        return fence;
      }

      if (fence.operation === "delete") {
        if (frame !== null) {
          if (fence.previous?.status !== "present") fail();
          await this.#assertFrameMatchesStable(record, frame, fence.previous);
          try {
            fs.unlinkSync(record.filePath);
          } catch (error) {
            if (!isMissing(error)) throw error;
          }
          fsyncDirectory(this.#directory, this.#platform);
          this.#assertDirectoryIdentity();
        } else if (fence.previous?.status === "present") {
          // The unlink completed before the process stopped.
        }
        await this.#finalizePending(record.id, fence);
        return fence.target;
      }

      return fail();
    } finally {
      frame?.fill(0);
    }
  }

  #frameMatchesDigest(
    frame: Uint8Array,
    stable: BrokerStateStableFenceValue,
  ): boolean {
    return (
      stable.status === "present" &&
      stable.frameDigest !== null &&
      digestFrame(frame) === stable.frameDigest
    );
  }

  #stagingPath(
    record: StateRecord,
    pending: BrokerStatePendingFenceValue,
  ): string {
    const match =
      pending.operation === "write" && pending.stagingFile
        ? STAGING_FILE.exec(pending.stagingFile)
        : null;
    if (!match || match[1] !== record.id) {
      return fail();
    }
    return path.join(this.#directory, match[0]);
  }

  async #installPendingWrite(
    record: StateRecord,
    pending: BrokerStatePendingFenceValue,
  ): Promise<void> {
    const installed = this.#readFile(record.filePath);
    try {
      if (
        installed !== null &&
        this.#frameMatchesDigest(installed, pending.target)
      ) {
        await this.#assertFrameMatchesStable(record, installed, pending.target);
        return;
      }
    } finally {
      installed?.fill(0);
    }

    const staged = this.#readFile(this.#stagingPath(record, pending));
    try {
      if (staged === null) fail();
      await this.#assertFrameMatchesStable(record, staged, pending.target);
      this.#writeFileAtomic(record.filePath, staged);
    } finally {
      staged?.fill(0);
    }

    const verified = this.#readFile(record.filePath);
    try {
      if (verified === null) fail();
      await this.#assertFrameMatchesStable(record, verified, pending.target);
    } finally {
      verified?.fill(0);
    }
  }

  async #enterWritePending(
    recordId: string,
    previous: BrokerStateStableFenceValue | null,
    pending: BrokerStatePendingFenceValue,
  ): Promise<boolean> {
    try {
      return await this.#generationFence.compareAndSwap(
        recordId,
        previous,
        pending,
      );
    } catch {
      const current = await this.#readFence(recordId);
      if (this.#samePendingFence(current, pending)) return true;
      if (this.#sameOptionalStableFence(current, previous)) return false;
      fail();
    }
  }

  async #finalizePending(
    recordId: string,
    pending: BrokerStatePendingFenceValue,
  ): Promise<void> {
    let completed = false;
    try {
      completed = await this.#generationFence.compareAndSwap(
        recordId,
        pending,
        pending.target,
      );
    } catch {
      // A lost response can still mean the durable CAS committed.
    }
    if (completed) return;
    const current = await this.#readFence(recordId);
    if (!this.#sameStableFence(current, pending.target)) fail();
  }

  #sameStableFence(
    left: BrokerStateFenceValue | null,
    right: BrokerStateStableFenceValue,
  ): boolean {
    return (
      left?.kind === "stable" &&
      left.generation === right.generation &&
      left.status === right.status &&
      left.frameDigest === right.frameDigest
    );
  }

  #sameOptionalStableFence(
    left: BrokerStateFenceValue | null,
    right: BrokerStateStableFenceValue | null,
  ): boolean {
    if (left === null || right === null) return left === right;
    return this.#sameStableFence(left, right);
  }

  #samePendingFence(
    left: BrokerStateFenceValue | null,
    right: BrokerStatePendingFenceValue,
  ): boolean {
    return (
      left?.kind === "pending" &&
      left.operation === right.operation &&
      left.generation === right.generation &&
      left.stagingFile === right.stagingFile &&
      this.#sameOptionalStableFence(left.previous, right.previous) &&
      this.#sameStableFence(left.target, right.target)
    );
  }

  #removeStagingFile(
    record: StateRecord,
    pending: BrokerStatePendingFenceValue,
  ): void {
    this.#removeFileDurable(this.#stagingPath(record, pending));
  }

  #removeFileDurable(filePath: string): void {
    this.#assertDirectoryIdentity();
    try {
      const stat = fs.lstatSync(filePath);
      assertSecureStat(stat, "file", this.#platform);
      fs.unlinkSync(filePath);
      fsyncDirectory(this.#directory, this.#platform);
      this.#assertDirectoryIdentity();
    } catch (error) {
      if (!isMissing(error)) fail();
    }
  }

  async #assertFrameMatchesStable(
    record: StateRecord,
    frame: Uint8Array,
    stable: BrokerStateStableFenceValue,
  ): Promise<void> {
    if (!this.#frameMatchesDigest(frame, stable)) fail();
    const decoded = decodeFrame(frame);
    if (decoded.generation !== stable.generation) fail();
    const plaintext = await this.#decrypt(record, decoded);
    try {
      if (plaintext.byteLength > ENCRYPTED_BROKER_STATE_MAX_PLAINTEXT_BYTES) {
        fail();
      }
    } finally {
      this.#crypto.zeroize(plaintext);
    }
  }

  async #fault(
    point: EncryptedBrokerStateFaultPoint,
    recordId: string,
  ): Promise<void> {
    await this.#faults?.hit(point, recordId);
  }

  async #decrypt(
    record: { namespace: string; key: string },
    frame: DecodedFrame,
  ): Promise<Uint8Array> {
    return this.#keys.withStateEncryptionKey(
      record.namespace,
      async (encryptionKey) => {
        this.#assertEncryptionKey(encryptionKey);
        const aad = this.#aad(record.namespace, record.key, frame.generation);
        try {
          return this.#crypto.aeadDecrypt(
            "manifest",
            frame.ciphertext,
            aad,
            frame.nonce,
            encryptionKey,
          );
        } finally {
          this.#crypto.zeroize(aad);
        }
      },
    );
  }

  #readFile(filePath: string): Buffer | null {
    this.#assertDirectoryIdentity();
    let descriptor: number | null = null;
    let value: Buffer | null = null;
    try {
      const before = fs.lstatSync(filePath);
      assertSecureStat(before, "file", this.#platform);
      descriptor = fs.openSync(
        filePath,
        fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
      );
      const opened = fs.fstatSync(descriptor);
      assertSecureStat(opened, "file", this.#platform);
      if (opened.dev !== before.dev || opened.ino !== before.ino) fail();
      if (
        opened.size < FRAME_HEADER_BYTES + AEAD_TAG_BYTES ||
        opened.size > ENCRYPTED_BROKER_STATE_MAX_FRAME_BYTES
      ) {
        fail();
      }
      value = Buffer.alloc(opened.size);
      let offset = 0;
      while (offset < value.byteLength) {
        const read = fs.readSync(
          descriptor,
          value,
          offset,
          value.byteLength - offset,
          null,
        );
        if (read <= 0) fail();
        offset += read;
      }
      return value;
    } catch (error) {
      value?.fill(0);
      if (isMissing(error)) return null;
      return fail();
    } finally {
      if (descriptor !== null) fs.closeSync(descriptor);
    }
  }

  #writeFileExclusiveDurable(filePath: string, frame: Uint8Array): void {
    this.#assertDirectoryIdentity();
    let descriptor: number | null = null;
    let created = false;
    try {
      descriptor = fs.openSync(
        filePath,
        fs.constants.O_CREAT |
          fs.constants.O_EXCL |
          fs.constants.O_WRONLY |
          (fs.constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      created = true;
      const opened = fs.fstatSync(descriptor);
      assertSecureStat(opened, "file", this.#platform);
      const buffer = Buffer.from(
        frame.buffer,
        frame.byteOffset,
        frame.byteLength,
      );
      let offset = 0;
      while (offset < buffer.byteLength) {
        const written = fs.writeSync(
          descriptor,
          buffer,
          offset,
          buffer.byteLength - offset,
        );
        if (written <= 0) fail();
        offset += written;
      }
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = null;
      fsyncDirectory(this.#directory, this.#platform);
      this.#assertDirectoryIdentity();
    } catch {
      if (descriptor !== null) {
        try {
          fs.closeSync(descriptor);
        } catch {
          // The content-free storage error below remains authoritative.
        }
      }
      if (created) {
        try {
          fs.unlinkSync(filePath);
          fsyncDirectory(this.#directory, this.#platform);
        } catch {
          // The content-free storage error below remains authoritative.
        }
      }
      fail();
    }
  }

  #writeFileAtomic(filePath: string, frame: Uint8Array): void {
    this.#assertDirectoryIdentity();
    const existing = this.#readFile(filePath);
    existing?.fill(0);
    const tempPath = path.join(
      this.#directory,
      `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
    );
    let descriptor: number | null = null;
    try {
      descriptor = fs.openSync(
        tempPath,
        fs.constants.O_CREAT |
          fs.constants.O_EXCL |
          fs.constants.O_WRONLY |
          (fs.constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      const opened = fs.fstatSync(descriptor);
      assertSecureStat(opened, "file", this.#platform);
      const buffer = Buffer.from(
        frame.buffer,
        frame.byteOffset,
        frame.byteLength,
      );
      let offset = 0;
      while (offset < buffer.byteLength) {
        const written = fs.writeSync(
          descriptor,
          buffer,
          offset,
          buffer.byteLength - offset,
        );
        if (written <= 0) fail();
        offset += written;
      }
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = null;
      this.#assertDirectoryIdentity();
      fs.renameSync(tempPath, filePath);
      fs.chmodSync(filePath, 0o600);
      const installed = fs.lstatSync(filePath);
      assertSecureStat(installed, "file", this.#platform);
      fsyncDirectory(this.#directory, this.#platform);
      this.#assertDirectoryIdentity();
    } catch {
      if (descriptor !== null) {
        try {
          fs.closeSync(descriptor);
        } catch {
          // The content-free storage error below remains authoritative.
        }
      }
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // The content-free storage error below remains authoritative.
      }
      fail();
    }
  }
}
