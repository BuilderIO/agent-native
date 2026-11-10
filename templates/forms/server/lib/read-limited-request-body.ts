import { getRequestHeader, type H3Event } from "h3";

export class RequestBodyTooLargeError extends Error {}

export async function readLimitedRequestBody(
  event: H3Event,
  maxBytes: number,
): Promise<void> {
  const declared = getRequestHeader(event, "content-length");
  if (declared !== undefined) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes) {
      throw new RequestBodyTooLargeError("Request body too large");
    }
  }

  const request = event.req;
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Request body stream is unavailable");

  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new RequestBodyTooLargeError("Request body too large");
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // Preserve the read or size-limit failure.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }

  // H3 2 parsers read event.req directly, so give them only the verified bytes.
  Object.assign(event, {
    req: new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: Buffer.concat(chunks, total),
    }),
  });
}
