const MAX_RATE_LIMIT_ATTEMPTS = 6;
const RATE_LIMIT_BACKOFF_MS = 30_000;
const MAX_RATE_LIMIT_DELAY_MS = 120_000;

const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

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
  for (let attempt = 0; attempt < MAX_RATE_LIMIT_ATTEMPTS; attempt += 1) {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status !== 429) return response;

    await response.arrayBuffer();
    if (attempt === MAX_RATE_LIMIT_ATTEMPTS - 1) return response;

    const delay = retryDelayMilliseconds(response, attempt);
    console.warn(
      `Netlify API rate limited; retrying in ${Math.ceil(delay / 1000)}s.`,
    );
    await sleep(delay);
  }

  throw new Error("Netlify API request exhausted its rate-limit retries.");
}
