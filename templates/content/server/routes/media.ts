import express, { RequestHandler } from "express";
import multer, { MulterError } from "multer";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import {
  BuilderUploadError,
  normalizeBuilderAssetUrl,
  uploadBufferToBuilderCDN,
  uploadUrlToBuilderCDN,
} from "../utils/builder-upload";

const PROJECTS_DIR = path.join(process.cwd(), "content", "projects");
const TEMP_UPLOADS_ROOT = path.join(os.tmpdir(), "media-upload-sessions");
const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
];
const ALLOWED_VIDEO_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
];
const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES];
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const CHUNK_SIZE = 1 * 1024 * 1024;
const MAX_CHUNK_BODY_SIZE = CHUNK_SIZE + 64 * 1024;
const UPLOAD_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const BUILDER_VIDEO_UPLOAD_RETRIES = 2;

type MediaMetadata = {
  filename: string;
  url: string;
  type: "image" | "video";
  size: number;
  mimeType: string;
};

type SavedMediaMetadata = MediaMetadata & {
  modifiedAt: number;
};

type UploadSessionStatus = "uploading" | "processing" | "complete" | "failed";

type UploadSession = {
  id: string;
  project: string;
  originalName: string;
  size: number;
  mimeType: string;
  receivedBytes: number;
  nextChunkIndex: number;
  createdAt: number;
  expiresAt: number;
  accessToken: string;
  status: UploadSessionStatus;
  uploadFilename?: string;
  resultUrl?: string;
  resultMetadata?: SavedMediaMetadata;
  failureMessage?: string;
  processingStartedAt?: number;
  completedAt?: number;
};

const ACTIVE_BACKGROUND_UPLOADS = new Set<string>();

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function logMediaEvent(
  level: "info" | "warn" | "error",
  message: string,
  details: Record<string, unknown>
) {
  const log = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
  log(`[media] ${message}`, details);
}

function getHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

function isLoopbackHost(value: string): boolean {
  try {
    const parsed = new URL(value.includes("://") ? value : `https://${value}`);
    return ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(parsed.hostname) || parsed.hostname.endsWith(".local");
  } catch {
    return false;
  }
}

function getMimeType(originalname: string, defaultType: string): string {
  const ext = path.extname(originalname).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
  };
  return mimeTypes[ext] || defaultType;
}

type ByteRange = {
  start: number;
  end: number;
};

function parseByteRange(rangeHeader: string | undefined, size: number): ByteRange | null {
  if (!rangeHeader) return null;

  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) return null;

  const [, startValue, endValue] = match;

  if (!startValue && !endValue) return null;

  if (!startValue) {
    const suffixLength = Number.parseInt(endValue, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;

    const start = Math.max(size - suffixLength, 0);
    return { start, end: size - 1 };
  }

  const start = Number.parseInt(startValue, 10);
  if (!Number.isFinite(start) || start < 0 || start >= size) return null;

  const parsedEnd = endValue ? Number.parseInt(endValue, 10) : size - 1;
  if (!Number.isFinite(parsedEnd)) return null;

  const end = Math.min(parsedEnd, size - 1);
  if (end < start) return null;

  return { start, end };
}

function streamMediaFile(
  req: express.Request,
  res: express.Response,
  options: {
    filePath: string;
    mimeType: string;
    cacheControl: string;
    streamErrorMessage: string;
    streamErrorCode: string;
    logDetails: Record<string, unknown>;
  }
) {
  const { filePath, mimeType, cacheControl, streamErrorMessage, streamErrorCode, logDetails } = options;
  const stat = fs.statSync(filePath);
  const range = parseByteRange(typeof req.headers.range === "string" ? req.headers.range : undefined, stat.size);

  res.setHeader("Content-Type", mimeType);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", cacheControl);

  if (range) {
    const contentLength = range.end - range.start + 1;
    res.status(206);
    res.setHeader("Content-Length", String(contentLength));
    res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${stat.size}`);

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    const stream = fs.createReadStream(filePath, { start: range.start, end: range.end });
    stream.on("error", (error) => {
      logMediaEvent("error", streamErrorMessage, {
        ...logDetails,
        error: getErrorMessage(error),
        rangeStart: range.start,
        rangeEnd: range.end,
      });
      if (!res.headersSent) {
        res.status(500).json({ error: streamErrorMessage, code: streamErrorCode });
        return;
      }
      res.destroy(error instanceof Error ? error : undefined);
    });
    stream.pipe(res);
    return;
  }

  res.setHeader("Content-Length", String(stat.size));

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  const stream = fs.createReadStream(filePath);
  stream.on("error", (error) => {
    logMediaEvent("error", streamErrorMessage, {
      ...logDetails,
      error: getErrorMessage(error),
    });
    if (!res.headersSent) {
      res.status(500).json({ error: streamErrorMessage, code: streamErrorCode });
      return;
    }
    res.destroy(error instanceof Error ? error : undefined);
  });
  stream.pipe(res);
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

function getMediaDir(projectSlug: string): string {
  return path.join(PROJECTS_DIR, projectSlug, "media");
}

function getProjectUploadTempDir(projectSlug: string): string {
  return path.join(TEMP_UPLOADS_ROOT, projectSlug.replace(/\//g, "__"));
}

function getUploadSessionDir(projectSlug: string, uploadId: string): string {
  return path.join(getProjectUploadTempDir(projectSlug), uploadId);
}

function getUploadSessionMetaPath(projectSlug: string, uploadId: string): string {
  return path.join(getUploadSessionDir(projectSlug, uploadId), "session.json");
}

function getUploadSessionDataPath(projectSlug: string, uploadId: string): string {
  return path.join(getUploadSessionDir(projectSlug, uploadId), "upload.bin");
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function generateFilename(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase();
  const id = crypto.randomBytes(8).toString("hex");
  const baseName = path
    .basename(originalName, ext)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
  return `${baseName}-${id}${ext}`;
}

function saveMediaMetadata(project: string, metadata: MediaMetadata): SavedMediaMetadata {
  const mediaDir = getMediaDir(project);
  ensureDir(mediaDir);
  const modifiedAt = Date.now();
  const normalizedMetadata = {
    ...metadata,
    url: normalizeBuilderAssetUrl(metadata.url),
  };
  const metadataPath = path.join(mediaDir, `${metadata.filename}.json`);
  fs.writeFileSync(
    metadataPath,
    JSON.stringify({ ...normalizedMetadata, modifiedAt }, null, 2)
  );

  return {
    ...normalizedMetadata,
    modifiedAt,
  };
}

function normalizeAllowedMimeType(originalName: string, mimeType: string): string {
  return getMimeType(originalName, mimeType || "application/octet-stream");
}

function isAllowedMediaType(originalName: string, mimeType: string): boolean {
  const normalizedMimeType = normalizeAllowedMimeType(originalName, mimeType);
  if (ALLOWED_TYPES.includes(normalizedMimeType)) return true;

  const ext = path.extname(originalName).toLowerCase();
  const allowedExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".mp4", ".webm", ".mov"];
  return allowedExtensions.includes(ext) || normalizedMimeType.startsWith("image/") || normalizedMimeType.startsWith("video/");
}

function isUploadSessionExpired(session: UploadSession): boolean {
  return session.expiresAt <= Date.now();
}

function cleanupExpiredUploadSessions() {
  if (!fs.existsSync(TEMP_UPLOADS_ROOT)) return;

  for (const projectEntry of fs.readdirSync(TEMP_UPLOADS_ROOT, { withFileTypes: true })) {
    if (!projectEntry.isDirectory()) continue;

    const projectDir = path.join(TEMP_UPLOADS_ROOT, projectEntry.name);
    for (const sessionEntry of fs.readdirSync(projectDir, { withFileTypes: true })) {
      if (!sessionEntry.isDirectory()) continue;

      const sessionDir = path.join(projectDir, sessionEntry.name);
      const metaPath = path.join(sessionDir, "session.json");

      if (!fs.existsSync(metaPath)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
        continue;
      }

      try {
        const session = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as UploadSession;
        if (isUploadSessionExpired(session)) {
          fs.rmSync(sessionDir, { recursive: true, force: true });
        }
      } catch {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }
    }
  }
}

function createUploadSession(project: string, file: {
  originalName: string;
  size: number;
  mimeType: string;
}): UploadSession {
  cleanupExpiredUploadSessions();

  const uploadId = crypto.randomBytes(12).toString("hex");
  const sessionDir = getUploadSessionDir(project, uploadId);
  ensureDir(sessionDir);

  const createdAt = Date.now();
  const session: UploadSession = {
    id: uploadId,
    project,
    originalName: file.originalName,
    size: file.size,
    mimeType: normalizeAllowedMimeType(file.originalName, file.mimeType),
    receivedBytes: 0,
    nextChunkIndex: 0,
    createdAt,
    expiresAt: createdAt + UPLOAD_SESSION_TTL_MS,
    accessToken: crypto.randomBytes(24).toString("hex"),
    status: "uploading",
  };

  fs.writeFileSync(getUploadSessionMetaPath(project, uploadId), JSON.stringify(session, null, 2));
  fs.writeFileSync(getUploadSessionDataPath(project, uploadId), Buffer.alloc(0));
  return session;
}

function readUploadSession(project: string, uploadId: string): UploadSession | null {
  const metaPath = getUploadSessionMetaPath(project, uploadId);
  if (!fs.existsSync(metaPath)) return null;

  try {
    const session = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as UploadSession;
    if (session.project !== project || isUploadSessionExpired(session)) {
      deleteUploadSession(project, uploadId);
      return null;
    }
    return session;
  } catch {
    deleteUploadSession(project, uploadId);
    return null;
  }
}

function writeUploadSession(project: string, session: UploadSession) {
  session.expiresAt = Date.now() + UPLOAD_SESSION_TTL_MS;
  fs.writeFileSync(
    getUploadSessionMetaPath(project, session.id),
    JSON.stringify(session, null, 2)
  );
}

function deleteUploadSession(project: string, uploadId: string) {
  fs.rmSync(getUploadSessionDir(project, uploadId), { recursive: true, force: true });
}

function deleteUploadSessionData(project: string, uploadId: string) {
  fs.rmSync(getUploadSessionDataPath(project, uploadId), { force: true });
}

function getUploadSessionKey(project: string, uploadId: string): string {
  return `${project}:${uploadId}`;
}

function getChunkedUploadStatusPayload(session: UploadSession) {
  return {
    uploadId: session.id,
    status: session.status,
    pollAfterMs: session.status === "processing" ? 1500 : undefined,
    error: session.status === "failed" ? session.failureMessage || "Upload failed" : undefined,
    result: session.status === "complete" ? session.resultMetadata : undefined,
  };
}

function markChunkedUploadFailed(project: string, uploadId: string, error: unknown) {
  const session = readUploadSession(project, uploadId);
  if (!session) return;

  session.status = "failed";
  session.failureMessage = getErrorMessage(error) || "Upload failed";
  session.completedAt = Date.now();
  writeUploadSession(project, session);
}

function startChunkedMediaUploadProcessing(options: {
  project: string;
  uploadId: string;
  sourceUrl: string;
  apiKey?: string;
  privateKey?: string;
}) {
  const { project, uploadId, sourceUrl, apiKey, privateKey } = options;
  const sessionKey = getUploadSessionKey(project, uploadId);
  if (ACTIVE_BACKGROUND_UPLOADS.has(sessionKey)) {
    return;
  }

  ACTIVE_BACKGROUND_UPLOADS.add(sessionKey);

  void (async () => {
    const startedAt = Date.now();

    try {
      const session = readUploadSession(project, uploadId);
      if (!session || session.status !== "processing") {
        return;
      }

      const filename = session.uploadFilename || generateFilename(session.originalName);
      const mimeType = normalizeAllowedMimeType(session.originalName, session.mimeType);
      const isVideo = ALLOWED_VIDEO_TYPES.includes(mimeType);
      const dataPath = getUploadSessionDataPath(project, uploadId);

      if (!fs.existsSync(dataPath)) {
        throw new Error("Upload file not found");
      }

      const stat = fs.statSync(dataPath);
      if (stat.size !== session.size) {
        throw new Error("Upload size mismatch");
      }

      logMediaEvent("info", "Starting Builder CDN upload for completed chunked media", {
        project,
        uploadId,
        filename,
        bytes: stat.size,
        mimeType,
        uploadMode: "source-url",
        retries: isVideo ? BUILDER_VIDEO_UPLOAD_RETRIES : 0,
      });

      const cdnUrl = await uploadUrlToBuilderCDN(filename, sourceUrl, {
        apiKey,
        privateKey,
        retries: isVideo ? BUILDER_VIDEO_UPLOAD_RETRIES : 0,
      });

      logMediaEvent("info", "Completed Builder CDN upload for completed chunked media", {
        project,
        uploadId,
        filename,
        bytes: stat.size,
        mimeType,
        uploadMode: "source-url",
        durationMs: Date.now() - startedAt,
        cdnUrl,
      });

      const metadata = saveMediaMetadata(project, {
        filename,
        url: cdnUrl,
        type: isVideo ? "video" : "image",
        size: session.size,
        mimeType,
      });

      const nextSession = readUploadSession(project, uploadId);
      if (!nextSession) {
        return;
      }

      nextSession.status = "complete";
      nextSession.resultUrl = cdnUrl;
      nextSession.resultMetadata = metadata;
      nextSession.failureMessage = undefined;
      nextSession.completedAt = Date.now();
      nextSession.uploadFilename = filename;
      writeUploadSession(project, nextSession);
      deleteUploadSessionData(project, uploadId);
    } catch (error) {
      if (error instanceof BuilderUploadError) {
        logMediaEvent("error", "Builder media upload failed during chunked processing", {
          project,
          uploadId,
          durationMs: Date.now() - startedAt,
          status: error.status,
          code: error.code,
          response: error.responseBody.slice(0, 500),
        });
        markChunkedUploadFailed(project, uploadId, error.message);
        return;
      }

      logMediaEvent("error", "Chunked upload background processing failed", {
        project,
        uploadId,
        durationMs: Date.now() - startedAt,
        error: getErrorMessage(error),
      });
      markChunkedUploadFailed(project, uploadId, error);
    } finally {
      ACTIVE_BACKGROUND_UPLOADS.delete(sessionKey);
    }
  })();
}

function getChunkIndex(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function getUploadToken(req: express.Request): string {
  const headerToken = req.headers["x-upload-token"];
  if (typeof headerToken === "string") return headerToken;
  if (Array.isArray(headerToken)) return headerToken[0] ?? "";
  return typeof req.query.token === "string" ? req.query.token : "";
}

function getUploadRequestId(res: express.Response): string | undefined {
  return typeof res.locals.uploadRequestId === "string" ? res.locals.uploadRequestId : undefined;
}

function getChunkRequestLogDetails(req: express.Request, res: express.Response) {
  return {
    requestId: getUploadRequestId(res),
    project: normalizeProjectParam(req.params.project),
    uploadId: typeof req.params.uploadId === "string" ? req.params.uploadId : "",
    chunkIndex: getChunkIndex(req.query.index),
  };
}

function validateChunkUploadSession(req: express.Request) {
  const project = normalizeProjectParam(req.params.project);
  const uploadId = typeof req.params.uploadId === "string" ? req.params.uploadId : "";
  const uploadToken = getUploadToken(req);

  if (!isValidProjectPath(project) || !uploadId) {
    return { error: { status: 400, body: { error: "Invalid upload request", code: "invalid_upload_request" } } };
  }

  if (!uploadToken) {
    return { error: { status: 401, body: { error: "Upload token is required", code: "missing_upload_token" } } };
  }

  const session = readUploadSession(project, uploadId);
  if (!session) {
    return { error: { status: 404, body: { error: "Upload session not found", code: "upload_session_not_found" } } };
  }

  if (uploadToken !== session.accessToken) {
    return { error: { status: 403, body: { error: "Invalid upload token", code: "invalid_upload_token" } } };
  }

  return { project, uploadId, session };
}

function sendBuilderUploadError(res: express.Response, req: express.Request, err: BuilderUploadError) {
  console.error("[media] Builder media upload failed", {
    project: normalizeProjectParam(req.params.project),
    filename: req.file?.originalname,
    size: req.file?.size,
    mimeType: req.file ? getMimeType(req.file.originalname, req.file.mimetype) : undefined,
    status: err.status,
    code: err.code,
    response: err.responseBody.slice(0, 500),
  });

  res.status(err.status || 502).json({
    error: err.message,
    code: err.code,
    details: err.responseBody || undefined,
  });
}

function getRequestBaseUrl(req: express.Request): string {
  const envOrigin = process.env.APP_ORIGIN?.trim();
  if (envOrigin) {
    try {
      return new URL(envOrigin).origin;
    } catch {
      throw new Error("APP_ORIGIN is not a valid absolute URL");
    }
  }

  const originHeader = getHeaderValue(req.headers.origin).trim();
  if (originHeader && !isLoopbackHost(originHeader)) {
    try {
      return new URL(originHeader).origin;
    } catch {
      logMediaEvent("warn", "Ignoring invalid origin header during Builder upload handoff", {
        originHeader,
        project: normalizeProjectParam(req.params.project),
      });
    }
  }

  const refererHeader = getHeaderValue(req.headers.referer).trim();
  if (refererHeader && !isLoopbackHost(refererHeader)) {
    try {
      return new URL(refererHeader).origin;
    } catch {
      logMediaEvent("warn", "Ignoring invalid referer header during Builder upload handoff", {
        refererHeader,
        project: normalizeProjectParam(req.params.project),
      });
    }
  }

  const forwardedProto = getHeaderValue(req.headers["x-forwarded-proto"]).split(",")[0]?.trim();
  const forwardedHost = getHeaderValue(req.headers["x-forwarded-host"]).split(",")[0]?.trim();
  const host = forwardedHost || req.get("host")?.trim() || "";
  const protocol = forwardedProto || req.protocol || "https";

  if (host && !isLoopbackHost(host)) {
    return `${protocol}://${host}`;
  }

  throw new Error("Public upload origin is unavailable. Set APP_ORIGIN to the public app URL before uploading large videos.");
}

function getChunkedUploadSourceUrl(req: express.Request, project: string, session: UploadSession): string {
  const baseUrl = getRequestBaseUrl(req);
  const pathname = `/api/projects/${project}/media/chunked/${session.id}/source`;
  const url = new URL(pathname, `${baseUrl}/`);
  url.searchParams.set("token", session.accessToken);
  return url.toString();
}

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const mimeType = getMimeType(file.originalname, file.mimetype);

    if (ALLOWED_TYPES.includes(mimeType)) {
      cb(null, true);
      return;
    }

    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".mp4", ".webm", ".mov"];

    if (allowedExtensions.includes(ext) || mimeType.startsWith("image/") || mimeType.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} (${ext}) not allowed`));
    }
  },
});

export const uploadMiddleware: RequestHandler = (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (!err) {
      next();
      return;
    }

    if (err instanceof MulterError && err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: `File too large. Max upload size is ${Math.round(MAX_FILE_SIZE / (1024 * 1024))}MB.`,
        code: "file_too_large",
        maxBytes: MAX_FILE_SIZE,
      });
      return;
    }

    res.status(400).json({
      error: err.message || "Invalid media upload",
      code: "invalid_media_upload",
    });
  });
};

const rawChunkParser = express.raw({
  type: "application/octet-stream",
  limit: MAX_CHUNK_BODY_SIZE,
});

export const requireChunkedUploadAccess: RequestHandler = (req, res, next) => {
  logMediaEvent("info", "Authenticating chunk upload session", {
    ...getChunkRequestLogDetails(req, res),
  });

  const result = validateChunkUploadSession(req);
  if ("error" in result) {
    logMediaEvent("warn", "Chunk upload session rejected", {
      ...getChunkRequestLogDetails(req, res),
      status: result.error.status,
      code: result.error.body.code,
    });
    res.status(result.error.status).json(result.error.body);
    return;
  }

  logMediaEvent("info", "Chunk upload session authenticated", {
    ...getChunkRequestLogDetails(req, res),
    receivedBytes: result.session.receivedBytes,
    nextChunkIndex: result.session.nextChunkIndex,
  });
  next();
};

export const chunkUploadMiddleware: RequestHandler = (req, res, next) => {
  logMediaEvent("info", "Starting chunk body parse", {
    ...getChunkRequestLogDetails(req, res),
    contentLength: req.headers["content-length"],
    contentType: req.headers["content-type"],
  });

  rawChunkParser(req, res, (err) => {
    if (!err) {
      logMediaEvent("info", "Completed chunk body parse", {
        ...getChunkRequestLogDetails(req, res),
        parsedBytes: Buffer.isBuffer(req.body) ? req.body.length : 0,
      });
      next();
      return;
    }

    logMediaEvent("warn", "Chunk body parse failed", {
      ...getChunkRequestLogDetails(req, res),
      error: err instanceof Error ? err.message : String(err),
      type: (err as { type?: string }).type,
    });

    if ((err as { type?: string }).type === "entity.too.large") {
      res.status(413).json({
        error: `Chunk too large. Max chunk size is ${Math.round(CHUNK_SIZE / (1024 * 1024))}MB.`,
        code: "chunk_too_large",
        maxBytes: CHUNK_SIZE,
      });
      return;
    }

    res.status(400).json({
      error: err instanceof Error ? err.message : "Invalid upload chunk",
      code: "invalid_upload_chunk",
    });
  });
};

export const initializeChunkedMediaUpload: RequestHandler = (req, res) => {
  const project = normalizeProjectParam(req.params.project);
  const { originalName, size, mimeType } = req.body as {
    originalName?: string;
    size?: number;
    mimeType?: string;
  };

  if (!isValidProjectPath(project)) {
    res.status(400).json({ error: "Invalid project slug" });
    return;
  }

  if (!originalName || typeof size !== "number" || !mimeType) {
    res.status(400).json({ error: "Missing upload metadata", code: "missing_upload_metadata" });
    return;
  }

  if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_SIZE) {
    res.status(413).json({
      error: `File too large. Max upload size is ${Math.round(MAX_FILE_SIZE / (1024 * 1024))}MB.`,
      code: "file_too_large",
      maxBytes: MAX_FILE_SIZE,
    });
    return;
  }

  if (!isAllowedMediaType(originalName, mimeType)) {
    res.status(400).json({
      error: `File type ${mimeType} not allowed`,
      code: "invalid_media_upload",
    });
    return;
  }

  try {
    logMediaEvent("info", "Initializing chunked media upload", {
      project,
      originalName,
      size,
      mimeType,
    });

    const session = createUploadSession(project, { originalName, size, mimeType });
    res.json({
      uploadId: session.id,
      uploadToken: session.accessToken,
      chunkSize: CHUNK_SIZE,
      totalChunks: Math.ceil(size / CHUNK_SIZE),
    });
  } catch (error) {
    logMediaEvent("error", "Failed to initialize chunked media upload", {
      project,
      originalName,
      size,
      mimeType,
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Could not create an upload session",
      code: "upload_session_create_failed",
    });
  }
};

export const appendChunkedMediaUpload: RequestHandler = (req, res) => {
  const project = normalizeProjectParam(req.params.project);
  const uploadId = typeof req.params.uploadId === "string" ? req.params.uploadId : "";
  const chunkIndex = getChunkIndex(req.query.index);

  logMediaEvent("info", "Chunk append handler entered", {
    ...getChunkRequestLogDetails(req, res),
  });

  if (!isValidProjectPath(project) || !uploadId) {
    res.status(400).json({ error: "Invalid upload request" });
    return;
  }

  if (chunkIndex === null) {
    res.status(400).json({ error: "Chunk index is required", code: "missing_chunk_index" });
    return;
  }

  try {
    const session = readUploadSession(project, uploadId);
    if (!session) {
      res.status(404).json({ error: "Upload session not found", code: "upload_session_not_found" });
      return;
    }

    if (session.status !== "uploading") {
      res.status(409).json({
        error: `Upload can no longer accept chunks while ${session.status}.`,
        code: "upload_not_appendable",
        status: session.status,
      });
      return;
    }

    if (chunkIndex !== session.nextChunkIndex) {
      res.status(409).json({
        error: `Unexpected chunk index ${chunkIndex}. Expected ${session.nextChunkIndex}.`,
        code: "unexpected_chunk_index",
        expectedChunkIndex: session.nextChunkIndex,
      });
      return;
    }

    const chunk = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (chunk.length === 0) {
      res.status(400).json({ error: "Chunk body is required", code: "missing_chunk_body" });
      return;
    }

    if (chunk.length > CHUNK_SIZE) {
      res.status(413).json({
        error: `Chunk too large. Max chunk size is ${Math.round(CHUNK_SIZE / (1024 * 1024))}MB.`,
        code: "chunk_too_large",
        maxBytes: CHUNK_SIZE,
      });
      return;
    }

    const nextReceivedBytes = session.receivedBytes + chunk.length;
    if (nextReceivedBytes > session.size) {
      res.status(400).json({ error: "Chunk exceeds declared file size", code: "chunk_out_of_bounds" });
      return;
    }

    logMediaEvent("info", "Appending upload chunk", {
      ...getChunkRequestLogDetails(req, res),
      chunkBytes: chunk.length,
      nextReceivedBytes,
      expectedBytes: session.size,
    });

    fs.appendFileSync(getUploadSessionDataPath(project, uploadId), chunk);
    session.receivedBytes = nextReceivedBytes;
    session.nextChunkIndex += 1;
    writeUploadSession(project, session);

    res.json({
      uploadId,
      receivedBytes: session.receivedBytes,
      nextChunkIndex: session.nextChunkIndex,
      complete: session.receivedBytes === session.size,
    });
  } catch (error) {
    logMediaEvent("error", "Failed while appending upload chunk", {
      ...getChunkRequestLogDetails(req, res),
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Could not persist the uploaded chunk",
      code: "chunk_write_failed",
    });
  }
};

export const serveChunkedMediaUploadSource: RequestHandler = (req, res) => {
  const project = normalizeProjectParam(req.params.project);
  const uploadId = typeof req.params.uploadId === "string" ? req.params.uploadId : "";
  const token = typeof req.query.token === "string" ? req.query.token : "";

  if (!isValidProjectPath(project) || !uploadId || !token) {
    res.status(400).json({ error: "Invalid upload source request" });
    return;
  }

  try {
    const session = readUploadSession(project, uploadId);
    if (!session) {
      res.status(404).json({ error: "Upload session not found", code: "upload_session_not_found" });
      return;
    }

    if (token !== session.accessToken) {
      res.status(403).json({ error: "Invalid upload token", code: "invalid_upload_token" });
      return;
    }

    if (session.receivedBytes !== session.size) {
      res.status(409).json({
        error: "Upload is incomplete",
        code: "incomplete_upload",
        receivedBytes: session.receivedBytes,
        expectedBytes: session.size,
      });
      return;
    }

    const filePath = getUploadSessionDataPath(project, uploadId);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "Upload file not found", code: "upload_file_not_found" });
      return;
    }

    const stat = fs.statSync(filePath);
    logMediaEvent("info", "Serving chunked upload source for Builder fetch", {
      project,
      uploadId,
      bytes: stat.size,
      mimeType: session.mimeType,
      method: req.method,
      range: req.headers.range,
    });

    streamMediaFile(req, res, {
      filePath,
      mimeType: session.mimeType,
      cacheControl: "private, max-age=300",
      streamErrorMessage: "Could not stream the upload source",
      streamErrorCode: "upload_source_stream_failed",
      logDetails: {
        project,
        uploadId,
      },
    });
  } catch (error) {
    logMediaEvent("error", "Failed while preparing chunked upload source", {
      project,
      uploadId,
      error: getErrorMessage(error),
    });
    res.status(500).json({ error: "Could not prepare the upload source", code: "upload_source_failed" });
  }
};

export const getChunkedMediaUploadStatus: RequestHandler = (req, res) => {
  const result = validateChunkUploadSession(req);
  if ("error" in result) {
    res.status(result.error.status).json(result.error.body);
    return;
  }

  res.json(getChunkedUploadStatusPayload(result.session));
};

export const completeChunkedMediaUpload: RequestHandler = async (req, res) => {
  const apiKey = req.headers["x-builder-api-key"] as string | undefined;
  const privateKey = req.headers["x-builder-private-key"] as string | undefined;

  const result = validateChunkUploadSession(req);
  if ("error" in result) {
    res.status(result.error.status).json(result.error.body);
    return;
  }

  const { project, uploadId, session } = result;

  if (session.receivedBytes !== session.size) {
    res.status(400).json({
      error: "Upload is incomplete",
      code: "incomplete_upload",
      receivedBytes: session.receivedBytes,
      expectedBytes: session.size,
    });
    return;
  }

  if (session.status === "complete" && session.resultMetadata) {
    res.json({
      ...getChunkedUploadStatusPayload(session),
      ...session.resultMetadata,
    });
    return;
  }

  if (session.status === "failed") {
    res.status(409).json({
      ...getChunkedUploadStatusPayload(session),
      code: "chunked_upload_failed",
    });
    return;
  }

  if (session.status !== "processing") {
    const dataPath = getUploadSessionDataPath(project, uploadId);
    if (!fs.existsSync(dataPath)) {
      res.status(404).json({ error: "Upload file not found", code: "upload_file_not_found" });
      return;
    }

    const stat = fs.statSync(dataPath);
    if (stat.size !== session.size) {
      res.status(400).json({
        error: "Upload size mismatch",
        code: "upload_size_mismatch",
        receivedBytes: stat.size,
        expectedBytes: session.size,
      });
      return;
    }

    session.status = "processing";
    session.processingStartedAt = Date.now();
    session.completedAt = undefined;
    session.failureMessage = undefined;
    session.uploadFilename = session.uploadFilename || generateFilename(session.originalName);
    writeUploadSession(project, session);

    logMediaEvent("info", "Queued chunked media upload for background Builder processing", {
      project,
      uploadId,
      filename: session.originalName,
      uploadFilename: session.uploadFilename,
      bytes: stat.size,
      mimeType: session.mimeType,
    });
  }

  const sourceUrl = getChunkedUploadSourceUrl(req, project, session);
  startChunkedMediaUploadProcessing({
    project,
    uploadId,
    sourceUrl,
    apiKey,
    privateKey,
  });

  res.status(202).json(getChunkedUploadStatusPayload(session));
};

export const uploadMedia: RequestHandler = async (req, res) => {
  try {
    const project = normalizeProjectParam(req.params.project);
    const file = req.file;
    const apiKey = req.headers["x-builder-api-key"] as string;
    const privateKey = req.headers["x-builder-private-key"] as string;

    if (!isValidProjectPath(project)) {
      res.status(400).json({ error: "Invalid project slug" });
      return;
    }

    if (!file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }

    const filename = generateFilename(file.originalname);
    const mimeType = getMimeType(file.originalname, file.mimetype);
    const isVideo = ALLOWED_VIDEO_TYPES.includes(mimeType);
    const uploadMimeType = mimeType === "image/svg+xml" ? "image/svg+xml" : mimeType;

    const cdnUrl = await uploadBufferToBuilderCDN(filename, file.buffer, uploadMimeType, {
      apiKey,
      privateKey,
    });

    const metadata = saveMediaMetadata(project, {
      filename,
      url: cdnUrl,
      type: isVideo ? "video" : "image",
      size: file.size,
      mimeType,
    });

    res.json(metadata);
  } catch (err: any) {
    if (err instanceof BuilderUploadError) {
      sendBuilderUploadError(res, req, err);
      return;
    }

    console.error("[media] Upload failed", {
      project: normalizeProjectParam(req.params.project),
      filename: req.file?.originalname,
      size: req.file?.size,
      error: err?.message || String(err),
    });
    res.status(500).json({ error: err.message || "Upload failed", code: "media_upload_failed" });
  }
};

export const serveMedia: RequestHandler = (req, res) => {
  const project = normalizeProjectParam(req.params.project);
  const { filename } = req.params;

  if (!isValidProjectPath(project) || !filename) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const safeName = path.basename(filename);
  const filePath = path.join(getMediaDir(project), safeName);

  if (!fs.existsSync(filePath)) {
    const jsonPath = path.join(getMediaDir(project), `${safeName}.json`);
    if (fs.existsSync(jsonPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
        if (meta && meta.url) {
          res.redirect(302, normalizeBuilderAssetUrl(meta.url));
          return;
        }
      } catch {
      }
    }

    res.status(404).json({ error: "File not found" });
    return;
  }

  const contentType = getMimeType(safeName, "application/octet-stream");

  streamMediaFile(req, res, {
    filePath,
    mimeType: contentType,
    cacheControl: "public, max-age=31536000, immutable",
    streamErrorMessage: "Could not stream the media file",
    streamErrorCode: "media_stream_failed",
    logDetails: {
      project,
      filename: safeName,
    },
  });
};

export const listMedia: RequestHandler = (req, res) => {
  const project = normalizeProjectParam(req.params.project);

  if (!isValidProjectPath(project)) {
    res.status(400).json({ error: "Invalid project slug" });
    return;
  }

  const mediaDir = getMediaDir(project);
  if (!fs.existsSync(mediaDir)) {
    res.json({ files: [] });
    return;
  }

  const entries = fs.readdirSync(mediaDir);
  const files: any[] = [];

  for (const name of entries) {
    const ext = path.extname(name).toLowerCase();
    const filePath = path.join(mediaDir, name);

    if (ext === ".json") {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        files.push({
          ...data,
          url: typeof data?.url === "string" ? normalizeBuilderAssetUrl(data.url) : data?.url,
        });
      } catch {
      }
    } else if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".mp4", ".webm", ".mov"].includes(ext)) {
      const stat = fs.statSync(filePath);
      const isVideo = [".mp4", ".webm", ".mov"].includes(ext);
      const mimeTypes: Record<string, string> = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".mov": "video/quicktime",
      };
      files.push({
        filename: name,
        url: `/api/projects/${project}/media/${name}`,
        type: isVideo ? "video" : "image",
        size: stat.size,
        mimeType: mimeTypes[ext] || "application/octet-stream",
        modifiedAt: stat.mtimeMs,
      });
    }
  }

  files.sort((a, b) => b.modifiedAt - a.modifiedAt);

  res.json({ files });
};

export const bulkDeleteMedia: RequestHandler = (req, res) => {
  const project = normalizeProjectParam(req.params.project);
  const { filenames } = req.body as { filenames?: string[] };

  if (!isValidProjectPath(project)) {
    res.status(400).json({ error: "Invalid project slug" });
    return;
  }

  if (!Array.isArray(filenames) || filenames.length === 0) {
    res.status(400).json({ error: "filenames array is required" });
    return;
  }

  const mediaDir = getMediaDir(project);
  const deleted: string[] = [];
  const errors: string[] = [];

  for (const filename of filenames) {
    const safeName = path.basename(filename);
    const filePath = path.join(mediaDir, safeName);
    const jsonPath = path.join(mediaDir, `${safeName}.json`);

    let deletedFile = false;

    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        deletedFile = true;
      }
      if (fs.existsSync(jsonPath)) {
        fs.unlinkSync(jsonPath);
        deletedFile = true;
      }

      if (deletedFile) {
        deleted.push(safeName);
      } else {
        errors.push(`${safeName}: not found`);
      }
    } catch (e: any) {
      errors.push(`${safeName}: ${e.message}`);
    }
  }

  res.json({ deleted, errors });
};

export const deleteMedia: RequestHandler = (req, res) => {
  const project = normalizeProjectParam(req.params.project);
  const { filename } = req.params;

  if (!isValidProjectPath(project) || !filename) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const safeName = path.basename(filename);
  const filePath = path.join(getMediaDir(project), safeName);
  const jsonPath = path.join(getMediaDir(project), `${safeName}.json`);

  let deleted = false;
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    deleted = true;
  }
  if (fs.existsSync(jsonPath)) {
    fs.unlinkSync(jsonPath);
    deleted = true;
  }

  if (!deleted) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  res.json({ success: true });
};
