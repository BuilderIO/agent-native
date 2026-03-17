import type { Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";

const UPLOADS_DIR = path.resolve("data/uploads");

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".zip": "application/zip",
};

export async function uploadMedia(req: Request, res: Response) {
  try {
    const body = req.body as Buffer;
    if (!body || !body.length) {
      res.status(400).json({ error: "No file data" });
      return;
    }

    const originalName = (req.query.filename as string) || "upload";
    const ext = path.extname(originalName).toLowerCase() || ".bin";
    const id = nanoid(12) + ext;
    const filePath = path.join(UPLOADS_DIR, id);

    fs.writeFileSync(filePath, body);

    const mimeType = MIME_MAP[ext] || "application/octet-stream";

    res.json({
      url: `/api/media/${id}`,
      filename: id,
      originalName,
      mimeType,
      size: body.length,
    });
  } catch (err) {
    console.error("[media] Upload failed:", err);
    res.status(500).json({ error: "Upload failed" });
  }
}

export async function serveMedia(req: Request, res: Response) {
  const filename = req.params.filename as string;

  // Prevent directory traversal
  if (filename.includes("..") || filename.includes("/")) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }

  const filePath = path.join(UPLOADS_DIR, filename);

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const ext = path.extname(filename).toLowerCase();
  const mimeType = MIME_MAP[ext] || "application/octet-stream";

  res.setHeader("Content-Type", mimeType);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
}
