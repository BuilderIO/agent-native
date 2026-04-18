import { eq, sql, desc, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "../db/index.js";
import type { EmailTrackingStats } from "../../shared/types.js";

export type TrackingContext = {
  pixelToken: string;
  linkTokens: Map<string, string>; // url -> clickToken
  trackOpens: boolean;
  trackClicks: boolean;
  appUrl: string;
};

export function newPixelToken(): string {
  return nanoid(16);
}

export function newClickToken(): string {
  return nanoid(12);
}

const PIXEL_IMG =
  `<img alt="" width="1" height="1" ` +
  `style="width:1px;height:1px;border:0;opacity:0;display:block" src="__PIXEL_URL__" />`;

/**
 * Rewrite <a href="http(s)://..."> tags in `html` to point at the tracking
 * click endpoint. Appends a 1x1 pixel when open tracking is enabled.
 *
 * `html` is the message body's top-portion HTML (reply quotes are handled
 * separately by the caller so we never rewrite links in quoted content).
 */
export function injectTrackingIntoHtml(
  html: string,
  ctx: TrackingContext,
): string {
  let out = html;

  if (ctx.trackClicks && ctx.linkTokens.size > 0) {
    out = out.replace(
      /<a\s+([^>]*?)href="(https?:\/\/[^"]+)"([^>]*)>/gi,
      (match, pre, url, post) => {
        const token = ctx.linkTokens.get(url);
        if (!token) return match;
        const tracked = `${ctx.appUrl}/api/tracking/click/${token}`;
        return `<a ${pre}href="${tracked}"${post}>`;
      },
    );
  }

  if (ctx.trackOpens) {
    const pixelUrl = `${ctx.appUrl}/api/tracking/open/${ctx.pixelToken}`;
    const pixel = PIXEL_IMG.replace("__PIXEL_URL__", pixelUrl);
    out = out + pixel;
  }

  return out;
}

/** Collect unique http(s) URLs from a markdown body (top portion, not quoted). */
export function collectLinks(body: string): string[] {
  const urls = new Set<string>();
  const markdown = /\[[^\]]+\]\((https?:\/\/[^\s)]+)\)/g;
  const bare = /(?<!["(>])(https?:\/\/[^\s<)]+)/g;
  let m: RegExpExecArray | null;
  while ((m = markdown.exec(body))) urls.add(m[1]);
  while ((m = bare.exec(body))) urls.add(m[1]);
  return [...urls];
}

/**
 * Persist a tracking row for a freshly-sent message. Generates one pixel
 * token for the message and one click token per unique link.
 */
export async function persistTracking(opts: {
  pixelToken: string;
  messageId: string;
  ownerEmail: string;
  sentAt: number;
  linkTokens: Map<string, string>;
}): Promise<void> {
  await db.insert(schema.emailTracking).values({
    pixelToken: opts.pixelToken,
    messageId: opts.messageId,
    ownerEmail: opts.ownerEmail.toLowerCase(),
    sentAt: opts.sentAt,
    opensCount: 0,
  });
  const rows = [...opts.linkTokens.entries()].map(([url, token]) => ({
    clickToken: token,
    pixelToken: opts.pixelToken,
    url,
    clicksCount: 0,
  }));
  if (rows.length > 0) {
    await db.insert(schema.emailLinkTracking).values(rows);
  }
}

/** Record an open event for a pixel token. No-op if token is unknown. */
export async function recordOpen(
  pixelToken: string,
  userAgent: string | undefined,
): Promise<void> {
  const now = Date.now();
  await db
    .update(schema.emailTracking)
    .set({
      opensCount: sql`${schema.emailTracking.opensCount} + 1`,
      firstOpenedAt: sql`COALESCE(${schema.emailTracking.firstOpenedAt}, ${now})`,
      lastOpenedAt: now,
      lastUserAgent: userAgent ?? null,
    })
    .where(eq(schema.emailTracking.pixelToken, pixelToken));
}

/** Record a click event; returns the destination URL or null if unknown. */
export async function recordClick(clickToken: string): Promise<string | null> {
  const rows = await db
    .select()
    .from(schema.emailLinkTracking)
    .where(eq(schema.emailLinkTracking.clickToken, clickToken))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const now = Date.now();
  await db
    .update(schema.emailLinkTracking)
    .set({
      clicksCount: sql`${schema.emailLinkTracking.clicksCount} + 1`,
      firstClickedAt: sql`COALESCE(${schema.emailLinkTracking.firstClickedAt}, ${now})`,
      lastClickedAt: now,
    })
    .where(eq(schema.emailLinkTracking.clickToken, clickToken));
  return row.url;
}

/** Fetch tracking stats for a sent message (scoped to owner). */
export async function getTrackingStats(
  messageId: string,
  ownerEmail: string,
): Promise<EmailTrackingStats | null> {
  const trackingRows = await db
    .select()
    .from(schema.emailTracking)
    .where(
      and(
        eq(schema.emailTracking.messageId, messageId),
        eq(schema.emailTracking.ownerEmail, ownerEmail.toLowerCase()),
      ),
    )
    .limit(1);
  const tracking = trackingRows[0];
  if (!tracking) return null;

  const linkRows = await db
    .select()
    .from(schema.emailLinkTracking)
    .where(eq(schema.emailLinkTracking.pixelToken, tracking.pixelToken))
    .orderBy(desc(schema.emailLinkTracking.clicksCount));

  const linkClicks = linkRows.map((r) => ({
    url: r.url,
    count: r.clicksCount,
    firstClickedAt: r.firstClickedAt ?? undefined,
    lastClickedAt: r.lastClickedAt ?? undefined,
  }));
  const totalClicks = linkClicks.reduce((sum, l) => sum + l.count, 0);

  return {
    opens: tracking.opensCount,
    firstOpenedAt: tracking.firstOpenedAt ?? undefined,
    lastOpenedAt: tracking.lastOpenedAt ?? undefined,
    linkClicks,
    totalClicks,
  };
}
