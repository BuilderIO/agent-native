import { randomBytes } from "node:crypto";
import {
  chmod,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { afterEach, describe, expect, it } from "vitest";

import {
  ancV1DeriveRecoveryRoot,
  ancV1RecoveryEntropyFromBip39Bytes,
  ancV1VaultId,
  sealAncV1ExportArchive,
} from "../e2ee/index.js";
import {
  decodePrivateVaultRecoveryPhrase,
  parsePrivateVaultRecoverArguments,
  PrivateVaultRecoverError,
  recoverPrivateVaultExport,
  writePrivateVaultRecoveryFile,
} from "./private-vault-recover.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "anc-private-vault-recover-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function counterBytes(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => index);
}

describe("Private Vault offline recovery", () => {
  it("keeps the recovery binary outside telemetry and network-capable code", async () => {
    const source = await readFile(
      join(dirname(fileURLToPath(import.meta.url)), "private-vault-recover.ts"),
      "utf8",
    );
    const entry = await readFile(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "private-vault-recover-entry.ts",
      ),
      "utf8",
    );
    expect(source).not.toMatch(
      /@sentry|tracking\/|\bfetch\s*\(|node:(?:http|https|net|dns)/,
    );
    expect(entry).not.toMatch(
      /@sentry|tracking\/|\bfetch\s*\(|node:(?:http|https|net|dns)/,
    );
    expect(source).not.toContain("./index.js");
  });

  it("decodes a checksum-valid phrase from bytes without a phrase string API", () => {
    const entropy = counterBytes(32);
    const phrase = new TextEncoder().encode(
      `  ${entropyToMnemonic(entropy, wordlist)}   `,
    );
    const decoded = decodePrivateVaultRecoveryPhrase(phrase);
    expect(decoded).toEqual(entropy);
    decoded.fill(0);
    phrase.fill(0);
    entropy.fill(0);
  });

  it("rejects a phrase with a valid word count but invalid checksum", () => {
    const entropy = counterBytes(32);
    const words = entropyToMnemonic(entropy, wordlist).split(" ");
    words[23] = words[23] === "zoo" ? "zone" : "zoo";
    const phrase = new TextEncoder().encode(words.join(" "));
    expect(() => decodePrivateVaultRecoveryPhrase(phrase)).toThrow(
      PrivateVaultRecoverError,
    );
    phrase.fill(0);
    entropy.fill(0);
  });

  it("recovers an independently sealed archive into a new mode-0600 file", async () => {
    const directory = await temporaryDirectory();
    const archivePath = join(directory, "vault.anc-v1");
    const outputPath = join(directory, "vault-recovered.json");
    const entropy = counterBytes(32);
    const phraseBytes = new TextEncoder().encode(
      entropyToMnemonic(entropy, wordlist),
    );
    const vaultId = ancV1VaultId(counterBytes(16));
    const recoveryEntropy = ancV1RecoveryEntropyFromBip39Bytes(entropy);
    const recoveryRoot = await ancV1DeriveRecoveryRoot({
      recoveryEntropy,
      vaultId,
    });
    const plaintext = new TextEncoder().encode(
      '{"format":"anc-private-vault-export/v1","objects":[]}',
    );
    const archive = await sealAncV1ExportArchive({
      vaultId,
      exportId: randomBytes(16),
      createdAt: 1_800_000_000_000,
      sourceSnapshotHash: randomBytes(32),
      objectCount: 1,
      plaintext,
      recoveryRoot,
      nonce: randomBytes(24),
    });
    await writeFile(archivePath, archive);
    await chmod(archivePath, 0o600);

    const phraseForReader = phraseBytes.slice();
    const result = await recoverPrivateVaultExport({
      archivePath,
      outputPath,
      readRecoveryPhrase: async () => phraseForReader,
    });

    expect(result).toEqual({
      outputPath: join(await realpath(directory), "vault-recovered.json"),
      objectCount: 1,
    });
    expect(await readFile(outputPath, "utf8")).toBe(
      '{"format":"anc-private-vault-export/v1","objects":[]}',
    );
    expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
    expect(Array.from(phraseForReader).every((byte) => byte === 0)).toBe(true);

    phraseBytes.fill(0);
    entropy.fill(0);
    recoveryEntropy.fill(0);
    recoveryRoot.fill(0);
    vaultId.fill(0);
    archive.fill(0);
  });

  it("never replaces an existing file or follows an output symlink", async () => {
    const directory = await temporaryDirectory();
    const existing = join(directory, "existing.json");
    const target = join(directory, "target.json");
    const linkPath = join(directory, "link.json");
    await writeFile(existing, "keep");
    await writeFile(target, "target");
    await symlink(target, linkPath);
    const plaintext = new TextEncoder().encode("secret");

    await expect(
      writePrivateVaultRecoveryFile(existing, plaintext),
    ).rejects.toThrow("refusing to replace");
    await expect(
      writePrivateVaultRecoveryFile(linkPath, plaintext),
    ).rejects.toThrow("refusing to replace");
    expect(await readFile(existing, "utf8")).toBe("keep");
    expect(await readFile(target, "utf8")).toBe("target");
    plaintext.fill(0);
  });

  it("exposes no command-line or environment phrase input", () => {
    expect(
      parsePrivateVaultRecoverArguments([
        "--archive",
        "vault.anc-v1",
        "--output",
        "vault.json",
      ]),
    ).toEqual({ archivePath: "vault.anc-v1", outputPath: "vault.json" });
    expect(() =>
      parsePrivateVaultRecoverArguments([
        "--archive",
        "vault.anc-v1",
        "--output",
        "vault.json",
        "--recovery-phrase",
        "never",
      ]),
    ).toThrow("Unknown or incomplete option");
  });
});
