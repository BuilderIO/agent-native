export const MAX_ICON_MULTIPART_BYTES = 5 * 1024 * 1024 + 64 * 1024;

export class IconUploadBodyError extends Error {
  declare readonly cause?: unknown;

  constructor(
    public readonly statusCode: 400 | 413,
    options?: { cause?: unknown },
  ) {
    super(
      statusCode === 413 ? "Icon too large" : "Invalid multipart icon upload",
    );
    this.name = "IconUploadBodyError";
    if (options && "cause" in options) {
      Object.defineProperty(this, "cause", {
        value: options.cause,
        enumerable: false,
        configurable: true,
        writable: true,
      });
    }
  }
}

type BodyErrorFactory = (
  statusCode: 400 | 413,
  options?: { cause?: unknown },
) => Error;

async function rejectOversized(
  cancel: () => Promise<void> | undefined,
  createError: BodyErrorFactory,
): Promise<never> {
  try {
    await cancel();
  } catch (cause) {
    throw createError(413, { cause });
  }
  throw createError(413);
}

/**
 * Reads a multipart body without ever holding more than `maxBytes`, then
 * parses it. Oversized bodies fail with 413 and malformed ones with 400,
 * through `createError`.
 */
export async function readBoundedMultipartFormData(
  request: Request,
  maxBytes: number,
  createError: BodyErrorFactory,
): Promise<FormData> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (declaredLength > maxBytes) {
    return rejectOversized(() => request.body?.cancel(), createError);
  }
  const reader = request.body?.getReader();
  if (!reader) throw createError(400);
  const body = new Uint8Array(maxBytes);
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > maxBytes - size)
        await rejectOversized(() => reader.cancel(), createError);
      body.set(value, size);
      size += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  // Parse the bounded buffer, never a clone that tees and queues the live body.
  try {
    return await new Response(body.subarray(0, size), {
      headers: { "content-type": request.headers.get("content-type") ?? "" },
    }).formData();
  } catch {
    throw createError(400);
  }
}

export function readIconUploadFormData(request: Request): Promise<FormData> {
  return readBoundedMultipartFormData(
    request,
    MAX_ICON_MULTIPART_BYTES,
    (statusCode, options) => new IconUploadBodyError(statusCode, options),
  );
}
