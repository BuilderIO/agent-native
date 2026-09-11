const REPO_URL = "https://api.github.com/repos/BuilderIO/agent-native";
const FETCH_TIMEOUT_MS = 5_000;
const CACHE_FRESH_MS = 5 * 60_000;
const FAILURE_RETRY_MS = 60_000;

let cache: { count: number; ts: number } | null = null;
let inFlight: Promise<number | null> | null = null;
let retryAt: number | null = null;

function retryAtFromResponse(response: Response): number {
  const retryAfter = response.headers.get("retry-after")?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Date.now() + seconds * 1000;
    }

    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return date;
  }

  const resetHeader = response.headers.get("x-ratelimit-reset")?.trim();
  if (resetHeader) {
    const reset = Number(resetHeader);
    if (Number.isFinite(reset) && reset >= 0) return reset * 1000;
  }

  return Date.now() + FAILURE_RETRY_MS;
}

async function fetchStarCount(): Promise<{
  count: number | null;
  retryAt: number;
}> {
  try {
    const res = await fetch(REPO_URL, {
      headers: { accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return { count: null, retryAt: retryAtFromResponse(res) };
    const data = await res.json();
    return {
      count:
        typeof data.stargazers_count === "number"
          ? data.stargazers_count
          : null,
      retryAt: Date.now() + FAILURE_RETRY_MS,
    };
  } catch {
    // coercion-ok: Network/API failures surface as an explicit null, not a fake value
    return { count: null, retryAt: Date.now() + FAILURE_RETRY_MS };
  }
}

function refresh(): Promise<number | null> {
  if (inFlight) return inFlight;
  if (retryAt !== null && Date.now() < retryAt) {
    return Promise.resolve(null);
  }
  const request = (async () => {
    const result = await fetchStarCount();
    const { count } = result;
    if (count !== null) {
      cache = { count, ts: Date.now() };
      retryAt = null;
    } else {
      retryAt = result.retryAt;
    }
    return count;
  })();
  inFlight = request.finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export async function getGithubStarCount(): Promise<number | null> {
  if (cache) {
    if (
      Date.now() - cache.ts >= CACHE_FRESH_MS &&
      (retryAt === null || Date.now() >= retryAt)
    ) {
      void refresh();
    }
    return cache.count;
  }
  if (retryAt !== null && Date.now() < retryAt) {
    return null;
  }
  return refresh();
}

export function resetGithubStarCountCacheForTests(): void {
  cache = null;
  inFlight = null;
  retryAt = null;
}
