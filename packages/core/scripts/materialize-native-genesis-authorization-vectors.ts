import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  ANC_V1_NATIVE_GENESIS_AUTHORIZATION_SOURCE_PATHS,
  buildAncV1NativeGenesisAuthorizationVectors,
} from "../src/e2ee/native-genesis-authorization-vectors.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const destination = fileURLToPath(
  new URL(
    "../src/e2ee/fixtures/anc-v1-native-genesis-authorization-vectors.json",
    import.meta.url,
  ),
);

export async function materializeNativeGenesisAuthorizationVectors(
  protocolBaseCommit: string,
) {
  if (!/^[0-9a-f]{40}$/.test(protocolBaseCommit))
    throw new Error("Pass the frozen 40-character protocol base commit");
  const sources = await Promise.all(
    ANC_V1_NATIVE_GENESIS_AUTHORIZATION_SOURCE_PATHS.map(async (path) => ({
      path,
      sha256: createHash("sha256")
        .update(await readFile(`${root}${path}`))
        .digest("hex"),
    })),
  );
  const corpus = await buildAncV1NativeGenesisAuthorizationVectors({
    protocolBaseCommit,
    sources,
  });
  await writeFile(destination, `${JSON.stringify(corpus, null, 2)}\n`, "utf8");
}

async function main() {
  if (process.argv.length !== 3 || !process.argv[2])
    throw new Error("Pass the frozen 40-character protocol base commit");
  await materializeNativeGenesisAuthorizationVectors(process.argv[2]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
