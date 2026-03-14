import { RequestHandler } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
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

export const getSharedTree: RequestHandler = (_req, res) => {
  ensureDir(SHARED_DIR);
  const tree = buildFileTree(SHARED_DIR);
  const response: FileTreeResponse = { tree };
  res.json(response);
};

export const serveSharedAsset: RequestHandler = (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath || !isValidPath(filePath)) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const fullPath = path.join(SHARED_DIR, filePath);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    res.status(404).json({ error: "File not found" });
    return;
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
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "public, max-age=3600");
  fs.createReadStream(fullPath).pipe(res);
};

export const getSharedFile: RequestHandler = (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath || !isValidPath(filePath)) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const fullPath = path.join(SHARED_DIR, filePath);
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

export const saveSharedFile: RequestHandler = (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath || !isValidPath(filePath)) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const { content } = req.body;
  if (typeof content !== "string") {
    res.status(400).json({ error: "Content is required" });
    return;
  }

  const fullPath = path.join(SHARED_DIR, filePath);
  ensureDir(path.dirname(fullPath));
  fs.writeFileSync(fullPath, content, "utf-8");
  res.json({ success: true });
};

export const createSharedFile: RequestHandler = (req, res) => {
  const { name, type, parentPath, content } = req.body;
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "Name is required" });
    return;
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

export const deleteSharedFile: RequestHandler = (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath || !isValidPath(filePath)) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const fullPath = path.join(SHARED_DIR, filePath);
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

export const getImageFolders: RequestHandler = (_req, res) => {
  const baseDir = path.join(SHARED_DIR, "image-references");
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
    res.json({ folders: [] } as ImageFoldersResponse);
    return;
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

  res.json({ folders } as ImageFoldersResponse);
};

// Upload images to a shared resource folder
const sharedUploadStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const folder = req.query.folder as string;
    if (!folder || !isValidPath(folder)) {
      return cb(new Error("Invalid folder path"), "");
    }
    const dir = path.join(SHARED_DIR, folder);
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    cb(null, file.originalname);
  },
});

const sharedUpload = multer({
  storage: sharedUploadStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "image/svg+xml",
    ];
    cb(null, allowed.includes(file.mimetype));
  },
});

export const sharedImageUploadMiddleware = sharedUpload.array("files", 20);

export const uploadSharedImages: RequestHandler = (req, res) => {
  const folder = req.query.folder as string;
  const files = req.files as Express.Multer.File[];
  if (!files?.length) {
    res.status(400).json({ error: "No files provided" });
    return;
  }
  const uploaded = files.map((f) => ({
    name: f.filename,
    path: `${folder}/${f.filename}`,
  }));
  res.json({ uploaded });
};

export const deleteSharedImage: RequestHandler = (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath || !isValidPath(filePath)) {
    res.status(400).json({ error: "Invalid path" });
    return;
  }
  const fullPath = path.join(SHARED_DIR, filePath);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  fs.unlinkSync(fullPath);
  res.json({ success: true });
};
