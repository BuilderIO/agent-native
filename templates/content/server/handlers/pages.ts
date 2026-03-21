import {
  defineEventHandler,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";
import fs from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";
import type { Page, PageTreeResponse, FileNode } from "../../shared/api";

const PROJECTS_DIR = path.join(process.cwd(), "content", "projects");

function readProjectMeta(projectDir: string): Record<string, any> {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(projectDir, ".project.json"), "utf-8"),
    );
  } catch {
    return {};
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
          const builderTitle = parsed.builder?.title;
          const topLevelTitle = parsed.title;
          const title = builderTitle || topLevelTitle;
          if (title) return String(title).trim();
        }
      } catch {}
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
    const mtime = entry.isDirectory()
      ? getLatestMtime(fullPath)
      : fs.statSync(fullPath).mtime;
    if (mtime > latest) latest = mtime;
  }
  return latest;
}

function resolveProjectActiveDraftPath(
  projectDir: string,
  preferredPath?: string,
): string {
  const candidatePaths = [preferredPath, "draft.md"].filter(
    (c): c is string => !!c,
  );
  for (const candidate of candidatePaths) {
    if (fs.existsSync(path.join(projectDir, candidate))) return candidate;
  }
  const files = listMarkdownFiles(projectDir);
  return files[0] || "draft.md";
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
    } else if (entry.name.endsWith(".md")) {
      files.push(relativePath);
    }
  }
  return files.sort();
}

function buildFileTree(dir: string, basePath: string = ""): FileNode[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const nodes: FileNode[] = [];
  for (const entry of entries) {
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
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return nodes;
}

/**
 * GET /api/pages?workspace=<workspace>
 *
 * Returns a flat Page[] with parentId references that form a unified page tree.
 * Wraps existing project + file data into a Notion-like page hierarchy.
 */
export const getPages = defineEventHandler((event: H3Event) => {
  const query = getQuery(event);
  const workspace = query.workspace as string;
  if (!workspace) {
    setResponseStatus(event, 400);
    return { error: "workspace query parameter is required" };
  }

  const workspaceDir = path.join(PROJECTS_DIR, workspace);
  if (!fs.existsSync(workspaceDir)) {
    return { pages: [], workspace } as PageTreeResponse;
  }

  const pages: Page[] = [];

  // Recursively discover projects and organizational folders
  function discover(
    baseDir: string,
    relativePath: string,
    parentPageId: string | null,
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
        // This is a project -> becomes a page
        const meta = readProjectMeta(fullDir);
        const projectSlug = `${workspace}/${currentPath}`;
        const activeDraft = resolveProjectActiveDraftPath(
          fullDir,
          meta.activeDraft,
        );

        // Get the project's file tree to find subpages
        const fileTree = buildFileTree(fullDir);
        // Filter to only markdown files that aren't the active draft
        const subFiles = collectFileNodes(fileTree, activeDraft);
        const hasChildren = subFiles.length > 0;

        // Add the project as a page
        pages.push({
          id: projectSlug,
          title: meta.name || entry.name.replace(/-/g, " "),
          parentId: parentPageId,
          type: "page",
          updatedAt: getLatestMtime(fullDir).toISOString(),
          hasChildren,
          isPrivate: meta.isPrivate || undefined,
          _projectSlug: projectSlug,
          _filePath: null, // null = active draft
        });

        // Add sub-files as child pages
        for (const file of subFiles) {
          const filePageId = `${projectSlug}::${file.path}`;
          pages.push({
            id: filePageId,
            title:
              file.title || file.name.replace(/\.md$/, "").replace(/-/g, " "),
            parentId: projectSlug,
            type: file.type === "directory" ? "folder" : "page",
            updatedAt: file.updatedAt || new Date().toISOString(),
            hasChildren: (file.children?.length ?? 0) > 0,
            _projectSlug: projectSlug,
            _filePath: file.path,
          });

          // Add nested children recursively
          if (file.children) {
            addNestedFiles(file.children, filePageId, projectSlug);
          }
        }
      } else {
        // This is an organizational folder
        const folderId = `folder::${workspace}/${currentPath}`;
        // Check if folder has any content (projects or subfolders)
        const subEntries = fs.readdirSync(fullDir, { withFileTypes: true });
        const hasContent = subEntries.some(
          (e) => e.isDirectory() && !e.name.startsWith("."),
        );

        pages.push({
          id: folderId,
          title: entry.name
            .split("-")
            .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
            .join(" "),
          parentId: parentPageId,
          type: "folder",
          updatedAt: fs.statSync(fullDir).mtime.toISOString(),
          hasChildren: hasContent,
          _projectSlug: "",
          _filePath: null,
        });

        // Recurse into the folder
        discover(fullDir, currentPath, folderId);
      }
    }
  }

  function collectFileNodes(tree: FileNode[], activeDraft: string): FileNode[] {
    return tree.filter((node) => {
      // Skip the active draft - it's represented by the project page itself
      if (node.type === "file" && node.path === activeDraft) return false;
      return true;
    });
  }

  function addNestedFiles(
    children: FileNode[],
    parentId: string,
    projectSlug: string,
  ) {
    for (const child of children) {
      const childId = `${projectSlug}::${child.path}`;
      pages.push({
        id: childId,
        title:
          child.title || child.name.replace(/\.md$/, "").replace(/-/g, " "),
        parentId,
        type: child.type === "directory" ? "folder" : "page",
        updatedAt: child.updatedAt || new Date().toISOString(),
        hasChildren: (child.children?.length ?? 0) > 0,
        _projectSlug: projectSlug,
        _filePath: child.path,
      });
      if (child.children) {
        addNestedFiles(child.children, childId, projectSlug);
      }
    }
  }

  discover(workspaceDir, "", null);

  return { pages, workspace } as PageTreeResponse;
});
