#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import {
  link,
  lstat,
  open,
  readFile,
  realpath,
  stat,
  unlink,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { stdin, stdout } from "node:process";

import { wordlist } from "@scure/bip39/wordlists/english.js";

import {
  ANC_V1_EXPORT_ARCHIVE_MAX_ENCODED_BYTES,
  type AncV1RecoveryEntropy,
  type AncV1VaultId,
  ancV1DeriveRecoveryRoot,
  ancV1RecoveryEntropyFromBip39Bytes,
  ancV1VaultId,
  inspectAncV1ExportArchive,
  openAncV1ExportArchive,
} from "../e2ee/index.js";

const RECOVERY_WORD_COUNT = 24;
const RECOVERY_ENTROPY_BYTES = 32;
const MAX_RECOVERY_PHRASE_BYTES = 512;

type WordTrie = {
  readonly next: Map<number, WordTrie>;
  index?: number;
};

export class PrivateVaultRecoverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivateVaultRecoverError";
  }
}

function buildEnglishWordTrie(): WordTrie {
  const root: WordTrie = { next: new Map() };
  if (wordlist.length !== 2048) {
    throw new Error("The bundled BIP39 English word list is invalid");
  }
  for (let index = 0; index < wordlist.length; index += 1) {
    let node = root;
    for (const character of wordlist[index]!) {
      const byte = character.charCodeAt(0);
      let child = node.next.get(byte);
      if (!child) {
        child = { next: new Map() };
        node.next.set(byte, child);
      }
      node = child;
    }
    node.index = index;
  }
  return root;
}

const ENGLISH_WORD_TRIE = buildEnglishWordTrie();

const invalidPhrase = (): never => {
  throw new PrivateVaultRecoverError(
    "Recovery phrase verification failed. Check all 24 words and try again.",
  );
};

/**
 * Decode a 24-word English BIP39 phrase without ever constructing the complete
 * phrase as a JavaScript string. The input bytes remain caller-owned.
 */
export function decodePrivateVaultRecoveryPhrase(
  phraseBytes: Uint8Array,
): Uint8Array {
  if (
    !(phraseBytes instanceof Uint8Array) ||
    phraseBytes.byteLength === 0 ||
    phraseBytes.byteLength > MAX_RECOVERY_PHRASE_BYTES
  ) {
    return invalidPhrase();
  }

  const indices = new Array<number>(RECOVERY_WORD_COUNT).fill(0);
  const entropy = new Uint8Array(RECOVERY_ENTROPY_BYTES);
  let checksum = 0;
  try {
    let offset = 0;
    while (offset < phraseBytes.byteLength && phraseBytes[offset] === 0x20) {
      offset += 1;
    }

    let wordCount = 0;
    while (offset < phraseBytes.byteLength) {
      if (wordCount >= RECOVERY_WORD_COUNT) return invalidPhrase();
      let node = ENGLISH_WORD_TRIE;
      let wordBytes = 0;
      while (offset < phraseBytes.byteLength && phraseBytes[offset] !== 0x20) {
        const byte = phraseBytes[offset]!;
        if (byte < 0x61 || byte > 0x7a) return invalidPhrase();
        const child = node.next.get(byte);
        if (!child) return invalidPhrase();
        node = child;
        offset += 1;
        wordBytes += 1;
      }
      if (wordBytes === 0 || node.index === undefined) return invalidPhrase();
      indices[wordCount++] = node.index;
      while (offset < phraseBytes.byteLength && phraseBytes[offset] === 0x20) {
        offset += 1;
      }
    }
    if (wordCount !== RECOVERY_WORD_COUNT) return invalidPhrase();

    let bitOffset = 0;
    for (const index of indices) {
      for (let bit = 10; bit >= 0; bit -= 1) {
        const value = (index >>> bit) & 1;
        if (bitOffset < 256) {
          entropy[bitOffset >>> 3] |= value << (7 - (bitOffset & 7));
        } else {
          checksum = (checksum << 1) | value;
        }
        bitOffset += 1;
      }
    }

    const digest = createHash("sha256").update(entropy).digest();
    const checksumMatches = checksum === digest[0];
    digest.fill(0);
    if (!checksumMatches) return invalidPhrase();
    return entropy;
  } catch (error) {
    entropy.fill(0);
    if (error instanceof PrivateVaultRecoverError) throw error;
    return invalidPhrase();
  } finally {
    indices.fill(0);
  }
}

export async function readPrivateVaultRecoveryPhraseFromTerminal(): Promise<Buffer> {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function") {
    throw new PrivateVaultRecoverError(
      "Recovery requires an interactive terminal; phrases cannot be piped, passed as arguments, or read from environment variables.",
    );
  }

  stdout.write("Enter the 24-word Private Vault recovery phrase: ");
  const collected = Buffer.alloc(MAX_RECOVERY_PHRASE_BYTES);
  const wasRaw = stdin.isRaw ?? false;
  const wasPaused = stdin.isPaused();
  let length = 0;

  return await new Promise<Buffer>((resolvePromise, rejectPromise) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      stdin.off("data", onData);
      stdin.setRawMode(wasRaw);
      if (wasPaused) stdin.pause();
      stdout.write("\n");
      if (error) {
        collected.fill(0);
        rejectPromise(error);
        return;
      }
      const phrase = Buffer.from(collected.subarray(0, length));
      collected.fill(0);
      resolvePromise(phrase);
    };

    const onData = (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      try {
        for (const byte of bytes) {
          if (byte === 0x0d || byte === 0x0a) {
            finish();
            return;
          }
          if (byte === 0x03 || byte === 0x04) {
            finish(new PrivateVaultRecoverError("Recovery cancelled."));
            return;
          }
          if (byte === 0x7f || byte === 0x08) {
            if (length > 0) collected[--length] = 0;
            continue;
          }
          if (byte < 0x20 || byte > 0x7e || length >= collected.byteLength) {
            finish(
              new PrivateVaultRecoverError(
                "Recovery phrase input was invalid or too long.",
              ),
            );
            return;
          }
          collected[length++] = byte;
        }
      } finally {
        bytes.fill(0);
      }
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function syncDirectory(path: string): Promise<void> {
  let handle;
  try {
    handle = await open(path, "r");
    await handle.sync();
  } catch {
    // Some platforms do not permit opening directories. The file itself was
    // already fsynced before the atomic link.
  } finally {
    await handle?.close();
  }
}

/** Atomically publish a new mode-0600 file without following or replacing it. */
export async function writePrivateVaultRecoveryFile(
  requestedPath: string,
  plaintext: Uint8Array,
): Promise<string> {
  if (!requestedPath || !(plaintext instanceof Uint8Array)) {
    throw new PrivateVaultRecoverError("A recovery output path is required.");
  }
  const absolute = isAbsolute(requestedPath)
    ? requestedPath
    : resolve(requestedPath);
  const outputName = basename(absolute);
  if (!outputName || outputName === "." || outputName === "..") {
    throw new PrivateVaultRecoverError("The recovery output path is invalid.");
  }
  const realDirectory = await realpath(dirname(absolute));
  const outputPath = join(realDirectory, outputName);
  try {
    await lstat(outputPath);
    throw new PrivateVaultRecoverError(
      "The recovery output already exists; refusing to replace it.",
    );
  } catch (error) {
    if (
      error instanceof PrivateVaultRecoverError ||
      (error as NodeJS.ErrnoException).code !== "ENOENT"
    ) {
      throw error;
    }
  }

  const temporaryPath = join(
    realDirectory,
    `.${outputName}.private-vault-${randomBytes(16).toString("hex")}.tmp`,
  );
  let handle;
  let published = false;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(plaintext);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(temporaryPath, outputPath);
    published = true;
    await unlink(temporaryPath);
    await syncDirectory(realDirectory);
    return outputPath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new PrivateVaultRecoverError(
        "The recovery output already exists; refusing to replace it.",
      );
    }
    throw error;
  } finally {
    await handle?.close();
    try {
      await unlink(temporaryPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !published) {
        throw error;
      }
    }
  }
}

export interface RecoverPrivateVaultExportInput {
  readonly archivePath: string;
  readonly outputPath: string;
  readonly readRecoveryPhrase?: () => Promise<Uint8Array>;
}

export async function recoverPrivateVaultExport(
  input: RecoverPrivateVaultExportInput,
): Promise<{ outputPath: string; objectCount: number }> {
  const archivePath = await realpath(input.archivePath);
  const archiveStat = await stat(archivePath);
  if (
    !archiveStat.isFile() ||
    archiveStat.size <= 0 ||
    archiveStat.size > ANC_V1_EXPORT_ARCHIVE_MAX_ENCODED_BYTES
  ) {
    throw new PrivateVaultRecoverError(
      "The Private Vault export archive is invalid or too large.",
    );
  }

  const requestedOutput = isAbsolute(input.outputPath)
    ? input.outputPath
    : resolve(input.outputPath);
  const outputDirectory = await realpath(dirname(requestedOutput));
  if (join(outputDirectory, basename(requestedOutput)) === archivePath) {
    throw new PrivateVaultRecoverError(
      "The recovery output must not replace the encrypted archive.",
    );
  }

  const encoded = await readFile(archivePath);
  let phraseBytes: Uint8Array | undefined;
  let rawEntropy: Uint8Array | undefined;
  let recoveryEntropy: AncV1RecoveryEntropy | undefined;
  let vaultId: AncV1VaultId | undefined;
  let recoveryRoot: Uint8Array | undefined;
  let plaintext: Uint8Array | undefined;
  try {
    const metadata = inspectAncV1ExportArchive(encoded);
    phraseBytes = await (
      input.readRecoveryPhrase ?? readPrivateVaultRecoveryPhraseFromTerminal
    )();
    rawEntropy = decodePrivateVaultRecoveryPhrase(phraseBytes);
    recoveryEntropy = ancV1RecoveryEntropyFromBip39Bytes(rawEntropy);
    vaultId = ancV1VaultId(metadata.vaultId);
    recoveryRoot = await ancV1DeriveRecoveryRoot({
      recoveryEntropy,
      vaultId,
    });
    const opened = await openAncV1ExportArchive({
      encoded,
      expectedVaultId: metadata.vaultId,
      recoveryRoot,
    });
    plaintext = opened.plaintext;
    const outputPath = await writePrivateVaultRecoveryFile(
      input.outputPath,
      plaintext,
    );
    return { outputPath, objectCount: opened.objectCount };
  } finally {
    phraseBytes?.fill(0);
    rawEntropy?.fill(0);
    recoveryEntropy?.fill(0);
    vaultId?.fill(0);
    recoveryRoot?.fill(0);
    plaintext?.fill(0);
    encoded.fill(0);
  }
}

type ParsedArguments = { archivePath: string; outputPath: string } | "help";

export function parsePrivateVaultRecoverArguments(
  args: string[],
): ParsedArguments {
  let archivePath: string | undefined;
  let outputPath: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--help" || argument === "-h") return "help";
    if (argument === "--archive" && args[index + 1]) {
      archivePath = args[++index];
      continue;
    }
    if (argument === "--output" && args[index + 1]) {
      outputPath = args[++index];
      continue;
    }
    throw new PrivateVaultRecoverError(
      `Unknown or incomplete option: ${argument}`,
    );
  }
  if (!archivePath || !outputPath) {
    throw new PrivateVaultRecoverError(
      "Both --archive <encrypted-file> and --output <new-local-file> are required.",
    );
  }
  return { archivePath, outputPath };
}

const HELP = `Usage: agent-native-private-vault-recover --archive <encrypted-file> --output <new-local-file>

Decrypt a Private Vault export entirely on this computer.

The 24-word phrase is accepted only through a hidden interactive terminal
prompt. It cannot be supplied through command arguments, stdin pipes, or
environment variables. The output is created atomically with mode 0600 and an
existing path is never replaced. No network connection is used.`;

export async function runPrivateVaultRecoverCli(
  args = process.argv.slice(2),
): Promise<number> {
  try {
    const parsed = parsePrivateVaultRecoverArguments(args);
    if (parsed === "help") {
      stdout.write(`${HELP}\n`);
      return 0;
    }
    const result = await recoverPrivateVaultExport(parsed);
    stdout.write(
      `Recovered ${result.objectCount} object${result.objectCount === 1 ? "" : "s"} to ${result.outputPath}\n`,
    );
    return 0;
  } catch (error) {
    const message =
      error instanceof PrivateVaultRecoverError
        ? error.message
        : "Private Vault recovery failed. The archive was not written.";
    process.stderr.write(`${message}\n`);
    return 1;
  }
}
