import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  ANC_V1_NATIVE_RECOVERY_WRAP_SOURCE_PATHS,
  buildAncV1NativeRecoveryWrapVectors,
} from "../src/e2ee/native-recovery-wrap-vectors.js";

const protocolBaseCommit = process.argv[2];
if (!protocolBaseCommit || !/^[0-9a-f]{40}$/.test(protocolBaseCommit))
  throw new Error("Pass the frozen 40-character protocol base commit");
const root = fileURLToPath(new URL("../../../", import.meta.url));
const sources = await Promise.all(
  ANC_V1_NATIVE_RECOVERY_WRAP_SOURCE_PATHS.map(async (path) => ({
    path,
    sha256: createHash("sha256")
      .update(await readFile(`${root}${path}`))
      .digest("hex"),
  })),
);
const corpus = await buildAncV1NativeRecoveryWrapVectors({
  protocolBaseCommit,
  sources,
});
await writeFile(
  new URL(
    "../src/e2ee/fixtures/anc-v1-native-recovery-wrap-vectors.json",
    import.meta.url,
  ),
  `${JSON.stringify(corpus, null, 2)}\n`,
);
