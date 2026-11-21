import { z } from "zod";

/**
 * A link summary: what one app tells another about a link to one of its
 * items, asked as the signed-in reader. The owning app answers with the
 * item's title only when that reader can open it, and with the same bare
 * `unavailable` for an item that is private, missing, or not an item at all,
 * so the answer never says whether a private item exists.
 */
export const LINK_SUMMARY_APPS = ["design", "slides", "clips"] as const;
export type LinkSummaryApp = (typeof LINK_SUMMARY_APPS)[number];

export const LINK_SUMMARY_KINDS = {
  design: "design",
  slides: "deck",
  clips: "recording",
} as const satisfies Record<LinkSummaryApp, string>;
export type LinkSummaryKind = (typeof LINK_SUMMARY_KINDS)[LinkSummaryApp];

export const LINK_SUMMARY_MAX_LINKS = 20;
export const LINK_SUMMARY_TITLE_CHARS = 300;
export const LINK_SUMMARY_URL_CHARS = 2048;

export function isLinkSummaryApp(value: unknown): value is LinkSummaryApp {
  return (
    typeof value === "string" &&
    (LINK_SUMMARY_APPS as readonly string[]).includes(value)
  );
}

/** An http(s) URL without credentials, as a reader would paste it. */
export function parseLinkSummaryUrl(value: string): URL | null {
  const trimmed = value.trim();
  if (trimmed.length > LINK_SUMMARY_URL_CHARS || !URL.canParse(trimmed)) {
    return null;
  }
  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  return url;
}

export const linkSummaryRequestSchema = z.object({
  links: z
    .array(z.string().max(LINK_SUMMARY_URL_CHARS))
    .min(1)
    .max(LINK_SUMMARY_MAX_LINKS)
    .describe("Links to summarize, as the reader pasted them."),
});

export const linkSummaryAvailableSchema = z
  .object({
    status: z.literal("available"),
    app: z.enum(LINK_SUMMARY_APPS),
    kind: z.enum(["design", "deck", "recording"]),
    title: z.string().max(LINK_SUMMARY_TITLE_CHARS),
    url: z.string().max(LINK_SUMMARY_URL_CHARS),
  })
  .strict();

export const linkSummaryUnavailableSchema = z
  .object({ status: z.literal("unavailable") })
  .strict();

export const linkSummarySchema = z.discriminatedUnion("status", [
  linkSummaryAvailableSchema,
  linkSummaryUnavailableSchema,
]);

/** One answer per requested link, in the request's order. */
export const linkSummaryResultSchema = z.object({
  summaries: z.array(linkSummarySchema).max(LINK_SUMMARY_MAX_LINKS),
});

export type LinkSummaryRequest = z.infer<typeof linkSummaryRequestSchema>;
export type LinkSummary = z.infer<typeof linkSummarySchema>;
export type LinkSummaryResult = z.infer<typeof linkSummaryResultSchema>;

export const UNAVAILABLE_LINK_SUMMARY: LinkSummary = Object.freeze({
  status: "unavailable",
});

/** The item a link names inside its app. */
export interface LinkSummaryItem {
  app: LinkSummaryApp;
  id: string;
  /** The route the link opens, which some apps check access for. */
  route: string;
}

const ITEM_ID = /^[A-Za-z0-9_-]{1,128}$/;

const ITEM_ROUTES: Record<
  LinkSummaryApp,
  ReadonlyArray<{ route: string; suffix?: string }>
> = {
  design: [{ route: "design" }, { route: "present" }, { route: "visual-edit" }],
  slides: [
    { route: "deck" },
    { route: "deck", suffix: "present" },
    { route: "p" },
  ],
  clips: [{ route: "r" }, { route: "share" }, { route: "embed" }],
};

/** The item a path below an app's mount names, or null for any other page. */
export function linkSummaryItemFromPath(
  app: LinkSummaryApp,
  path: string,
): LinkSummaryItem | null {
  const segments = path.split("/").filter(Boolean);
  const [route, id, suffix, ...rest] = segments;
  if (!route || !id || rest.length > 0 || !ITEM_ID.test(id)) return null;
  const known = ITEM_ROUTES[app].some(
    (candidate) => candidate.route === route && candidate.suffix === suffix,
  );
  return known ? { app, id, route } : null;
}

/** The path of `url` below an app mounted at `basePath`, or null outside it. */
export function pathBelowAppBase(url: URL, basePath: string): string | null {
  const base = basePath.replace(/\/+$/, "");
  if (!base) return url.pathname;
  if (url.pathname === base) return "/";
  return url.pathname.startsWith(`${base}/`)
    ? url.pathname.slice(base.length)
    : null;
}

/**
 * The app and item a link names, given where each app lives: its app URLs,
 * each an origin and an optional mount path. Null for a link to any other
 * site or page.
 */
export function linkSummaryItemFromUrl(
  link: string,
  appUrls: Partial<Record<LinkSummaryApp, readonly string[]>>,
): LinkSummaryItem | null {
  const url = parseLinkSummaryUrl(link);
  if (!url) return null;
  for (const app of LINK_SUMMARY_APPS) {
    for (const appUrl of appUrls[app] ?? []) {
      const mount = parseLinkSummaryUrl(appUrl);
      if (!mount || mount.origin !== url.origin) continue;
      const path = pathBelowAppBase(url, mount.pathname);
      if (path === null) continue;
      const item = linkSummaryItemFromPath(app, path);
      if (item) return item;
    }
  }
  return null;
}
