import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  ANC_V1_NATIVE_AUTHORITY_STORE_SOURCE_PATHS,
  buildAncV1NativeAuthorityStoreVectors,
} from "../src/e2ee/native-authority-store-vectors.js";

const protocolBaseCommit = process.argv[2];
if (!protocolBaseCommit || !/^[0-9a-f]{40}$/.test(protocolBaseCommit))
  throw new Error("Expected the 40-character protocol base commit");

const root = resolve(import.meta.dirname, "../../..");
const sources = await Promise.all(
  ANC_V1_NATIVE_AUTHORITY_STORE_SOURCE_PATHS.map(async (path) => ({
    path,
    sha256: createHash("sha256")
      .update(await readFile(resolve(root, path)))
      .digest("hex"),
  })),
);
const corpus = await buildAncV1NativeAuthorityStoreVectors({
  protocolBaseCommit,
  sources,
});
await writeFile(
  resolve(
    root,
    "packages/core/src/e2ee/fixtures/anc-v1-native-authority-store-vectors.json",
  ),
  `${JSON.stringify(corpus, null, 2)}\n`,
);
