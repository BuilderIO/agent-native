import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import sodium from "libsodium-wrappers-sumo";

import {
  ANC_V1_NATIVE_ROTATION_PREPARATION_SOURCE_PATHS,
  buildAncV1NativeRotationPreparationEphemeralMaterial,
  buildAncV1NativeRotationPreparationVectors,
} from "../src/e2ee/native-rotation-preparation-vectors.js";

export const ANC_V1_NATIVE_ROTATION_PREPARATION_STREAM_MAGIC = "ANVRMS02";
export const ANC_V1_NATIVE_ROTATION_PREPARATION_STREAM_VERSION = 2;
export const ANC_V1_NATIVE_ROTATION_PREPARATION_STREAM_HEADER_BYTES = 152;
export const ANC_V1_NATIVE_ROTATION_PREPARATION_STREAM_ALTERNATE_OUTER_MAX_BYTES = 1_114_424;
export const ANC_V1_NATIVE_ROTATION_PREPARATION_STREAM_MAX_BYTES =
  152 + 32 + 24 + 65_536 + 1_048_576 + 1_114_424 + 32;
export const ANC_V1_NATIVE_ROTATION_PREPARATION_STREAM_CHECKSUM_DOMAIN =
  "agent-native/private-vault/rotation-preparation-material-stream/anc-v1\0";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const destination = fileURLToPath(
  new URL(
    "../src/e2ee/fixtures/anc-v1-native-rotation-preparation-vectors.json",
    import.meta.url,
  ),
);

const concat = (...parts: Uint8Array[]) => {
  const output = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
};

async function streamChecksum(bytes: Uint8Array) {
  await sodium.ready;
  const domain = new TextEncoder().encode(
    ANC_V1_NATIVE_ROTATION_PREPARATION_STREAM_CHECKSUM_DOMAIN.replace(
      "\\0",
      "\0",
    ),
  );
  const input = concat(domain, bytes);
  const digest = sodium.crypto_generichash(32, input, null);
  input.fill(0);
  return digest;
}

async function writeStdout(bytes: Uint8Array) {
  if (process.env.ANC_ROTATION_STREAM_TEST_DELAY === "1")
    await new Promise((resolve) => setTimeout(resolve, 100));
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    process.stdout.once("error", onError);
    process.stdout.write(bytes, (error) => {
      process.stdout.off("error", onError);
      if (error) reject(error);
      else resolve();
    });
  });
}

export async function buildEphemeralRotationPreparationStream() {
  const material = await buildAncV1NativeRotationPreparationEphemeralMaterial();
  const values = [
    material.files.pendingEpochKey,
    material.files.spoolNonce,
    material.files.signedEntry,
    material.files.recoveryWrap,
    material.files.alternateOuter,
  ];
  let header: Uint8Array | undefined;
  let withoutChecksum: Uint8Array | undefined;
  let checksum: Uint8Array | undefined;
  let stream: Uint8Array | undefined;
  try {
    if (
      values[4]!.length >
      ANC_V1_NATIVE_ROTATION_PREPARATION_STREAM_ALTERNATE_OUTER_MAX_BYTES
    )
      throw new Error(
        "Alternate encrypted spool exceeds the anc/v1 wire maximum",
      );
    header = new Uint8Array(
      ANC_V1_NATIVE_ROTATION_PREPARATION_STREAM_HEADER_BYTES,
    );
    const view = new DataView(header.buffer);
    header.set(
      new TextEncoder().encode(ANC_V1_NATIVE_ROTATION_PREPARATION_STREAM_MAGIC),
    );
    view.setUint16(8, ANC_V1_NATIVE_ROTATION_PREPARATION_STREAM_VERSION, true);
    view.setUint16(10, 0, true);
    view.setUint32(12, header.length, true);
    values.forEach((value, index) =>
      view.setBigUint64(16 + index * 8, BigInt(value.length), true),
    );
    header.set(Buffer.from(material.bindings.vaultIdHex, "hex"), 56);
    header.set(Buffer.from(material.bindings.ceremonyIdHex, "hex"), 72);
    header.set(
      Buffer.from(material.identities.endpoint.endpointIdHex, "hex"),
      88,
    );
    header.set(
      Buffer.from(material.identities.broker.endpointIdHex, "hex"),
      104,
    );
    header.set(Buffer.from(material.bindings.alternateVaultIdHex, "hex"), 120);
    header.set(
      Buffer.from(material.bindings.alternateCeremonyIdHex, "hex"),
      136,
    );
    withoutChecksum = concat(header, ...values);
    checksum = await streamChecksum(withoutChecksum);
    stream = concat(withoutChecksum, checksum);
    return { stream, material };
  } catch (error) {
    stream?.fill(0);
    for (const bytes of Object.values(material.files)) bytes.fill(0);
    throw error;
  } finally {
    header?.fill(0);
    withoutChecksum?.fill(0);
    checksum?.fill(0);
  }
}

async function emitEphemeralStream() {
  const { stream, material } = await buildEphemeralRotationPreparationStream();
  try {
    await writeStdout(stream);
  } finally {
    stream.fill(0);
    for (const bytes of Object.values(material.files)) bytes.fill(0);
  }
}

async function materializeFixture(protocolBaseCommit: string) {
  if (!/^[0-9a-f]{40}$/.test(protocolBaseCommit))
    throw new Error("Pass the frozen 40-character protocol base commit");
  const sources = await Promise.all(
    ANC_V1_NATIVE_ROTATION_PREPARATION_SOURCE_PATHS.map(async (path) => ({
      path,
      sha256: createHash("sha256")
        .update(await readFile(`${root}${path}`))
        .digest("hex"),
    })),
  );
  const corpus = await buildAncV1NativeRotationPreparationVectors({
    protocolBaseCommit,
    sources,
  });
  const serialized = JSON.stringify(corpus, null, 2).replace(
    /"holderRoles": \[\n\s+1,\n\s+2\n\s+\]/,
    '"holderRoles": [1, 2]',
  );
  await writeFile(destination, `${serialized}\n`, "utf8");
}

async function main() {
  if (process.argv[2] === "--ephemeral-material-stdout") {
    if (process.argv.length !== 3)
      throw new Error("stdout mode accepts no path");
    await emitEphemeralStream();
    return;
  }
  if (process.argv.length !== 3 || !process.argv[2])
    throw new Error("Pass the frozen 40-character protocol base commit");
  await materializeFixture(process.argv[2]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
