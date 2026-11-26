import { resolveCredential } from "./credentials";
import { requireRequestCredentialContext } from "./credentials-context";

const API_BASE = "https://api.x.com/2";
export const X_POST_READ_USD = 0.005;
export const X_USER_READ_USD = 0.01;
export const X_PAGE_SIZE = 100;
export const X_POST_FIELDS = "created_at,public_metrics,entities,note_tweet";

export type XUser = { id: string; username: string; name: string };

export type XPostLink = {
  url: string | null;
  expandedUrl: string | null;
  unwoundUrl: string | null;
  displayUrl: string | null;
};

export type XPostMetrics = {
  views: number | null;
  likes: number | null;
  reposts: number | null;
  replies: number | null;
  quotes: number | null;
  bookmarks: number | null;
};

export type XPost = {
  id: string;
  createdAt: string;
  text: string;
  links: XPostLink[];
  metrics: XPostMetrics;
};

export type XRequestError = Error & {
  errorCode: string;
  statusCode?: number;
};

function xError(
  message: string,
  errorCode: string,
  statusCode?: number,
): XRequestError {
  return Object.assign(new Error(message), {
    errorCode,
    ...(statusCode ? { statusCode } : {}),
  });
}

export function isXSpendingLimitError(error: unknown): boolean {
  return (
    (error as { errorCode?: unknown } | null)?.errorCode ===
    "x_spending_limit_reached"
  );
}

export async function xBearerToken(): Promise<string> {
  const ctx = requireRequestCredentialContext("TWITTER_BEARER_TOKEN");
  const token = await resolveCredential("TWITTER_BEARER_TOKEN", ctx);
  if (!token) {
    throw xError(
      "No X API Bearer token is saved. Add one under Data Sources → X / Twitter.",
      "x_bearer_token_missing",
      424,
    );
  }
  return token;
}

type XProblem = {
  title?: string;
  detail?: string;
  type?: string;
  message?: string;
  resource_id?: string;
  value?: string;
  parameter?: string;
};

async function get<T>(
  token: string,
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  const url = new URL(`${API_BASE}/${path}`);
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    ...(signal ? { signal } : {}),
  });
  if (res.ok) return (await res.json()) as T;
  // coercion-ok: an error body that isn't JSON still throws x_request_failed below.
  const body = (await res.json().catch(() => null)) as
    | (XProblem & { errors?: XProblem[] })
    | null;
  const problems = [body, ...(body?.errors ?? [])].filter(
    (problem): problem is XProblem => Boolean(problem),
  );
  const detail =
    problems
      .map((problem) => problem.detail ?? problem.message ?? problem.title)
      .find(Boolean) ?? `HTTP ${res.status}`;
  const capped = problems.some((problem) =>
    /usage-?cap|spend/i.test(`${problem.type ?? ""} ${problem.title ?? ""}`),
  );
  if (res.status === 402 || (res.status === 429 && capped)) {
    throw xError(
      `X stopped serving reads at the app's spending limit: ${detail}`,
      "x_spending_limit_reached",
      res.status,
    );
  }
  if (res.status === 401) {
    throw xError(
      `X refused the saved Bearer token. Check it in the X Developer Console: ${detail}`,
      "x_token_rejected",
      res.status,
    );
  }
  if (res.status === 403) {
    throw xError(
      `X refused this request for the saved app: ${detail}`,
      "x_access_denied",
      res.status,
    );
  }
  if (res.status === 429) {
    throw xError(
      `X rate-limited the request: ${detail}`,
      "x_rate_limited",
      res.status,
    );
  }
  throw xError(
    `X API ${path} returned ${res.status}: ${detail}`,
    "x_request_failed",
    res.status,
  );
}

type RawUrlEntity = {
  url?: string;
  expanded_url?: string;
  unwound_url?: string;
  display_url?: string;
};

type RawPost = {
  id: string;
  text?: string;
  created_at?: string;
  entities?: { urls?: RawUrlEntity[] };
  note_tweet?: { text?: string; entities?: { urls?: RawUrlEntity[] } };
  note_post?: { text?: string; entities?: { urls?: RawUrlEntity[] } };
  public_metrics?: {
    impression_count?: number;
    like_count?: number;
    retweet_count?: number;
    repost_count?: number;
    reply_count?: number;
    quote_count?: number;
    bookmark_count?: number;
  };
};

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function link(entity: RawUrlEntity): XPostLink {
  return {
    url: entity.url ?? null,
    expandedUrl: entity.expanded_url ?? null,
    unwoundUrl: entity.unwound_url ?? null,
    displayUrl: entity.display_url ?? null,
  };
}

export function parseXPost(raw: RawPost): XPost | null {
  if (!raw.id || !raw.created_at) return null;
  const note = raw.note_tweet ?? raw.note_post;
  const metrics = raw.public_metrics;
  return {
    id: raw.id,
    createdAt: new Date(raw.created_at).toISOString(),
    text: note?.text ?? raw.text ?? "",
    links: [...(raw.entities?.urls ?? []), ...(note?.entities?.urls ?? [])].map(
      link,
    ),
    metrics: {
      views: count(metrics?.impression_count),
      likes: count(metrics?.like_count),
      reposts: count(metrics?.repost_count ?? metrics?.retweet_count),
      replies: count(metrics?.reply_count),
      quotes: count(metrics?.quote_count),
      bookmarks: count(metrics?.bookmark_count),
    },
  };
}

function missingIds(errors: XProblem[] | undefined): string[] {
  return (errors ?? []).flatMap((problem) => {
    const id = problem.resource_id ?? problem.value;
    return id ? [id] : [];
  });
}

export async function lookupXUsers(
  token: string,
  usernames: string[],
  signal?: AbortSignal,
): Promise<{ users: XUser[]; missing: string[] }> {
  if (usernames.length === 0) return { users: [], missing: [] };
  if (usernames.length > X_PAGE_SIZE) {
    throw xError(
      `X looks up at most ${X_PAGE_SIZE} accounts at once.`,
      "x_too_many_accounts",
    );
  }
  const body = await get<{
    data?: Array<{ id: string; username: string; name?: string }>;
    errors?: XProblem[];
  }>(token, "users/by", { usernames: usernames.join(",") }, signal);
  const users = (body.data ?? []).map((user) => ({
    id: user.id,
    username: user.username,
    name: user.name ?? user.username,
  }));
  const found = new Set(users.map((user) => user.username.toLowerCase()));
  return {
    users,
    missing: usernames.filter((name) => !found.has(name.toLowerCase())),
  };
}

export type XTimelineStart = { sinceId: string } | { startTime: string };

export async function listXUserPostsPage(
  token: string,
  userId: string,
  start: XTimelineStart,
  paginationToken: string | undefined,
  signal?: AbortSignal,
): Promise<{ posts: XPost[]; returned: number; nextToken: string | null }> {
  const body = await get<{
    data?: RawPost[];
    meta?: { next_token?: string };
  }>(
    token,
    `users/${encodeURIComponent(userId)}/tweets`,
    {
      max_results: String(X_PAGE_SIZE),
      exclude: "retweets,replies",
      "tweet.fields": X_POST_FIELDS,
      ...("sinceId" in start
        ? { since_id: start.sinceId }
        : { start_time: start.startTime }),
      ...(paginationToken ? { pagination_token: paginationToken } : {}),
    },
    signal,
  );
  const data = body.data ?? [];
  return {
    posts: data.flatMap((raw) => parseXPost(raw) ?? []),
    returned: data.length,
    nextToken: body.meta?.next_token ?? null,
  };
}

export async function lookupXPosts(
  token: string,
  ids: string[],
  signal?: AbortSignal,
): Promise<{ posts: XPost[]; returned: number; missing: string[] }> {
  if (ids.length === 0) return { posts: [], returned: 0, missing: [] };
  if (ids.length > X_PAGE_SIZE) {
    throw xError(
      `X looks up at most ${X_PAGE_SIZE} posts at once.`,
      "x_too_many_posts",
    );
  }
  const body = await get<{ data?: RawPost[]; errors?: XProblem[] }>(
    token,
    "tweets",
    { ids: ids.join(","), "tweet.fields": X_POST_FIELDS },
    signal,
  );
  const data = body.data ?? [];
  const posts = data.flatMap((raw) => parseXPost(raw) ?? []);
  const returnedIds = new Set(data.map((raw) => raw.id));
  const reported = new Set(missingIds(body.errors));
  return {
    posts,
    returned: data.length,
    missing: ids.filter((id) => !returnedIds.has(id) && reported.has(id)),
  };
}

export async function testXBearerToken(token: string): Promise<void> {
  await get(token, "usage/tweets", { days: "1" });
}
