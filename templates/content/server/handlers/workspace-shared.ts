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
import type {
  FileTreeResponse,
  FileContentResponse,
  FileNode,
} from "../../shared/api";

const PROJECTS_DIR = path.join(process.cwd(), "content", "projects");

function getWorkspaceSharedDir(workspace: string): string {
  return path.join(PROJECTS_DIR, workspace, "shared-resources");
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function isValidPath(p: string): boolean {
  const normalized = path.normalize(p);
  return (
    !normalized.startsWith("..") &&
    !path.isAbsolute(normalized) &&
    !p.includes("\0")
  );
}

function isValidWorkspace(w: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(w);
}

function extractTitle(content: string, filename: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  if (match) return match[1].trim();
  return filename.replace(/\.md$/, "").replace(/-/g, " ");
}

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".svg",
]);

function isImageFile(name: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase());
}

function buildFileTree(dir: string, basePath = ""): FileNode[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const nodes: FileNode[] = [];

  for (const entry of entries) {
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
    } else if (isImageFile(entry.name)) {
      nodes.push({
        name: entry.name,
        path: relativePath,
        type: "file",
        isImage: true,
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

export const getWorkspaceSharedTree = defineEventHandler((event: H3Event) => {
  const workspace = getRouterParam(event, "workspace") as string;
  if (!isValidWorkspace(workspace)) {
    setResponseStatus(event, 400);
    return { error: "Invalid workspace" };
  }
  const dir = getWorkspaceSharedDir(workspace);
  ensureDir(dir);
  const tree = buildFileTree(dir);
  const response: FileTreeResponse = { tree };
  return response;
});

export const getWorkspaceSharedFile = defineEventHandler((event: H3Event) => {
  const workspace = getRouterParam(event, "workspace") as string;
  const query = getQuery(event);
  const filePath = query.path as string;
  if (!isValidWorkspace(workspace) || !filePath || !isValidPath(filePath)) {
    setResponseStatus(event, 400);
    return { error: "Invalid request" };
  }

  const fullPath = path.join(getWorkspaceSharedDir(workspace), filePath);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    setResponseStatus(event, 404);
    return { error: "File not found" };
  }

  const content = fs.readFileSync(fullPath, "utf-8");
  const response: FileContentResponse = {
    path: filePath,
    title: extractTitle(content, path.basename(filePath)),
    content,
  };
  return response;
});

export const saveWorkspaceSharedFile = defineEventHandler(
  async (event: H3Event) => {
    const workspace = getRouterParam(event, "workspace") as string;
    const query = getQuery(event);
    const filePath = query.path as string;
    if (!isValidWorkspace(workspace) || !filePath || !isValidPath(filePath)) {
      setResponseStatus(event, 400);
      return { error: "Invalid request" };
    }

    const body = await readBody(event);
    const { content } = body;
    if (typeof content !== "string") {
      setResponseStatus(event, 400);
      return { error: "Content is required" };
    }

    const fullPath = path.join(getWorkspaceSharedDir(workspace), filePath);
    ensureDir(path.dirname(fullPath));
    fs.writeFileSync(fullPath, content, "utf-8");
    return { success: true };
  },
);

export const createWorkspaceSharedFile = defineEventHandler(
  async (event: H3Event) => {
    const workspace = getRouterParam(event, "workspace") as string;
    if (!isValidWorkspace(workspace)) {
      setResponseStatus(event, 400);
      return { error: "Invalid workspace" };
    }

    const body = await readBody(event);
    const { name, type, parentPath, content } = body;
    if (!name || typeof name !== "string") {
      setResponseStatus(event, 400);
      return { error: "Name is required" };
    }

    const baseDir = getWorkspaceSharedDir(workspace);
    ensureDir(baseDir);

    const parent =
      parentPath && isValidPath(parentPath)
        ? path.join(baseDir, parentPath)
        : baseDir;
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
      const relativePath = parentPath
        ? `${parentPath}/${finalName}`
        : finalName;
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
  },
);

export const deleteWorkspaceSharedFile = defineEventHandler(
  (event: H3Event) => {
    const workspace = getRouterParam(event, "workspace") as string;
    const query = getQuery(event);
    const filePath = query.path as string;
    if (!isValidWorkspace(workspace) || !filePath || !isValidPath(filePath)) {
      setResponseStatus(event, 400);
      return { error: "Invalid request" };
    }

    const fullPath = path.join(getWorkspaceSharedDir(workspace), filePath);
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
  },
);
