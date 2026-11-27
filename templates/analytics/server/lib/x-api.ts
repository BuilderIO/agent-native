import { resolveCredential } from "./credentials";
import { requireRequestCredentialContext } from "./credentials-context";

const API_BASE = "https://api.x.com/2";
export const X_POST_READ_USD = 0.005;
export const X_USER_READ_USD = 0.01;
export const X_PAGE_SIZE = 100;
export const X_MIN_PAGE_SIZE = 5;
export const X_POST_FIELDS = "created_at,public_metrics,entities,note_post";
export const X_REQUEST_TIMEOUT_MS = 60_000;

export type XUser = { id: string; username: string };

export type XPostLink = {
  url: string | null;
  expandedUrl: string | null;
  unwoundUrl: string | null;
  displayUrl: string | null;
};

export type XPostMetrics = {
  views: number;
  likes: number;
  reposts: number;
  replies: number;
  quotes: number;
  bookmarks: number;
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
  billed: number | null;
};

function xError(
  message: string,
  errorCode: string,
  billed: number | null,
  statusCode?: number,
): XRequestError {
  return Object.assign(new Error(message), {
    errorCode,
    billed,
    ...(statusCode ? { statusCode } : {}),
  });
}

export function isXSpendingLimitError(error: unknown): boolean {
  return (
    (error as { errorCode?: unknown } | null)?.errorCode ===
    "x_spending_limit_reached"
  );
}

export function xErrorBilled(error: unknown): number | null {
  const billed = (error as { billed?: unknown } | null)?.billed;
  return typeof billed === "number" ? billed : null;
}

export function compareXIds(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

export async function xBearerToken(): Promise<string> {
  const ctx = requireRequestCredentialContext("TWITTER_BEARER_TOKEN");
  const token = await resolveCredential("TWITTER_BEARER_TOKEN", ctx);
  if (!token) {
    throw xError(
      "No X API Bearer token is saved. Add one under Data Sources → X / Twitter.",
      "x_bearer_token_missing",
      0,
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
  resource_type?: string;
  value?: string;
  parameter?: string;
};

type XBody = {
  data?: unknown;
  errors?: unknown;
  meta?: { result_count?: unknown; next_token?: unknown };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function problemList(value: unknown): XProblem[] {
  return Array.isArray(value) ? (value.filter(isRecord) as XProblem[]) : [];
}

function firstOf<T>(items: readonly T[]): T | undefined {
  return items[0];
}

function problemKind(problem: XProblem): string {
  return (problem.type ?? "").split("/").pop() ?? "";
}

function problemDetail(problem: XProblem): string | undefined {
  return problem.detail ?? problem.message ?? problem.title;
}

const NOTHING_READ_PROBLEMS = new Set([
  "resource-not-found",
  "not-authorized-for-resource",
  "resource-unavailable",
  "usage-capped",
]);

const FORBIDDEN_PROBLEMS = new Set([
  "client-forbidden",
  "unsupported-authentication",
  "not-authorized-for-resource",
  "disallowed-resource",
  "usage-capped",
]);

function leadingProblem(problems: XProblem[]): XProblem | undefined {
  return (
    problems.find((problem) => problemKind(problem) === "usage-capped") ??
    firstOf(problems)
  );
}

function billedWithoutData(problems: XProblem[]): number | null {
  return problems.length > 0 &&
    problems.every((problem) => NOTHING_READ_PROBLEMS.has(problemKind(problem)))
    ? 0
    : null;
}

function decode(text: string): { body: unknown } | null {
  try {
    return { body: JSON.parse(text) };
  } catch {
    // coercion-ok: callers name a body that is not JSON as an unreadable answer and keep its reservation.
    return null;
  }
}

async function send(
  token: string,
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<XBody> {
  const url = new URL(`${API_BASE}/${path}`);
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }
  const timeout = AbortSignal.timeout(X_REQUEST_TIMEOUT_MS);
  let res: Response;
  let text: string;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    text = await res.text();
  } catch (error) {
    if (!timeout.aborted) throw error;
    throw xError(
      `X API ${path} didn't answer within ${X_REQUEST_TIMEOUT_MS / 1000} seconds.`,
      "x_request_timed_out",
      null,
    );
  }
  const decoded = decode(text);
  if (res.ok) {
    if (!decoded || !isRecord(decoded.body)) {
      throw xError(
        `X API ${path} answered with a body that is not a JSON object.`,
        "x_unexpected_response",
        null,
        res.status,
      );
    }
    return decoded.body as XBody;
  }
  const body = decoded && isRecord(decoded.body) ? decoded.body : null;
  const problems = body
    ? [body as XProblem, ...problemList(body.errors)]
    : ([] as XProblem[]);
  const detail =
    problems.map(problemDetail).find(Boolean) ?? `HTTP ${res.status}`;
  const refused =
    body !== null &&
    body.data === undefined &&
    (res.status === 401 ||
      res.status === 402 ||
      res.status === 429 ||
      (res.status === 403 &&
        problems.some((problem) =>
          FORBIDDEN_PROBLEMS.has(problemKind(problem)),
        )));
  const billed = refused ? 0 : null;
  const capped = problems.some((problem) =>
    /usage-?cap|spend/i.test(`${problem.type ?? ""} ${problem.title ?? ""}`),
  );
  if (res.status === 402 || (res.status === 429 && capped)) {
    throw xError(
      `X stopped serving reads at the app's spending limit: ${detail}`,
      "x_spending_limit_reached",
      billed,
      res.status,
    );
  }
  if (res.status === 401) {
    throw xError(
      `X refused the saved Bearer token. Check it in the X Developer Console: ${detail}`,
      "x_token_rejected",
      billed,
      res.status,
    );
  }
  if (res.status === 403) {
    throw xError(
      `X refused this request for the saved app: ${detail}`,
      "x_access_denied",
      billed,
      res.status,
    );
  }
  if (res.status === 429) {
    throw xError(
      `X rate-limited the request: ${detail}`,
      "x_rate_limited",
      billed,
      res.status,
    );
  }
  throw xError(
    `X API ${path} returned ${res.status}: ${detail}`,
    "x_request_failed",
    billed,
    res.status,
  );
}

function requestProblem(
  path: string,
  problem: XProblem,
  billed: number | null,
): XRequestError {
  const detail = problemDetail(problem) ?? "no detail";
  if (problemKind(problem) === "usage-capped") {
    return xError(
      `X stopped serving reads at the app's spending limit: ${detail}`,
      "x_spending_limit_reached",
      billed,
    );
  }
  return xError(
    `X API ${path} reported a problem: ${detail}`,
    "x_request_failed",
    billed,
  );
}

type RawUrlEntity = {
  url?: string;
  expanded_url?: string;
  unwound_url?: string;
  display_url?: string;
};

type RawNote = { text?: string; entities?: { urls?: RawUrlEntity[] } };

type RawPost = {
  id?: string;
  text?: string;
  created_at?: string;
  entities?: { urls?: RawUrlEntity[] };
  note_post?: RawNote;
  note_tweet?: RawNote;
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

function postMetrics(raw: RawPost["public_metrics"]): XPostMetrics | null {
  if (!raw) return null;
  const views = count(raw.impression_count);
  const likes = count(raw.like_count);
  const reposts = count(raw.repost_count ?? raw.retweet_count);
  const replies = count(raw.reply_count);
  const quotes = count(raw.quote_count);
  const bookmarks = count(raw.bookmark_count);
  if (
    views === null ||
    likes === null ||
    reposts === null ||
    replies === null ||
    quotes === null ||
    bookmarks === null
  ) {
    return null;
  }
  return { views, likes, reposts, replies, quotes, bookmarks };
}

export function parseXPost(raw: RawPost): XPost | null {
  const created = raw.created_at ? Date.parse(raw.created_at) : Number.NaN;
  const metrics = postMetrics(raw.public_metrics);
  if (!raw.id || !/^\d+$/.test(raw.id) || Number.isNaN(created) || !metrics) {
    return null;
  }
  const note = raw.note_post ?? raw.note_tweet;
  return {
    id: raw.id,
    createdAt: new Date(created).toISOString(),
    text: note?.text ?? raw.text ?? "",
    links: [...(raw.entities?.urls ?? []), ...(note?.entities?.urls ?? [])].map(
      link,
    ),
    metrics,
  };
}

function rawItems(path: string, body: XBody): unknown[] {
  if (body.data === undefined) return [];
  if (!Array.isArray(body.data)) {
    throw xError(
      `X API ${path} answered with data that is not a list.`,
      "x_unexpected_response",
      null,
    );
  }
  return body.data;
}

function parsePosts(path: string, data: unknown[]): XPost[] {
  const posts = data.flatMap((raw) => {
    const post = isRecord(raw) ? parseXPost(raw as RawPost) : null;
    return post ? [post] : [];
  });
  if (posts.length < data.length) {
    throw xError(
      `X API ${path} returned ${data.length - posts.length} of ${data.length} posts without an id, a created_at or all six public_metrics counts, which this collection asks for with post.fields=${X_POST_FIELDS}. X may have renamed a field.`,
      "x_fields_missing",
      data.length,
    );
  }
  return posts;
}

export async function lookupXUsers(
  token: string,
  usernames: string[],
  signal?: AbortSignal,
): Promise<{
  users: XUser[];
  returned: number;
  missing: string[];
  unavailable: string[];
  problem: XRequestError | null;
}> {
  if (usernames.length === 0) {
    return {
      users: [],
      returned: 0,
      missing: [],
      unavailable: [],
      problem: null,
    };
  }
  if (usernames.length > X_PAGE_SIZE) {
    throw xError(
      `X looks up at most ${X_PAGE_SIZE} accounts at once.`,
      "x_too_many_accounts",
      0,
    );
  }
  const body = await send(
    token,
    "users/by",
    { usernames: usernames.join(",") },
    signal,
  );
  const data = rawItems("users/by", body);
  const users = data.flatMap((raw) =>
    isRecord(raw) &&
    typeof raw.id === "string" &&
    typeof raw.username === "string"
      ? [{ id: raw.id, username: raw.username }]
      : [],
  );
  if (users.length < data.length) {
    throw xError(
      "X API users/by returned an account without an id or username.",
      "x_fields_missing",
      data.length,
    );
  }
  const asked = new Map(usernames.map((name) => [name.toLowerCase(), name]));
  const found = new Set(users.map((user) => user.username.toLowerCase()));
  const notFound = new Set<string>();
  const reported = new Set<string>();
  for (const problem of problemList(body.errors)) {
    const name = (problem.value ?? problem.resource_id ?? "").toLowerCase();
    if (!asked.has(name) || found.has(name)) continue;
    reported.add(name);
    if (problemKind(problem) === "resource-not-found") notFound.add(name);
  }
  const generals = problemList(body.errors).filter(
    (problem) =>
      !asked.has((problem.value ?? problem.resource_id ?? "").toLowerCase()),
  );
  const general = leadingProblem(generals);
  if (users.length === 0 && reported.size === 0) {
    throw general
      ? requestProblem("users/by", general, billedWithoutData(generals))
      : xError(
          "X API users/by answered with neither accounts nor a reason.",
          "x_unexpected_response",
          null,
        );
  }
  return {
    users,
    returned: data.length,
    missing: usernames.filter((name) => notFound.has(name.toLowerCase())),
    unavailable: usernames.filter(
      (name) =>
        !found.has(name.toLowerCase()) && !notFound.has(name.toLowerCase()),
    ),
    problem: general ? requestProblem("users/by", general, data.length) : null,
  };
}

export type XTimelineRange = ({ sinceId: string } | { startTime: string }) & {
  untilId?: string;
  paginationToken?: string;
};

export type XTimelinePage = {
  posts: XPost[];
  returned: number;
  newestId: string | null;
  oldestId: string | null;
  oldestAt: string | null;
  nextToken: string | null;
  problem: XRequestError | null;
};

function inRange(post: XPost, range: XTimelineRange): boolean {
  if ("sinceId" in range && compareXIds(post.id, range.sinceId) <= 0) {
    return false;
  }
  if (
    "startTime" in range &&
    Date.parse(post.createdAt) < Date.parse(range.startTime)
  ) {
    return false;
  }
  return !range.untilId || compareXIds(post.id, range.untilId) < 0;
}

function timelineProblem(
  path: string,
  problem: XProblem,
  billed: number | null,
): XRequestError {
  const detail = problemDetail(problem) ?? "no detail";
  switch (problemKind(problem)) {
    case "resource-not-found":
      return xError(
        `X has no account ${problem.value ?? problem.resource_id ?? ""}: ${detail}`,
        "x_account_not_found",
        billed,
      );
    case "not-authorized-for-resource":
    case "resource-unavailable":
      return xError(
        `X won't serve this account's posts: ${detail}`,
        "x_account_unavailable",
        billed,
      );
    default:
      return requestProblem(path, problem, billed);
  }
}

export async function listXUserPostsPage(
  token: string,
  userId: string,
  range: XTimelineRange,
  maxResults: number,
  signal?: AbortSignal,
): Promise<XTimelinePage> {
  if (
    !Number.isInteger(maxResults) ||
    maxResults < X_MIN_PAGE_SIZE ||
    maxResults > X_PAGE_SIZE
  ) {
    throw xError(
      `X reads ${X_MIN_PAGE_SIZE} to ${X_PAGE_SIZE} posts a page, not ${maxResults}.`,
      "x_page_size_invalid",
      0,
    );
  }
  const path = `users/${encodeURIComponent(userId)}/tweets`;
  const body = await send(
    token,
    path,
    {
      max_results: String(maxResults),
      exclude: "retweets,replies",
      "post.fields": X_POST_FIELDS,
      ...("sinceId" in range
        ? { since_id: range.sinceId }
        : { start_time: range.startTime }),
      ...(range.untilId ? { until_id: range.untilId } : {}),
      ...(range.paginationToken
        ? { pagination_token: range.paginationToken }
        : {}),
    },
    signal,
  );
  const data = rawItems(path, body);
  const problems = problemList(body.errors);
  const problem = leadingProblem(problems);
  const resultCount = body.meta?.result_count;
  const nextToken =
    typeof body.meta?.next_token === "string" && body.meta.next_token
      ? body.meta.next_token
      : null;
  if (resultCount !== undefined && resultCount !== data.length) {
    throw xError(
      `X API ${path} sent ${data.length} posts with a post count that doesn't match.`,
      "x_unexpected_response",
      null,
    );
  }
  if (data.length === 0) {
    if (problem) {
      throw timelineProblem(path, problem, billedWithoutData(problems));
    }
    if (resultCount !== 0) {
      throw xError(
        `X API ${path} answered with neither posts nor a post count of 0.`,
        "x_unexpected_response",
        null,
      );
    }
    return {
      posts: [],
      returned: 0,
      newestId: null,
      oldestId: null,
      oldestAt: null,
      nextToken,
      problem: null,
    };
  }
  const posts = parsePosts(path, data);
  const ordered = [...posts].sort((a, b) => compareXIds(a.id, b.id));
  const kept = ordered.filter((post) => inRange(post, range));
  const oldest = firstOf(ordered);
  const newest = firstOf(kept.slice(-1));
  return {
    posts: posts.filter((post) => inRange(post, range)),
    returned: data.length,
    newestId: newest?.id ?? null,
    oldestId: oldest?.id ?? null,
    oldestAt: oldest?.createdAt ?? null,
    nextToken,
    problem: problem ? timelineProblem(path, problem, data.length) : null,
  };
}

export async function lookupXPosts(
  token: string,
  ids: string[],
  signal?: AbortSignal,
): Promise<{
  posts: XPost[];
  returned: number;
  gone: string[];
  unavailable: string[];
  problem: XRequestError | null;
}> {
  if (ids.length === 0) {
    return { posts: [], returned: 0, gone: [], unavailable: [], problem: null };
  }
  if (ids.length > X_PAGE_SIZE) {
    throw xError(
      `X looks up at most ${X_PAGE_SIZE} posts at once.`,
      "x_too_many_posts",
      0,
    );
  }
  const body = await send(
    token,
    "tweets",
    { ids: ids.join(","), "post.fields": X_POST_FIELDS },
    signal,
  );
  const data = rawItems("tweets", body);
  const asked = new Set(ids);
  const posts = parsePosts("tweets", data).filter((post) => asked.has(post.id));
  const returnedIds = new Set(posts.map((post) => post.id));
  const gone = new Set<string>();
  const reported = new Set<string>();
  const general: XProblem[] = [];
  for (const problem of problemList(body.errors)) {
    const id = problem.resource_id ?? problem.value ?? "";
    if (!asked.has(id)) {
      general.push(problem);
      continue;
    }
    if (returnedIds.has(id)) continue;
    reported.add(id);
    if (problemKind(problem) === "resource-not-found") gone.add(id);
  }
  const problem = leadingProblem(general);
  if (data.length === 0 && reported.size === 0) {
    throw problem
      ? requestProblem("tweets", problem, billedWithoutData(general))
      : xError(
          "X API tweets answered with neither posts nor a reason.",
          "x_unexpected_response",
          null,
        );
  }
  return {
    posts,
    returned: data.length,
    gone: ids.filter((id) => gone.has(id)),
    unavailable: ids.filter((id) => !returnedIds.has(id) && !gone.has(id)),
    problem: problem ? requestProblem("tweets", problem, data.length) : null,
  };
}

export async function testXBearerToken(token: string): Promise<void> {
  await send(token, "usage/tweets", { days: "1" });
}
