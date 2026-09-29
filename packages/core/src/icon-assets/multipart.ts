export const MAX_ICON_MULTIPART_BYTES = 5 * 1024 * 1024 + 64 * 1024;

export class IconUploadBodyError extends Error {
  constructor(
    public readonly statusCode: 400 | 413,
    options?: ErrorOptions,
  ) {
    super(
      statusCode === 413 ? "Icon too large" : "Invalid multipart icon upload",
      options,
    );
    this.name = "IconUploadBodyError";
  }
}

async function rejectOversized(
  cancel: () => Promise<void> | undefined,
): Promise<never> {
  try {
    await cancel();
  } catch (cause) {
    throw new IconUploadBodyError(413, { cause });
  }
  throw new IconUploadBodyError(413);
}

export async function readIconUploadFormData(
  request: Request,
): Promise<FormData> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (declaredLength > MAX_ICON_MULTIPART_BYTES) {
    return rejectOversized(() => request.body?.cancel());
  }
  const reader = request.body?.getReader();
  if (!reader) throw new IconUploadBodyError(400);
  const body = new Uint8Array(MAX_ICON_MULTIPART_BYTES);
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > MAX_ICON_MULTIPART_BYTES - size)
        await rejectOversized(() => reader.cancel());
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
    throw new IconUploadBodyError(400);
  }
}
