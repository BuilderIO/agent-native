import {
  credentialCacheScope,
  requireRequestCredentialContext,
  scopedCredentialCacheKey,
} from "./credentials-context";
import { resolveAnalyticsProviderCredential } from "./provider-credentials";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const CONTENT_DATABASE_REQUIRED_PROPERTIES = [
  "Topic",
  "Status",
  "Publish Date",
] as const;
const MAX_DATABASE_DISCOVERY_PAGES = 10;

// Cache for Notion data (refreshed less frequently)
const contentCalendarCache = new Map<
  string,
  { entries: ContentCalendarEntry[]; ts: number }
>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const contentDatabaseCache = new Map<
  string,
  { databaseId: string; ts: number }
>();

// Page block cache
const pageCache = new Map<string, { data: NotionPageData; ts: number }>();

async function getApiKey(): Promise<string> {
  const ctx = requireRequestCredentialContext("NOTION_API_KEY");
  const credential = await resolveAnalyticsProviderCredential({
    provider: "notion",
    keys: ["NOTION_API_KEY"],
    ctx,
  });
  if (!credential) throw new Error("NOTION_API_KEY not configured");
  return credential.value;
}

async function notionGet(path: string): Promise<unknown> {
  const res = await fetch(`${NOTION_API}${path}`, {
    headers: {
      Authorization: `Bearer ${await getApiKey()}`,
      "Notion-Version": NOTION_VERSION,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function notionPost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${NOTION_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await getApiKey()}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion API error ${res.status}: ${text}`);
  }
  return res.json();
}

// Extract plain text from a Notion rich_text array
function richTextToString(rt: any[]): string {
  if (!rt || !Array.isArray(rt)) return "";
  return rt.map((t: any) => t.plain_text ?? "").join("");
}

// Extract property value from Notion page properties
function extractProp(props: any, name: string): string {
  const prop = props[name];
  if (!prop) return "";

  switch (prop.type) {
    case "title":
      return richTextToString(prop.title);
    case "rich_text":
      return richTextToString(prop.rich_text);
    case "select":
      return prop.select?.name ?? "";
    case "multi_select":
      return (prop.multi_select ?? []).map((s: any) => s.name).join(", ");
    case "date":
      return prop.date?.start ?? "";
    case "url":
      return prop.url ?? "";
    case "number":
      return prop.number != null ? String(prop.number) : "";
    case "checkbox":
      return prop.checkbox ? "true" : "false";
    case "status":
      return prop.status?.name ?? "";
    case "people":
      return (prop.people ?? []).map((p: any) => p.name ?? p.id).join(", ");
    case "formula":
      if (prop.formula?.type === "string") return prop.formula.string ?? "";
      if (prop.formula?.type === "number")
        return String(prop.formula.number ?? "");
      if (prop.formula?.type === "date") return prop.formula.date?.start ?? "";
      return "";
    case "created_time":
      return prop.created_time ?? "";
    case "last_edited_time":
      return prop.last_edited_time ?? "";
    case "rollup":
      if (prop.rollup?.type === "number")
        return String(prop.rollup.number ?? "");
      if (prop.rollup?.type === "array")
        return (prop.rollup.array ?? [])
          .map((a: any) => richTextToString(a.title ?? a.rich_text ?? []))
          .join(", ");
      return "";
    default:
      return "";
  }
}

async function resolveContentDatabaseId(
  requestedDatabaseId?: string,
): Promise<string> {
  const requested = requestedDatabaseId?.trim();
  if (requested) return requested;

  const scope = credentialCacheScope("NOTION_API_KEY");
  const cached = contentDatabaseCache.get(scope);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.databaseId;
  }

  const candidates: Array<{ id: string; score: number }> = [];
  let startCursor: string | undefined;
  for (let page = 0; page < MAX_DATABASE_DISCOVERY_PAGES; page += 1) {
    const result = (await notionPost("/search", {
      filter: { property: "object", value: "database" },
      page_size: 100,
      ...(startCursor ? { start_cursor: startCursor } : {}),
    })) as any;

    for (const database of result.results ?? []) {
      const properties = database.properties ?? {};
      if (
        !CONTENT_DATABASE_REQUIRED_PROPERTIES.every(
          (name) => name in properties,
        )
      ) {
        continue;
      }
      const title = richTextToString(database.title ?? []).toLowerCase();
      const titleScore = /content/.test(title) ? 2 : 0;
      const calendarScore = /calendar/.test(title) ? 1 : 0;
      candidates.push({ id: database.id, score: titleScore + calendarScore });
    }

    startCursor = result.next_cursor ?? undefined;
    if (!result.has_more || !startCursor) break;
  }

  candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const best = candidates[0];
  if (!best) {
    throw new Error(
      "No accessible Notion database has the required Topic, Status, and Publish Date properties. Pass databaseId explicitly or share the content calendar database with the integration.",
    );
  }
  if (candidates[1]?.score === best.score) {
    throw new Error(
      "Multiple Notion databases match the content calendar schema. Pass databaseId explicitly to choose one.",
    );
  }

  contentDatabaseCache.set(scope, {
    databaseId: best.id,
    ts: Date.now(),
  });
  return best.id;
}

export interface ContentCalendarEntry {
  id: string;
  title: string;
  status: string;
  author: string;
  publishDate: string;
  url: string;
  handle: string;
  type: string;
  seoKeyword: string;
  msv: number | null;
  priority: string;
  objective: string;
  contentPillar: string;
  persona: string;
  properties: Record<string, string>;
}

// Fetch all content calendar entries, paginating through results
export async function getContentCalendar(
  requestedDatabaseId?: string,
): Promise<ContentCalendarEntry[]> {
  const databaseId = await resolveContentDatabaseId(requestedDatabaseId);
  const calendarCacheKey = `${credentialCacheScope("NOTION_API_KEY")}:${databaseId}`;
  const cached = contentCalendarCache.get(calendarCacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.entries;
  }

  const entries: ContentCalendarEntry[] = [];
  let hasMore = true;
  let startCursor: string | undefined;

  while (hasMore) {
    const body: any = { page_size: 100 };
    if (startCursor) body.start_cursor = startCursor;

    const result = (await notionPost(
      `/databases/${encodeURIComponent(databaseId)}/query`,
      body,
    )) as any;

    for (const page of result.results ?? []) {
      const props = page.properties ?? {};
      const propNames = Object.keys(props);

      // Build a generic properties map
      const allProps: Record<string, string> = {};
      for (const name of propNames) {
        allProps[name] = extractProp(props, name);
      }

      // Map to known Notion property names for this database
      const title = allProps["Topic"] || "";
      const status = allProps["Status"] || "";
      const author = allProps["Owner"] || "";
      const publishDate = allProps["Publish Date"] || "";
      const url = allProps["Published URL"] || "";
      const seoKeyword = allProps["SEO Keyword"] || "";
      const msvRaw = props["MSV"]?.number;
      const msv = msvRaw != null ? msvRaw : null;

      // Extract blog handle from URL if available
      const handleMatch = url.match(/\/blog\/([^/?#]+)/);
      const handle = handleMatch?.[1] ?? "";

      entries.push({
        id: page.id,
        title,
        status,
        author,
        publishDate,
        url,
        handle,
        type: allProps["Type"] || "",
        seoKeyword,
        msv,
        priority: allProps["Priority"] || "",
        objective: allProps["Objective"] || "",
        contentPillar: allProps["Content Pillar"] || "",
        persona: allProps["Persona"] || "",
        properties: allProps,
      });
    }

    hasMore = result.has_more ?? false;
    startCursor = result.next_cursor ?? undefined;
  }

  contentCalendarCache.set(calendarCacheKey, { entries, ts: Date.now() });
  return entries;
}

// --- Page block fetching ---

export interface RichText {
  type: string;
  plain_text: string;
  href: string | null;
  annotations: {
    bold: boolean;
    italic: boolean;
    strikethrough: boolean;
    underline: boolean;
    code: boolean;
    color: string;
  };
}

export interface NotionBlock {
  id: string;
  type: string;
  has_children: boolean;
  children?: NotionBlock[];
  [key: string]: any;
}

export interface NotionPageData {
  title: string;
  blocks: NotionBlock[];
}

async function fetchBlocks(blockId: string): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = [];
  let hasMore = true;
  let startCursor: string | undefined;

  while (hasMore) {
    const url = startCursor
      ? `/blocks/${blockId}/children?page_size=100&start_cursor=${startCursor}`
      : `/blocks/${blockId}/children?page_size=100`;
    const result = (await notionGet(url)) as any;

    for (const block of result.results ?? []) {
      const b: NotionBlock = {
        id: block.id,
        type: block.type,
        has_children: block.has_children,
        ...(block[block.type] ? { [block.type]: block[block.type] } : {}),
      };

      if (b.has_children) {
        b.children = await fetchBlocks(block.id);
      }

      blocks.push(b);
    }

    hasMore = result.has_more ?? false;
    startCursor = result.next_cursor ?? undefined;
  }

  return blocks;
}

export async function getNotionPage(pageId: string): Promise<NotionPageData> {
  const cacheKey = scopedCredentialCacheKey(pageId, "NOTION_API_KEY");
  const cached = pageCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  // Fetch page title
  const page = (await notionGet(`/pages/${pageId}`)) as any;
  const titleProp = Object.values(page.properties ?? {}).find(
    (p: any) => p.type === "title",
  ) as any;
  const title = titleProp ? richTextToString(titleProp.title) : "";

  // Fetch all blocks recursively
  const blocks = await fetchBlocks(pageId);

  const data: NotionPageData = { title, blocks };
  pageCache.set(cacheKey, { data, ts: Date.now() });
  return data;
}

export async function getContentCalendarSchema(
  requestedDatabaseId?: string,
): Promise<{ name: string; type: string }[]> {
  const databaseId = await resolveContentDatabaseId(requestedDatabaseId);
  const db = (await notionGet(
    `/databases/${encodeURIComponent(databaseId)}`,
  )) as any;
  const props = db.properties ?? {};
  return Object.entries(props).map(([name, def]: [string, any]) => ({
    name,
    type: def.type,
  }));
}
