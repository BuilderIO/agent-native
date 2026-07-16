import type { H3Event } from "h3";

/**
 * Read an authenticated opaque binary request with an actual streaming limit.
 * Callers must complete authorization and validate Content-Length first. A
 * missing web stream fails closed; falling back to readRawBody would buffer an
 * attacker-controlled chunked request before enforcing the cap.
 */
export async function readPrivateVaultBoundedBody(
  event: H3Event,
  expectedBytes: number,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (
    !Number.isSafeInteger(expectedBytes) ||
    expectedBytes < 1 ||
    expectedBytes > maximumBytes
  ) {
    throw new Error("Invalid private-vault body length");
  }
  const stream = event.req.body;
  if (!stream) throw new Error("Private-vault request stream is unavailable");
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw new Error("Private-vault request stream was not binary");
      }
      total += value.byteLength;
      if (total > expectedBytes || total > maximumBytes) {
        throw new Error("Private-vault request body exceeded its bound");
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (total !== expectedBytes) {
    throw new Error("Private-vault request body length mismatch");
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
