const REPO_URL = "https://api.github.com/repos/BuilderIO/agent-native";
const FETCH_TIMEOUT_MS = 5_000;
const CACHE_FRESH_MS = 5 * 60_000;

let cache: { count: number; ts: number } | null = null;
let inFlight: Promise<number | null> | null = null;

async function fetchStarCount(): Promise<number | null> {
  try {
    const res = await fetch(REPO_URL, {
      headers: { accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.stargazers_count === "number"
      ? data.stargazers_count
      : null;
  } catch {
    // coercion-ok: Network/API failures surface as an explicit null, not a fake value
    return null;
  }
}

function refresh(): Promise<number | null> {
  if (inFlight) return inFlight;
  const request = (async () => {
    const count = await fetchStarCount();
    if (count !== null) cache = { count, ts: Date.now() };
    return count;
  })();
  inFlight = request.finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export async function getGithubStarCount(): Promise<number | null> {
  if (cache) {
    if (Date.now() - cache.ts >= CACHE_FRESH_MS) {
      void refresh();
    }
    return cache.count;
  }
  return refresh();
}

// For the root loader, which runs on every page: awaiting the GitHub fetch
// there would put a cold-start network round trip in front of the whole site.
// An unknown count renders as no count, so returning null while the refresh
// runs in the background is the honest answer rather than a stalled page.
export function getGithubStarCountFromCache(): number | null {
  if (!cache) {
    void refresh();
    return null;
  }
  if (Date.now() - cache.ts >= CACHE_FRESH_MS) void refresh();
  return cache.count;
}

export function resetGithubStarCountCacheForTests(): void {
  cache = null;
  inFlight = null;
}
