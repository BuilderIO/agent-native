import { setTimeout as sleep } from "node:timers/promises";

const MAX_RATE_LIMIT_ATTEMPTS = 6;
const RATE_LIMIT_BACKOFF_MS = 30_000;
const MAX_RATE_LIMIT_DELAY_MS = 120_000;
const MAX_DELETE_SERVER_ERROR_ATTEMPTS = 3;
const DELETE_SERVER_ERROR_BACKOFF_MS = 1_000;

function retryDelayMilliseconds(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_RATE_LIMIT_DELAY_MS, seconds * 1000);
  }

  const retryAt = retryAfter === null ? Number.NaN : Date.parse(retryAfter);
  if (Number.isFinite(retryAt)) {
    return Math.min(MAX_RATE_LIMIT_DELAY_MS, Math.max(0, retryAt - Date.now()));
  }

  return Math.min(
    MAX_RATE_LIMIT_DELAY_MS,
    RATE_LIMIT_BACKOFF_MS * 2 ** attempt,
  );
}

export async function requestNetlifyApi(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  let rateLimitAttempts = 0;
  let deleteServerErrorAttempts = 0;
  const method = (options.method ?? "GET").toUpperCase();
  while (true) {
    let response: Response;
    try {
      response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      if (
        method !== "DELETE" ||
        deleteServerErrorAttempts >= MAX_DELETE_SERVER_ERROR_ATTEMPTS - 1
      ) {
        throw error;
      }

      const delay =
        DELETE_SERVER_ERROR_BACKOFF_MS * 2 ** deleteServerErrorAttempts;
      deleteServerErrorAttempts += 1;
      console.warn(
        `Netlify API transport error during delete; retrying in ${delay}ms.`,
      );
      await sleep(delay);
      continue;
    }
    if (response.status === 429) {
      if (rateLimitAttempts >= MAX_RATE_LIMIT_ATTEMPTS - 1) return response;

      await response.arrayBuffer();
      const delay = retryDelayMilliseconds(response, rateLimitAttempts);
      rateLimitAttempts += 1;
      console.warn(
        `Netlify API rate limited; retrying in ${Math.ceil(delay / 1000)}s.`,
      );
      await sleep(delay);
      continue;
    }

    if (
      method === "DELETE" &&
      response.status >= 500 &&
      response.status < 600
    ) {
      if (deleteServerErrorAttempts >= MAX_DELETE_SERVER_ERROR_ATTEMPTS - 1) {
        return response;
      }

      await response.arrayBuffer();
      const delay =
        DELETE_SERVER_ERROR_BACKOFF_MS * 2 ** deleteServerErrorAttempts;
      deleteServerErrorAttempts += 1;
      console.warn(
        `Netlify API server error during delete; retrying in ${delay}ms.`,
      );
      await sleep(delay);
      continue;
    }

    return response;
  }
}
