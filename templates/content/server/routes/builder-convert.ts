import { RequestHandler } from "express";
import fs, { existsSync, readFileSync } from "fs";
import { readFile } from "fs/promises";
import path, { join } from "path";
import type { BuilderBlock } from "../../shared/api";
import { normalizeBuilderBlogHandle } from "../../shared/builder-slugs.js";

/**
 * POST /api/builder/test-roundtrip
 * Test round-trip conversion: Markdown → Builder JSON → Markdown
 * 
 * Body: { projectSlug: string }
 * Returns: { original, builderJson, converted, summary }
 */
export const testRoundtrip: RequestHandler = async (req, res) => {
  try {
    const { projectSlug } = req.body;
    if (!projectSlug) {
      res.status(400).json({ error: "projectSlug is required" });
      return;
    }

    // Read the active draft
    const projectDir = join(process.cwd(), "content/projects", projectSlug);
    let activeDraft = "draft.md";
    const metaPath = join(projectDir, ".project.json");
    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
        if (meta.activeDraft && existsSync(join(projectDir, meta.activeDraft))) {
          activeDraft = meta.activeDraft;
        }
      } catch {}
    }
    if (!existsSync(join(projectDir, activeDraft))) {
      const markdownFiles = fs
        .readdirSync(projectDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith("."))
        .map((entry) => entry.name)
        .sort();
      activeDraft = markdownFiles[0] || activeDraft;
    }
    const draftPath = join(projectDir, activeDraft);
    const originalMarkdown = await readFile(draftPath, "utf-8");

    // For now, we can't actually do the conversion server-side because
    // markdownToBuilder uses browser APIs (Image loading)
    // Instead, return a structure that the client can use

    res.json({
      original: originalMarkdown,
      message: "Client-side conversion required - use the test endpoint from browser context",
      instructions: {
        step1: "The client should call markdownToBuilder() with the original markdown",
        step2: "Then call builderToMarkdown() with the resulting blocks",
        step3: "Compare the original and converted markdown",
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

const AUTH_FILE = path.join(process.cwd(), "content", ".builder-auth.json");

function getStoredApiKey(): string | null {
  if (process.env.BUILDER_API_KEY) return process.env.BUILDER_API_KEY;

  try {
    if (!fs.existsSync(AUTH_FILE)) return null;
    const raw = fs.readFileSync(AUTH_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return typeof parsed?.apiKey === "string" && parsed.apiKey ? parsed.apiKey : null;
  } catch {
    return null;
  }
}

function normalizeBuilderHandle(input: string, model: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;

  if (model === "blog-article") {
    return normalizeBuilderBlogHandle(input);
  }

  return trimmed;
}

/**
 * POST /api/builder/fetch-article
 * Fetch a published article or doc from Builder.io (for testing pull functionality)
 *
 * Body: { apiKey?: string, articleId?: string, handle?: string, model?: string }
 * Returns: { blocks, title, ... }
 */
export const fetchArticle: RequestHandler = async (req, res) => {
  try {
    const { articleId, handle, model = "blog-article" } = req.body;
    const apiKey = req.body?.apiKey || getStoredApiKey();
    if (!apiKey || (!articleId && !handle)) {
      res.status(400).json({ error: "Builder API key and either articleId or handle are required" });
      return;
    }

    const normalizedHandle = typeof handle === "string" ? normalizeBuilderHandle(handle, model) : handle;
    const BUILDER_CDN = "https://cdn.builder.io/api/v3";
    const cacheBuster = `&cachebust=${Date.now()}`;

    let url = "";
    let data: any = null;

    // If articleId is provided, fetch by ID directly
    if (articleId) {
      url = `${BUILDER_CDN}/content/${model}/${articleId}?apiKey=${apiKey}&includeUnpublished=true${cacheBuster}`;
      const response = await fetch(url);
      if (!response.ok) {
        res.status(response.status).json({ error: `Failed to fetch ${model} from Builder` });
        return;
      }
      data = await response.json();
    } else {
      console.log(`[fetch-article] Searching for ${model} with handle: ${handle} (normalized: ${normalizedHandle})`);

      // If handle looks like a Builder ID (32 hex chars), try direct lookup first
      const looksLikeId = /^[0-9a-f]{32}$/i.test(normalizedHandle);
      if (looksLikeId) {
        console.log(`[fetch-article] Handle looks like an ID — trying direct lookup first`);
        url = `${BUILDER_CDN}/content/${model}/${normalizedHandle}?apiKey=${apiKey}&includeUnpublished=true${cacheBuster}`;
        const idResponse = await fetch(url);
        if (idResponse.ok) {
          const idData = await idResponse.json();
          if (idData && idData.id) {
            console.log(`[fetch-article] ✓ Found by direct ID — blocksCount: ${idData.data?.blocks?.length || 0}`);
            data = idData;
          }
        }
      }

      // If not found yet, try query strategies
      if (!data || (!data.results && !data.id)) {
        // 1. Try by handle field (for blog-article)
        url = `${BUILDER_CDN}/content/${model}?apiKey=${apiKey}&query.data.handle=${encodeURIComponent(normalizedHandle)}&limit=1&includeUnpublished=true${cacheBuster}`;
        console.log(`[fetch-article] Try 1: query.data.handle`);
        let response = await fetch(url);
        if (response.ok) {
          data = await response.json();
          if (data.results && data.results.length > 0) {
            console.log(`[fetch-article] ✓ Found by data.handle`);
          }
        }

        // 2. Try by root-level URL field (for docs-content)
        if (!data || !data.results || data.results.length === 0) {
          url = `${BUILDER_CDN}/content/${model}?apiKey=${apiKey}&query.url=${encodeURIComponent(handle)}&limit=1&includeUnpublished=true${cacheBuster}`;
          console.log(`[fetch-article] Try 2: query.url (root level)`);
          response = await fetch(url);
          if (response.ok) {
            data = await response.json();
            if (data.results && data.results.length > 0) {
              console.log(`[fetch-article] ✓ Found by root url`);
            }
          }
        }

        // 3. Try by data.url field
        if (!data || !data.results || data.results.length === 0) {
          url = `${BUILDER_CDN}/content/${model}?apiKey=${apiKey}&query.data.url=${encodeURIComponent(handle)}&limit=1&includeUnpublished=true${cacheBuster}`;
          console.log(`[fetch-article] Try 3: query.data.url`);
          response = await fetch(url);
          if (response.ok) {
            data = await response.json();
            if (data.results && data.results.length > 0) {
              console.log(`[fetch-article] ✓ Found by data.url`);
            }
          }
        }

        // 4. Fallback: direct ID lookup
        if (!data || !data.results || data.results.length === 0) {
          url = `${BUILDER_CDN}/content/${model}/${normalizedHandle}?apiKey=${apiKey}&includeUnpublished=true${cacheBuster}`;
          console.log(`[fetch-article] Try 4: Direct ID fallback`);
          response = await fetch(url);
          if (response.ok) {
            data = await response.json();
            if (data?.id) {
              console.log(`[fetch-article] ✓ Found by direct ID (fallback)`);
            }
          }
        }
      }

      if (!data || ((!data.results || data.results.length === 0) && !data.id)) {
        console.error(`[fetch-article] No data found for handle: ${handle}`);
        res.status(404).json({ error: `Content not found: ${handle}` });
        return;
      }
    }

    // Extract the blocks and metadata
    const article = data.results?.[0] || data;

    if (!article || !article.id) {
      console.error(`[fetch-article] Invalid article data for handle: ${handle}`);
      res.status(404).json({ error: `Invalid content data returned for: ${handle}` });
      return;
    }
    const blocks = article.data?.blocks || [];
    const title = article.data?.title || article.name || "";
    const returnedHandle = article.data?.handle || article.url || "";

    console.log(`[fetch-article] Model: ${model}, Handle: ${handle}`);

    // For docs-content, url is typically in article.data.url, not article.url
    const articleUrl = article.url || article.data?.url || "";

    res.json({
      blocks,
      title,
      handle: returnedHandle,
      url: articleUrl,
      fullData: article.data,
    });
  } catch (err: any) {
    console.error(`[fetch-article] Error:`, err.message);
    res.status(500).json({ error: err.message });
  }
};
