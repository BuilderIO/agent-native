import {
  defineEventHandler,
  getQuery,
  getRequestHeader,
  getRouterParam,
  readBody,
  readMultipartFormData,
  readRawBody,
  sendRedirect,
  sendStream,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";
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
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES];
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const CHUNK_SIZE = 1 * 1024 * 1024;
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
  details: Record<string, unknown>,
) {
  const log =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : console.info;
  log(`[media] ${message}`, details);
}

function isLoopbackHost(value: string): boolean {
  try {
    const parsed = new URL(value.includes("://") ? value : `https://${value}`);
    return (
      ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(parsed.hostname) ||
      parsed.hostname.endsWith(".local")
    );
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

function parseByteRange(
  rangeHeader: string | undefined,
  size: number,
): ByteRange | null {
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

async function streamMediaFileH3(
  event: H3Event,
  options: {
    filePath: string;
    mimeType: string;
    cacheControl: string;
    streamErrorMessage: string;
    streamErrorCode: string;
    logDetails: Record<string, unknown>;
  },
) {
  const {
    filePath,
    mimeType,
    cacheControl,
    streamErrorMessage,
    streamErrorCode,
    logDetails,
  } = options;
  const stat = fs.statSync(filePath);
  const rangeHeader = getRequestHeader(event, "range");
  const range = parseByteRange(rangeHeader, stat.size);

  setResponseHeader(event, "Content-Type", mimeType);
  setResponseHeader(event, "Accept-Ranges", "bytes");
  setResponseHeader(event, "Cache-Control", cacheControl);

  if (range) {
    const contentLength = range.end - range.start + 1;
    setResponseStatus(event, 206);
    setResponseHeader(event, "Content-Length", contentLength);
    setResponseHeader(
      event,
      "Content-Range",
      `bytes ${range.start}-${range.end}/${stat.size}`,
    );

    if (event.node.req.method === "HEAD") {
      event.node.res.end();
      return;
    }

    const stream = fs.createReadStream(filePath, {
      start: range.start,
      end: range.end,
    });
    return sendStream(event, stream);
  }

  setResponseHeader(event, "Content-Length", stat.size);

  if (event.node.req.method === "HEAD") {
    event.node.res.end();
    return;
  }

  const stream = fs.createReadStream(filePath);
  return sendStream(event, stream);
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

function getUploadSessionMetaPath(
  projectSlug: string,
  uploadId: string,
): string {
  return path.join(getUploadSessionDir(projectSlug, uploadId), "session.json");
}

function getUploadSessionDataPath(
  projectSlug: string,
  uploadId: string,
): string {
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

function saveMediaMetadata(
  project: string,
  metadata: MediaMetadata,
): SavedMediaMetadata {
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
    JSON.stringify({ ...normalizedMetadata, modifiedAt }, null, 2),
  );

  return {
    ...normalizedMetadata,
    modifiedAt,
  };
}

function normalizeAllowedMimeType(
  originalName: string,
  mimeType: string,
): string {
  return getMimeType(originalName, mimeType || "application/octet-stream");
}

function isAllowedMediaType(originalName: string, mimeType: string): boolean {
  const normalizedMimeType = normalizeAllowedMimeType(originalName, mimeType);
  if (ALLOWED_TYPES.includes(normalizedMimeType)) return true;

  const ext = path.extname(originalName).toLowerCase();
  const allowedExtensions = [
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".svg",
    ".mp4",
    ".webm",
    ".mov",
  ];
  return (
    allowedExtensions.includes(ext) ||
    normalizedMimeType.startsWith("image/") ||
    normalizedMimeType.startsWith("video/")
  );
}

function isUploadSessionExpired(session: UploadSession): boolean {
  return session.expiresAt <= Date.now();
}

function cleanupExpiredUploadSessions() {
  if (!fs.existsSync(TEMP_UPLOADS_ROOT)) return;

  for (const projectEntry of fs.readdirSync(TEMP_UPLOADS_ROOT, {
    withFileTypes: true,
  })) {
    if (!projectEntry.isDirectory()) continue;

    const projectDir = path.join(TEMP_UPLOADS_ROOT, projectEntry.name);
    for (const sessionEntry of fs.readdirSync(projectDir, {
      withFileTypes: true,
    })) {
      if (!sessionEntry.isDirectory()) continue;

      const sessionDir = path.join(projectDir, sessionEntry.name);
      const metaPath = path.join(sessionDir, "session.json");

      if (!fs.existsSync(metaPath)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
        continue;
      }

      try {
        const session = JSON.parse(
          fs.readFileSync(metaPath, "utf-8"),
        ) as UploadSession;
        if (isUploadSessionExpired(session)) {
          fs.rmSync(sessionDir, { recursive: true, force: true });
        }
      } catch {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }
    }
  }
}

function createUploadSession(
  project: string,
  file: {
    originalName: string;
    size: number;
    mimeType: string;
  },
): UploadSession {
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

  fs.writeFileSync(
    getUploadSessionMetaPath(project, uploadId),
    JSON.stringify(session, null, 2),
  );
  fs.writeFileSync(
    getUploadSessionDataPath(project, uploadId),
    Buffer.alloc(0),
  );
  return session;
}

function readUploadSession(
  project: string,
  uploadId: string,
): UploadSession | null {
  const metaPath = getUploadSessionMetaPath(project, uploadId);
  if (!fs.existsSync(metaPath)) return null;

  try {
    const session = JSON.parse(
      fs.readFileSync(metaPath, "utf-8"),
    ) as UploadSession;
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
    JSON.stringify(session, null, 2),
  );
}

function deleteUploadSession(project: string, uploadId: string) {
  fs.rmSync(getUploadSessionDir(project, uploadId), {
    recursive: true,
    force: true,
  });
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
    error:
      session.status === "failed"
        ? session.failureMessage || "Upload failed"
        : undefined,
    result: session.status === "complete" ? session.resultMetadata : undefined,
  };
}

function markChunkedUploadFailed(
  project: string,
  uploadId: string,
  error: unknown,
) {
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

      const filename =
        session.uploadFilename || generateFilename(session.originalName);
      const mimeType = normalizeAllowedMimeType(
        session.originalName,
        session.mimeType,
      );
      const isVideo = ALLOWED_VIDEO_TYPES.includes(mimeType);
      const dataPath = getUploadSessionDataPath(project, uploadId);

      if (!fs.existsSync(dataPath)) {
        throw new Error("Upload file not found");
      }

      const stat = fs.statSync(dataPath);
      if (stat.size !== session.size) {
        throw new Error("Upload size mismatch");
      }

      logMediaEvent(
        "info",
        "Starting Builder CDN upload for completed chunked media",
        {
          project,
          uploadId,
          filename,
          bytes: stat.size,
          mimeType,
          uploadMode: "source-url",
          retries: isVideo ? BUILDER_VIDEO_UPLOAD_RETRIES : 0,
        },
      );

      const cdnUrl = await uploadUrlToBuilderCDN(filename, sourceUrl, {
        apiKey,
        privateKey,
        retries: isVideo ? BUILDER_VIDEO_UPLOAD_RETRIES : 0,
      });

      logMediaEvent(
        "info",
        "Completed Builder CDN upload for completed chunked media",
        {
          project,
          uploadId,
          filename,
          bytes: stat.size,
          mimeType,
          uploadMode: "source-url",
          durationMs: Date.now() - startedAt,
          cdnUrl,
        },
      );

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
        logMediaEvent(
          "error",
          "Builder media upload failed during chunked processing",
          {
            project,
            uploadId,
            durationMs: Date.now() - startedAt,
            status: error.status,
            code: error.code,
            response: error.responseBody.slice(0, 500),
          },
        );
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

function getUploadToken(event: H3Event): string {
  const headerToken = getRequestHeader(event, "x-upload-token");
  if (typeof headerToken === "string") return headerToken;
  const q = getQuery(event);
  return typeof q.token === "string" ? q.token : "";
}

function getRequestBaseUrl(event: H3Event, project: string): string {
  const envOrigin = process.env.APP_ORIGIN?.trim();
  if (envOrigin) {
    try {
      return new URL(envOrigin).origin;
    } catch {
      throw new Error("APP_ORIGIN is not a valid absolute URL");
    }
  }

  const originHeader = (getRequestHeader(event, "origin") || "").trim();
  if (originHeader && !isLoopbackHost(originHeader)) {
    try {
      return new URL(originHeader).origin;
    } catch {
      logMediaEvent(
        "warn",
        "Ignoring invalid origin header during Builder upload handoff",
        { originHeader, project },
      );
    }
  }

  const refererHeader = (getRequestHeader(event, "referer") || "").trim();
  if (refererHeader && !isLoopbackHost(refererHeader)) {
    try {
      return new URL(refererHeader).origin;
    } catch {
      logMediaEvent(
        "warn",
        "Ignoring invalid referer header during Builder upload handoff",
        { refererHeader, project },
      );
    }
  }

  const forwardedProto = (getRequestHeader(event, "x-forwarded-proto") || "")
    .split(",")[0]
    ?.trim();
  const forwardedHost = (getRequestHeader(event, "x-forwarded-host") || "")
    .split(",")[0]
    ?.trim();
  const host = forwardedHost || getRequestHeader(event, "host")?.trim() || "";
  const protocol = forwardedProto || "https";

  if (host && !isLoopbackHost(host)) {
    return `${protocol}://${host}`;
  }

  throw new Error(
    "Public upload origin is unavailable. Set APP_ORIGIN to the public app URL before uploading large videos.",
  );
}

function getChunkedUploadSourceUrl(
  event: H3Event,
  project: string,
  session: UploadSession,
): string {
  const baseUrl = getRequestBaseUrl(event, project);
  const pathname = `/api/projects/${project}/media/chunked/${session.id}/source`;
  const url = new URL(pathname, `${baseUrl}/`);
  url.searchParams.set("token", session.accessToken);
  return url.toString();
}

function validateChunkUploadSession(
  event: H3Event,
  project: string,
  uploadId: string,
) {
  const uploadToken = getUploadToken(event);

  if (!isValidProjectPath(project) || !uploadId) {
    return {
      error: {
        status: 400,
        body: {
          error: "Invalid upload request",
          code: "invalid_upload_request",
        },
      },
    };
  }

  if (!uploadToken) {
    return {
      error: {
        status: 401,
        body: {
          error: "Upload token is required",
          code: "missing_upload_token",
        },
      },
    };
  }

  const session = readUploadSession(project, uploadId);
  if (!session) {
    return {
      error: {
        status: 404,
        body: {
          error: "Upload session not found",
          code: "upload_session_not_found",
        },
      },
    };
  }

  if (uploadToken !== session.accessToken) {
    return {
      error: {
        status: 403,
        body: { error: "Invalid upload token", code: "invalid_upload_token" },
      },
    };
  }

  return { project, uploadId, session };
}

export const initializeChunkedMediaUpload = defineEventHandler(
  async (event: H3Event) => {
    const projectParam = getRouterParam(event, "project") || "";
    const project = normalizeProjectParam(projectParam);
    const { originalName, size, mimeType } = (await readBody(event)) as {
      originalName?: string;
      size?: number;
      mimeType?: string;
    };

    if (!isValidProjectPath(project)) {
      setResponseStatus(event, 400);
      return { error: "Invalid project slug" };
    }

    if (!originalName || typeof size !== "number" || !mimeType) {
      setResponseStatus(event, 400);
      return {
        error: "Missing upload metadata",
        code: "missing_upload_metadata",
      };
    }

    if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_SIZE) {
      setResponseStatus(event, 413);
      return {
        error: `File too large. Max upload size is ${Math.round(MAX_FILE_SIZE / (1024 * 1024))}MB.`,
        code: "file_too_large",
        maxBytes: MAX_FILE_SIZE,
      };
    }

    if (!isAllowedMediaType(originalName, mimeType)) {
      setResponseStatus(event, 400);
      return {
        error: `File type ${mimeType} not allowed`,
        code: "invalid_media_upload",
      };
    }

    try {
      logMediaEvent("info", "Initializing chunked media upload", {
        project,
        originalName,
        size,
        mimeType,
      });

      const session = createUploadSession(project, {
        originalName,
        size,
        mimeType,
      });
      return {
        uploadId: session.id,
        uploadToken: session.accessToken,
        chunkSize: CHUNK_SIZE,
        totalChunks: Math.ceil(size / CHUNK_SIZE),
      };
    } catch (error) {
      logMediaEvent("error", "Failed to initialize chunked media upload", {
        project,
        originalName,
        size,
        mimeType,
        error: getErrorMessage(error),
      });
      setResponseStatus(event, 500);
      return {
        error: "Could not create an upload session",
        code: "upload_session_create_failed",
      };
    }
  },
);

export const appendChunkedMediaUpload = defineEventHandler(
  async (event: H3Event) => {
    const projectParam = getRouterParam(event, "project") || "";
    const project = normalizeProjectParam(projectParam);
    const uploadId = getRouterParam(event, "uploadId") || "";
    const q = getQuery(event);
    const chunkIndex = getChunkIndex(q.index);

    logMediaEvent("info", "Chunk append handler entered", {
      project,
      uploadId,
      chunkIndex,
    });

    if (!isValidProjectPath(project) || !uploadId) {
      setResponseStatus(event, 400);
      return { error: "Invalid upload request" };
    }

    if (chunkIndex === null) {
      setResponseStatus(event, 400);
      return { error: "Chunk index is required", code: "missing_chunk_index" };
    }

    // Validate session and token
    const authResult = validateChunkUploadSession(event, project, uploadId);
    if ("error" in authResult) {
      setResponseStatus(event, authResult.error.status);
      return authResult.error.body;
    }

    try {
      const session = readUploadSession(project, uploadId);
      if (!session) {
        setResponseStatus(event, 404);
        return {
          error: "Upload session not found",
          code: "upload_session_not_found",
        };
      }

      if (session.status !== "uploading") {
        setResponseStatus(event, 409);
        return {
          error: `Upload can no longer accept chunks while ${session.status}.`,
          code: "upload_not_appendable",
          status: session.status,
        };
      }

      if (chunkIndex !== session.nextChunkIndex) {
        setResponseStatus(event, 409);
        return {
          error: `Unexpected chunk index ${chunkIndex}. Expected ${session.nextChunkIndex}.`,
          code: "unexpected_chunk_index",
          expectedChunkIndex: session.nextChunkIndex,
        };
      }

      const rawBody = await readRawBody(event, false);
      const chunk = rawBody
        ? Buffer.isBuffer(rawBody)
          ? rawBody
          : Buffer.from(rawBody)
        : Buffer.alloc(0);

      if (chunk.length === 0) {
        setResponseStatus(event, 400);
        return {
          error: "Chunk body is required",
          code: "missing_chunk_body",
        };
      }

      if (chunk.length > CHUNK_SIZE) {
        setResponseStatus(event, 413);
        return {
          error: `Chunk too large. Max chunk size is ${Math.round(CHUNK_SIZE / (1024 * 1024))}MB.`,
          code: "chunk_too_large",
          maxBytes: CHUNK_SIZE,
        };
      }

      const nextReceivedBytes = session.receivedBytes + chunk.length;
      if (nextReceivedBytes > session.size) {
        setResponseStatus(event, 400);
        return {
          error: "Chunk exceeds declared file size",
          code: "chunk_out_of_bounds",
        };
      }

      logMediaEvent("info", "Appending upload chunk", {
        project,
        uploadId,
        chunkIndex,
        chunkBytes: chunk.length,
        nextReceivedBytes,
        expectedBytes: session.size,
      });

      fs.appendFileSync(getUploadSessionDataPath(project, uploadId), chunk);
      session.receivedBytes = nextReceivedBytes;
      session.nextChunkIndex += 1;
      writeUploadSession(project, session);

      return {
        uploadId,
        receivedBytes: session.receivedBytes,
        nextChunkIndex: session.nextChunkIndex,
        complete: session.receivedBytes === session.size,
      };
    } catch (error) {
      logMediaEvent("error", "Failed while appending upload chunk", {
        project,
        uploadId,
        chunkIndex,
        error: getErrorMessage(error),
      });
      setResponseStatus(event, 500);
      return {
        error: "Could not persist the uploaded chunk",
        code: "chunk_write_failed",
      };
    }
  },
);

export const serveChunkedMediaUploadSource = defineEventHandler(
  async (event: H3Event) => {
    const projectParam = getRouterParam(event, "project") || "";
    const project = normalizeProjectParam(projectParam);
    const uploadId = getRouterParam(event, "uploadId") || "";
    const q = getQuery(event);
    const token = typeof q.token === "string" ? q.token : "";

    if (!isValidProjectPath(project) || !uploadId || !token) {
      setResponseStatus(event, 400);
      return { error: "Invalid upload source request" };
    }

    try {
      const session = readUploadSession(project, uploadId);
      if (!session) {
        setResponseStatus(event, 404);
        return {
          error: "Upload session not found",
          code: "upload_session_not_found",
        };
      }

      if (token !== session.accessToken) {
        setResponseStatus(event, 403);
        return {
          error: "Invalid upload token",
          code: "invalid_upload_token",
        };
      }

      if (session.receivedBytes !== session.size) {
        setResponseStatus(event, 409);
        return {
          error: "Upload is incomplete",
          code: "incomplete_upload",
          receivedBytes: session.receivedBytes,
          expectedBytes: session.size,
        };
      }

      const filePath = getUploadSessionDataPath(project, uploadId);
      if (!fs.existsSync(filePath)) {
        setResponseStatus(event, 404);
        return {
          error: "Upload file not found",
          code: "upload_file_not_found",
        };
      }

      const stat = fs.statSync(filePath);
      logMediaEvent("info", "Serving chunked upload source for Builder fetch", {
        project,
        uploadId,
        bytes: stat.size,
        mimeType: session.mimeType,
        method: event.node.req.method,
        range: getRequestHeader(event, "range"),
      });

      return streamMediaFileH3(event, {
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
      setResponseStatus(event, 500);
      return {
        error: "Could not prepare the upload source",
        code: "upload_source_failed",
      };
    }
  },
);

export const getChunkedMediaUploadStatus = defineEventHandler(
  (event: H3Event) => {
    const projectParam = getRouterParam(event, "project") || "";
    const project = normalizeProjectParam(projectParam);
    const uploadId = getRouterParam(event, "uploadId") || "";
    const result = validateChunkUploadSession(event, project, uploadId);
    if ("error" in result) {
      setResponseStatus(event, result.error.status);
      return result.error.body;
    }

    return getChunkedUploadStatusPayload(result.session);
  },
);

export const completeChunkedMediaUpload = defineEventHandler(
  async (event: H3Event) => {
    const apiKey = getRequestHeader(event, "x-builder-api-key");
    const privateKey = getRequestHeader(event, "x-builder-private-key");

    const projectParam = getRouterParam(event, "project") || "";
    const project = normalizeProjectParam(projectParam);
    const uploadId = getRouterParam(event, "uploadId") || "";
    const result = validateChunkUploadSession(event, project, uploadId);
    if ("error" in result) {
      setResponseStatus(event, result.error.status);
      return result.error.body;
    }

    const { session } = result;

    if (session.receivedBytes !== session.size) {
      setResponseStatus(event, 400);
      return {
        error: "Upload is incomplete",
        code: "incomplete_upload",
        receivedBytes: session.receivedBytes,
        expectedBytes: session.size,
      };
    }

    if (session.status === "complete" && session.resultMetadata) {
      return {
        ...getChunkedUploadStatusPayload(session),
        ...session.resultMetadata,
      };
    }

    if (session.status === "failed") {
      setResponseStatus(event, 409);
      return {
        ...getChunkedUploadStatusPayload(session),
        code: "chunked_upload_failed",
      };
    }

    if (session.status !== "processing") {
      const dataPath = getUploadSessionDataPath(project, uploadId);
      if (!fs.existsSync(dataPath)) {
        setResponseStatus(event, 404);
        return {
          error: "Upload file not found",
          code: "upload_file_not_found",
        };
      }

      const stat = fs.statSync(dataPath);
      if (stat.size !== session.size) {
        setResponseStatus(event, 400);
        return {
          error: "Upload size mismatch",
          code: "upload_size_mismatch",
          receivedBytes: stat.size,
          expectedBytes: session.size,
        };
      }

      session.status = "processing";
      session.processingStartedAt = Date.now();
      session.completedAt = undefined;
      session.failureMessage = undefined;
      session.uploadFilename =
        session.uploadFilename || generateFilename(session.originalName);
      writeUploadSession(project, session);

      logMediaEvent(
        "info",
        "Queued chunked media upload for background Builder processing",
        {
          project,
          uploadId,
          filename: session.originalName,
          uploadFilename: session.uploadFilename,
          bytes: stat.size,
          mimeType: session.mimeType,
        },
      );
    }

    const sourceUrl = getChunkedUploadSourceUrl(event, project, session);
    startChunkedMediaUploadProcessing({
      project,
      uploadId,
      sourceUrl,
      apiKey,
      privateKey,
    });

    setResponseStatus(event, 202);
    return getChunkedUploadStatusPayload(session);
  },
);

export const uploadMedia = defineEventHandler(async (event: H3Event) => {
  try {
    const projectParam = getRouterParam(event, "project") || "";
    const project = normalizeProjectParam(projectParam);
    const apiKey = getRequestHeader(event, "x-builder-api-key");
    const privateKey = getRequestHeader(event, "x-builder-private-key");

    if (!isValidProjectPath(project)) {
      setResponseStatus(event, 400);
      return { error: "Invalid project slug" };
    }

    const parts = await readMultipartFormData(event);
    const filePart = parts?.find((p) => p.name === "file");

    if (!filePart) {
      setResponseStatus(event, 400);
      return { error: "No file provided" };
    }

    const originalname = filePart.filename || "upload";
    const mimeType = getMimeType(
      originalname,
      filePart.type || "application/octet-stream",
    );

    if (!isAllowedMediaType(originalname, mimeType)) {
      setResponseStatus(event, 400);
      return {
        error: `File type ${mimeType} not allowed`,
        code: "invalid_media_upload",
      };
    }

    if (filePart.data.length > MAX_FILE_SIZE) {
      setResponseStatus(event, 413);
      return {
        error: `File too large. Max upload size is ${Math.round(MAX_FILE_SIZE / (1024 * 1024))}MB.`,
        code: "file_too_large",
        maxBytes: MAX_FILE_SIZE,
      };
    }

    const filename = generateFilename(originalname);
    const isVideo = ALLOWED_VIDEO_TYPES.includes(mimeType);
    const uploadMimeType =
      mimeType === "image/svg+xml" ? "image/svg+xml" : mimeType;

    const cdnUrl = await uploadBufferToBuilderCDN(
      filename,
      filePart.data,
      uploadMimeType,
      {
        apiKey,
        privateKey,
      },
    );

    const metadata = saveMediaMetadata(project, {
      filename,
      url: cdnUrl,
      type: isVideo ? "video" : "image",
      size: filePart.data.length,
      mimeType,
    });

    return metadata;
  } catch (err: any) {
    if (err instanceof BuilderUploadError) {
      console.error("[media] Builder media upload failed", {
        status: err.status,
        code: err.code,
        response: err.responseBody.slice(0, 500),
      });
      setResponseStatus(event, err.status || 502);
      return {
        error: err.message,
        code: err.code,
        details: err.responseBody || undefined,
      };
    }

    console.error("[media] Upload failed", {
      error: err?.message || String(err),
    });
    setResponseStatus(event, 500);
    return {
      error: err.message || "Upload failed",
      code: "media_upload_failed",
    };
  }
});

export const serveMedia = defineEventHandler(async (event: H3Event) => {
  const projectParam = getRouterParam(event, "project") || "";
  const project = normalizeProjectParam(projectParam);
  const filename = getRouterParam(event, "filename") || "";

  if (!isValidProjectPath(project) || !filename) {
    setResponseStatus(event, 400);
    return { error: "Invalid request" };
  }

  const safeName = path.basename(filename);
  const filePath = path.join(getMediaDir(project), safeName);

  if (!fs.existsSync(filePath)) {
    const jsonPath = path.join(getMediaDir(project), `${safeName}.json`);
    if (fs.existsSync(jsonPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
        if (meta && meta.url) {
          return sendRedirect(event, normalizeBuilderAssetUrl(meta.url), 302);
        }
      } catch {}
    }

    setResponseStatus(event, 404);
    return { error: "File not found" };
  }

  const contentType = getMimeType(safeName, "application/octet-stream");

  return streamMediaFileH3(event, {
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
});

export const listMedia = defineEventHandler((event: H3Event) => {
  const projectParam = getRouterParam(event, "project") || "";
  const project = normalizeProjectParam(projectParam);

  if (!isValidProjectPath(project)) {
    setResponseStatus(event, 400);
    return { error: "Invalid project slug" };
  }

  const mediaDir = getMediaDir(project);
  if (!fs.existsSync(mediaDir)) {
    return { files: [] };
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
          url:
            typeof data?.url === "string"
              ? normalizeBuilderAssetUrl(data.url)
              : data?.url,
        });
      } catch {}
    } else if (
      [
        ".jpg",
        ".jpeg",
        ".png",
        ".gif",
        ".webp",
        ".svg",
        ".mp4",
        ".webm",
        ".mov",
      ].includes(ext)
    ) {
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

  return { files };
});

export const bulkDeleteMedia = defineEventHandler(async (event: H3Event) => {
  const projectParam = getRouterParam(event, "project") || "";
  const project = normalizeProjectParam(projectParam);
  const { filenames } = (await readBody(event)) as { filenames?: string[] };

  if (!isValidProjectPath(project)) {
    setResponseStatus(event, 400);
    return { error: "Invalid project slug" };
  }

  if (!Array.isArray(filenames) || filenames.length === 0) {
    setResponseStatus(event, 400);
    return { error: "filenames array is required" };
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

  return { deleted, errors };
});

export const deleteMedia = defineEventHandler((event: H3Event) => {
  const projectParam = getRouterParam(event, "project") || "";
  const project = normalizeProjectParam(projectParam);
  const filename = getRouterParam(event, "filename") || "";

  if (!isValidProjectPath(project) || !filename) {
    setResponseStatus(event, 400);
    return { error: "Invalid request" };
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
    setResponseStatus(event, 404);
    return { error: "File not found" };
  }

  return { success: true };
});
