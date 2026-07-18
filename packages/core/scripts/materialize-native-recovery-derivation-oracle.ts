import { readFileSync, writeSync } from "node:fs";

import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

import { ANC_V1_RECOVERY_DERIVATION_VECTOR } from "../src/e2ee/recovery-derivation-vectors.js";

const entropy = Uint8Array.from({ length: 32 }, (_, index) => index);
const nativeWordlistSource = readFileSync(
  new URL(
    "../../desktop-app/native/private-vault-service/recovery/third-party/bip39/english.inc",
    import.meta.url,
  ),
  "utf8",
);
const nativeWordlist = Array.from(
  nativeWordlistSource.matchAll(/^"([a-z]+)",$/gm),
  (match) => match[1],
);

try {
  if (
    ANC_V1_RECOVERY_DERIVATION_VECTOR.recoveryEntropyRecipe !==
      "byte[i] = i for i in 0..31" ||
    ANC_V1_RECOVERY_DERIVATION_VECTOR.mnemonicEncoding !==
      "bip39-english-24-word-nfkd"
  ) {
    throw new Error(
      "Recovery oracle recipe no longer matches the frozen vector",
    );
  }
  if (
    nativeWordlist.length !== wordlist.length ||
    nativeWordlist.some((word, index) => word !== wordlist[index])
  ) {
    throw new Error(
      "Vendored native BIP39 word list differs from pinned @scure",
    );
  }
  const mnemonic = Buffer.from(entropyToMnemonic(entropy, wordlist), "utf8");
  const frame = Buffer.allocUnsafe(2 + mnemonic.byteLength);
  frame.writeUInt16BE(mnemonic.byteLength, 0);
  mnemonic.copy(frame, 2);
  writeSync(process.stdout.fd, frame);
  frame.fill(0);
  mnemonic.fill(0);
} finally {
  entropy.fill(0);
}
