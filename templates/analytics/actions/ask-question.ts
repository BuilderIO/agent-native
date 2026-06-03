import { z } from "zod";
import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { eq, isNull } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { tryRequestCredentialContext } from "../server/lib/credentials-context.js";
import { getGitHubAccessToken } from "../server/lib/github-oauth.js";

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

// --- Sigma workbook catalog (fetched from Sigma REST API, cached in memory) ---

interface SigmaWorkbookEntry {
  name: string;
  workbookId: string;
  description?: string;
}

let sigmaCache: { source: Source; fetchedAt: number } | null = null;
const SIGMA_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function getSigmaToken(): Promise<string> {
  const clientId = process.env.SIGMA_CLIENT_ID;
  const clientSecret = process.env.SIGMA_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Sigma credentials not set");

  const res = await fetch("https://aws-api.sigmacomputing.com/v2/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`Sigma token error: ${res.status}`);
  const { access_token } = (await res.json()) as { access_token: string };
  return access_token;
}

async function fetchSigmaWorkbookCatalog(): Promise<Source[]> {
  if (sigmaCache && Date.now() - sigmaCache.fetchedAt < SIGMA_CACHE_TTL_MS) {
    return [sigmaCache.source];
  }

  try {
    const token = await getSigmaToken();
    const workbooks: SigmaWorkbookEntry[] = [];
    let nextPage: string | undefined;

    do {
      const url = new URL("https://aws-api.sigmacomputing.com/v2/workbooks");
      url.searchParams.set("limit", "100");
      if (nextPage) url.searchParams.set("page", nextPage);

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) break;

      const data = (await res.json()) as {
        entries: SigmaWorkbookEntry[];
        nextPage?: string;
      };
      workbooks.push(...data.entries);
      nextPage = data.nextPage;
    } while (nextPage && workbooks.length < 500);

    if (workbooks.length === 0) return [];

    const list = workbooks
      .map((w) => {
        const desc = w.description ? ` — ${w.description}` : "";
        return `- ${w.name} (id: ${w.workbookId})${desc}`;
      })
      .join("\n");

    const source: Source = {
      type: "other" as const,
      title: "Sigma Workbooks Catalog",
      excerpt:
        `The organization has ${workbooks.length} Sigma workbooks. ` +
        `Use Sigma MCP (begin_session → search by workbook name → describe) to inspect pages and columns for the most relevant one.\n\n` +
        list,
    };

    sigmaCache = { source, fetchedAt: Date.now() };
    return [source];
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

    const [ghSources, dashboardSources, sigmaSources] = await Promise.all([
      (async () => {
        const ctx = tryRequestCredentialContext();
        const token = ctx
          ? ((await getGitHubAccessToken(ctx)).token ?? undefined)
          : undefined;
        return searchGitHub(question, token);
      })(),
      fetchDashboardCatalog(),
      fetchSigmaWorkbookCatalog(),
    ]);

    const allSources = [...dashboardSources, ...sigmaSources, ...ghSources];

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
