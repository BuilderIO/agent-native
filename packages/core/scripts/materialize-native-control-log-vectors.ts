import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  ANC_V1_NATIVE_CONTROL_LOG_SOURCE_PATHS,
  buildAncV1NativeControlLogVectors,
} from "../src/e2ee/native-control-log-vectors.js";

const PROTOCOL_BASE_COMMIT = "fd8c9800abbda048b21796a0953f449d1cc100ce";
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const FIXTURE_URL = new URL(
  "../src/e2ee/fixtures/anc-v1-native-control-log-vectors.json",
  import.meta.url,
);

const sources = await Promise.all(
  ANC_V1_NATIVE_CONTROL_LOG_SOURCE_PATHS.map(async (path) => ({
    path,
    sha256: createHash("sha256")
      .update(await readFile(`${REPO_ROOT}${path}`))
      .digest("hex"),
  })),
);
const corpus = await buildAncV1NativeControlLogVectors({
  protocolBaseCommit: PROTOCOL_BASE_COMMIT,
  sources,
});
await writeFile(FIXTURE_URL, `${JSON.stringify(corpus, null, 2)}\n`);
