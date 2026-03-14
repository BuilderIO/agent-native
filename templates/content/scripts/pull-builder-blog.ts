import fs from "fs";
import path from "path";
import { stringify as stringifyYaml } from "yaml";
import { builderToMarkdown } from "../client/lib/builder-to-markdown.js";
import {
  getBuilderBlogProjectSlug,
  normalizeBuilderBlogHandle,
} from "../shared/builder-slugs.js";
import { PROJECTS_DIR, camelCaseArgs, fail, loadEnv, parseArgs } from "./_utils.js";

type BuilderArticleResponse = {
  id?: string;
  name?: string;
  data?: Record<string, any>;
  results?: Array<{
    id?: string;
    name?: string;
    data?: Record<string, any>;
  }>;
};

function getBuilderApiKey(): string {
  if (process.env.BUILDER_API_KEY) return process.env.BUILDER_API_KEY;

  const authPath = path.join(process.cwd(), "content", ".builder-auth.json");
  if (!fs.existsSync(authPath)) {
    fail("BUILDER_API_KEY is required or content/.builder-auth.json must exist");
  }

  const auth = JSON.parse(fs.readFileSync(authPath, "utf-8"));
  if (!auth?.apiKey) {
    fail("Builder API key not found in content/.builder-auth.json");
  }

  return auth.apiKey;
}

async function fetchBuilderArticle(apiKey: string, rawHandle: string) {
  const normalizedHandle = normalizeBuilderBlogHandle(rawHandle);
  const cacheBuster = Date.now();
  const base = "https://cdn.builder.io/api/v3/content/blog-article";
  const attempts = [
    `${base}?apiKey=${encodeURIComponent(apiKey)}&query.data.handle=${encodeURIComponent(normalizedHandle)}&limit=1&includeUnpublished=true&cachebust=${cacheBuster}`,
    `${base}?apiKey=${encodeURIComponent(apiKey)}&query.url=${encodeURIComponent(rawHandle)}&limit=1&includeUnpublished=true&cachebust=${cacheBuster}`,
    `${base}/${encodeURIComponent(normalizedHandle)}?apiKey=${encodeURIComponent(apiKey)}&includeUnpublished=true&cachebust=${cacheBuster}`,
  ];

  for (const url of attempts) {
    const response = await fetch(url);
    if (!response.ok) continue;

    const data = (await response.json()) as BuilderArticleResponse;
    const article = data.results?.[0] || data;
    if (article?.id) {
      return article;
    }
  }

  fail(`Builder article not found for handle: ${rawHandle}`);
}

export default async function main(args: string[]) {
  loadEnv();
  const raw = parseArgs(args);
  const opts = camelCaseArgs(raw);

  if (raw["help"]) {
    console.log(`Usage: pnpm script pull-builder-blog --handle <builder-handle-or-path> --workspace <workspace> [--name <project-name>]\n\nExamples:\n  pnpm script pull-builder-blog --handle /model-context-protocol --workspace alice\n  pnpm script pull-builder-blog --handle model-context-protocol --workspace alice --name "Model Context Protocol"`);
    return;
  }

  const handle = String(opts.handle || "").trim();
  const workspace = String(opts.workspace || "").trim();
  const explicitName = String(opts.name || "").trim();

  if (!handle) fail("--handle is required");
  if (!workspace) fail("--workspace is required");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(workspace)) fail("--workspace must be a valid slug");

  const apiKey = getBuilderApiKey();
  const article = await fetchBuilderArticle(apiKey, handle);
  const fullData = article.data || {};
  const normalizedHandle = normalizeBuilderBlogHandle(handle);
  const title = explicitName || fullData.title || article.name || normalizedHandle;
  const baseProjectSlug = getBuilderBlogProjectSlug(handle);
  if (!baseProjectSlug) fail("Could not derive project slug from Builder handle");

  let projectSlug = baseProjectSlug;
  let counter = 2;
  while (fs.existsSync(path.join(PROJECTS_DIR, workspace, projectSlug))) {
    projectSlug = `${baseProjectSlug}-${counter}`;
    counter++;
  }

  const projectDir = path.join(PROJECTS_DIR, workspace, projectSlug);

  const blocks = Array.isArray(fullData.blocks) ? fullData.blocks : [];
  const blocksString = blocks.length > 0 ? builderToMarkdown(blocks as any) : "";
  const date = fullData.date
    ? new Date(fullData.date).toISOString().split("T")[0]
    : new Date().toISOString().split("T")[0];

  const frontmatter = stringifyYaml({
    builder: {
      model: "blog-article",
      title,
      handle: normalizedHandle,
      blurb: fullData.blurb || "",
      metaTitle: fullData.metaTitle || "",
      date,
      readTime: fullData.readTime || 1,
      tags: fullData.tags || [],
      topic: fullData.topic || "",
      image: fullData.image || "",
      hideImage: !!fullData.hideImage,
      authorId:
        fullData?.author?.id ||
        (Array.isArray(fullData?.author) ? fullData.author[0]?.id : "") ||
        (Array.isArray(fullData?.authors) ? fullData.authors[0]?.id : "") ||
        "",
    },
    hero_image: fullData.image || null,
  }).trim();

  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(path.join(projectDir, "resources"), { recursive: true });
  fs.mkdirSync(path.join(projectDir, "media"), { recursive: true });
  fs.writeFileSync(path.join(projectDir, ".project.json"), JSON.stringify({ name: title }, null, 2) + "\n", "utf-8");
  fs.writeFileSync(path.join(projectDir, "draft.md"), `---\n${frontmatter}\n---\n\n${blocksString}`.trimEnd() + "\n", "utf-8");

  console.log(JSON.stringify({
    success: true,
    projectSlug: `${workspace}/${projectSlug}`,
    title,
    handle: normalizedHandle,
    blockCount: blocks.length,
  }, null, 2));
}
