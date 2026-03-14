// Notion API helper for content calendar database & page rendering
// Docs: https://developers.notion.com/reference/post-database-query

import fs from "fs";
import path from "path";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const CONTENT_DB_ID = "db4ae46c822443ba96e51a6a352e0fbe";
const DATA_DICTIONARY_DB_ID = "31a3d7274be580da9da7cf54909e1b7c";

// Cache for Notion data (refreshed less frequently)
let cachedEntries: ContentCalendarEntry[] | null = null;
let cachedDataDict: DataDictionaryEntry[] | null = null;
let cacheTs = 0;
let dataDictCacheTs = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Page block cache
const pageCache = new Map<string, { data: NotionPageData; ts: number }>();

function getApiKey(): string {
  const key = process.env.NOTION_API_KEY;
  if (!key) throw new Error("NOTION_API_KEY env var required");
  return key;
}

async function notionGet(path: string): Promise<unknown> {
  const res = await fetch(`${NOTION_API}${path}`, {
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
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
      Authorization: `Bearer ${getApiKey()}`,
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
      if (prop.formula?.type === "number") return String(prop.formula.number ?? "");
      if (prop.formula?.type === "date") return prop.formula.date?.start ?? "";
      return "";
    case "created_time":
      return prop.created_time ?? "";
    case "last_edited_time":
      return prop.last_edited_time ?? "";
    case "rollup":
      if (prop.rollup?.type === "number") return String(prop.rollup.number ?? "");
      if (prop.rollup?.type === "array")
        return (prop.rollup.array ?? []).map((a: any) => richTextToString(a.title ?? a.rich_text ?? [])).join(", ");
      return "";
    default:
      return "";
  }
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

export interface DataDictionaryEntry {
  id: string;
  Metric: string;
  Definition: string;
  Table: string;
  Cuts: string;
  Department: string;
  url: string;
  // AI/Technical fields
  QueryTemplate: string;
  ExampleOutput: string;
  ColumnsUsed: string;
  JoinPattern: string;
  UpdateFrequency: string;
  DataLag: string;
  Dependencies: string;
  ValidDateRange: string;
  // Business user fields
  CommonQuestions: string;
  KnownGotchas: string;
  ExampleUseCase: string;
  Owner: string;
}

// Fetch all data dictionary entries, paginating through results
export async function getDataDictionary(): Promise<DataDictionaryEntry[]> {
  if (cachedDataDict && Date.now() - dataDictCacheTs < CACHE_TTL_MS) {
    return cachedDataDict;
  }

  const entries: DataDictionaryEntry[] = [];
  let hasMore = true;
  let startCursor: string | undefined;

  while (hasMore) {
    const body: any = { page_size: 100 };
    if (startCursor) body.start_cursor = startCursor;

    const result = (await notionPost(
      `/databases/${DATA_DICTIONARY_DB_ID}/query`,
      body
    )) as any;

    for (const page of result.results ?? []) {
      const props = page.properties ?? {};
      const propNames = Object.keys(props);

      // Build a generic properties map
      const allProps: Record<string, string> = {};
      for (const name of propNames) {
        allProps[name] = extractProp(props, name);
      }

      entries.push({
        id: page.id,
        Metric: allProps["Metric"] || "",
        Definition: allProps["Definition"] || "",
        Table: allProps["Table"] || "",
        Cuts: allProps["Cuts"] || "",
        Department: allProps["Department"] || "",
        url: page.url || `https://www.notion.so/${page.id.replace(/-/g, "")}`,
        // AI/Technical fields
        QueryTemplate: allProps["Query Template"] || "",
        ExampleOutput: allProps["Example Output"] || "",
        ColumnsUsed: allProps["Columns Used"] || "",
        JoinPattern: allProps["Join Pattern"] || "",
        UpdateFrequency: allProps["Update Frequency"] || "",
        DataLag: allProps["Data Lag"] || "",
        Dependencies: allProps["Dependencies"] || "",
        ValidDateRange: allProps["Valid Date Range"] || "",
        // Business user fields
        CommonQuestions: allProps["Common Questions"] || "",
        KnownGotchas: allProps["Known Gotchas"] || "",
        ExampleUseCase: allProps["Example Use Case"] || "",
        Owner: allProps["Owner"] || "",
      });
    }

    hasMore = result.has_more ?? false;
    startCursor = result.next_cursor ?? undefined;
  }

  // Sort by Metric name alphabetically
  entries.sort((a, b) => a.Metric.localeCompare(b.Metric));

  cachedDataDict = entries;
  dataDictCacheTs = Date.now();
  return entries;
}

// Fetch all content calendar entries, paginating through results
export async function getContentCalendar(): Promise<ContentCalendarEntry[]> {
  if (cachedEntries && Date.now() - cacheTs < CACHE_TTL_MS) {
    return cachedEntries;
  }

  const entries: ContentCalendarEntry[] = [];
  let hasMore = true;
  let startCursor: string | undefined;

  while (hasMore) {
    const body: any = { page_size: 100 };
    if (startCursor) body.start_cursor = startCursor;

    const result = (await notionPost(
      `/databases/${CONTENT_DB_ID}/query`,
      body
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

  cachedEntries = entries;
  cacheTs = Date.now();
  return entries;
}

// Get database schema (property names and types)
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
        ...( block[block.type] ? { [block.type]: block[block.type] } : {}),
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
  const cached = pageCache.get(pageId);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  // Fetch page title
  const page = (await notionGet(`/pages/${pageId}`)) as any;
  const titleProp = Object.values(page.properties ?? {}).find(
    (p: any) => p.type === "title"
  ) as any;
  const title = titleProp ? richTextToString(titleProp.title) : "";

  // Fetch all blocks recursively
  const blocks = await fetchBlocks(pageId);

  const data: NotionPageData = { title, blocks };
  pageCache.set(pageId, { data, ts: Date.now() });
  return data;
}

export async function getContentCalendarSchema(): Promise<
  { name: string; type: string }[]
> {
  const db = (await notionGet(`/databases/${CONTENT_DB_ID}`)) as any;
  const props = db.properties ?? {};
  return Object.entries(props).map(([name, def]: [string, any]) => ({
    name,
    type: def.type,
  }));
}

// Sync data dictionary from Notion to a local markdown file
/**
 * Create a new entry in the Data Dictionary database.
 * Returns the newly created page ID and URL.
 */
export async function createDataDictionaryEntry(entry: {
  Metric: string;
  Definition: string;
  Table?: string;
  Department?: string;
  Owner?: string;
  QueryTemplate?: string;
  ExampleOutput?: string;
  ColumnsUsed?: string;
  JoinPattern?: string;
  UpdateFrequency?: string;
  DataLag?: string;
  Dependencies?: string;
  ValidDateRange?: string;
  CommonQuestions?: string;
  KnownGotchas?: string;
  ExampleUseCase?: string;
}): Promise<{ id: string; url: string }> {
  const properties: Record<string, any> = {
    Metric: {
      title: [{ text: { content: entry.Metric } }],
    },
  };

  // Add all optional properties if provided
  if (entry.Definition) {
    properties.Definition = {
      rich_text: [{ text: { content: entry.Definition } }],
    };
  }
  if (entry.Table) {
    properties.Table = {
      rich_text: [{ text: { content: entry.Table } }],
    };
  }
  if (entry.Department) {
    properties.Department = {
      select: { name: entry.Department },
    };
  }
  if (entry.Owner) {
    properties.Owner = {
      rich_text: [{ text: { content: entry.Owner } }],
    };
  }
  if (entry.QueryTemplate) {
    properties["Query Template"] = {
      rich_text: [{ text: { content: entry.QueryTemplate } }],
    };
  }
  if (entry.ExampleOutput) {
    properties["Example Output"] = {
      rich_text: [{ text: { content: entry.ExampleOutput } }],
    };
  }
  if (entry.ColumnsUsed) {
    properties["Columns Used"] = {
      rich_text: [{ text: { content: entry.ColumnsUsed } }],
    };
  }
  if (entry.JoinPattern) {
    properties["Join Pattern"] = {
      rich_text: [{ text: { content: entry.JoinPattern } }],
    };
  }
  if (entry.UpdateFrequency) {
    properties["Update Frequency"] = {
      rich_text: [{ text: { content: entry.UpdateFrequency } }],
    };
  }
  if (entry.DataLag) {
    properties["Data Lag"] = {
      rich_text: [{ text: { content: entry.DataLag } }],
    };
  }
  if (entry.Dependencies) {
    properties.Dependencies = {
      rich_text: [{ text: { content: entry.Dependencies } }],
    };
  }
  if (entry.ValidDateRange) {
    properties["Valid Date Range"] = {
      rich_text: [{ text: { content: entry.ValidDateRange } }],
    };
  }
  if (entry.CommonQuestions) {
    properties["Common Questions"] = {
      rich_text: [{ text: { content: entry.CommonQuestions } }],
    };
  }
  if (entry.KnownGotchas) {
    properties["Known Gotchas"] = {
      rich_text: [{ text: { content: entry.KnownGotchas } }],
    };
  }
  if (entry.ExampleUseCase) {
    properties["Example Use Case"] = {
      rich_text: [{ text: { content: entry.ExampleUseCase } }],
    };
  }

  const result = (await notionPost("/pages", {
    parent: { database_id: DATA_DICTIONARY_DB_ID },
    properties,
  })) as any;

  return {
    id: result.id,
    url: result.url || `https://www.notion.so/${result.id.replace(/-/g, "")}`,
  };
}

/**
 * Update an existing entry in the Data Dictionary database.
 * Only updates the properties that are provided.
 */
export async function updateDataDictionaryEntry(
  pageId: string,
  updates: Partial<{
    Metric: string;
    Definition: string;
    Table: string;
    Department: string;
    Owner: string;
    QueryTemplate: string;
    ExampleOutput: string;
    ColumnsUsed: string;
    JoinPattern: string;
    UpdateFrequency: string;
    DataLag: string;
    Dependencies: string;
    ValidDateRange: string;
    CommonQuestions: string;
    KnownGotchas: string;
    ExampleUseCase: string;
  }>
): Promise<void> {
  const properties: Record<string, any> = {};

  // Build properties object with only the fields that are being updated
  if (updates.Metric !== undefined) {
    properties.Metric = {
      title: [{ text: { content: updates.Metric } }],
    };
  }
  if (updates.Definition !== undefined) {
    properties.Definition = {
      rich_text: [{ text: { content: updates.Definition } }],
    };
  }
  if (updates.Table !== undefined) {
    properties.Table = {
      rich_text: [{ text: { content: updates.Table } }],
    };
  }
  if (updates.Department !== undefined) {
    properties.Department = {
      select: { name: updates.Department },
    };
  }
  if (updates.Owner !== undefined) {
    properties.Owner = {
      rich_text: [{ text: { content: updates.Owner } }],
    };
  }
  if (updates.QueryTemplate !== undefined) {
    properties["Query Template"] = {
      rich_text: [{ text: { content: updates.QueryTemplate } }],
    };
  }
  if (updates.ExampleOutput !== undefined) {
    properties["Example Output"] = {
      rich_text: [{ text: { content: updates.ExampleOutput } }],
    };
  }
  if (updates.ColumnsUsed !== undefined) {
    properties["Columns Used"] = {
      rich_text: [{ text: { content: updates.ColumnsUsed } }],
    };
  }
  if (updates.JoinPattern !== undefined) {
    properties["Join Pattern"] = {
      rich_text: [{ text: { content: updates.JoinPattern } }],
    };
  }
  if (updates.UpdateFrequency !== undefined) {
    properties["Update Frequency"] = {
      rich_text: [{ text: { content: updates.UpdateFrequency } }],
    };
  }
  if (updates.DataLag !== undefined) {
    properties["Data Lag"] = {
      rich_text: [{ text: { content: updates.DataLag } }],
    };
  }
  if (updates.Dependencies !== undefined) {
    properties.Dependencies = {
      rich_text: [{ text: { content: updates.Dependencies } }],
    };
  }
  if (updates.ValidDateRange !== undefined) {
    properties["Valid Date Range"] = {
      rich_text: [{ text: { content: updates.ValidDateRange } }],
    };
  }
  if (updates.CommonQuestions !== undefined) {
    properties["Common Questions"] = {
      rich_text: [{ text: { content: updates.CommonQuestions } }],
    };
  }
  if (updates.KnownGotchas !== undefined) {
    properties["Known Gotchas"] = {
      rich_text: [{ text: { content: updates.KnownGotchas } }],
    };
  }
  if (updates.ExampleUseCase !== undefined) {
    properties["Example Use Case"] = {
      rich_text: [{ text: { content: updates.ExampleUseCase } }],
    };
  }

  await notionPost(`/pages/${pageId}`, { properties });
}

export async function syncDataDictionary(): Promise<void> {
  const entries = await getDataDictionary();

  const lines: string[] = [
    "# Data Dictionary",
    "",
    "> **Auto-generated from Notion on server startup. Do not edit manually.**",
    `> Last synced: ${new Date().toISOString()}`,
    "",
    `Total metrics: ${entries.length}`,
    "",
    "---",
    "",
  ];

  for (const entry of entries) {
    if (!entry.Metric) continue;

    lines.push(`## ${entry.Metric}`);
    lines.push("");

    if (entry.Definition) {
      lines.push(`**Definition:** ${entry.Definition}`);
      lines.push("");
    }

    const metaLine: string[] = [];
    if (entry.Table) metaLine.push(`**Table:** \`${entry.Table}\``);
    if (entry.ColumnsUsed) metaLine.push(`**Columns:** \`${entry.ColumnsUsed}\``);
    if (metaLine.length) {
      lines.push(metaLine.join(" | "));
      lines.push("");
    }

    const contextLine: string[] = [];
    if (entry.Department) contextLine.push(`**Department:** ${entry.Department}`);
    if (entry.Owner) contextLine.push(`**Owner:** ${entry.Owner}`);
    if (entry.UpdateFrequency) contextLine.push(`**Update Frequency:** ${entry.UpdateFrequency}`);
    if (entry.DataLag) contextLine.push(`**Data Lag:** ${entry.DataLag}`);
    if (contextLine.length) {
      lines.push(contextLine.join(" | "));
      lines.push("");
    }

    if (entry.Cuts) {
      lines.push(`**Cuts/Dimensions:** ${entry.Cuts}`);
      lines.push("");
    }

    if (entry.ValidDateRange) {
      lines.push(`**Valid Date Range:** ${entry.ValidDateRange}`);
      lines.push("");
    }

    if (entry.Dependencies) {
      lines.push(`**Dependencies:** ${entry.Dependencies}`);
      lines.push("");
    }

    if (entry.QueryTemplate) {
      lines.push("### Query Template");
      lines.push("");
      lines.push("```sql");
      lines.push(entry.QueryTemplate);
      lines.push("```");
      lines.push("");
    }

    if (entry.JoinPattern) {
      lines.push("### Join Pattern");
      lines.push("");
      lines.push(entry.JoinPattern);
      lines.push("");
    }

    if (entry.ExampleOutput) {
      lines.push("### Example Output");
      lines.push("");
      lines.push(entry.ExampleOutput);
      lines.push("");
    }

    if (entry.KnownGotchas) {
      lines.push("### Known Gotchas");
      lines.push("");
      lines.push(entry.KnownGotchas);
      lines.push("");
    }

    if (entry.CommonQuestions) {
      lines.push("### Common Questions");
      lines.push("");
      lines.push(entry.CommonQuestions);
      lines.push("");
    }

    if (entry.ExampleUseCase) {
      lines.push("### Example Use Case");
      lines.push("");
      lines.push(entry.ExampleUseCase);
      lines.push("");
    }

    lines.push(`[View in Notion](${entry.url})`);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  const outPath = path.join(import.meta.dirname, "../../docs/data-dictionary.md");
  const outDir = path.dirname(outPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
}
