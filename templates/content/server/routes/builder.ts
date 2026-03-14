import { RequestHandler } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { parse as parseYaml } from "yaml";
import {
  getBuilderBlogProjectSlug,
  normalizeBuilderBlogHandle,
} from "../../shared/builder-slugs.js";
import {
  normalizeBuilderAssetUrl,
  reuploadBlockImages,
} from "../utils/builder-upload";

const BUILDER_API = "https://builder.io/api/v1";
const BUILDER_CDN = "https://cdn.builder.io/api/v3";
const AUTH_FILE = path.join(process.cwd(), "content", ".builder-auth.json");
const PROJECTS_DIR = path.join(process.cwd(), "content", "projects");
const AUTHOR_WORKSPACES_FILE = path.join(
  process.cwd(),
  "content",
  "shared-resources",
  "builder-author-workspaces.json",
);

type BuilderAuthorEntry = {
  id: string;
  name?: string;
  data?: {
    fullName?: string;
    handle?: string;
  };
};

type BuilderAuthorReference = {
  "@type": string;
  id: string;
  model: string;
};

type BuilderArticleEntry = {
  id: string;
  name?: string;
  published?: "published" | "draft";
  lastUpdated?: number;
  data?: {
    handle?: string;
    title?: string;
    date?: number;
    author?: BuilderAuthorReference | BuilderAuthorReference[];
    authors?: BuilderAuthorReference[];
    [key: string]: unknown;
  };
};

type LocalProjectLink = {
  slug: string;
  name: string;
  workspace: string;
};

type AuthorWorkspaceMappings = {
  byId?: Record<string, string>;
  byHandle?: Record<string, string>;
};

function getMimeType(originalname: string, defaultType: string): string {
  if (defaultType.startsWith("image/")) return defaultType;

  const ext = path.extname(originalname).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
  };
  return mimeTypes[ext] || defaultType;
}

function getStoredAuth(): { apiKey: string | null; privateKey: string | null } {
  // Env vars take priority over the local auth file
  const envApiKey = process.env.BUILDER_API_KEY || null;
  const envPrivateKey = process.env.BUILDER_PRIVATE_KEY || null;
  if (envApiKey || envPrivateKey) {
    return { apiKey: envApiKey, privateKey: envPrivateKey };
  }

  // Fall back to the local auth file (used in local dev)
  try {
    if (!fs.existsSync(AUTH_FILE)) return { apiKey: null, privateKey: null };
    const raw = fs.readFileSync(AUTH_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      apiKey:
        typeof parsed?.apiKey === "string" && parsed.apiKey
          ? parsed.apiKey
          : null,
      privateKey:
        typeof parsed?.privateKey === "string" && parsed.privateKey
          ? parsed.privateKey
          : null,
    };
  } catch {
    return { apiKey: null, privateKey: null };
  }
}

function getApiKey(req: Parameters<RequestHandler>[0]): string | null {
  const headerApiKey = req.headers["x-builder-api-key"];
  if (typeof headerApiKey === "string" && headerApiKey) return headerApiKey;
  return getStoredAuth().apiKey;
}

function fetchBuilderContent<T>({
  apiKey,
  model,
  fields,
  includeUnpublished = false,
  limit = 100,
}: {
  apiKey: string;
  model: string;
  fields: string;
  includeUnpublished?: boolean;
  limit?: number;
}): Promise<T[]> {
  const fetchAll = async () => {
    const results: T[] = [];
    let offset = 0;

    while (true) {
      const params = new URLSearchParams({
        apiKey,
        limit: String(limit),
        offset: String(offset),
        fields,
        cachebust: String(Date.now()),
      });

      if (includeUnpublished) {
        params.set("includeUnpublished", "true");
      }

      const response = await fetch(
        `${BUILDER_CDN}/content/${model}?${params.toString()}`,
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Failed to fetch ${model}`);
      }

      const data = await response.json();
      const batch = Array.isArray(data?.results) ? data.results : [];
      results.push(...batch);

      if (batch.length < limit || results.length >= 1000) {
        break;
      }

      offset += limit;
    }

    return results;
  };

  return fetchAll();
}

function normalizeAuthorReferences(
  articleData: BuilderArticleEntry["data"],
): BuilderAuthorReference[] {
  if (!articleData) return [];

  const refs = [
    ...(Array.isArray(articleData.authors) ? articleData.authors : []),
    ...(Array.isArray(articleData.author)
      ? articleData.author
      : articleData.author
        ? [articleData.author]
        : []),
  ].filter(
    (ref): ref is BuilderAuthorReference =>
      !!ref && typeof ref.id === "string" && typeof ref.model === "string",
  );

  const seen = new Set<string>();
  return refs.filter((ref) => {
    if (seen.has(ref.id)) return false;
    seen.add(ref.id);
    return true;
  });
}

function readAuthorWorkspaceMappings(): AuthorWorkspaceMappings {
  try {
    if (!fs.existsSync(AUTHOR_WORKSPACES_FILE)) {
      return { byId: {}, byHandle: {} };
    }

    const raw = fs.readFileSync(AUTHOR_WORKSPACES_FILE, "utf-8");
    const parsed = JSON.parse(raw);

    return {
      byId: parsed?.byId && typeof parsed.byId === "object" ? parsed.byId : {},
      byHandle:
        parsed?.byHandle && typeof parsed.byHandle === "object"
          ? parsed.byHandle
          : {},
    };
  } catch {
    return { byId: {}, byHandle: {} };
  }
}

function listMarkdownFiles(dir: string, basePath: string = ""): string[] {
  if (!fs.existsSync(dir)) return [];

  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "media") continue;

    const fullPath = path.join(dir, entry.name);
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(fullPath, relativePath));
      continue;
    }

    if (entry.name.endsWith(".md")) {
      files.push(relativePath);
    }
  }

  return files.sort();
}

function getActiveDraftPath(projectDir: string): string {
  const metaPath = path.join(projectDir, ".project.json");
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    if (
      meta.activeDraft &&
      fs.existsSync(path.join(projectDir, meta.activeDraft))
    ) {
      return meta.activeDraft;
    }
  } catch {
    // fall through to filesystem-based fallback
  }

  if (fs.existsSync(path.join(projectDir, "draft.md"))) {
    return "draft.md";
  }

  return listMarkdownFiles(projectDir)[0] || "draft.md";
}

function discoverProjectDirs(
  dir: string,
  relativePath: string,
  results: { projectDir: string; slug: string; workspace: string }[],
  workspace: string,
) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      entry.name.startsWith(".") ||
      entry.name === "shared-resources"
    )
      continue;
    const fullDir = path.join(dir, entry.name);
    const currentPath = relativePath
      ? `${relativePath}/${entry.name}`
      : entry.name;
    if (fs.existsSync(path.join(fullDir, ".project.json"))) {
      results.push({
        projectDir: fullDir,
        slug: `${workspace}/${currentPath}`,
        workspace,
      });
    } else {
      discoverProjectDirs(fullDir, currentPath, results, workspace);
    }
  }
}

function getLocalProjectLinks(): Map<string, LocalProjectLink> {
  const links = new Map<string, LocalProjectLink>();

  if (!fs.existsSync(PROJECTS_DIR)) {
    return links;
  }

  const workspaceEntries = fs.readdirSync(PROJECTS_DIR, {
    withFileTypes: true,
  });
  for (const workspaceEntry of workspaceEntries) {
    if (!workspaceEntry.isDirectory()) continue;

    const workspace = workspaceEntry.name;
    const workspaceDir = path.join(PROJECTS_DIR, workspace);
    const projectResults: {
      projectDir: string;
      slug: string;
      workspace: string;
    }[] = [];
    discoverProjectDirs(workspaceDir, "", projectResults, workspace);

    for (const { projectDir, workspace: ws } of projectResults) {
      const activeDraft = getActiveDraftPath(projectDir);
      const draftPath = path.join(projectDir, activeDraft);
      if (!fs.existsSync(draftPath)) continue;

      try {
        const content = fs.readFileSync(draftPath, "utf-8");
        const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)*/);
        if (!match) continue;

        const frontmatter = parseYaml(match[1]) || {};
        const handle = frontmatter?.builder?.handle;
        if (!handle || typeof handle !== "string") continue;

        const normalizedHandle = normalizeBuilderBlogHandle(handle);
        const canonicalProjectSlug =
          getBuilderBlogProjectSlug(normalizedHandle);
        if (!normalizedHandle || !canonicalProjectSlug) continue;

        const projectMetaPath = path.join(projectDir, ".project.json");
        let projectName = path.basename(projectDir);
        if (fs.existsSync(projectMetaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(projectMetaPath, "utf-8"));
            if (typeof meta?.name === "string" && meta.name.trim()) {
              projectName = meta.name.trim();
            }
          } catch {}
        }

        links.set(normalizedHandle, {
          slug: `${ws}/${canonicalProjectSlug}`,
          name: projectName,
          workspace: ws,
        });
      } catch {}
    }
  }

  return links;
}

function resolveMappedWorkspace(
  authorRefs: BuilderAuthorReference[],
  authorLookup: Map<string, BuilderAuthorEntry>,
  mappings: AuthorWorkspaceMappings,
): string | undefined {
  for (const ref of authorRefs) {
    const mappedById = mappings.byId?.[ref.id];
    if (mappedById) return mappedById;

    const author = authorLookup.get(ref.id);
    const handle = author?.data?.handle;
    if (handle && mappings.byHandle?.[handle]) {
      return mappings.byHandle[handle];
    }
  }

  return undefined;
}

// Multer memory storage for image uploads (forward to Builder, don't save locally)
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const mimeType = getMimeType(file.originalname, file.mimetype);
    if (mimeType.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `Only image files are allowed, got ${file.mimetype} (${path.extname(file.originalname)})`,
        ),
      );
    }
  },
});

export const imageUploadMiddleware = memoryUpload.single("file");

// POST /api/builder/image — Upload image to Builder.io CDN
export const uploadImage: RequestHandler = async (req, res) => {
  try {
    const apiKey = req.headers["x-builder-api-key"] as string;
    const privateKey = req.headers["x-builder-private-key"] as string;
    const file = req.file;

    if (!apiKey || !privateKey) {
      res.status(400).json({ error: "Missing API key or private key" });
      return;
    }
    if (!file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }

    const mimeType = getMimeType(file.originalname, file.mimetype);
    const uploadUrl = `${BUILDER_API}/upload?apiKey=${apiKey}&name=${encodeURIComponent(file.originalname)}`;

    const requestInit: RequestInit = {
      method: "POST",
      headers: {
        Authorization: `Bearer ${privateKey}`,
        "Content-Type": mimeType,
        "Content-Length": file.buffer.length.toString(),
      },
      body: file.buffer as unknown as BodyInit,
    };

    const response = await fetch(uploadUrl, requestInit);

    if (!response.ok) {
      const text = await response.text();
      res
        .status(response.status)
        .json({ error: `Builder upload failed: ${text}` });
      return;
    }

    const data = await response.json();
    const url = data?.url || data?.[0]?.url || data?.results?.[0]?.url;
    if (!url) {
      res.status(500).json({ error: "No URL returned from Builder" });
      return;
    }

    res.json({ success: true, url: normalizeBuilderAssetUrl(url) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/builder/upload — Create a new blog-article or docs-content
export const uploadArticle: RequestHandler = async (req, res) => {
  try {
    const { apiKey, privateKey, article, model = "blog-article" } = req.body;
    if (!apiKey || !privateKey || !article) {
      res
        .status(400)
        .json({ success: false, error: "Missing required fields" });
      return;
    }

    // Auto-reupload non-CDN images before pushing to Builder
    let reuploadResult;
    if (Array.isArray(article.data?.blocks)) {
      reuploadResult = await reuploadBlockImages(
        article.data.blocks,
        article.data,
        { apiKey, privateKey },
      );
    }

    const response = await fetch(`${BUILDER_API}/write/${model}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${privateKey}`,
      },
      body: JSON.stringify(article),
    });

    if (!response.ok) {
      const text = await response.text();
      res.status(response.status).json({ success: false, error: text });
      return;
    }

    const data = await response.json();
    res.json({
      success: true,
      id: data.id || data._id,
      ...(reuploadResult &&
      (reuploadResult.reuploaded > 0 || reuploadResult.failed > 0)
        ? { imageReupload: reuploadResult }
        : {}),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// PUT /api/builder/upload/:id — Update an existing blog-article or docs-content
export const updateArticle: RequestHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const { apiKey, privateKey, article, model = "blog-article" } = req.body;
    if (!apiKey || !privateKey || !article) {
      res
        .status(400)
        .json({ success: false, error: "Missing required fields" });
      return;
    }

    // Auto-reupload non-CDN images before pushing to Builder
    let reuploadResult;
    if (Array.isArray(article.data?.blocks)) {
      reuploadResult = await reuploadBlockImages(
        article.data.blocks,
        article.data,
        { apiKey, privateKey },
      );
    }

    const response = await fetch(
      `${BUILDER_API}/write/${model}/${id}?autoSaveOnly=true`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${privateKey}`,
        },
        body: JSON.stringify(article),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      res.status(response.status).json({ success: false, error: text });
      return;
    }

    const data = await response.json();
    res.json({
      success: true,
      id: data.id || data._id || id,
      ...(reuploadResult &&
      (reuploadResult.reuploaded > 0 || reuploadResult.failed > 0)
        ? { imageReupload: reuploadResult }
        : {}),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// GET /api/builder/authors — Fetch blog-author entries
export const getAuthors: RequestHandler = async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    if (!apiKey) {
      res.status(400).json({ error: "Missing Builder API key" });
      return;
    }

    const authors = await fetchBuilderContent<BuilderAuthorEntry>({
      apiKey,
      model: "blog-author",
      fields: "id,name,data.fullName,data.photo,data.handle",
    });

    res.json({ authors });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/builder/articles — Fetch existing blog-article entries
export const getArticles: RequestHandler = async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    if (!apiKey) {
      res.status(400).json({ error: "Missing Builder API key" });
      return;
    }

    const limit = parseInt((req.query.limit as string) || "100", 10);
    const articles = await fetchBuilderContent<BuilderArticleEntry>({
      apiKey,
      model: "blog-article",
      limit,
      includeUnpublished: true,
      fields:
        "id,name,published,lastUpdated,data.handle,data.title,data.tags,data.topic,data.blurb,data.metaTitle,data.date,data.readTime,data.image,data.hideImage,data.author,data.authors",
    });

    res.json({ articles });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/builder/blog-index — Fetch normalized Builder blog rows for /blog
export const getBlogIndex: RequestHandler = async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    if (!apiKey) {
      res.status(400).json({ error: "Missing Builder API key" });
      return;
    }

    const [articles, authors] = await Promise.all([
      fetchBuilderContent<BuilderArticleEntry>({
        apiKey,
        model: "blog-article",
        includeUnpublished: true,
        fields:
          "id,name,published,lastUpdated,data.handle,data.title,data.date,data.topic,data.tags,data.author,data.authors",
      }),
      fetchBuilderContent<BuilderAuthorEntry>({
        apiKey,
        model: "blog-author",
        fields: "id,name,data.fullName,data.handle",
      }),
    ]);

    const authorLookup = new Map(authors.map((author) => [author.id, author]));
    const localProjectLinks = getLocalProjectLinks();
    const workspaceMappings = readAuthorWorkspaceMappings();

    const rows = articles
      .map((article) => {
        const handle = normalizeBuilderBlogHandle(article.data?.handle || "");
        if (!handle) return null;

        const authorRefs = normalizeAuthorReferences(article.data);
        const authorIds = authorRefs.map((ref) => ref.id);
        const authorNames = authorRefs.map((ref) => {
          const author = authorLookup.get(ref.id);
          return author?.data?.fullName || author?.name || ref.id;
        });
        const linkedProject = localProjectLinks.get(handle);

        return {
          id: article.id,
          handle,
          title: article.data?.title || article.name || handle,
          authorIds,
          authorNames,
          publishedAt: article.data?.date
            ? new Date(article.data.date).toISOString()
            : undefined,
          topic: article.data?.topic,
          tags: Array.isArray(article.data?.tags) ? article.data.tags : [],
          linkedProjectSlug: linkedProject?.slug,
          linkedProjectName: linkedProject?.name,
          linkedWorkspace: linkedProject?.workspace,
          inferredWorkspace:
            linkedProject?.workspace ||
            resolveMappedWorkspace(authorRefs, authorLookup, workspaceMappings),
        };
      })
      .filter((article): article is NonNullable<typeof article> =>
        Boolean(article),
      )
      .sort((a, b) => {
        const aTime = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
        const bTime = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
        return bTime - aTime || a.title.localeCompare(b.title);
      });

    res.json({ articles: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

function getLocalDocProjectLinks(): Map<string, LocalProjectLink> {
  const links = new Map<string, LocalProjectLink>();

  if (!fs.existsSync(PROJECTS_DIR)) {
    return links;
  }

  const workspaceEntries = fs.readdirSync(PROJECTS_DIR, {
    withFileTypes: true,
  });
  for (const workspaceEntry of workspaceEntries) {
    if (!workspaceEntry.isDirectory()) continue;

    const workspace = workspaceEntry.name;
    const workspaceDir = path.join(PROJECTS_DIR, workspace);
    const projectResults: {
      projectDir: string;
      slug: string;
      workspace: string;
    }[] = [];
    discoverProjectDirs(workspaceDir, "", projectResults, workspace);

    for (const { projectDir, slug, workspace: ws } of projectResults) {
      const activeDraft = getActiveDraftPath(projectDir);
      const draftPath = path.join(projectDir, activeDraft);
      if (!fs.existsSync(draftPath)) continue;

      try {
        const content = fs.readFileSync(draftPath, "utf-8");
        const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)*/);
        if (!match) continue;

        const frontmatter = parseYaml(match[1]) || {};
        const docsId = frontmatter?.builder?.docsId;
        if (!docsId || typeof docsId !== "string") continue;

        const projectMetaPath = path.join(projectDir, ".project.json");
        let projectName = path.basename(projectDir);
        if (fs.existsSync(projectMetaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(projectMetaPath, "utf-8"));
            if (typeof meta?.name === "string" && meta.name.trim()) {
              projectName = meta.name.trim();
            }
          } catch {}
        }

        links.set(docsId, {
          slug,
          name: projectName,
          workspace: ws,
        });
      } catch {}
    }
  }

  return links;
}

type BuilderDocsEntry = {
  id: string;
  url?: string;
  name?: string;
  data?: {
    pageTitle?: string;
    referenceNumber?: string;
    tags?: string[];
    redirectToUrl?: string;
    addNoIndex?: boolean;
    [key: string]: unknown;
  };
};

// GET /api/builder/docs-index — Fetch normalized Builder docs rows for /docs
export const getDocsIndex: RequestHandler = async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    if (!apiKey) {
      res.status(400).json({ error: "Missing Builder API key" });
      return;
    }

    const entries = await fetchBuilderContent<BuilderDocsEntry>({
      apiKey,
      model: "docs-content",
      includeUnpublished: true,
      fields:
        "id,url,name,data.pageTitle,data.referenceNumber,data.tags,data.redirectToUrl,data.addNoIndex",
    });

    const localProjectLinks = getLocalDocProjectLinks();

    const rows = entries
      .map((entry) => {
        const title =
          entry.data?.pageTitle || entry.name || entry.url || entry.id;
        const linkedProject = localProjectLinks.get(entry.id);

        return {
          id: entry.id,
          url: entry.url,
          title,
          referenceNumber: entry.data?.referenceNumber,
          tags: Array.isArray(entry.data?.tags) ? entry.data.tags : [],
          redirectToUrl: entry.data?.redirectToUrl,
          addNoIndex: entry.data?.addNoIndex,
          linkedProjectSlug: linkedProject?.slug,
          linkedProjectName: linkedProject?.name,
          linkedWorkspace: linkedProject?.workspace,
        };
      })
      .sort((a, b) => {
        const aRef = a.referenceNumber || "";
        const bRef = b.referenceNumber || "";
        if (aRef && bRef)
          return aRef.localeCompare(bRef, undefined, { numeric: true });
        if (aRef) return -1;
        if (bRef) return 1;
        return a.title.localeCompare(b.title);
      });

    res.json({ docs: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/builder/docs — Fetch existing docs-content entries
export const getDocs: RequestHandler = async (req, res) => {
  try {
    const apiKey = req.headers["x-builder-api-key"] as string;
    if (!apiKey) {
      res.status(400).json({ error: "Missing x-builder-api-key header" });
      return;
    }

    const limit = parseInt((req.query.limit as string) || "100", 10);
    // Fetch all fields including url at root level (not data.url) and all data fields
    const fields = "id,name,lastUpdated,url,data";

    let allDocs: any[] = [];
    let offset = 0;

    while (true) {
      const cacheBuster = `&cb=${Date.now()}`;
      const response = await fetch(
        `${BUILDER_CDN}/content/docs-content?apiKey=${apiKey}&limit=${limit}&offset=${offset}&fields=${fields}&includeUnpublished=true${cacheBuster}`,
      );

      if (!response.ok) {
        const errorText = await response.text();
        if (allDocs.length === 0) {
          res
            .status(response.status)
            .json({ error: `Failed to fetch docs: ${errorText}` });
          return;
        }
        break;
      }

      const data = await response.json();
      const results = data.results || [];
      allDocs = allDocs.concat(results);

      if (results.length < limit || allDocs.length >= 1000) {
        break;
      }

      offset += limit;
    }

    res.json({ docs: allDocs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/builder/validate — Validate connection
export const validateConnection: RequestHandler = async (req, res) => {
  try {
    const { apiKey, privateKey } = req.body;
    if (!apiKey || !privateKey) {
      res.status(400).json({ valid: false, error: "Missing keys" });
      return;
    }

    const response = await fetch(
      `${BUILDER_CDN}/content/blog-article?apiKey=${apiKey}&limit=1&fields=id`,
    );

    if (!response.ok) {
      res.status(401).json({ valid: false, error: "Invalid API key" });
      return;
    }

    res.json({ valid: true });
  } catch (err: any) {
    res.status(500).json({ valid: false, error: err.message });
  }
};

// POST /api/builder/auth — Save Builder auth keys
export const saveAuth: RequestHandler = async (req, res) => {
  try {
    const { apiKey, privateKey } = req.body;
    if (!apiKey || !privateKey) {
      res.status(400).json({ success: false, error: "Missing keys" });
      return;
    }
    fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
    fs.writeFileSync(
      AUTH_FILE,
      JSON.stringify({ apiKey, privateKey }, null, 2),
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// DELETE /api/builder/auth — Clear Builder auth keys
export const clearAuth: RequestHandler = async (_req, res) => {
  try {
    if (fs.existsSync(AUTH_FILE)) {
      fs.unlinkSync(AUTH_FILE);
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
};
