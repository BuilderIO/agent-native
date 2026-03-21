import {
  defineEventHandler,
  getQuery,
  readBody,
  getRouterParam,
  setResponseStatus,
  type H3Event,
} from "h3";
import fs from "fs";
import path from "path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type {
  ProjectListResponse,
  FileTreeResponse,
  FileNode,
  FileContentResponse,
  FileSaveResponse,
  VersionContentResponse,
  VersionHistoryListResponse,
  RestoreVersionResponse,
} from "../../shared/api";
import {
  getBuilderBlogProjectSlug,
  normalizeBuilderBlogHandle,
  slugifyProjectName as slugify,
} from "../../shared/builder-slugs.js";
import {
  buildProjectFileFirestorePath,
  persistVersionHistory,
  registerPendingFileWrite,
  suppressWatcherVersionHistory,
  getVersionHistory as getVersionHistoryEntries,
  getVersionById,
} from "../lib/version-history.js";

const PROJECTS_DIR = path.join(process.cwd(), "content", "projects");

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function isValidProjectPath(project: string): boolean {
  if (!project) return false;
  const normalized = path.posix.normalize(project);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) return false;
  if (normalized.includes("\0")) return false;
  const segments = normalized.split("/").filter(Boolean);
  if (!segments.length) return false;
  return segments.every((segment) => /^[a-z0-9][a-z0-9-]*$/.test(segment));
}

function normalizeProjectParam(project: string | string[] | undefined): string {
  if (!project) return "";
  return Array.isArray(project) ? project.join("/") : project;
}

function isValidPath(p: string): boolean {
  const normalized = path.normalize(p);
  return (
    !normalized.startsWith("..") &&
    !path.isAbsolute(normalized) &&
    !p.includes("\0")
  );
}

function readProjectMeta(projectDir: string): Record<string, any> {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(projectDir, ".project.json"), "utf-8"),
    );
  } catch {
    return {};
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

function resolveProjectActiveDraftPath(
  projectDir: string,
  preferredPath?: string,
): string {
  const candidatePaths = [preferredPath, "draft.md"].filter(
    (candidate): candidate is string => !!candidate,
  );

  for (const candidate of candidatePaths) {
    if (fs.existsSync(path.join(projectDir, candidate))) {
      return candidate;
    }
  }

  return listMarkdownFiles(projectDir)[0] || "draft.md";
}

function getProjectVersionHistoryPath(project: string, filePath: string) {
  return buildProjectFileFirestorePath(project, filePath);
}

function mapVersionHistoryDoc(
  data: Record<string, any>,
): VersionContentResponse {
  return {
    id: String(data.id ?? ""),
    content: String(data.content ?? ""),
    timestamp: Number(data.timestamp ?? 0),
    actorType: data.actorType === "user" ? "user" : "agent",
    actorId: String(data.actorId ?? ""),
    actorDisplayName:
      typeof data.actorDisplayName === "string"
        ? data.actorDisplayName
        : undefined,
    actorEmail:
      typeof data.actorEmail === "string" ? data.actorEmail : undefined,
    source:
      data.source === "autosave" || data.source === "restore"
        ? data.source
        : "agentWrite",
    wordsAdded: Number(data.wordsAdded ?? 0),
    wordsRemoved: Number(data.wordsRemoved ?? 0),
    linesChanged: Number(data.linesChanged ?? 0),
    sectionsAffected: Array.isArray(data.sectionsAffected)
      ? data.sectionsAffected.map(String)
      : [],
  };
}

function getFirstBuilderAuthorId(fullData: any): string {
  if (
    fullData?.author &&
    !Array.isArray(fullData.author) &&
    typeof fullData.author.id === "string"
  ) {
    return fullData.author.id;
  }

  if (
    Array.isArray(fullData?.author) &&
    typeof fullData.author[0]?.id === "string"
  ) {
    return fullData.author[0].id;
  }

  if (
    Array.isArray(fullData?.authors) &&
    typeof fullData.authors[0]?.id === "string"
  ) {
    return fullData.authors[0].id;
  }

  return "";
}

function getCanonicalProjectPath(
  projectDir: string,
  fallbackPath: string,
  preferredPath?: string,
): { activeDraft: string; canonicalPath: string } {
  const activeDraft = resolveProjectActiveDraftPath(projectDir, preferredPath);
  const draftPath = path.join(projectDir, activeDraft);

  if (!fs.existsSync(draftPath)) {
    return { activeDraft, canonicalPath: fallbackPath };
  }

  try {
    const content = fs.readFileSync(draftPath, "utf-8");
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)*/);
    if (!match) {
      return { activeDraft, canonicalPath: fallbackPath };
    }

    const frontmatter = parseYaml(match[1]) || {};
    const builderHandle = frontmatter?.builder?.handle;
    const builderModel = frontmatter?.builder?.model;
    if (builderModel === "docs-content" || typeof builderHandle !== "string") {
      return { activeDraft, canonicalPath: fallbackPath };
    }

    const canonicalPath = getBuilderBlogProjectSlug(builderHandle);
    return {
      activeDraft,
      canonicalPath: canonicalPath || fallbackPath,
    };
  } catch {
    return { activeDraft, canonicalPath: fallbackPath };
  }
}

function extractTitle(content: string, filename: string): string {
  if (content.startsWith("---")) {
    const endIdx = content.indexOf("---", 3);
    if (endIdx !== -1) {
      try {
        const frontmatter = content.substring(3, endIdx);
        const parsed = parseYaml(frontmatter);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          // Check for nested builder.title first, then top-level title
          const builderTitle = parsed.builder?.title;
          const topLevelTitle = parsed.title;
          const title = builderTitle || topLevelTitle;
          if (title) return String(title).trim();
        }
      } catch (e) {
        // Ignore yaml parsing errors
      }
    }
  }

  const match = content.match(/^#\s+(.+)$/m);
  if (match) return match[1].trim();
  return filename.replace(/\.md$/, "").replace(/-/g, " ");
}

function getLatestMtime(dir: string): Date {
  let latest = fs.statSync(dir).mtime;
  if (!fs.existsSync(dir)) return latest;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    let mtime: Date;
    if (entry.isDirectory()) {
      mtime = getLatestMtime(fullPath);
    } else {
      mtime = fs.statSync(fullPath).mtime;
    }
    if (mtime > latest) latest = mtime;
  }
  return latest;
}

function buildFileTree(dir: string, basePath: string = ""): FileNode[] {
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const nodes: FileNode[] = [];

  for (const entry of entries) {
    // Skip hidden files/dirs, media storage folder
    if (entry.name.startsWith(".") || entry.name === "media") continue;

    const fullPath = path.join(dir, entry.name);
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: relativePath,
        type: "directory",
        children: buildFileTree(fullPath, relativePath),
        updatedAt: fs.statSync(fullPath).mtime.toISOString(),
      });
    } else if (entry.name.endsWith(".md")) {
      const content = fs.readFileSync(fullPath, "utf-8");
      nodes.push({
        name: entry.name,
        path: relativePath,
        type: "file",
        title: extractTitle(content, entry.name),
        updatedAt: fs.statSync(fullPath).mtime.toISOString(),
      });
    }
  }

  // Sort: directories first, then files, both alphabetically
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return nodes;
}

// --- Project CRUD ---

/**
 * Recursively find all projects (.project.json) under a directory.
 * Returns project entries and discovered folders.
 */
function discoverProjects(
  baseDir: string,
  relativePath: string,
  requestingUid: string | undefined,
  projects: ProjectListResponse["projects"],
  folderSet: Set<string>,
  workspace: string,
) {
  if (!fs.existsSync(baseDir)) return;
  const entries = fs.readdirSync(baseDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || entry.name === "shared-resources")
      continue;

    const fullDir = path.join(baseDir, entry.name);
    const currentPath = relativePath
      ? `${relativePath}/${entry.name}`
      : entry.name;
    const metaPath = path.join(fullDir, ".project.json");

    if (fs.existsSync(metaPath)) {
      // This is a project
      let name = entry.name.replace(/-/g, " ");
      let isPrivate = false;
      let ownerId: string | undefined;
      let activeDraft: string | undefined;
      let canonicalPath = currentPath;
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
        name = meta.name || name;
        isPrivate = !!meta.isPrivate;
        ownerId = meta.ownerId;
        const resolved = getCanonicalProjectPath(
          fullDir,
          currentPath,
          meta.activeDraft,
        );
        activeDraft = resolved.activeDraft;
        canonicalPath = resolved.canonicalPath;
      } catch {
        const resolved = getCanonicalProjectPath(fullDir, currentPath);
        activeDraft = resolved.activeDraft;
        canonicalPath = resolved.canonicalPath;
      }

      // Skip private projects that don't belong to the requesting user
      if (isPrivate && ownerId && requestingUid && ownerId !== requestingUid)
        continue;

      const slug = `${workspace}/${currentPath}`;
      const canonicalSlug = `${workspace}/${canonicalPath}`;
      // folder = intermediate path between workspace and project name
      const folder = relativePath || undefined;

      projects.push({
        slug,
        canonicalSlug,
        name,
        group: workspace,
        folder,
        updatedAt: getLatestMtime(fullDir).toISOString(),
        ...(activeDraft && activeDraft !== "draft.md" ? { activeDraft } : {}),
        ...(isPrivate ? { isPrivate, ownerId } : {}),
      });
    } else {
      // This is a folder - record it and recurse
      folderSet.add(currentPath);
      discoverProjects(
        fullDir,
        currentPath,
        requestingUid,
        projects,
        folderSet,
        workspace,
      );
    }
  }
}

export const listProjects = defineEventHandler((event: H3Event) => {
  ensureDir(PROJECTS_DIR);
  // Ensure the well-known "private" workspace always exists
  ensureDir(path.join(PROJECTS_DIR, "private"));

  const requestingUid = (event as any).uid as string | undefined;
  const entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
  const projects: ProjectListResponse["projects"] = [];
  const groups = new Set<string>();
  const folders: Record<string, string[]> = {};

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;

    const entryDir = path.join(PROJECTS_DIR, entry.name);
    const metaPath = path.join(entryDir, ".project.json");

    if (fs.existsSync(metaPath)) {
      // Root-level project (no workspace)
      let name = entry.name.replace(/-/g, " ");
      let isPrivate = false;
      let ownerId: string | undefined;
      let activeDraft: string | undefined;
      let canonicalPath = entry.name;
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
        name = meta.name || name;
        isPrivate = !!meta.isPrivate;
        ownerId = meta.ownerId;
        const resolved = getCanonicalProjectPath(
          entryDir,
          entry.name,
          meta.activeDraft,
        );
        activeDraft = resolved.activeDraft;
        canonicalPath = resolved.canonicalPath;
      } catch {
        const resolved = getCanonicalProjectPath(entryDir, entry.name);
        activeDraft = resolved.activeDraft;
        canonicalPath = resolved.canonicalPath;
      }

      if (isPrivate && ownerId && requestingUid && ownerId !== requestingUid)
        continue;

      projects.push({
        slug: entry.name,
        canonicalSlug: canonicalPath,
        name,
        updatedAt: getLatestMtime(entryDir).toISOString(),
        ...(activeDraft && activeDraft !== "draft.md" ? { activeDraft } : {}),
        ...(isPrivate ? { isPrivate, ownerId } : {}),
      });
      continue;
    }

    // Check if this is a workspace
    const hasWorkspaceMeta = fs.existsSync(
      path.join(entryDir, ".workspace.json"),
    );
    const isWellKnown = entry.name === "private";

    // Recursively discover projects and folders
    const folderSet = new Set<string>();
    const workspaceProjects: ProjectListResponse["projects"] = [];
    discoverProjects(
      entryDir,
      "",
      requestingUid,
      workspaceProjects,
      folderSet,
      entry.name,
    );

    if (!workspaceProjects.length && !hasWorkspaceMeta && !isWellKnown)
      continue;

    groups.add(entry.name);
    projects.push(...workspaceProjects);

    if (folderSet.size > 0) {
      folders[entry.name] = Array.from(folderSet).sort();
    }
  }

  projects.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  // Build group metadata (prefixed flag)
  const groupMeta: Record<string, { prefixed?: boolean }> = {};
  for (const g of groups) {
    const wsMetaPath = path.join(PROJECTS_DIR, g, ".workspace.json");
    let prefixed = false;
    if (fs.existsSync(wsMetaPath)) {
      try {
        const wsMeta = JSON.parse(fs.readFileSync(wsMetaPath, "utf-8"));
        prefixed = !!wsMeta.prefixed;
      } catch {}
    }
    groupMeta[g] = { prefixed };
  }

  const response: ProjectListResponse = {
    projects,
    groups: Array.from(groups).sort(),
    groupMeta,
    ...(Object.keys(folders).length > 0 ? { folders } : {}),
  };
  return response;
});

export const createProject = defineEventHandler(async (event: H3Event) => {
  const body = await readBody(event);
  const {
    name,
    group,
    builderHandle,
    builderDocsId,
    builderModel,
    fullData,
    blocksString,
  } = body;
  if (!name || typeof name !== "string") {
    setResponseStatus(event, 400);
    return { error: "Project name is required" };
  }

  ensureDir(PROJECTS_DIR);

  const normalizedBuilderHandle =
    builderHandle && builderModel === "blog-article"
      ? normalizeBuilderBlogHandle(builderHandle)
      : builderHandle;
  let slug =
    builderHandle && builderModel === "blog-article"
      ? getBuilderBlogProjectSlug(builderHandle)
      : slugify(name);
  if (!slug) slug = slugify(name);
  if (!slug) slug = "project";

  // Group can now contain slashes for nested folders (e.g. "devrel/blog")
  // Each segment is slugified independently
  let groupPath = "";
  if (group) {
    const segments = group.split("/").filter(Boolean);
    const slugifiedSegments = segments
      .map((s: string) => slugify(s))
      .filter(Boolean);
    if (segments.length > 0 && slugifiedSegments.length === 0) {
      setResponseStatus(event, 400);
      return { error: "Invalid group" };
    }
    groupPath = slugifiedSegments.join("/");
  }

  const baseDir = groupPath
    ? path.join(PROJECTS_DIR, ...groupPath.split("/"))
    : PROJECTS_DIR;
  ensureDir(baseDir);

  let finalSlug = slug;
  let counter = 2;
  while (fs.existsSync(path.join(baseDir, finalSlug))) {
    finalSlug = `${slug}-${counter}`;
    counter++;
  }

  const projectDir = path.join(baseDir, finalSlug);
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(path.join(projectDir, "resources"), { recursive: true });

  // Write project metadata
  fs.writeFileSync(
    path.join(projectDir, ".project.json"),
    JSON.stringify({ name }, null, 2),
    "utf-8",
  );

  let draftContent = `# ${name}\n\n`;

  if (
    builderHandle &&
    fullData &&
    blocksString &&
    builderModel === "docs-content"
  ) {
    // If creating from Builder docs-content, construct the initial draft with frontmatter and body
    // Strip /c/docs/ prefix from URL for local storage
    let localUrl = fullData.url || "";
    if (localUrl && localUrl.startsWith("/c/docs/")) {
      localUrl = localUrl.substring("/c/docs/".length);
    }

    const metaStr = stringifyYaml({
      builder: {
        model: "docs-content",
        docsId: builderHandle,
        pageTitle: fullData.pageTitle || name,
        url: localUrl,
        description: fullData.description || "",
        hideNav: !!fullData.hideNav,
        shopifyApplicable: !!fullData.shopifyApplicable,
        referenceNumber: fullData.referenceNumber || "",
        tags: fullData.tags || [],
        redirectToUrl: fullData.redirectToUrl || "",
        redirectToPermanent: !!fullData.redirectToPermanent,
        image: fullData.image || "",
        hideFeedbackColumn: !!fullData.hideFeedbackColumn,
        showToc: !!fullData.showToc,
        addNoIndex: !!fullData.addNoIndex,
      },
    }).trim();
    draftContent = `---\n${metaStr}\n---\n\n${blocksString}`;
  } else if (
    builderHandle &&
    fullData &&
    blocksString &&
    builderModel === "blog-article"
  ) {
    // If creating from Builder blog article, construct the initial draft with frontmatter and body
    const metaStr = stringifyYaml({
      builder: {
        model: "blog-article",
        title: fullData.title || name,
        handle: normalizedBuilderHandle,
        blurb: fullData.blurb || "",
        metaTitle: fullData.metaTitle || "",
        date: fullData.date
          ? new Date(fullData.date).toISOString().split("T")[0]
          : new Date().toISOString().split("T")[0],
        readTime: fullData.readTime || 1,
        tags: fullData.tags || [],
        topic: fullData.topic || "",
        image: fullData.image || "",
        hideImage: !!fullData.hideImage,
        authorId: getFirstBuilderAuthorId(fullData),
      },
      hero_image: fullData.image || null,
    }).trim();
    draftContent = `---\n${metaStr}\n---\n\n${blocksString}`;
  } else if (builderHandle) {
    draftContent = `---\nbuilder:\n  model: blog-article\n  handle: ${normalizedBuilderHandle}\n---\n# ${name}\n\n`;
  } else if (builderDocsId) {
    draftContent = `---\nbuilder:\n  model: docs-content\n  docsId: ${builderDocsId}\n---\n# ${name}\n\n`;
  }

  // Create default draft
  fs.writeFileSync(path.join(projectDir, "draft.md"), draftContent, "utf-8");

  return {
    slug: groupPath ? `${groupPath}/${finalSlug}` : finalSlug,
    name,
    group: groupPath || undefined,
  };
});

export const createProjectGroup = defineEventHandler(async (event: H3Event) => {
  const body = await readBody(event);
  const { name } = body;
  if (!name || typeof name !== "string") {
    setResponseStatus(event, 400);
    return { error: "Group name is required" };
  }

  ensureDir(PROJECTS_DIR);

  const groupSlug = slugify(name);
  if (!groupSlug) {
    setResponseStatus(event, 400);
    return { error: "Invalid group" };
  }

  const groupDir = path.join(PROJECTS_DIR, groupSlug);
  if (!fs.existsSync(groupDir)) {
    fs.mkdirSync(groupDir, { recursive: true });
  }

  // Mark new workspaces as prefixed so they use /workspace/<name> URLs
  const workspaceMeta = path.join(groupDir, ".workspace.json");
  if (!fs.existsSync(workspaceMeta)) {
    fs.writeFileSync(
      workspaceMeta,
      JSON.stringify({ prefixed: true }, null, 2),
      "utf-8",
    );
  }

  return { group: groupSlug, prefixed: true };
});

export const deleteProject = defineEventHandler((event: H3Event) => {
  const project = normalizeProjectParam(getRouterParam(event, "project"));
  if (!isValidProjectPath(project)) {
    setResponseStatus(event, 400);
    return { error: "Invalid project" };
  }

  const projectDir = path.join(PROJECTS_DIR, project);
  if (!fs.existsSync(projectDir)) {
    setResponseStatus(event, 404);
    return { error: "Project not found" };
  }

  fs.rmSync(projectDir, { recursive: true, force: true });
  return { success: true };
});

export const renameProject = defineEventHandler(async (event: H3Event) => {
  const project = normalizeProjectParam(getRouterParam(event, "project"));
  const body = await readBody(event);
  const { name } = body;

  if (!isValidProjectPath(project)) {
    setResponseStatus(event, 400);
    return { error: "Invalid project" };
  }
  if (!name || typeof name !== "string") {
    setResponseStatus(event, 400);
    return { error: "New name is required" };
  }

  const projectDir = path.join(PROJECTS_DIR, project);
  if (!fs.existsSync(projectDir)) {
    setResponseStatus(event, 404);
    return { error: "Project not found" };
  }

  // Update metadata (keep same slug), preserving existing fields
  const metaPath = path.join(projectDir, ".project.json");
  let existingMeta: Record<string, any> = {};
  try {
    existingMeta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  } catch {}
  existingMeta.name = name;
  fs.writeFileSync(metaPath, JSON.stringify(existingMeta, null, 2), "utf-8");

  const activeDraft = resolveProjectActiveDraftPath(
    projectDir,
    existingMeta.activeDraft,
  );
  const draftPath = path.join(projectDir, activeDraft);
  if (fs.existsSync(draftPath)) {
    let content = fs.readFileSync(draftPath, "utf-8");
    let updated = false;

    if (content.startsWith("---")) {
      const endIdx = content.indexOf("---", 3);
      if (endIdx !== -1) {
        try {
          const frontmatter = content.substring(3, endIdx);
          let parsed = parseYaml(frontmatter);
          if (
            parsed === null ||
            typeof parsed !== "object" ||
            Array.isArray(parsed)
          ) {
            parsed = {};
          }

          // Update nested builder.title if builder object exists, otherwise update top-level title
          if (parsed.builder && typeof parsed.builder === "object") {
            parsed.builder.title = name;
          } else if ("title" in parsed) {
            parsed.title = name;
          } else {
            // Create builder object with title
            parsed.builder = { title: name };
          }
          const newFrontmatter = stringifyYaml(parsed).trim();
          content = `---\n${newFrontmatter}\n---${content.substring(endIdx + 3)}`;
          updated = true;
        } catch (e) {
          // ignore parsing error
        }
      }
    }

    if (!updated) {
      const match = content.match(/^#\s+(.+)$/m);
      if (match) {
        content = content.replace(/^#\s+(.+)$/m, `# ${name}`);
      } else {
        content = `# ${name}\n\n${content}`;
      }
    }

    fs.writeFileSync(draftPath, content, "utf-8");
  }

  return { slug: project, name };
});

export const moveProject = defineEventHandler(async (event: H3Event) => {
  const project = normalizeProjectParam(getRouterParam(event, "project"));
  const body = await readBody(event);
  const { group } = body as { group?: string };

  if (!isValidProjectPath(project)) {
    setResponseStatus(event, 400);
    return { error: "Invalid project" };
  }

  const projectDir = path.join(PROJECTS_DIR, project);
  if (!fs.existsSync(projectDir)) {
    setResponseStatus(event, 404);
    return { error: "Project not found" };
  }

  const projectName = path.posix.basename(project);

  // Group can contain slashes for nested target paths (e.g. "devrel/blog")
  let targetGroupPath = "";
  if (group) {
    // Accept pre-slugified paths (already valid segments)
    const segments = group.split("/").filter(Boolean);
    if (
      segments.length > 0 &&
      !segments.every((s) => /^[a-z0-9][a-z0-9-]*$/.test(s))
    ) {
      // Try slugifying
      const slugified = segments.map((s) => slugify(s)).filter(Boolean);
      if (slugified.length === 0) {
        setResponseStatus(event, 400);
        return { error: "Invalid group" };
      }
      targetGroupPath = slugified.join("/");
    } else {
      targetGroupPath = segments.join("/");
    }
  }

  const targetBase = targetGroupPath
    ? path.join(PROJECTS_DIR, ...targetGroupPath.split("/"))
    : PROJECTS_DIR;
  const targetDir = path.join(targetBase, projectName);

  if (path.resolve(projectDir) === path.resolve(targetDir)) {
    return { slug: project, group: targetGroupPath || undefined };
  }

  if (fs.existsSync(targetDir)) {
    setResponseStatus(event, 409);
    return { error: "Target project already exists" };
  }

  ensureDir(targetBase);
  fs.renameSync(projectDir, targetDir);

  return {
    slug: targetGroupPath ? `${targetGroupPath}/${projectName}` : projectName,
    group: targetGroupPath || undefined,
  };
});

// --- File Tree ---

export const getFileTree = defineEventHandler((event: H3Event) => {
  const project = normalizeProjectParam(getRouterParam(event, "project"));
  if (!isValidProjectPath(project)) {
    setResponseStatus(event, 400);
    return { error: "Invalid project" };
  }

  const projectDir = path.join(PROJECTS_DIR, project);
  if (!fs.existsSync(projectDir)) {
    setResponseStatus(event, 404);
    return { error: "Project not found" };
  }

  const tree = buildFileTree(projectDir);
  const meta = readProjectMeta(projectDir);
  const response: FileTreeResponse = {
    tree,
    activeDraftPath: resolveProjectActiveDraftPath(
      projectDir,
      meta.activeDraft,
    ),
  };
  return response;
});

// --- File CRUD ---

export const getFile = defineEventHandler((event: H3Event) => {
  const project = normalizeProjectParam(getRouterParam(event, "project"));
  const query = getQuery(event);
  const filePath = query.path as string;

  if (!isValidProjectPath(project) || !filePath || !isValidPath(filePath)) {
    setResponseStatus(event, 400);
    return { error: "Invalid request" };
  }

  const fullPath = path.join(PROJECTS_DIR, project, filePath);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    setResponseStatus(event, 404);
    return { error: "File not found" };
  }

  const content = fs.readFileSync(fullPath, "utf-8");
  const response: FileContentResponse = {
    path: filePath,
    title: extractTitle(content, path.basename(filePath)),
    content,
    updatedAt: fs.statSync(fullPath).mtime.toISOString(),
  };
  return response;
});

export const saveFile = defineEventHandler(async (event: H3Event) => {
  const project = normalizeProjectParam(getRouterParam(event, "project"));
  const query = getQuery(event);
  const filePath = query.path as string;

  if (!isValidProjectPath(project) || !filePath || !isValidPath(filePath)) {
    setResponseStatus(event, 400);
    return { error: "Invalid request" };
  }

  const body = await readBody(event);
  const { content } = body;
  if (typeof content !== "string") {
    setResponseStatus(event, 400);
    return { error: "Content is required" };
  }

  const projectDir = path.join(PROJECTS_DIR, project);
  const fullPath = path.join(projectDir, filePath);
  const historyPath = getProjectVersionHistoryPath(project, filePath);
  ensureDir(path.dirname(fullPath));

  try {
    registerPendingFileWrite(historyPath, {
      actorType: "user",
      actorId: "local",
      actorDisplayName: "Local User",
      actorEmail: "",
      source: "autosave",
    });
    suppressWatcherVersionHistory(fullPath);
  } catch (error) {
    console.error("Failed to register pending version history write:", error);
  }

  fs.writeFileSync(fullPath, content, "utf-8");

  const projectMetaPath = path.join(projectDir, ".project.json");
  if (fs.existsSync(projectMetaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(projectMetaPath, "utf-8"));
      const activeDraft = resolveProjectActiveDraftPath(
        projectDir,
        meta.activeDraft,
      );
      if (filePath === activeDraft) {
        const title = extractTitle(content, filePath);
        if (title && title.toLowerCase() !== "draft" && meta.name !== title) {
          meta.name = title;
          fs.writeFileSync(
            projectMetaPath,
            JSON.stringify(meta, null, 2),
            "utf-8",
          );
        }
      }
    } catch {
      // ignore parsing error
    }
  }

  try {
    await persistVersionHistory({
      filePath: historyPath,
      content,
      fallbackTimestamp: Date.now(),
    });
  } catch (error) {
    console.error("Failed to persist version history:", error);
  }

  const response: FileSaveResponse = {
    success: true,
    updatedAt: fs.statSync(fullPath).mtime.toISOString(),
  };
  return response;
});

export const createFile = defineEventHandler(async (event: H3Event) => {
  const project = normalizeProjectParam(getRouterParam(event, "project"));
  if (!isValidProjectPath(project)) {
    setResponseStatus(event, 400);
    return { error: "Invalid project" };
  }

  const body = await readBody(event);
  const { name, type, parentPath, content } = body;
  if (!name || typeof name !== "string") {
    setResponseStatus(event, 400);
    return { error: "Name is required" };
  }

  const projectDir = path.join(PROJECTS_DIR, project);
  if (!fs.existsSync(projectDir)) {
    setResponseStatus(event, 404);
    return { error: "Project not found" };
  }

  const parent =
    parentPath && isValidPath(parentPath)
      ? path.join(projectDir, parentPath)
      : projectDir;

  ensureDir(parent);

  if (type === "directory") {
    const dirSlug = slugify(name) || "folder";
    let finalName = dirSlug;
    let counter = 2;
    while (fs.existsSync(path.join(parent, finalName))) {
      finalName = `${dirSlug}-${counter}`;
      counter++;
    }
    fs.mkdirSync(path.join(parent, finalName), { recursive: true });
    const relativePath = parentPath ? `${parentPath}/${finalName}` : finalName;
    return { path: relativePath, name: finalName };
  } else {
    const fileSlug = slugify(name) || "untitled";
    let fileName = `${fileSlug}.md`;
    let counter = 2;
    while (fs.existsSync(path.join(parent, fileName))) {
      fileName = `${fileSlug}-${counter}.md`;
      counter++;
    }
    const defaultContent = content || `# ${name}\n\n`;
    fs.writeFileSync(path.join(parent, fileName), defaultContent, "utf-8");
    const relativePath = parentPath ? `${parentPath}/${fileName}` : fileName;
    return { path: relativePath, name: fileName };
  }
});

export const deleteFile = defineEventHandler((event: H3Event) => {
  const project = normalizeProjectParam(getRouterParam(event, "project"));
  const query = getQuery(event);
  const filePath = query.path as string;

  if (!isValidProjectPath(project) || !filePath || !isValidPath(filePath)) {
    setResponseStatus(event, 400);
    return { error: "Invalid request" };
  }

  const fullPath = path.join(PROJECTS_DIR, project, filePath);
  if (!fs.existsSync(fullPath)) {
    setResponseStatus(event, 404);
    return { error: "File not found" };
  }

  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
    fs.rmSync(fullPath, { recursive: true, force: true });
  } else {
    fs.unlinkSync(fullPath);
  }

  return { success: true };
});

// --- Project privacy ---

export const updateProjectMeta = defineEventHandler(async (event: H3Event) => {
  const project = normalizeProjectParam(getRouterParam(event, "project"));
  if (!isValidProjectPath(project)) {
    setResponseStatus(event, 400);
    return { error: "Invalid project" };
  }

  const projectDir = path.join(PROJECTS_DIR, project);
  if (!fs.existsSync(projectDir)) {
    setResponseStatus(event, 404);
    return { error: "Project not found" };
  }

  const body = await readBody(event);
  const { isPrivate, ownerId, activeDraft } = body as {
    isPrivate?: boolean;
    ownerId?: string;
    activeDraft?: string;
  };
  const metaPath = path.join(projectDir, ".project.json");

  let meta: Record<string, any> = {};
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  } catch {}

  if (isPrivate !== undefined) {
    if (isPrivate) {
      meta.isPrivate = true;
      meta.ownerId = ownerId || "local";
    } else {
      delete meta.isPrivate;
      delete meta.ownerId;
    }
  }

  if (activeDraft !== undefined) {
    if (activeDraft && activeDraft !== "draft.md") {
      meta.activeDraft = activeDraft;
    } else {
      delete meta.activeDraft;
    }
  }

  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");
  return {
    success: true,
    isPrivate: !!meta.isPrivate,
    activeDraft: meta.activeDraft || "draft.md",
  };
});

// --- Version history ---

export const getVersionHistory = defineEventHandler(async (event: H3Event) => {
  const project = normalizeProjectParam(getRouterParam(event, "project"));
  const query = getQuery(event);
  const filePath = query.path as string;

  if (!isValidProjectPath(project) || !filePath || !isValidPath(filePath)) {
    setResponseStatus(event, 400);
    return { error: "Invalid request" };
  }

  try {
    const historyPath = getProjectVersionHistoryPath(project, filePath);
    const entries = getVersionHistoryEntries(historyPath);

    const response: VersionHistoryListResponse = {
      versions: entries.map((entry) => {
        const version = mapVersionHistoryDoc(entry);
        const { content: _content, ...summary } = version;
        return summary;
      }),
    };

    return response;
  } catch (error) {
    console.error("Failed to fetch version history:", error);
    setResponseStatus(event, 500);
    return { error: "Failed to fetch version history" };
  }
});

export const getVersionContent = defineEventHandler(async (event: H3Event) => {
  const project = normalizeProjectParam(getRouterParam(event, "project"));
  const query = getQuery(event);
  const filePath = query.path as string;
  const versionId = getRouterParam(event, "versionId") as string;

  if (
    !isValidProjectPath(project) ||
    !filePath ||
    !isValidPath(filePath) ||
    !versionId
  ) {
    setResponseStatus(event, 400);
    return { error: "Invalid request" };
  }

  try {
    const historyPath = getProjectVersionHistoryPath(project, filePath);
    const entry = getVersionById(historyPath, versionId);
    if (!entry) {
      setResponseStatus(event, 404);
      return { error: "Version not found" };
    }

    const response = mapVersionHistoryDoc(entry);
    return response;
  } catch (error) {
    console.error("Failed to fetch version content:", error);
    setResponseStatus(event, 500);
    return { error: "Failed to fetch version content" };
  }
});

export const restoreVersion = defineEventHandler(async (event: H3Event) => {
  const project = normalizeProjectParam(getRouterParam(event, "project"));
  const query = getQuery(event);
  const filePath = query.path as string;
  const body = await readBody(event);
  const { versionId } = body as { versionId?: string };

  if (
    !isValidProjectPath(project) ||
    !filePath ||
    !isValidPath(filePath) ||
    !versionId
  ) {
    setResponseStatus(event, 400);
    return { error: "Invalid request" };
  }

  const projectDir = path.join(PROJECTS_DIR, project);
  const fullPath = path.join(projectDir, filePath);

  try {
    const historyPath = getProjectVersionHistoryPath(project, filePath);
    const entry = getVersionById(historyPath, versionId);
    if (!entry) {
      setResponseStatus(event, 404);
      return { error: "Version not found" };
    }

    const version = mapVersionHistoryDoc(entry);
    ensureDir(path.dirname(fullPath));

    registerPendingFileWrite(historyPath, {
      actorType: "user",
      actorId: "local",
      actorDisplayName: "Local User",
      actorEmail: "",
      source: "restore",
    });
    suppressWatcherVersionHistory(fullPath);
    fs.writeFileSync(fullPath, version.content, "utf-8");

    await persistVersionHistory({
      filePath: historyPath,
      content: version.content,
      fallbackTimestamp: Date.now(),
    });

    const meta = readProjectMeta(projectDir);
    const activeDraftPath = resolveProjectActiveDraftPath(
      projectDir,
      meta.activeDraft,
    );
    if (filePath === activeDraftPath) {
      const title = extractTitle(version.content, path.basename(filePath));
      if (title && title.toLowerCase() !== "draft" && meta.name !== title) {
        meta.name = title;
        fs.writeFileSync(
          path.join(projectDir, ".project.json"),
          JSON.stringify(meta, null, 2),
          "utf-8",
        );
      }
    }

    const response: RestoreVersionResponse = {
      success: true,
      path: filePath,
      title: extractTitle(version.content, path.basename(filePath)),
      content: version.content,
      updatedAt: fs.statSync(fullPath).mtime.toISOString(),
    };
    return response;
  } catch (error) {
    console.error("Failed to restore version:", error);
    setResponseStatus(event, 500);
    return { error: "Failed to restore version" };
  }
});

// --- Folder CRUD (workspace-level organizational folders) ---

export const createFolder = defineEventHandler(async (event: H3Event) => {
  const workspace = getRouterParam(event, "workspace") as string;
  const body = await readBody(event);
  const { path: folderPath } = body as { path: string };

  if (!workspace || !folderPath) {
    setResponseStatus(event, 400);
    return { error: "Workspace and path are required" };
  }

  const segments = folderPath.split("/").filter(Boolean);
  const slugifiedSegments = segments
    .map((s: string) => slugify(s))
    .filter(Boolean);
  if (!slugifiedSegments.length) {
    setResponseStatus(event, 400);
    return { error: "Invalid folder path" };
  }

  const fullPath = path.join(PROJECTS_DIR, workspace, ...slugifiedSegments);
  ensureDir(fullPath);

  return { path: slugifiedSegments.join("/") };
});

export const deleteFolder = defineEventHandler((event: H3Event) => {
  const workspace = getRouterParam(event, "workspace") as string;
  const query = getQuery(event);
  const folderPath = query.path as string;

  if (!workspace || !folderPath) {
    setResponseStatus(event, 400);
    return { error: "Workspace and path are required" };
  }

  const fullPath = path.join(PROJECTS_DIR, workspace, ...folderPath.split("/"));
  if (!fs.existsSync(fullPath)) {
    setResponseStatus(event, 404);
    return { error: "Folder not found" };
  }

  // Check if folder contains any projects
  const hasProjects = (dir: string): boolean => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (fs.existsSync(path.join(dir, e.name, ".project.json"))) return true;
      if (hasProjects(path.join(dir, e.name))) return true;
    }
    return false;
  };

  if (hasProjects(fullPath)) {
    setResponseStatus(event, 400);
    return {
      error:
        "Cannot delete folder that contains projects. Move or delete projects first.",
    };
  }

  fs.rmSync(fullPath, { recursive: true, force: true });
  return { success: true };
});

export const renameFolder = defineEventHandler(async (event: H3Event) => {
  const workspace = getRouterParam(event, "workspace") as string;
  const body = await readBody(event);
  const { oldPath, newName } = body as { oldPath: string; newName: string };

  if (!workspace || !oldPath || !newName) {
    setResponseStatus(event, 400);
    return { error: "Workspace, oldPath and newName are required" };
  }

  const segments = oldPath.split("/").filter(Boolean);
  const parentSegments = segments.slice(0, -1);
  const newSlug = slugify(newName);
  if (!newSlug) {
    setResponseStatus(event, 400);
    return { error: "Invalid new name" };
  }

  const oldFullPath = path.join(PROJECTS_DIR, workspace, ...segments);
  const newFullPath = path.join(
    PROJECTS_DIR,
    workspace,
    ...parentSegments,
    newSlug,
  );

  if (!fs.existsSync(oldFullPath)) {
    setResponseStatus(event, 404);
    return { error: "Folder not found" };
  }

  if (fs.existsSync(newFullPath)) {
    setResponseStatus(event, 409);
    return { error: "A folder with that name already exists" };
  }

  fs.renameSync(oldFullPath, newFullPath);
  return { path: [...parentSegments, newSlug].join("/") };
});
