import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  getOrgSetting,
  getUserSetting,
  putOrgSetting,
  putUserSetting,
} from "@agent-native/core/settings";

const KEY_PREFIX = "data-dict-";
const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function richTextToString(rt: unknown): string {
  if (!Array.isArray(rt)) return "";
  return rt
    .map((t) => (t as { plain_text?: string })?.plain_text ?? "")
    .join("");
}

function extractProp(props: Record<string, unknown>, name: string): string {
  const prop = props[name] as { type?: string } & Record<string, unknown>;
  if (!prop) return "";
  switch (prop.type) {
    case "title":
      return richTextToString(prop.title);
    case "rich_text":
      return richTextToString(prop.rich_text);
    case "select":
      return (prop.select as { name?: string } | null)?.name ?? "";
    case "multi_select":
      return ((prop.multi_select as Array<{ name?: string }>) ?? [])
        .map((o) => o.name ?? "")
        .filter(Boolean)
        .join(", ");
    case "checkbox":
      return prop.checkbox ? "true" : "false";
    case "people":
      return ((prop.people as Array<{ name?: string }>) ?? [])
        .map((p) => p.name ?? "")
        .filter(Boolean)
        .join(", ");
    case "url":
      return String(prop.url ?? "");
    case "email":
      return String(prop.email ?? "");
    default:
      return "";
  }
}

export default defineAction({
  description:
    "One-time migration: pull data dictionary entries from a Notion database and save them into the analytics app's data dictionary for the current user/org. Requires `NOTION_API_KEY`. Only imports entries marked `Approved` unless `includeUnapproved=true`.",
  schema: z.object({
    databaseId: z
      .string()
      .default("31a3d7274be580da9da7cf54909e1b7c")
      .describe("Notion database ID to pull from"),
    includeUnapproved: z
      .boolean()
      .optional()
      .describe("If true, import entries regardless of Approved checkbox"),
    overwrite: z
      .boolean()
      .optional()
      .describe(
        "If true, overwrite existing entries with the same id. Default: skip existing.",
      ),
  }),
  run: async (args) => {
    const apiKey = process.env.NOTION_API_KEY;
    if (!apiKey) {
      return "Error: NOTION_API_KEY env var not set. Add it to .env and try again.";
    }
    const orgId = process.env.AGENT_ORG_ID || null;
    const email = process.env.AGENT_USER_EMAIL || "local@localhost";

    let imported = 0;
    let skipped = 0;
    let unapproved = 0;
    let hasMore = true;
    let startCursor: string | undefined;

    while (hasMore) {
      const body: Record<string, unknown> = { page_size: 100 };
      if (startCursor) body.start_cursor = startCursor;

      const res = await fetch(
        `${NOTION_API}/databases/${args.databaseId}/query`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const text = await res.text();
        return `Error: Notion API ${res.status}: ${text}`;
      }
      const data = (await res.json()) as {
        results?: Array<{
          id: string;
          url?: string;
          properties?: Record<string, unknown>;
        }>;
        has_more?: boolean;
        next_cursor?: string | null;
      };

      for (const page of data.results ?? []) {
        const props = page.properties ?? {};
        const approved = extractProp(props, "Approved") === "true";
        if (!approved && !args.includeUnapproved) {
          unapproved++;
          continue;
        }
        const metric = extractProp(props, "Metric");
        if (!metric) {
          skipped++;
          continue;
        }

        const id = slugify(metric);
        const key = `${KEY_PREFIX}${id}`;

        if (!args.overwrite) {
          let existing: Record<string, unknown> | null = null;
          try {
            existing = orgId
              ? await getOrgSetting(orgId, key)
              : await getUserSetting(email, key);
          } catch {}
          if (existing) {
            skipped++;
            continue;
          }
        }

        const now = new Date().toISOString();
        const entry: Record<string, unknown> = {
          id,
          metric,
          definition: extractProp(props, "Definition"),
          department: extractProp(props, "Department"),
          table: extractProp(props, "Table"),
          columnsUsed: extractProp(props, "Columns Used"),
          cuts: extractProp(props, "Cuts"),
          queryTemplate: extractProp(props, "Query Template"),
          exampleOutput: extractProp(props, "Example Output"),
          joinPattern: extractProp(props, "Join Pattern"),
          updateFrequency: extractProp(props, "Update Frequency"),
          dataLag: extractProp(props, "Data Lag"),
          dependencies: extractProp(props, "Dependencies"),
          validDateRange: extractProp(props, "Valid Date Range"),
          commonQuestions: extractProp(props, "Common Questions"),
          knownGotchas: extractProp(props, "Known Gotchas"),
          exampleUseCase: extractProp(props, "Example Use Case"),
          owner: extractProp(props, "Owner"),
          approved,
          aiGenerated: extractProp(props, "AI Generated") === "true",
          sourceUrl:
            page.url || `https://www.notion.so/${page.id.replace(/-/g, "")}`,
          createdAt: now,
          updatedAt: now,
          author: email,
        };

        if (orgId) {
          await putOrgSetting(orgId, key, entry);
        } else {
          await putUserSetting(email, key, entry);
        }
        imported++;
      }

      hasMore = data.has_more ?? false;
      startCursor = data.next_cursor ?? undefined;
    }

    return {
      imported,
      skipped,
      unapproved,
      scope: orgId ? `org:${orgId}` : `user:${email}`,
      message: `Imported ${imported} entries from Notion (${skipped} already existed, ${unapproved} unapproved).`,
    };
  },
});
