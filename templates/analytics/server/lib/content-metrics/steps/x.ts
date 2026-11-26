import {
  isXSpendingLimitError,
  listXUserPostsPage,
  lookupXPosts,
  lookupXUsers,
  X_PAGE_SIZE,
  X_POST_READ_USD,
  X_USER_READ_USD,
  xBearerToken,
  type XPost,
  type XTimelineStart,
  type XUser,
} from "../../x-api.js";
import {
  X_MONTHLY_CAP_USD,
  xConfigFingerprint,
  type XAccount,
} from "../config.js";
import { ContentStepStop, type ContentStep } from "../step.js";
import {
  contentRunCostSince,
  listRecentContentItems,
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
  const name = handle.slice(1).toLowerCase();
  return post.links.some((link) =>
    [link.expandedUrl, link.unwoundUrl].some((href) => {
      const parsed = href ? hostAndPath(href) : null;
      if (!parsed) return false;
      const host = parsed.host.replace(/^(?:www|mobile)\./, "");
      return (
        (host === "x.com" || host === "twitter.com") &&
        parsed.path.split("/")[1] === name
      );
    }),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function xTermMatches(text: string, term: string): boolean {
  const anyCase = term.startsWith("@") || term.includes(".");
  const pattern = new RegExp(
    `(?<![A-Za-z0-9_@])${escapeRegExp(term)}(?![A-Za-z0-9_])`,
    anyCase ? "i" : "",
  );
  return pattern.test(text);
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
      (term.startsWith("@") && linksToProfile(post, term))
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
  lookupsPerDay: number;
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
    future +=
      (input.postsPerDay + input.countedPerDay * rereads) * POST_MICROS +
      input.lookupsPerDay * USER_MICROS;
  }
  return Math.round(input.spentMicros + reads * POST_MICROS + future);
}

function newerId(a: string | null, b: string): string {
  if (a === null) return b;
  if (a.length !== b.length) return a.length > b.length ? a : b;
  return a > b ? a : b;
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

export function xPostItem(
  read: ReadPost,
  now: Date,
  extra: Record<string, unknown> = {},
): ContentItemInput {
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
      ...extra,
    },
  };
}

class XSpend {
  postReads = 0;
  userReads = 0;
  readonly spentBeforeMicros: number;

  constructor(spentBeforeMicros: number) {
    this.spentBeforeMicros = spentBeforeMicros;
  }

  get runMicros(): number {
    return this.postReads * POST_MICROS + this.userReads * USER_MICROS;
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

function timelineStart(sinceId: string | null, now: Date): XTimelineStart {
  if (sinceId) return { sinceId };
  return {
    startTime: new Date(now.getTime() - X_BACKFILL_DAYS * DAY_MS)
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z"),
  };
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
  async run({ collection, now, signal }) {
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
    const month = monthBounds(now);
    const spentBefore = await contentRunCostSince(
      collection,
      "x",
      month.start.toISOString(),
    );
    const spend = new XSpend(Math.round(spentBefore * MICROS));
    const recent = await listRecentContentItems(
      collection,
      "x",
      new Date(now.getTime() - RECENT_DAYS * DAY_MS).toISOString(),
    );
    const readDate = utcDate(now);
    const rule = { links: config.links, terms: config.terms };
    const items: ContentItemInput[] = [];
    const snapshots: ContentSnapshotInput[] = [];
    const fresh: ReadPost[] = [];
    let stopped: ContentRunOutcome["stopped"];
    let skippedDay30 = 0;
    let rereads = 0;
    let projection: number | null = null;

    try {
      const known = new Map<string, XUser>();
      for (const item of recent) {
        const id = textValue(item.metadata.authorId);
        const username = textValue(item.metadata.username);
        if (id && username) {
          known.set(username.toLowerCase(), { id, username, name: username });
        }
      }
      const unknown = config.accounts
        .map((account) => account.handle.slice(1))
        .filter((name) => !known.has(name.toLowerCase()));
      if (unknown.length > 0) {
        if (!spend.affords(unknown.length * USER_MICROS)) {
          throw new XCapReached();
        }
        const lookup = await lookupXUsers(token, unknown, signal);
        spend.userReads += lookup.users.length;
        for (const user of lookup.users) {
          known.set(user.username.toLowerCase(), user);
        }
        if (lookup.missing.length > 0) {
          throw Object.assign(
            new Error(
              `X has no account ${lookup.missing.map((name) => `@${name}`).join(", ")}. Check the collection's X accounts.`,
            ),
            { errorCode: "x_account_not_found" },
          );
        }
      }
      const accounts = config.accounts.flatMap((account) => {
        const user = known.get(account.handle.slice(1).toLowerCase());
        return user ? [{ account, user }] : [];
      });
      const usersById = new Map(accounts.map(({ user }) => [user.id, user]));

      for (const { account, user } of accounts) {
        let sinceId: string | null = null;
        for (const item of recent) {
          if (item.metadata.authorId === user.id) {
            sinceId = newerId(sinceId, item.externalId);
          }
        }
        const start = timelineStart(sinceId, now);
        const posts: XPost[] = [];
        let pageToken: string | undefined;
        for (let page = 0; page < X_MAX_TIMELINE_PAGES; page += 1) {
          if (!spend.affords(X_PAGE_SIZE * POST_MICROS)) {
            throw new XCapReached();
          }
          const result = await listXUserPostsPage(
            token,
            user.id,
            start,
            pageToken,
            signal,
          );
          spend.postReads += result.returned;
          posts.push(...result.posts);
          if (!result.nextToken) break;
          pageToken = result.nextToken;
        }
        for (const post of posts) {
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
      const windowStart = now.getTime() - X_BACKFILL_DAYS * DAY_MS;
      const lately = new Map<string, boolean>();
      for (const item of recent) {
        if (
          usersById.has(String(item.metadata.authorId)) &&
          item.publishedAt &&
          Date.parse(item.publishedAt) >= windowStart
        ) {
          lately.set(item.externalId, item.relevance === "counted");
        }
      }
      for (const { post, countedBy } of fresh) {
        if (Date.parse(post.createdAt) >= windowStart) {
          lately.set(post.id, countedBy !== null);
        }
      }
      const postedBy = new Set([
        ...recent.map((item) => String(item.metadata.authorId)),
        ...fresh.map(({ user }) => user.id),
      ]);
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
        lookupsPerDay: accounts.filter(({ user }) => !postedBy.has(user.id))
          .length,
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
      for (let start = 0; start < reading.length; start += X_PAGE_SIZE) {
        const batch = reading.slice(start, start + X_PAGE_SIZE);
        const take = batch.slice(
          0,
          Math.max(0, Math.floor(spend.leftMicros / POST_MICROS)),
        );
        if (take.length > 0) {
          const result = await lookupXPosts(
            token,
            take.map(({ item }) => item.externalId),
            signal,
          );
          spend.postReads += result.returned;
          const byId = new Map(take.map(({ item }) => [item.externalId, item]));
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
          for (const id of result.missing) {
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
        }
        if (take.length < batch.length) throw new XCapReached();
      }
    } catch (error) {
      if (error instanceof XCapReached) {
        stopped = {
          status: "cost_limited",
          errorCode: "x_monthly_cap",
          errorMessage: `Stopped before the ${dollars(CAP_MICROS)} monthly X cap: ${dollars(spend.monthMicros)} spent this month, ${dollars(spend.runMicros)} of it in this run.`,
        };
      } else if (isXSpendingLimitError(error)) {
        stopped = {
          status: "cost_limited",
          errorCode: "x_spending_limit_reached",
          errorMessage: error instanceof Error ? error.message : String(error),
        };
      } else {
        if (error instanceof Error) {
          Object.assign(error, { costUsd: spend.runMicros / MICROS });
        }
        throw error;
      }
    }

    const newCounted = fresh.filter(({ countedBy }) => countedBy !== null);
    const detail = [
      `Read ${plural(spend.postReads, "post", "posts")} and ${plural(spend.userReads, "account", "accounts")} (${dollars(spend.runMicros)}): ${newCounted.length} of ${plural(fresh.length, "new post", "new posts")} counted, ${plural(rereads, "re-read", "re-reads")}.`,
      `This month: ${dollars(spend.monthMicros)} of the ${dollars(CAP_MICROS)} cap${projection === null ? "" : `; month-end projection ${dollars(projection)}`}.`,
      ...(skippedDay30 > 0
        ? [
            `Skipped ${plural(skippedDay30, "30-day re-read", "30-day re-reads")} to keep the projection under the cap.`,
          ]
        : []),
    ].join(" ");
    return {
      items,
      snapshots,
      outcome: {
        rowCount: snapshots.length,
        windowStart: readDate,
        windowEnd: readDate,
        configFingerprint: xConfigFingerprint(config),
        costUsd: spend.runMicros / MICROS,
        detail,
        ...(stopped ? { stopped } : {}),
      },
    };
  },
};
