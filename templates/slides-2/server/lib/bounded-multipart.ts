import { assertBodySize, readMultipartFormData, readRawBody } from "h3";

export async function readBoundedMultipartFormData(
  event: Parameters<typeof assertBodySize>[0],
  limit: number,
) {
  const originalRequest = event.req;
  // Nitro exposes HTTPEvent here, while H3's body readers still require H3Event.
  const h3Event = event as unknown as Parameters<typeof readRawBody>[0];
  const contentType = originalRequest.headers.get("content-type");

  await assertBodySize(event, limit);
  if (
    contentType?.split(";")[0]?.trim().toLowerCase() !== "multipart/form-data"
  ) {
    throw Object.assign(new TypeError("Expected multipart/form-data"), {
      statusCode: 400,
    });
  }
  const body = await readRawBody(h3Event, false);
  if (!body || body.byteLength === 0) return undefined;

  const headers = new Headers();
  if (contentType) headers.set("content-type", contentType);
  // The body limiter wraps the request stream, which breaks Request.formData().
  const multipartEvent = Object.assign(
    Object.create(Object.getPrototypeOf(h3Event)),
    h3Event,
    {
      req: new Request(originalRequest.url, {
        method: originalRequest.method,
        headers,
        body: new Blob([body as Uint8Array<ArrayBuffer>]),
      }),
    },
  ) as typeof h3Event;

  try {
    return await readMultipartFormData(multipartEvent);
  } catch (error) {
    if (
      error instanceof TypeError &&
      error.message === "Failed to parse body as FormData."
    ) {
      throw Object.assign(error, { statusCode: 400 });
    }
    throw error;
  }
}
