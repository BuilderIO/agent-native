import {
  isXSpendingLimitError,
  listXUserPostsPage,
  lookupXPosts,
  lookupXUsers,
  X_MIN_PAGE_SIZE,
  X_PAGE_SIZE,
  X_POST_READ_USD,
  X_USER_READ_USD,
  xBearerToken,
  xErrorBilled,
  type XPost,
  type XRequestError,
  type XTimelineRange,
  type XUser,
} from "../../x-api.js";
import {
  X_HANDLE,
  X_MONTHLY_CAP_USD,
  xConfigFingerprint,
  type XAccount,
} from "../config.js";
import { ContentStepStop, type ContentStep } from "../step.js";
import {
  contentRunCostSince,
  listContentItemsWithRelevance,
  listRecentContentItems,
  reserveContentRunCost,
  saveContentRunProgress,
  settleContentRunCost,
  type ContentItemInput,
  type ContentRunOutcome,
  type ContentSnapshotInput,
  type RecentContentItem,
} from "../store.js";
import { utcDate } from "./daily-metrics.js";

export const X_METRICS = {
  views: "x_views",
  likes: "x_likes",
  reposts: "x_reposts",
  replies: "x_replies",
  quotes: "x_quotes",
  bookmarks: "x_bookmarks",
  ageHours: "x_age_hours",
} as const;

export const X_CHECKPOINT_DAYS = [1, 3, 7, 30] as const;
export const X_CHECKPOINT_WINDOW_HOURS = 30;
export const X_BACKFILL_DAYS = 30;
export const X_MAX_TIMELINE_PAGES = 8;
export const X_TIMELINE_POST_LIMIT = 800;
export const X_ACCOUNT_RELEVANCE = "account";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const RECENT_DAYS = 32;
const MICROS = 1_000_000;
const POST_MICROS = Math.round(X_POST_READ_USD * MICROS);
const USER_MICROS = Math.round(X_USER_READ_USD * MICROS);
const CAP_MICROS = Math.round(X_MONTHLY_CAP_USD * MICROS);

export type XCountingRule = { links: string[]; terms: string[] };

function hostAndPath(href: string): { host: string; path: string } | null {
  try {
    const url = new URL(href);
    return {
      host: url.hostname.toLowerCase(),
      path: url.pathname.toLowerCase(),
    };
  } catch {
    // coercion-ok: an address that is not a URL cannot match a tracked link
    return null;
  }
}

function linkTarget(href: string, targets: string[]): string | null {
  const parsed = hostAndPath(href);
  if (!parsed) return null;
  for (const target of targets) {
    const slash = target.indexOf("/");
    const host = slash === -1 ? target : target.slice(0, slash);
    const path = slash === -1 ? "" : target.slice(slash).replace(/\/+$/, "");
    const hostMatches =
      parsed.host === host || parsed.host.endsWith(`.${host}`);
    const pathMatches =
      path === "" || parsed.path === path || parsed.path.startsWith(`${path}/`);
    if (hostMatches && pathMatches) return target;
  }
  return null;
}

function linksToProfile(post: XPost, handle: string): boolean {
  const profile = `/${handle.slice(1).toLowerCase()}`;
  const status = `${profile}/status/`;
  return post.links.some((link) =>
    [link.expandedUrl, link.unwoundUrl].some((href) => {
      const parsed = href ? hostAndPath(href) : null;
      if (!parsed) return false;
      const host = parsed.host.replace(/^(?:www|mobile)\./, "");
      const path = parsed.path.replace(/\/$/, "");
      return (
        (host === "x.com" || host === "twitter.com") &&
        (path === profile ||
          (path.startsWith(status) && /^\d+$/.test(path.slice(status.length))))
      );
    }),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function plainHyphens(text: string): string {
  return text.replace(/[\u2010\u2011]/g, "-");
}

export function xTermMatches(text: string, term: string): boolean {
  const anyCase = /[^\p{L}\s]/u.test(term);
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{M}\\p{N}_@])${escapeRegExp(plainHyphens(term))}(?![\\p{L}\\p{M}\\p{N}_])`,
    anyCase ? "iu" : "u",
  );
  return pattern.test(plainHyphens(text));
}

function textWithoutLinks(post: XPost): string {
  let text = post.text;
  for (const link of post.links) {
    if (link.url) text = text.split(link.url).join(" ");
  }
  return text;
}

export function xCountedBy(
  post: XPost,
  account: XAccount,
  rule: XCountingRule,
): string | null {
  if (account.allPosts) return "account";
  for (const link of post.links) {
    for (const href of [link.expandedUrl, link.unwoundUrl]) {
      const target = href ? linkTarget(href, rule.links) : null;
      if (target) return `link:${target}`;
    }
  }
  const text = textWithoutLinks(post);
  for (const term of rule.terms) {
    if (
      xTermMatches(text, term) ||
      (X_HANDLE.test(term) && linksToProfile(post, term))
    ) {
      return `term:${term}`;
    }
  }
  return null;
}

export function xPostExcerpt(post: XPost): string | null {
  let text = post.text;
  for (const link of post.links) {
    if (link.url) text = text.split(link.url).join(link.displayUrl ?? "");
  }
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length > 140 ? `${flat.slice(0, 139).trimEnd()}…` : flat;
}

function hoursBetween(from: string, to: Date): number {
  return (to.getTime() - Date.parse(from)) / HOUR_MS;
}

export function xCheckpointDue(
  publishedAt: string,
  lastReadAt: string,
  now: Date,
  checkpoints: readonly number[] = X_CHECKPOINT_DAYS,
): number | null {
  const lastAge = (Date.parse(lastReadAt) - Date.parse(publishedAt)) / HOUR_MS;
  const age = hoursBetween(publishedAt, now);
  for (const days of checkpoints) {
    const opens = days * 24;
    if (
      lastAge < opens &&
      opens <= age &&
      age < opens + X_CHECKPOINT_WINDOW_HOURS
    ) {
      return days;
    }
  }
  return null;
}

function monthBounds(now: Date): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

export type XProjectionInput = {
  now: Date;
  spentMicros: number;
  countedPosts: Array<{ publishedAt: string; lastReadAt: string }>;
  postsPerDay: number;
  countedPerDay: number;
  includeDay30: boolean;
};

export function projectXMonthSpend(input: XProjectionInput): number {
  const { end } = monthBounds(input.now);
  const checkpoints = X_CHECKPOINT_DAYS.filter(
    (days) => input.includeDay30 || days !== 30,
  );
  let reads = 0;
  for (const post of input.countedPosts) {
    const published = Date.parse(post.publishedAt);
    const lastAge = (Date.parse(post.lastReadAt) - published) / HOUR_MS;
    for (const days of checkpoints) {
      const opens = published + days * DAY_MS;
      const closes = opens + X_CHECKPOINT_WINDOW_HOURS * HOUR_MS;
      if (
        lastAge < days * 24 &&
        opens < end.getTime() &&
        closes > input.now.getTime()
      ) {
        reads += 1;
      }
    }
  }
  let future = 0;
  const tomorrow = Date.UTC(
    input.now.getUTCFullYear(),
    input.now.getUTCMonth(),
    input.now.getUTCDate() + 1,
  );
  for (let day = tomorrow; day < end.getTime(); day += DAY_MS) {
    const rereads = checkpoints.filter(
      (days) => day + 12 * HOUR_MS + days * DAY_MS < end.getTime(),
    ).length;
    future += (input.postsPerDay + input.countedPerDay * rereads) * POST_MICROS;
  }
  return Math.round(input.spentMicros + reads * POST_MICROS + future);
}

function dollars(micros: number): string {
  return `$${(micros / MICROS).toFixed(2)}`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

type ReadPost = {
  post: XPost;
  user: XUser;
  countedBy: string | null;
};

function postSnapshots(
  post: XPost,
  readDate: string,
  now: Date,
): ContentSnapshotInput[] {
  const counts: Record<string, number | null> = {
    [X_METRICS.views]: post.metrics.views,
    [X_METRICS.likes]: post.metrics.likes,
    [X_METRICS.reposts]: post.metrics.reposts,
    [X_METRICS.replies]: post.metrics.replies,
    [X_METRICS.quotes]: post.metrics.quotes,
    [X_METRICS.bookmarks]: post.metrics.bookmarks,
    [X_METRICS.ageHours]: Math.max(
      0,
      Math.floor(hoursBetween(post.createdAt, now)),
    ),
  };
  return Object.entries(counts).flatMap(([metric, value]) =>
    value === null
      ? []
      : [
          {
            itemSource: "x" as const,
            itemExternalId: post.id,
            metricDate: readDate,
            metric,
            value,
          },
        ],
  );
}

export function xPostItem(read: ReadPost, now: Date): ContentItemInput {
  const { post, user, countedBy } = read;
  return {
    source: "x",
    externalId: post.id,
    url: `https://x.com/${encodeURIComponent(user.username)}/status/${encodeURIComponent(post.id)}`,
    title: xPostExcerpt(post),
    author: `@${user.username}`,
    authors: [`@${user.username}`],
    publishedAt: post.createdAt,
    relevance: countedBy ? "counted" : "not_counted",
    metadata: {
      authorId: user.id,
      username: user.username,
      countedBy,
      ...(countedBy ? { lastReadAt: now.toISOString() } : {}),
    },
  };
}

type XCursor = {
  sinceId: string | null;
  sinceAt: string | null;
  startTime: string | null;
  untilId: string | null;
  untilAt: string | null;
  topId: string | null;
  topAt: string | null;
  scanCount: number;
};

const NO_CURSOR: XCursor = {
  sinceId: null,
  sinceAt: null,
  startTime: null,
  untilId: null,
  untilAt: null,
  topId: null,
  topAt: null,
  scanCount: 0,
};

function readCursor(metadata: Record<string, unknown>): XCursor {
  return {
    sinceId: textValue(metadata.sinceId),
    sinceAt: textValue(metadata.sinceAt),
    startTime: textValue(metadata.startTime),
    untilId: textValue(metadata.untilId),
    untilAt: textValue(metadata.untilAt),
    topId: textValue(metadata.topId),
    topAt: textValue(metadata.topAt),
    scanCount: typeof metadata.scanCount === "number" ? metadata.scanCount : 0,
  };
}

function accountItem(user: XUser, cursor: XCursor): ContentItemInput {
  return {
    source: "x",
    externalId: `account:${user.id}`,
    url: `https://x.com/${encodeURIComponent(user.username)}`,
    title: `@${user.username}`,
    author: `@${user.username}`,
    authors: [`@${user.username}`],
    publishedAt: null,
    relevance: X_ACCOUNT_RELEVANCE,
    metadata: { authorId: user.id, username: user.username, ...cursor },
  };
}

class XSpend {
  postReads = 0;
  userReads = 0;
  runMicros = 0;
  readonly spentBeforeMicros: number;

  constructor(spentBeforeMicros: number) {
    this.spentBeforeMicros = spentBeforeMicros;
  }

  get monthMicros(): number {
    return this.spentBeforeMicros + this.runMicros;
  }

  get leftMicros(): number {
    return CAP_MICROS - this.monthMicros;
  }

  affords(micros: number): boolean {
    return micros <= this.leftMicros;
  }
}

class XCapReached extends Error {}

class XMonthEnded extends Error {}

function isoSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

type StoredCountedPost = {
  item: RecentContentItem;
  publishedAt: string;
  lastReadAt: string;
};

function storedCountedPost(item: RecentContentItem): StoredCountedPost | null {
  const lastReadAt = textValue(item.metadata.lastReadAt);
  if (
    item.relevance !== "counted" ||
    !item.publishedAt ||
    !lastReadAt ||
    item.metadata.unavailableSince
  ) {
    return null;
  }
  return { item, publishedAt: item.publishedAt, lastReadAt };
}

export const xStep: ContentStep = {
  id: "x",
  async run({ collection, runId, now, clock, signal }) {
    const config = collection.config.x;
    if (config.accounts.length === 0) {
      throw new ContentStepStop({
        status: "not_configured",
        errorCode: "x_accounts_not_configured",
        errorMessage:
          "Name the X accounts to collect with configure-content-collection's xAccounts.",
      });
    }
    if (
      !config.accounts.some((account) => account.allPosts) &&
      config.links.length === 0 &&
      config.terms.length === 0
    ) {
      throw new ContentStepStop({
        status: "not_configured",
        errorCode: "x_counting_rule_not_configured",
        errorMessage:
          "No X post can count yet: mark an account allPosts or name xLinks or xTerms with configure-content-collection.",
      });
    }
    const token = await xBearerToken();
    const fingerprint = xConfigFingerprint(config);
    const month = monthBounds(now);
    const monthName = now.toLocaleString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    const spend = new XSpend(
      Math.round(
        (await contentRunCostSince(
          collection,
          "x",
          month.start.toISOString(),
        )) * MICROS,
      ),
    );
    const recent = await listRecentContentItems(
      collection,
      "x",
      new Date(now.getTime() - RECENT_DAYS * DAY_MS).toISOString(),
    );
    const accountItems = await listContentItemsWithRelevance(
      collection,
      "x",
      X_ACCOUNT_RELEVANCE,
    );
    const readDate = utcDate(now);
    const backfillStart = new Date(now.getTime() - X_BACKFILL_DAYS * DAY_MS);
    const rule = { links: config.links, terms: config.terms };
    const fresh: ReadPost[] = [];
    const seen = new Set<string>();
    const notes: string[] = [];
    let rowCount = 0;
    let stopped: ContentRunOutcome["stopped"];
    let skippedDay30 = 0;
    let rereads = 0;
    let projection: number | null = null;

    const save = async (
      items: ContentItemInput[],
      snapshots: ContentSnapshotInput[],
    ) => {
      await saveContentRunProgress(collection, runId, "x", {
        items,
        snapshots,
        costUsd: spend.runMicros / MICROS,
        configFingerprint: fingerprint,
      });
      rowCount += snapshots.length;
    };

    const charge = (
      kind: "post" | "user",
      billed: number | null,
      worstMicros: number,
    ) => {
      const unit = kind === "post" ? POST_MICROS : USER_MICROS;
      spend.runMicros += billed === null ? worstMicros : billed * unit;
      if (kind === "post") spend.postReads += billed ?? 0;
      else spend.userReads += billed ?? 0;
    };

    const dispatch = async <T>(
      kind: "post" | "user",
      worst: number,
      request: () => Promise<T>,
      billedOf: (result: T) => number,
    ): Promise<T> => {
      const worstMicros = worst * (kind === "post" ? POST_MICROS : USER_MICROS);
      if (clock().toISOString().slice(0, 7) !== readDate.slice(0, 7)) {
        throw new XMonthEnded();
      }
      if (!spend.affords(worstMicros)) throw new XCapReached();
      const reserved = await reserveContentRunCost(collection, runId, "x", {
        costUsd: (spend.runMicros + worstMicros) / MICROS,
        since: month.start.toISOString(),
        capUsd: X_MONTHLY_CAP_USD,
        configFingerprint: fingerprint,
      });
      if (!reserved) throw new XCapReached();
      try {
        const result = await request();
        charge(kind, billedOf(result), worstMicros);
        return result;
      } catch (error) {
        charge(kind, xErrorBilled(error), worstMicros);
        throw error;
      }
    };

    try {
      const known = new Map<string, { user: XUser; cursor: XCursor }>();
      for (const item of accountItems) {
        const id = textValue(item.metadata.authorId);
        const username = textValue(item.metadata.username);
        if (id && username) {
          known.set(username.toLowerCase(), {
            user: { id, username },
            cursor: readCursor(item.metadata),
          });
        }
      }
      const unknown = config.accounts
        .map((account) => account.handle.slice(1))
        .filter((name) => !known.has(name.toLowerCase()));
      let missing: string[] = [];
      let problem: XRequestError | null = null;
      if (unknown.length > 0) {
        const lookup = await dispatch(
          "user",
          unknown.length,
          () => lookupXUsers(token, unknown, signal),
          (result) => result.returned,
        );
        for (const user of lookup.users) {
          known.set(user.username.toLowerCase(), { user, cursor: NO_CURSOR });
        }
        missing = lookup.missing;
        problem = lookup.problem;
        if (lookup.unavailable.length > 0) {
          notes.push(
            `X didn't return ${lookup.unavailable.map((name) => `@${name}`).join(", ")}, so they were skipped.`,
          );
        }
      }
      const accounts = config.accounts.flatMap((account) => {
        const entry = known.get(account.handle.slice(1).toLowerCase());
        return entry ? [{ account, ...entry }] : [];
      });
      const usersById = new Map(accounts.map(({ user }) => [user.id, user]));
      await save(
        accounts.map(({ user, cursor }) => accountItem(user, cursor)),
        [],
      );
      if (missing.length > 0) {
        throw Object.assign(
          new Error(
            `X has no account ${missing.map((name) => `@${name}`).join(", ")}. Check the collection's X accounts.`,
          ),
          { errorCode: "x_account_not_found" },
        );
      }
      if (problem) throw problem;

      for (const { account, user, cursor: saved } of accounts) {
        let cursor = saved;
        if (
          !cursor.untilId &&
          cursor.sinceAt &&
          Date.parse(cursor.sinceAt) < backfillStart.getTime()
        ) {
          cursor = NO_CURSOR;
        }
        let reopen = cursor.untilId !== null;
        for (let pages = 0; ; pages += 1) {
          if (pages === X_MAX_TIMELINE_PAGES) {
            if (cursor.untilId) {
              notes.push(
                `@${user.username} has older posts left to read; the next run reads on.`,
              );
            }
            break;
          }
          const startTime = cursor.startTime ?? isoSeconds(backfillStart);
          const range: XTimelineRange = {
            ...(cursor.sinceId ? { sinceId: cursor.sinceId } : { startTime }),
            ...(cursor.untilId ? { untilId: cursor.untilId } : {}),
          };
          const size = Math.min(
            X_PAGE_SIZE,
            Math.floor(spend.leftMicros / POST_MICROS),
          );
          if (size < X_MIN_PAGE_SIZE) throw new XCapReached();
          const page = await dispatch(
            "post",
            size,
            () => listXUserPostsPage(token, user.id, range, size, signal),
            (result) => result.returned,
          );
          const items: ContentItemInput[] = [];
          const snapshots: ContentSnapshotInput[] = [];
          for (const post of page.posts) {
            if (seen.has(post.id)) continue;
            seen.add(post.id);
            const read = {
              post,
              user,
              countedBy: xCountedBy(post, account, rule),
            };
            fresh.push(read);
            items.push(xPostItem(read, now));
            if (read.countedBy) {
              snapshots.push(...postSnapshots(post, readDate, now));
            }
          }
          const newest = page.posts.find((post) => post.id === page.newestId);
          const topId = cursor.topId ?? page.newestId;
          const topAt = cursor.topAt ?? newest?.createdAt ?? null;
          const scanned = !page.more || !page.oldestId;
          const scanCount = cursor.scanCount + page.returned;
          if (scanned && scanCount >= X_TIMELINE_POST_LIMIT) {
            const oldestAt = page.oldestAt ?? cursor.untilAt;
            notes.push(
              `X serves only an account's ${X_TIMELINE_POST_LIMIT} newest posts without replies, so @${user.username}'s posts ${oldestAt ? `older than ${day(oldestAt)} ` : ""}may not all have been read.`,
            );
          }
          cursor = scanned
            ? {
                ...NO_CURSOR,
                sinceId: topId ?? cursor.sinceId,
                sinceAt: topId ? topAt : cursor.sinceAt,
              }
            : {
                ...cursor,
                startTime: cursor.sinceId ? null : startTime,
                untilId: page.oldestId,
                untilAt: page.oldestAt,
                topId,
                topAt,
                scanCount,
              };
          await save([...items, accountItem(user, cursor)], snapshots);
          if (page.problem) throw page.problem;
          if (!scanned) continue;
          if (!reopen) break;
          reopen = false;
        }
      }

      const freshIds = new Set(fresh.map(({ post }) => post.id));
      const stored = recent.flatMap((item) => {
        const counted = storedCountedPost(item);
        return counted &&
          usersById.has(String(item.metadata.authorId)) &&
          !freshIds.has(item.externalId)
          ? [counted]
          : [];
      });
      const lately = new Map<string, boolean>();
      for (const item of recent) {
        if (
          usersById.has(String(item.metadata.authorId)) &&
          item.publishedAt &&
          Date.parse(item.publishedAt) >= backfillStart.getTime()
        ) {
          lately.set(item.externalId, item.relevance === "counted");
        }
      }
      for (const { post, countedBy } of fresh) {
        if (Date.parse(post.createdAt) >= backfillStart.getTime()) {
          lately.set(post.id, countedBy !== null);
        }
      }
      const projectionInput = {
        now,
        spentMicros: spend.monthMicros,
        countedPosts: [
          ...stored.map(({ publishedAt, lastReadAt }) => ({
            publishedAt,
            lastReadAt,
          })),
          ...fresh
            .filter(({ countedBy }) => countedBy !== null)
            .map(({ post }) => ({
              publishedAt: post.createdAt,
              lastReadAt: now.toISOString(),
            })),
        ],
        postsPerDay: lately.size / X_BACKFILL_DAYS,
        countedPerDay:
          [...lately.values()].filter(Boolean).length / X_BACKFILL_DAYS,
      };
      projection = projectXMonthSpend({
        ...projectionInput,
        includeDay30: true,
      });
      const includeDay30 = projection <= CAP_MICROS;
      if (!includeDay30) {
        projection = projectXMonthSpend({
          ...projectionInput,
          includeDay30: false,
        });
      }

      const due = stored
        .flatMap((post) => {
          const days = xCheckpointDue(post.publishedAt, post.lastReadAt, now);
          return days === null ? [] : [{ ...post, days }];
        })
        .sort((a, b) => a.days - b.days);
      const reading = due.filter(({ days }) => includeDay30 || days !== 30);
      skippedDay30 = due.length - reading.length;
      let held = 0;
      for (let start = 0; start < reading.length; start += X_PAGE_SIZE) {
        const batch = reading.slice(start, start + X_PAGE_SIZE);
        const take = batch.slice(
          0,
          Math.max(0, Math.floor(spend.leftMicros / POST_MICROS)),
        );
        if (take.length === 0) throw new XCapReached();
        const result = await dispatch(
          "post",
          take.length,
          () =>
            lookupXPosts(
              token,
              take.map(({ item }) => item.externalId),
              signal,
            ),
          (lookup) => lookup.returned,
        );
        const byId = new Map(take.map(({ item }) => [item.externalId, item]));
        const items: ContentItemInput[] = [];
        const snapshots: ContentSnapshotInput[] = [];
        for (const post of result.posts) {
          const item = byId.get(post.id);
          const user = usersById.get(String(item?.metadata.authorId));
          if (!item || !user) continue;
          rereads += 1;
          items.push(
            xPostItem(
              {
                post,
                user,
                countedBy: textValue(item.metadata.countedBy) ?? "counted",
              },
              now,
            ),
          );
          snapshots.push(...postSnapshots(post, readDate, now));
        }
        for (const id of result.gone) {
          const item = byId.get(id);
          if (!item) continue;
          items.push({
            source: "x",
            externalId: item.externalId,
            url: item.url,
            title: item.title,
            author: item.author,
            authors: item.author ? [item.author] : [],
            publishedAt: item.publishedAt,
            relevance: item.relevance,
            metadata: {
              ...item.metadata,
              unavailableSince: now.toISOString(),
            },
          });
        }
        held += result.unavailable.length;
        await save(items, snapshots);
        if (result.problem) throw result.problem;
        if (take.length < batch.length) throw new XCapReached();
      }
      if (held > 0) {
        notes.push(
          `X held back ${plural(held, "post", "posts")} due a re-read without saying ${held === 1 ? "it was" : "they were"} deleted; the next run tries again while the window is open.`,
        );
      }
    } catch (error) {
      await settleContentRunCost(runId, spend.runMicros / MICROS);
      if (error instanceof XCapReached) {
        stopped = {
          status: "cost_limited",
          errorCode: "x_monthly_cap",
          errorMessage: `Stopped before the ${dollars(CAP_MICROS)} monthly X cap: ${dollars(spend.monthMicros)} spent in ${monthName} (UTC), ${dollars(spend.runMicros)} of it in this run.`,
        };
      } else if (error instanceof XMonthEnded) {
        notes.push(
          `The UTC month ended during this run, so it stopped to keep its reads in ${monthName}; the next run reads on.`,
        );
      } else if (isXSpendingLimitError(error)) {
        stopped = {
          status: "cost_limited",
          errorCode: "x_spending_limit_reached",
          errorMessage: error instanceof Error ? error.message : String(error),
        };
      } else {
        throw error;
      }
    }

    const newCounted = fresh.filter(({ countedBy }) => countedBy !== null);
    const detail = [
      `Read ${plural(spend.postReads, "post", "posts")} and ${plural(spend.userReads, "account", "accounts")} (${dollars(spend.runMicros)}): ${newCounted.length} of ${plural(fresh.length, "new post", "new posts")} counted, ${plural(rereads, "re-read", "re-reads")}.`,
      `${monthName} (UTC): ${dollars(spend.monthMicros)} of the ${dollars(CAP_MICROS)} cap${projection === null ? "" : `; month-end projection ${dollars(projection)}`}.`,
      ...(skippedDay30 > 0
        ? [
            `Skipped ${plural(skippedDay30, "30-day re-read", "30-day re-reads")} to keep the projection under the cap.`,
          ]
        : []),
      ...notes,
    ].join(" ");
    return {
      outcome: {
        rowCount,
        windowStart: readDate,
        windowEnd: readDate,
        configFingerprint: fingerprint,
        detail,
        ...(stopped ? { stopped } : {}),
      },
    };
  },
};
