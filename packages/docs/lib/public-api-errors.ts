import { setResponseHeaders, setResponseStatus, type H3Event } from "h3";

export interface PublicApiError {
  code: string;
  message: string;
  resolution: string;
}

export function publicApiError(
  event: H3Event,
  statusCode: number,
  error: PublicApiError,
  cacheControl = "no-store",
) {
  setResponseStatus(event, statusCode, error.message);
  setResponseHeaders(event, {
    "cache-control": cacheControl,
    "content-type": "application/json; charset=utf-8",
  });
  return { error };
}
