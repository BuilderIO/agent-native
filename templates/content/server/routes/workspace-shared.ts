import { RequestHandler } from "express";
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

export const getWorkspaceSharedTree: RequestHandler = (req, res) => {
  const workspace = req.params.workspace;
  if (!isValidWorkspace(workspace)) {
    res.status(400).json({ error: "Invalid workspace" });
    return;
  }
  const dir = getWorkspaceSharedDir(workspace);
  ensureDir(dir);
  const tree = buildFileTree(dir);
  const response: FileTreeResponse = { tree };
  res.json(response);
};

export const getWorkspaceSharedFile: RequestHandler = (req, res) => {
  const workspace = req.params.workspace;
  const filePath = req.query.path as string;
  if (!isValidWorkspace(workspace) || !filePath || !isValidPath(filePath)) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const fullPath = path.join(getWorkspaceSharedDir(workspace), filePath);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const content = fs.readFileSync(fullPath, "utf-8");
  const response: FileContentResponse = {
    path: filePath,
    title: extractTitle(content, path.basename(filePath)),
    content,
  };
  res.json(response);
};

export const saveWorkspaceSharedFile: RequestHandler = (req, res) => {
  const workspace = req.params.workspace;
  const filePath = req.query.path as string;
  if (!isValidWorkspace(workspace) || !filePath || !isValidPath(filePath)) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const { content } = req.body;
  if (typeof content !== "string") {
    res.status(400).json({ error: "Content is required" });
    return;
  }

  const fullPath = path.join(getWorkspaceSharedDir(workspace), filePath);
  ensureDir(path.dirname(fullPath));
  fs.writeFileSync(fullPath, content, "utf-8");
  res.json({ success: true });
};

export const createWorkspaceSharedFile: RequestHandler = (req, res) => {
  const workspace = req.params.workspace;
  if (!isValidWorkspace(workspace)) {
    res.status(400).json({ error: "Invalid workspace" });
    return;
  }

  const { name, type, parentPath, content } = req.body;
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "Name is required" });
    return;
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
    const relativePath = parentPath ? `${parentPath}/${finalName}` : finalName;
    res.json({ path: relativePath, name: finalName });
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
    res.json({ path: relativePath, name: fileName });
  }
};

export const deleteWorkspaceSharedFile: RequestHandler = (req, res) => {
  const workspace = req.params.workspace;
  const filePath = req.query.path as string;
  if (!isValidWorkspace(workspace) || !filePath || !isValidPath(filePath)) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const fullPath = path.join(getWorkspaceSharedDir(workspace), filePath);
  if (!fs.existsSync(fullPath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
    fs.rmSync(fullPath, { recursive: true, force: true });
  } else {
    fs.unlinkSync(fullPath);
  }

  res.json({ success: true });
};
