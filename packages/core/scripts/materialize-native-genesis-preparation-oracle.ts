import { writeSync } from "node:fs";

import { buildAncV1NativeGenesisPreparationRuntimeVector } from "../src/e2ee/native-genesis-preparation-vectors.js";
import { ancV1Hash } from "../src/e2ee/portable-crypto.js";

const vector = await buildAncV1NativeGenesisPreparationRuntimeVector();
const u64 = (value: number) => {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value));
  return bytes;
};
let body: Uint8Array | undefined;
let checksum: Uint8Array | undefined;
let output: Uint8Array | undefined;
try {
  const fields = [
    ...vector.secretInputs,
    ...vector.publicInputs,
    ...vector.times.map(u64),
    ...vector.expected,
  ];
  const size = 10 + fields.reduce((sum, field) => sum + 4 + field.length, 0);
  if (size > 1024 * 1024)
    throw new Error("Genesis preparation oracle is oversized");
  body = new Uint8Array(size);
  body.set(new TextEncoder().encode("ANCPVG1\0"), 0);
  new DataView(body.buffer).setUint16(8, fields.length);
  let offset = 10;
  for (const field of fields) {
    new DataView(body.buffer).setUint32(offset, field.length);
    offset += 4;
    body.set(field, offset);
    offset += field.length;
  }
  checksum = await ancV1Hash("recovery", body);
  output = new Uint8Array(body.length + checksum.length);
  output.set(body);
  output.set(checksum, body.length);
  if (writeSync(1, output) !== output.length)
    throw new Error("Short oracle write");
} finally {
  for (const secret of vector.secretInputs) secret.fill(0);
  body?.fill(0);
  checksum?.fill(0);
  output?.fill(0);
}
