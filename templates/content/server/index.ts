import "dotenv/config";
import fs from "fs";
import express from "express";
import cors from "cors";
import chokidar from "chokidar";
import type { FSWatcher } from "chokidar";
import path from "path";
import crypto from "crypto";
import { createServer } from "@agent-native/core/server";
import { envKeys } from "./lib/env-config.js";
import {
  listProjects,
  createProject,
  createProjectGroup,
  deleteProject,
  renameProject,
  moveProject,
  getFileTree,
  getFile,
  saveFile,
  createFile,
  deleteFile,
  updateProjectMeta,
  getVersionHistory,
  getVersionContent,
  restoreVersion,
  createFolder,
  deleteFolder,
  renameFolder,
} from "./routes/projects";
import {
  getSharedTree,
  getSharedFile,
  serveSharedAsset,
  saveSharedFile,
  createSharedFile,
  deleteSharedFile,
  getImageFolders,
  sharedImageUploadMiddleware,
  uploadSharedImages,
  deleteSharedImage,
} from "./routes/shared";
import {
  getWorkspaceSharedTree,
  getWorkspaceSharedFile,
  saveWorkspaceSharedFile,
  createWorkspaceSharedFile,
  deleteWorkspaceSharedFile,
} from "./routes/workspace-shared";
import {
  suggestKeywords,
  getKeywordVolume,
  getApiStatus,
  configureApi,
} from "./routes/keywords";
import {
  uploadMiddleware,
  chunkUploadMiddleware,
  initializeChunkedMediaUpload,
  requireChunkedUploadAccess,
  appendChunkedMediaUpload,
  getChunkedMediaUploadStatus,
  completeChunkedMediaUpload,
  serveChunkedMediaUploadSource,
  uploadMedia,
  serveMedia,
  deleteMedia,
  listMedia,
  bulkDeleteMedia,
} from "./routes/media";
import {
  uploadArticle,
  updateArticle,
  getAuthors,
  getArticles,
  getDocs,
  getBlogIndex,
  getDocsIndex,
  validateConnection,
  imageUploadMiddleware,
  uploadImage,
  saveAuth,
  clearAuth,
} from "./routes/builder";
import { testRoundtrip, fetchArticle } from "./routes/builder-convert";
import { getResearch, saveResearch } from "./routes/research";
import {
  searchTwitter,
  getArticle as getTwitterArticle,
  saveResults as saveTwitterResults,
  previewLink,
  fetchAsMarkdown,
} from "./routes/twitter";
import {
  generateImage,
  getImageGenStatus,
  configureImageGen,
  listPresets,
  createPreset,
  updatePresetHandler,
  deletePresetHandler,
} from "./routes/image-gen";
import { generateAltText } from "./routes/alt-text";
import { generateMetaDescription } from "./routes/meta-description";
import {
  saveSelection,
  getSelection,
  clearSelection,
} from "./routes/selection";
import { proxyUrl } from "./routes/proxy";
import { getClearbitLogo } from "./routes/clearbit";
import { getYouTubeTranscript } from "./routes/youtube";
import {
  searchGoogle,
  googleSearchStatus,
  configureGoogleSearch,
} from "./routes/google-search";
import {
  getPages,
  fetchPage,
  pushPage,
  getDatabaseSchema,
  getPageMeta,
} from "./routes/notion";
import { sendFeedback } from "./routes/feedback";
import { getPages as getPageTree } from "./routes/pages";
import {
  persistVersionHistory,
  resolveProjectVersionHistoryTarget,
  shouldSuppressWatcherVersionHistory,
  shouldTrackVersionHistory,
} from "./lib/version-history.js";

const contentDir = path.resolve(process.cwd(), "content");
let contentWatcher: FSWatcher | null = null;
const watcherPersistDebounceTimers = new Map<string, NodeJS.Timeout>();
const WATCHER_PERSIST_DEBOUNCE_MS = 250;

const persistHistoryForContentChange = async (changedPath: string) => {
  try {
    if (shouldSuppressWatcherVersionHistory(changedPath)) {
      return;
    }

    const target = resolveProjectVersionHistoryTarget(changedPath);
    if (!target || !shouldTrackVersionHistory(target.filePath)) {
      return;
    }

    const content = await fs.promises.readFile(changedPath, "utf-8");
    await persistVersionHistory({
      filePath: target.historyPath,
      content,
      fallbackTimestamp: Date.now(),
    });
  } catch (error) {
    console.error(
      "Failed to persist version history from file watcher:",
      error,
    );
  }
};

function getContentWatcher() {
  if (contentWatcher) {
    return contentWatcher;
  }

  contentWatcher = chokidar.watch(contentDir, {
    ignoreInitial: true,
    ignored: /\/media\/\.upload-sessions\//,
  });

  const scheduleHistoryPersistForContentChange = (changedPath: string) => {
    const normalizedPath = path.resolve(changedPath);
    const existingTimer = watcherPersistDebounceTimers.get(normalizedPath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      watcherPersistDebounceTimers.delete(normalizedPath);
      void persistHistoryForContentChange(normalizedPath);
    }, WATCHER_PERSIST_DEBOUNCE_MS);

    watcherPersistDebounceTimers.set(normalizedPath, timer);
  };

  contentWatcher.on("add", scheduleHistoryPersistForContentChange);
  contentWatcher.on("change", scheduleHistoryPersistForContentChange);

  return contentWatcher;
}

const CHUNK_UPLOAD_ROUTE =
  /^\/api\/projects\/.+\/media\/chunked\/[^/]+\/chunk$/;

function getRequestPath(req: express.Request): string {
  return req.originalUrl.split("?")[0] || req.originalUrl;
}

function isChunkUploadRequest(req: express.Request): boolean {
  return req.method === "POST" && CHUNK_UPLOAD_ROUTE.test(getRequestPath(req));
}

export function createAppServer() {
  const app = createServer({
    cors: {
      origin: true,
      credentials: true,
      methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "Accept",
        "Authorization",
        "Content-Type",
        "x-builder-api-key",
        "x-builder-private-key",
        "x-upload-token",
      ],
      maxAge: 86400,
    },
    pingMessage: "ok",
    envKeys,
  });

  app.options(
    /.*/,
    cors({
      origin: true,
      credentials: true,
      methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "Accept",
        "Authorization",
        "Content-Type",
        "x-builder-api-key",
        "x-builder-private-key",
        "x-upload-token",
      ],
      maxAge: 86400,
    }),
  );
  app.use(/^\/api\/projects\/.+\/media(?:\/.*)?$/, (req, _res, next) => {
    if (req.method === "OPTIONS") {
      console.info("[media] Upload preflight", {
        path: req.originalUrl,
        origin: req.headers.origin,
        requestMethod: req.headers["access-control-request-method"],
        requestHeaders: req.headers["access-control-request-headers"],
      });
    }
    next();
  });
  app.use((req, res, next) => {
    if (!isChunkUploadRequest(req)) {
      next();
      return;
    }

    const requestId = crypto.randomBytes(6).toString("hex");
    const path = getRequestPath(req);
    const startedAt = Date.now();
    let responseFinished = false;

    res.locals.uploadRequestId = requestId;

    console.info("[media] Chunk request received", {
      requestId,
      method: req.method,
      path,
      chunkIndex:
        typeof req.query.index === "string" ? req.query.index : undefined,
      contentLength: req.headers["content-length"],
      contentType: req.headers["content-type"],
      origin: req.headers.origin,
    });

    req.on("aborted", () => {
      console.warn("[media] Chunk request aborted", {
        requestId,
        method: req.method,
        path,
        chunkIndex:
          typeof req.query.index === "string" ? req.query.index : undefined,
        durationMs: Date.now() - startedAt,
      });
    });

    req.on("close", () => {
      console.info("[media] Chunk request stream closed", {
        requestId,
        method: req.method,
        path,
        chunkIndex:
          typeof req.query.index === "string" ? req.query.index : undefined,
        requestComplete: req.complete,
        durationMs: Date.now() - startedAt,
      });
    });

    res.on("finish", () => {
      responseFinished = true;
      console.info("[media] Chunk response finished", {
        requestId,
        method: req.method,
        path,
        chunkIndex:
          typeof req.query.index === "string" ? req.query.index : undefined,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });

    res.on("close", () => {
      if (responseFinished) return;
      console.warn("[media] Chunk response closed before finish", {
        requestId,
        method: req.method,
        path,
        chunkIndex:
          typeof req.query.index === "string" ? req.query.index : undefined,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });

    next();
  });

  // Pages API (unified page tree)
  app.get("/api/pages", getPageTree);

  // Project routes
  app.get("/api/projects", listProjects);
  app.post("/api/projects", createProject);
  app.post("/api/projects/groups", createProjectGroup);
  app.patch("/api/projects/*project/rename", renameProject);
  app.patch("/api/projects/*project/move", moveProject);
  app.patch("/api/projects/*project/meta", updateProjectMeta);

  // Folder CRUD (workspace-level organizational folders)
  app.post("/api/workspace/:workspace/folder", createFolder);
  app.delete("/api/workspace/:workspace/folder", deleteFolder);
  app.patch("/api/workspace/:workspace/folder", renameFolder);

  // Project file tree & CRUD (must be registered before the wildcard project delete)
  app.get("/api/projects/*project/tree", getFileTree);
  app.get("/api/projects/*project/file", getFile);
  app.put("/api/projects/*project/file", saveFile);
  app.post("/api/projects/*project/file", createFile);
  app.delete("/api/projects/*project/file", deleteFile);
  app.get("/api/projects/*project/version-history", getVersionHistory);
  app.get(
    "/api/projects/*project/version-history/:versionId",
    getVersionContent,
  );
  app.post("/api/projects/*project/restore-version", restoreVersion);

  // Shared resources
  app.get("/api/shared/tree", getSharedTree);
  app.get("/api/shared/asset", serveSharedAsset);
  app.get("/api/shared/file", getSharedFile);
  app.put("/api/shared/file", saveSharedFile);
  app.post("/api/shared/file", createSharedFile);
  app.delete("/api/shared/file", deleteSharedFile);
  app.get("/api/shared/image-folders", getImageFolders);
  app.post(
    "/api/shared/image-upload",
    sharedImageUploadMiddleware,
    uploadSharedImages,
  );
  app.delete("/api/shared/image", deleteSharedImage);

  // Workspace-scoped shared resources
  app.get("/api/workspace/:workspace/shared/tree", getWorkspaceSharedTree);
  app.get("/api/workspace/:workspace/shared/file", getWorkspaceSharedFile);
  app.put("/api/workspace/:workspace/shared/file", saveWorkspaceSharedFile);
  app.post("/api/workspace/:workspace/shared/file", createWorkspaceSharedFile);
  app.delete(
    "/api/workspace/:workspace/shared/file",
    deleteWorkspaceSharedFile,
  );

  // Media upload & serving
  app.get("/api/projects/*project/media", listMedia);
  app.post("/api/projects/*project/media", uploadMiddleware, uploadMedia);
  app.post(
    "/api/projects/*project/media/chunked/init",
    initializeChunkedMediaUpload,
  );
  app.post(
    "/api/projects/*project/media/chunked/:uploadId/chunk",
    requireChunkedUploadAccess,
    chunkUploadMiddleware,
    appendChunkedMediaUpload,
  );
  app.get(
    "/api/projects/*project/media/chunked/:uploadId/status",
    getChunkedMediaUploadStatus,
  );
  app.post(
    "/api/projects/*project/media/chunked/:uploadId/complete",
    completeChunkedMediaUpload,
  );
  app.get(
    "/api/projects/*project/media/chunked/:uploadId/source",
    serveChunkedMediaUploadSource,
  );
  app.post("/api/projects/*project/media/bulk-delete", bulkDeleteMedia);
  app.get("/api/projects/*project/media/:filename", serveMedia);
  app.delete("/api/projects/*project/media/:filename", deleteMedia);

  // Research
  app.get("/api/projects/*project/research", getResearch);
  app.put("/api/projects/*project/research", saveResearch);

  // Project delete (wildcard, must come after more specific routes)
  app.delete("/api/projects/*project", deleteProject);

  // Keyword research
  app.get("/api/keywords/suggest", suggestKeywords);
  app.post("/api/keywords/volume", getKeywordVolume);
  app.get("/api/keywords/status", getApiStatus);
  app.post("/api/keywords/configure", configureApi);

  // Image generation
  app.post("/api/image-gen/generate", generateImage);
  app.get("/api/image-gen/status", getImageGenStatus);
  app.post("/api/image-gen/configure", configureImageGen);

  // Alt text generation
  app.post("/api/alt-text/generate", generateAltText);

  // Meta description generation
  app.post("/api/meta-description/generate", generateMetaDescription);

  // Image presets
  app.get("/api/image-presets", listPresets);
  app.post("/api/image-presets", createPreset);
  app.put("/api/image-presets/:id", updatePresetHandler);
  app.delete("/api/image-presets/:id", deletePresetHandler);

  // Builder.io integration
  app.post("/api/builder/upload", uploadArticle);
  app.put("/api/builder/upload/:id", updateArticle);
  app.get("/api/builder/authors", getAuthors);
  app.get("/api/builder/articles", getArticles);
  app.get("/api/builder/docs", getDocs);
  app.get("/api/builder/blog-index", getBlogIndex);
  app.get("/api/builder/docs-index", getDocsIndex);
  app.post("/api/builder/validate", validateConnection);
  app.post("/api/builder/image", imageUploadMiddleware, uploadImage);
  app.post("/api/builder/auth", saveAuth);
  app.delete("/api/builder/auth", clearAuth);

  // Builder.io conversion testing
  app.post("/api/builder/test-roundtrip", testRoundtrip);
  app.post("/api/builder/fetch-article", fetchArticle);

  // Google search
  app.get("/api/google/search", searchGoogle);
  app.get("/api/google/status", googleSearchStatus);
  app.post("/api/google/configure", configureGoogleSearch);

  // Notion integration
  app.get("/api/notion/pages", getPages);
  app.get("/api/notion/page-meta", getPageMeta);
  app.post("/api/notion/fetch-page", fetchPage);
  app.post("/api/notion/push-page", pushPage);
  app.get("/api/notion/schema", getDatabaseSchema);

  // Twitter research
  app.get("/api/twitter/search", searchTwitter);
  app.get("/api/twitter/article", getTwitterArticle);
  app.post("/api/twitter/results", saveTwitterResults);
  app.get("/api/twitter/preview", previewLink);
  app.get("/api/twitter/fetch-markdown", fetchAsMarkdown);

  // YouTube transcript
  app.get("/api/youtube/transcript", getYouTubeTranscript);

  // Editor selection (ephemeral state for agent)
  app.post("/api/selection", saveSelection);
  app.get("/api/selection", getSelection);
  app.delete("/api/selection", clearSelection);

  // Clearbit logo API
  app.get("/api/clearbit/logo", getClearbitLogo);

  // Proxy (strips X-Frame-Options for iframe embedding)
  app.get("/api/proxy", proxyUrl);

  // SSE for File Watching
  const watcher = getContentWatcher();

  app.get("/api/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const onChange = (eventName: string, filePath: string) => {
      res.write(
        `data: ${JSON.stringify({ type: eventName, path: filePath })}\n\n`,
      );
    };

    watcher.on("all", onChange);

    req.on("close", () => {
      watcher.off("all", onChange);
    });
  });

  app.use(
    (
      err: unknown,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      const path = getRequestPath(req);
      if (!path.startsWith("/api/projects/") || !path.includes("/media")) {
        next(err);
        return;
      }

      console.error("[media] Upload route error", {
        requestId:
          typeof res.locals.uploadRequestId === "string"
            ? res.locals.uploadRequestId
            : undefined,
        method: req.method,
        path,
        chunkIndex:
          typeof req.query.index === "string" ? req.query.index : undefined,
        error: err instanceof Error ? err.message : String(err),
      });

      if (res.headersSent) {
        next(err);
        return;
      }

      res.status(500).json({
        error: "Upload request failed",
        code: "upload_request_failed",
      });
    },
  );

  // Feedback
  app.post("/api/feedback", sendFeedback);

  return app;
}
