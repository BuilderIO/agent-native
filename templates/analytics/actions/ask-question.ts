import { z } from "zod";
import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
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
  // Preserve snake_case model names like dim_contracts, fct_orders
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

    await db.insert(schema.askSessions).values({ id, question, status: "searching" });

    const ghSources = await searchGitHub(question, process.env.GITHUB_TOKEN);

    await db
      .update(schema.askSessions)
      .set({ sourcesJson: JSON.stringify(ghSources), status: "generating" })
      .where(eq(schema.askSessions.id, id));

    return {
      sessionId: id,
      sources: ghSources,
      followUpSessionId: followUpSessionId ?? null,
    };
  },
});
