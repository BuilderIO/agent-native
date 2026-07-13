import { getRequestUserEmail } from "@agent-native/core/server";

import {
  getNotionConnectionForOwner,
  notionFetch,
} from "../server/lib/notion.js";
import type {
  BuilderCmsModelFieldSummary,
  DocumentPropertyValue,
} from "../shared/api.js";
import type { BuilderCmsSourceEntry } from "./_builder-cms-source-adapter.js";
import type { ContentDatabaseSourceReadResult } from "./_content-database-source-adapters.js";

const NOTION_SOURCE_PAGE_SIZE = 100;
const NOTION_SOURCE_MAX_PAGES = 5;

type NotionProperty = {
  id?: string;
  name?: string;
  type?: string;
  [key: string]: unknown;
};

type NotionPage = {
  object?: string;
  id: string;
  url?: string;
  last_edited_time?: string;
  properties?: Record<string, NotionProperty>;
};

function plainText(value: unknown): string {
  return Array.isArray(value)
    ? value
        .map((part) =>
          typeof part === "object" && part && "plain_text" in part
            ? String((part as { plain_text?: unknown }).plain_text ?? "")
            : "",
        )
        .join("")
    : "";
}

const supportedTypes = new Set([
  "title",
  "rich_text",
  "number",
  "checkbox",
  "url",
  "email",
  "phone_number",
  "date",
  "select",
  "status",
  "multi_select",
]);

function sourceFieldType(type: string) {
  if (!supportedTypes.has(type)) return `unsupported:${type || "unknown"}`;
  if (type === "rich_text" || type === "title") return "text";
  if (type === "phone_number") return "phone";
  return type;
}

function propertyValue(property: NotionProperty): DocumentPropertyValue {
  const type = property.type ?? "unknown";
  if (!supportedTypes.has(type)) {
    return `[Unsupported Notion property: ${type}]`;
  }
  if (type === "title" || type === "rich_text")
    return plainText(property[type]);
  if (type === "number")
    return typeof property.number === "number" ? property.number : null;
  if (type === "checkbox") return property.checkbox === true;
  if (type === "url" || type === "email" || type === "phone_number") {
    const value = property[type];
    return typeof value === "string" ? value : null;
  }
  if (type === "date") {
    const date = property.date as
      | { start?: unknown; end?: unknown }
      | null
      | undefined;
    return typeof date?.start === "string"
      ? {
          start: date.start,
          end: typeof date.end === "string" ? date.end : null,
          includeTime: date.start.includes("T"),
        }
      : null;
  }
  if (type === "select" || type === "status") {
    const option = property[type] as { name?: unknown } | null | undefined;
    return typeof option?.name === "string" ? option.name : null;
  }
  if (type === "multi_select") {
    return Array.isArray(property.multi_select)
      ? property.multi_select.flatMap((option) =>
          typeof option === "object" &&
          option &&
          "name" in option &&
          typeof (option as { name?: unknown }).name === "string"
            ? [(option as { name: string }).name]
            : [],
        )
      : [];
  }
  return null;
}

function titleFromProperties(properties: Record<string, NotionProperty>) {
  const title = Object.values(properties).find(
    (property) => property.type === "title",
  );
  return title ? plainText(title.title) || "Untitled" : "Untitled";
}

export async function readNotionDatabaseSource(args: {
  sourceTable: string;
  limit: number;
  offset: number;
  fullRefresh?: boolean;
}): Promise<ContentDatabaseSourceReadResult> {
  if (args.offset !== 0) {
    throw new Error(
      "Notion database sources use cursor pagination; numeric offsets are not supported.",
    );
  }
  const userEmail = getRequestUserEmail();
  if (!userEmail)
    throw new Error("Notion database access requires a signed-in user.");
  const connection = await getNotionConnectionForOwner(userEmail);
  if (!connection)
    throw new Error("Connect Notion before attaching a Notion database.");

  const dataSource = await notionFetch<{
    id: string;
    title?: Array<{ plain_text?: string }>;
    properties?: Record<string, NotionProperty>;
  }>(
    `/data_sources/${encodeURIComponent(args.sourceTable)}`,
    connection.accessToken,
  );
  const fields: BuilderCmsModelFieldSummary[] = Object.entries(
    dataSource.properties ?? {},
  ).map(([name, property]) => ({
    name: property.id || name,
    label: property.name || name,
    type: sourceFieldType(property.type ?? "unknown"),
    required: false,
  }));

  const entries: BuilderCmsSourceEntry[] = [];
  let cursor: string | undefined;
  let hasMore = false;
  const maxPages = args.fullRefresh ? NOTION_SOURCE_MAX_PAGES : 1;
  for (let page = 0; page < maxPages; page++) {
    const response = await notionFetch<{
      results?: NotionPage[];
      has_more?: boolean;
      next_cursor?: string | null;
    }>(
      `/data_sources/${encodeURIComponent(args.sourceTable)}/query`,
      connection.accessToken,
      {
        method: "POST",
        body: JSON.stringify({
          page_size: Math.min(NOTION_SOURCE_PAGE_SIZE, args.limit),
          ...(cursor ? { start_cursor: cursor } : {}),
        }),
      },
    );
    for (const result of response.results ?? []) {
      if (result.object && result.object !== "page") continue;
      const properties = result.properties ?? {};
      entries.push({
        id: result.id,
        model: args.sourceTable,
        title: titleFromProperties(properties),
        urlPath: result.url ?? "",
        updatedAt: result.last_edited_time ?? "",
        sourceValues: Object.fromEntries(
          Object.entries(properties).map(([name, property]) => [
            property.id || name,
            propertyValue(property),
          ]),
        ),
      });
    }
    hasMore = response.has_more === true && !!response.next_cursor;
    cursor = response.next_cursor ?? undefined;
    if (!hasMore || entries.length >= args.limit) break;
  }

  const fetchedAt = new Date().toISOString();
  return {
    state: "live",
    entries: entries.slice(0, args.limit),
    fields,
    fetchedAt,
    message: hasMore
      ? `Loaded a bounded Notion snapshot; more rows remain after cursor ${cursor ? "present" : "missing"}.`
      : null,
    metadata: {
      provider: "notion",
      dataSourceId: dataSource.id,
      dataSourceName: plainText(dataSource.title) || "Notion database",
      hasMore,
      nextCursor: cursor ?? null,
      fetchedRowCount: Math.min(entries.length, args.limit),
      unsupportedPropertyCount: fields.filter((field) =>
        field.type.startsWith("unsupported:"),
      ).length,
    },
  };
}
