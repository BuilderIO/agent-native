import { z } from "zod";
import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { eq, isNull } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";

const SourceSchema = z.object({
  type: z.enum(["github", "dbt", "notion", "other"]),
  title: z.string(),
  url: z.string().optional(),
  repo: z.string().optional(),
  excerpt: z.string().optional(),
});

export type Source = z.infer<typeof SourceSchema>;

function buildSearchQuery(question: string): string {
  const modelNames: string[] = question.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [];
  if (modelNames.length > 0) {
    return modelNames.sort((a, b) => b.length - a.length)[0];
  }
  const stopWords =
    /^(does|have|what|where|when|which|that|this|with|from|into|find|show|tell|about|like|used|being|there|their|they)$/i;
  return question
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 3 && !stopWords.test(t))
    .slice(0, 4)
    .join(" ");
}

async function searchGitHub(
  question: string,
  token: string | undefined,
): Promise<Source[]> {
  if (!token) return [];
  const query = buildSearchQuery(question);
  if (!query) return [];

  const makeRequest = (q: string) =>
    fetch(
      `https://api.github.com/search/code?q=${encodeURIComponent(q)}&per_page=5`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3.text-match+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );

  type GHItem = {
    path: string;
    html_url: string;
    repository: { full_name: string };
    text_matches?: Array<{ fragment: string }>;
  };

  try {
    const [contentRes, filenameRes] = await Promise.all([
      makeRequest(query),
      makeRequest(`filename:${query}`),
    ]);
    const parse = async (res: Response): Promise<GHItem[]> => {
      if (!res.ok) return [];
      const d = (await res.json()) as { items?: GHItem[] };
      return d.items ?? [];
    };
    const [contentItems, filenameItems] = await Promise.all([
      parse(contentRes),
      parse(filenameRes),
    ]);
    const seen = new Set<string>();
    return [...filenameItems, ...contentItems]
      .filter((item) => {
        if (seen.has(item.html_url)) return false;
        seen.add(item.html_url);
        return true;
      })
      .slice(0, 6)
      .map((item) => ({
        type: "github" as const,
        title: item.path,
        repo: item.repository.full_name,
        url: item.html_url,
        excerpt: item.text_matches?.[0]?.fragment?.slice(0, 200) ?? "",
      }));
  } catch {
    return [];
  }
}

async function fetchDashboardCatalog(): Promise<Source[]> {
  try {
    const db = getDb();
    const queryPromise = db
      .select({
        id: schema.dashboards.id,
        title: schema.dashboards.title,
        kind: schema.dashboards.kind,
      })
      .from(schema.dashboards)
      .where(isNull(schema.dashboards.archivedAt));

    const rows = await Promise.race([
      queryPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000),
      ),
    ]);

    if (!rows || rows.length === 0) return [];

    const list = rows
      .map((r) => `- ${r.title} (id: ${r.id}, type: ${r.kind})`)
      .join("\n");

    return [
      {
        type: "other" as const,
        title: "Available Dashboards Catalog",
        excerpt: `The following dashboards exist in the app:\n${list}`,
      },
    ];
  } catch {
    return [];
  }
}

export default defineAction({
  description:
    "Search internal sources for a question and create a Knowledge Q&A session.",
  schema: z.object({
    question: z.string(),
    followUpSessionId: z.string().optional(),
  }),
  http: { method: "POST" },
  run: async ({ question, followUpSessionId }) => {
    const db = getDb();
    const id = crypto.randomUUID();
    const userEmail = getRequestUserEmail() ?? null;

    await db
      .insert(schema.askSessions)
      .values({ id, question, status: "searching", userEmail });

    const sigmaKnownWorkbooks: Source = {
      type: "other" as const,
      title: "Known Sigma Workbooks Registry",
      excerpt: [
        "The following Sigma workbooks are known resources. Search Sigma by workbook name to locate them, then describe to inspect sheets/columns.",
        "",
        "- Enterprise Contract Terms and Details",
        "  Covers: contract details, enterprise tier, case study opt-in status, CSM assignments, opt-in/consent flags, customer references",
      ].join("\n"),
    };

    const [ghSources, dashboardSources] = await Promise.all([
      searchGitHub(question, process.env.GITHUB_TOKEN),
      fetchDashboardCatalog(),
    ]);

    const allSources = [...dashboardSources, sigmaKnownWorkbooks, ...ghSources];

    await db
      .update(schema.askSessions)
      .set({ sourcesJson: JSON.stringify(allSources), status: "generating" })
      .where(eq(schema.askSessions.id, id));

    return {
      sessionId: id,
      sources: allSources,
      followUpSessionId: followUpSessionId ?? null,
    };
  },
});
