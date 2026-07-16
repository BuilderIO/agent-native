export async function readBoundedResponseBytes(
  response: Response,
  options: {
    maximumByteLength: number;
    expectedByteLength: number;
    invalidResponse: () => Error;
  },
): Promise<Uint8Array> {
  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader !== null) {
    if (!/^[1-9][0-9]*$/.test(contentLengthHeader)) {
      throw options.invalidResponse();
    }
    const contentLength = Number(contentLengthHeader);
    if (
      !Number.isSafeInteger(contentLength) ||
      contentLength > options.maximumByteLength ||
      contentLength !== options.expectedByteLength
    ) {
      throw options.invalidResponse();
    }
  }

  const reader = response.body?.getReader();
  if (!reader) throw options.invalidResponse();

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (!(next.value instanceof Uint8Array)) throw options.invalidResponse();
      byteLength += next.value.byteLength;
      if (
        byteLength > options.maximumByteLength ||
        byteLength > options.expectedByteLength
      ) {
        await reader.cancel().catch(() => undefined);
        throw options.invalidResponse();
      }
      chunks.push(next.value);
    }
  } catch {
    throw options.invalidResponse();
  } finally {
    reader.releaseLock();
  }

  if (byteLength !== options.expectedByteLength) {
    throw options.invalidResponse();
  }
  const output = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
