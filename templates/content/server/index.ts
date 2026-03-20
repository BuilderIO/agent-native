import "dotenv/config";
import fs from "fs";
import chokidar from "chokidar";
import type { FSWatcher } from "chokidar";
import path from "path";
import { createServer, createSSEHandler } from "@agent-native/core";
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
  initializeChunkedMediaUpload,
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

export function createAppServer() {
  const { app, router } = createServer({ envKeys });

  // Pages API (unified page tree)
  router.get("/api/pages", getPageTree);

  // Project routes
  router.get("/api/projects", listProjects);
  router.post("/api/projects", createProject);
  router.post("/api/projects/groups", createProjectGroup);
  router.patch("/api/projects/**:project/rename", renameProject);
  router.patch("/api/projects/**:project/move", moveProject);
  router.patch("/api/projects/**:project/meta", updateProjectMeta);

  // Folder CRUD (workspace-level organizational folders)
  router.post("/api/workspace/:workspace/folder", createFolder);
  router.delete("/api/workspace/:workspace/folder", deleteFolder);
  router.patch("/api/workspace/:workspace/folder", renameFolder);

  // Project file tree & CRUD (must be registered before the wildcard project delete)
  router.get("/api/projects/**:project/tree", getFileTree);
  router.get("/api/projects/**:project/file", getFile);
  router.put("/api/projects/**:project/file", saveFile);
  router.post("/api/projects/**:project/file", createFile);
  router.delete("/api/projects/**:project/file", deleteFile);
  router.get("/api/projects/**:project/version-history", getVersionHistory);
  router.get(
    "/api/projects/**:project/version-history/:versionId",
    getVersionContent,
  );
  router.post("/api/projects/**:project/restore-version", restoreVersion);

  // Shared resources
  router.get("/api/shared/tree", getSharedTree);
  router.get("/api/shared/asset", serveSharedAsset);
  router.get("/api/shared/file", getSharedFile);
  router.put("/api/shared/file", saveSharedFile);
  router.post("/api/shared/file", createSharedFile);
  router.delete("/api/shared/file", deleteSharedFile);
  router.get("/api/shared/image-folders", getImageFolders);
  router.post("/api/shared/image-upload", uploadSharedImages);
  router.delete("/api/shared/image", deleteSharedImage);

  // Workspace-scoped shared resources
  router.get("/api/workspace/:workspace/shared/tree", getWorkspaceSharedTree);
  router.get("/api/workspace/:workspace/shared/file", getWorkspaceSharedFile);
  router.put(
    "/api/workspace/:workspace/shared/file",
    saveWorkspaceSharedFile,
  );
  router.post(
    "/api/workspace/:workspace/shared/file",
    createWorkspaceSharedFile,
  );
  router.delete(
    "/api/workspace/:workspace/shared/file",
    deleteWorkspaceSharedFile,
  );

  // Media upload & serving
  router.get("/api/projects/**:project/media", listMedia);
  router.post("/api/projects/**:project/media", uploadMedia);
  router.post(
    "/api/projects/**:project/media/chunked/init",
    initializeChunkedMediaUpload,
  );
  router.post(
    "/api/projects/**:project/media/chunked/:uploadId/chunk",
    appendChunkedMediaUpload,
  );
  router.get(
    "/api/projects/**:project/media/chunked/:uploadId/status",
    getChunkedMediaUploadStatus,
  );
  router.post(
    "/api/projects/**:project/media/chunked/:uploadId/complete",
    completeChunkedMediaUpload,
  );
  router.get(
    "/api/projects/**:project/media/chunked/:uploadId/source",
    serveChunkedMediaUploadSource,
  );
  router.post("/api/projects/**:project/media/bulk-delete", bulkDeleteMedia);
  router.get("/api/projects/**:project/media/:filename", serveMedia);
  router.delete("/api/projects/**:project/media/:filename", deleteMedia);

  // Research
  router.get("/api/projects/**:project/research", getResearch);
  router.put("/api/projects/**:project/research", saveResearch);

  // Project delete (wildcard, must come after more specific routes)
  router.delete("/api/projects/**:project", deleteProject);

  // Keyword research
  router.get("/api/keywords/suggest", suggestKeywords);
  router.post("/api/keywords/volume", getKeywordVolume);
  router.get("/api/keywords/status", getApiStatus);
  router.post("/api/keywords/configure", configureApi);

  // Image generation
  router.post("/api/image-gen/generate", generateImage);
  router.get("/api/image-gen/status", getImageGenStatus);
  router.post("/api/image-gen/configure", configureImageGen);

  // Alt text generation
  router.post("/api/alt-text/generate", generateAltText);

  // Meta description generation
  router.post("/api/meta-description/generate", generateMetaDescription);

  // Image presets
  router.get("/api/image-presets", listPresets);
  router.post("/api/image-presets", createPreset);
  router.put("/api/image-presets/:id", updatePresetHandler);
  router.delete("/api/image-presets/:id", deletePresetHandler);

  // Builder.io integration
  router.post("/api/builder/upload", uploadArticle);
  router.put("/api/builder/upload/:id", updateArticle);
  router.get("/api/builder/authors", getAuthors);
  router.get("/api/builder/articles", getArticles);
  router.get("/api/builder/docs", getDocs);
  router.get("/api/builder/blog-index", getBlogIndex);
  router.get("/api/builder/docs-index", getDocsIndex);
  router.post("/api/builder/validate", validateConnection);
  router.post("/api/builder/image", uploadImage);
  router.post("/api/builder/auth", saveAuth);
  router.delete("/api/builder/auth", clearAuth);

  // Builder.io conversion testing
  router.post("/api/builder/test-roundtrip", testRoundtrip);
  router.post("/api/builder/fetch-article", fetchArticle);

  // Google search
  router.get("/api/google/search", searchGoogle);
  router.get("/api/google/status", googleSearchStatus);
  router.post("/api/google/configure", configureGoogleSearch);

  // Notion integration
  router.get("/api/notion/pages", getPages);
  router.get("/api/notion/page-meta", getPageMeta);
  router.post("/api/notion/fetch-page", fetchPage);
  router.post("/api/notion/push-page", pushPage);
  router.get("/api/notion/schema", getDatabaseSchema);

  // Twitter research
  router.get("/api/twitter/search", searchTwitter);
  router.get("/api/twitter/article", getTwitterArticle);
  router.post("/api/twitter/results", saveTwitterResults);
  router.get("/api/twitter/preview", previewLink);
  router.get("/api/twitter/fetch-markdown", fetchAsMarkdown);

  // YouTube transcript
  router.get("/api/youtube/transcript", getYouTubeTranscript);

  // Editor selection (ephemeral state for agent)
  router.post("/api/selection", saveSelection);
  router.get("/api/selection", getSelection);
  router.delete("/api/selection", clearSelection);

  // Clearbit logo API
  router.get("/api/clearbit/logo", getClearbitLogo);

  // Proxy (strips X-Frame-Options for iframe embedding)
  router.get("/api/proxy", proxyUrl);

  // SSE for File Watching (keep last)
  const watcher = getContentWatcher();
  router.get("/api/events", createSSEHandler(watcher));

  // Feedback
  router.post("/api/feedback", sendFeedback);

  return app;
}
