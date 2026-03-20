import {
  defineEventHandler,
  getQuery,
  readBody,
  readMultipartFormData,
  setResponseStatus,
  type H3Event,
} from "h3";
import fs from "fs";
import path from "path";
import { createReadStream } from "fs";
import { sendStream } from "h3";
import type {
  FileTreeResponse,
  FileContentResponse,
  FileNode,
  ImageFolder,
  ImageFoldersResponse,
} from "../../shared/api";

const SHARED_DIR = path.join(process.cwd(), "content", "shared-resources");

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

function buildFileTree(dir: string, basePath: string = ""): FileNode[] {
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

export const getSharedTree = defineEventHandler((_event: H3Event) => {
  ensureDir(SHARED_DIR);
  const tree = buildFileTree(SHARED_DIR);
  const response: FileTreeResponse = { tree };
  return response;
});

export const serveSharedAsset = defineEventHandler(async (event: H3Event) => {
  const query = getQuery(event);
  const filePath = query.path as string;
  if (!filePath || !isValidPath(filePath)) {
    setResponseStatus(event, 400);
    return { error: "Invalid request" };
  }

  const fullPath = path.join(SHARED_DIR, filePath);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    setResponseStatus(event, 404);
    return { error: "File not found" };
  }

  const ext = path.extname(fullPath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
  };

  const contentType = mimeTypes[ext] || "application/octet-stream";
  event.node.res.setHeader("Content-Type", contentType);
  event.node.res.setHeader("Cache-Control", "public, max-age=3600");
  return sendStream(event, createReadStream(fullPath));
});

export const getSharedFile = defineEventHandler((event: H3Event) => {
  const query = getQuery(event);
  const filePath = query.path as string;
  if (!filePath || !isValidPath(filePath)) {
    setResponseStatus(event, 400);
    return { error: "Invalid request" };
  }

  const fullPath = path.join(SHARED_DIR, filePath);
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

export const saveSharedFile = defineEventHandler(async (event: H3Event) => {
  const query = getQuery(event);
  const filePath = query.path as string;
  if (!filePath || !isValidPath(filePath)) {
    setResponseStatus(event, 400);
    return { error: "Invalid request" };
  }

  const body = await readBody(event);
  const { content } = body;
  if (typeof content !== "string") {
    setResponseStatus(event, 400);
    return { error: "Content is required" };
  }

  const fullPath = path.join(SHARED_DIR, filePath);
  ensureDir(path.dirname(fullPath));
  fs.writeFileSync(fullPath, content, "utf-8");
  return { success: true };
});

export const createSharedFile = defineEventHandler(async (event: H3Event) => {
  const body = await readBody(event);
  const { name, type, parentPath, content } = body;
  if (!name || typeof name !== "string") {
    setResponseStatus(event, 400);
    return { error: "Name is required" };
  }

  ensureDir(SHARED_DIR);

  const parent =
    parentPath && isValidPath(parentPath)
      ? path.join(SHARED_DIR, parentPath)
      : SHARED_DIR;

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

export const deleteSharedFile = defineEventHandler((event: H3Event) => {
  const query = getQuery(event);
  const filePath = query.path as string;
  if (!filePath || !isValidPath(filePath)) {
    setResponseStatus(event, 400);
    return { error: "Invalid request" };
  }

  const fullPath = path.join(SHARED_DIR, filePath);
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

export const getImageFolders = defineEventHandler((_event: H3Event) => {
  const baseDir = path.join(SHARED_DIR, "image-references");
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
    return { folders: [] } as ImageFoldersResponse;
  }

  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  const folders: ImageFolder[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const folderPath = path.join(baseDir, entry.name);
    const files = fs.readdirSync(folderPath, { withFileTypes: true });
    const images = files
      .filter(
        (f) =>
          f.isFile() &&
          IMAGE_EXTENSIONS.has(path.extname(f.name).toLowerCase()),
      )
      .map((f) => ({
        name: f.name,
        path: `image-references/${entry.name}/${f.name}`,
      }));

    folders.push({
      name: entry.name,
      path: `image-references/${entry.name}`,
      imageCount: images.length,
      thumbnailPath: images[0]?.path,
      images,
    });
  }

  return { folders } as ImageFoldersResponse;
});

// Upload images to a shared resource folder
export const uploadSharedImages = defineEventHandler(async (event: H3Event) => {
  const query = getQuery(event);
  const folder = query.folder as string;

  if (!folder || !isValidPath(folder)) {
    setResponseStatus(event, 400);
    return { error: "Invalid folder path" };
  }

  const parts = await readMultipartFormData(event);
  const fileParts = parts?.filter((p) => p.name === "files") ?? [];

  if (!fileParts.length) {
    setResponseStatus(event, 400);
    return { error: "No files provided" };
  }

  const MAX_FILES = 20;
  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

  if (fileParts.length > MAX_FILES) {
    setResponseStatus(event, 413);
    return { error: `Too many files (max ${MAX_FILES})` };
  }

  const oversized = fileParts.find((p) => p.data.length > MAX_FILE_SIZE);
  if (oversized) {
    setResponseStatus(event, 413);
    return { error: "File too large (max 50 MB per file)" };
  }

  const allowedMimeTypes = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/svg+xml",
  ];

  const dir = path.join(SHARED_DIR, folder);
  ensureDir(dir);

  const uploaded: { name: string; path: string }[] = [];
  for (const part of fileParts) {
    if (!part.filename || !part.data) continue;
    const mime = part.type || "";
    if (!allowedMimeTypes.includes(mime)) continue;
    const filename = part.filename;
    fs.writeFileSync(path.join(dir, filename), part.data);
    uploaded.push({ name: filename, path: `${folder}/${filename}` });
  }

  return { uploaded };
});

export const deleteSharedImage = defineEventHandler((event: H3Event) => {
  const query = getQuery(event);
  const filePath = query.path as string;
  if (!filePath || !isValidPath(filePath)) {
    setResponseStatus(event, 400);
    return { error: "Invalid path" };
  }
  const fullPath = path.join(SHARED_DIR, filePath);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    setResponseStatus(event, 404);
    return { error: "File not found" };
  }
  fs.unlinkSync(fullPath);
  return { success: true };
});
