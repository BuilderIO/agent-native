import {
  deleteLocalArtifactFile,
  ensureLocalArtifactRoot,
  getLocalArtifactApp,
  isAgentNativeLocalFileMode,
  listLocalArtifactFiles,
  readLocalArtifactFile,
  writeLocalArtifactFile,
  type LocalArtifactFile,
  type LocalArtifactFileMeta,
  type LocalArtifactOptions,
} from "@agent-native/core/local-artifacts";

import type {
  Document,
  DocumentCreateRequest,
  DocumentMoveRequest,
  DocumentUpdateRequest,
} from "../shared/api.js";
import { parseContentSourceFile } from "../shared/content-source.js";

const CONTENT_APP_ID = "content";
const CONTENT_PROFILE_DOCS_NO_BOOKKEEPING = "docs/no-bookkeeping";
const LOCAL_FILE_ID_PREFIX = "local-file:";
const LOCAL_FOLDER_ID_PREFIX = "local-folder:";
const FRONTMATTER_RE =
  /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n\r?\n|\r?\n|$)/;

const CONTENT_LOCAL_DEFAULTS: LocalArtifactOptions["defaults"] = {
  roots: [
    { name: "Docs", path: "docs", kind: "docs", extensions: [".md", ".mdx"] },
    { name: "Blog", path: "blog", kind: "blog", extensions: [".md", ".mdx"] },
    {
      name: "Content",
      path: "content",
      kind: "content",
      extensions: [".md", ".mdx"],
    },
    {
      name: "Resources",
      path: "resources",
      kind: "resources",
      extensions: [".md", ".mdx"],
    },
  ],
  components: "components",
  hide: ["**/_*.md", "**/_*.mdx"],
};

function localOptions(): LocalArtifactOptions {
  return {
    appId: CONTENT_APP_ID,
    defaults: CONTENT_LOCAL_DEFAULTS,
  };
}

export async function isContentLocalFileMode() {
  return isAgentNativeLocalFileMode({
    appId: CONTENT_APP_ID,
    defaults: CONTENT_LOCAL_DEFAULTS,
  });
}

function encodeIdPath(filePath: string): string {
  return Buffer.from(filePath, "utf8").toString("base64url");
}

function decodeIdPath(encoded: string): string {
  return Buffer.from(encoded, "base64url").toString("utf8");
}

export function localFileDocumentId(filePath: string) {
  return `${LOCAL_FILE_ID_PREFIX}${encodeIdPath(filePath)}`;
}

export function localFolderDocumentId(folderPath: string) {
  return `${LOCAL_FOLDER_ID_PREFIX}${encodeIdPath(folderPath)}`;
}

export function isLocalFileDocumentId(id: string) {
  return id.startsWith(LOCAL_FILE_ID_PREFIX);
}

export function isLocalFolderDocumentId(id: string) {
  return id.startsWith(LOCAL_FOLDER_ID_PREFIX);
}

export function isLocalDocumentId(id: string) {
  return isLocalFileDocumentId(id) || isLocalFolderDocumentId(id);
}

export function localDocumentPathFromId(id: string) {
  if (isLocalFileDocumentId(id)) {
    return decodeIdPath(id.slice(LOCAL_FILE_ID_PREFIX.length));
  }
  if (isLocalFolderDocumentId(id)) {
    return decodeIdPath(id.slice(LOCAL_FOLDER_ID_PREFIX.length));
  }
  throw new Error(`Document "${id}" is not a local file document`);
}

function dirname(filePath: string) {
  const index = filePath.lastIndexOf("/");
  return index === -1 ? "" : filePath.slice(0, index);
}

function basename(filePath: string) {
  return filePath.split("/").pop() ?? filePath;
}

function titleFromSegment(segment: string) {
  return (
    segment
      .replace(/\.(mdx?|markdown)$/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase()) || "Untitled"
  );
}

function slugifyTitle(title: string) {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72)
    .replace(/-+$/g, "");
  return slug || "untitled";
}

function parentFolderId(filePath: string) {
  const folderPath = dirname(filePath);
  return folderPath ? localFolderDocumentId(folderPath) : null;
}

function folderParentId(folderPath: string) {
  const parentPath = dirname(folderPath);
  return parentPath ? localFolderDocumentId(parentPath) : null;
}

function isoFromMeta(meta: Pick<LocalArtifactFileMeta, "updatedAt">) {
  return meta.updatedAt || new Date(0).toISOString();
}

function documentFromFolder(folderPath: string, position: number): Document {
  return {
    id: localFolderDocumentId(folderPath),
    parentId: folderParentId(folderPath),
    title: titleFromSegment(basename(folderPath)),
    content: "",
    icon: null,
    position,
    isFavorite: false,
    hideFromSearch: false,
    visibility: "private",
    accessRole: "viewer",
    canEdit: false,
    canManage: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    source: {
      mode: "local-files",
      kind: "folder",
      path: folderPath,
      rootPath: folderPath.split("/")[0] ?? folderPath,
    },
  };
}

function documentFromLocalFile(
  file: LocalArtifactFile | LocalArtifactFileMeta,
  content: string,
  position: number,
): Document {
  const parsed = parseContentSourceFile(file.path, content);
  const now = isoFromMeta(file);
  const absolutePath =
    "absolutePath" in file && typeof file.absolutePath === "string"
      ? file.absolutePath
      : undefined;
  return {
    id: localFileDocumentId(file.path),
    parentId: parentFolderId(file.path),
    title: parsed.title,
    content: parsed.content,
    icon: parsed.icon ?? null,
    position,
    isFavorite: parsed.isFavorite ?? false,
    hideFromSearch: parsed.hideFromSearch ?? false,
    visibility: "private",
    accessRole: "owner",
    canEdit: true,
    canManage: true,
    createdAt: "createdAt" in file ? file.createdAt : now,
    updatedAt: now,
    source: {
      mode: "local-files",
      kind: "file",
      path: file.path,
      absolutePath,
      rootName: file.rootName,
      rootPath: file.rootPath,
      profile: file.profile,
      hash: file.hash,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
      updatedAt: now,
    },
  };
}

function folderDocumentsForFiles(files: LocalArtifactFileMeta[]) {
  const folders = new Set<string>();
  for (const file of files) {
    const parts = file.path.split("/");
    for (let index = 1; index < parts.length; index++) {
      folders.add(parts.slice(0, index).join("/"));
    }
  }
  return [...folders]
    .sort((a, b) => a.localeCompare(b))
    .map((folderPath, index) => documentFromFolder(folderPath, index));
}

let localFileDocumentsCache: {
  scope: string;
  signature: string;
  documents: Document[];
  cachedAt: number;
} | null = null;
const LOCAL_FILE_DOCUMENTS_CACHE_TTL_MS = 5_000;

function localFileDocumentsCacheScope() {
  return JSON.stringify({
    manifest: process.env.AGENT_NATIVE_MANIFEST,
    manifestPath: process.env.AGENT_NATIVE_MANIFEST_PATH,
    mode: process.env.AGENT_NATIVE_MODE,
    dataMode: process.env.AGENT_NATIVE_DATA_MODE,
  });
}

function localFileDocumentsSignature(files: LocalArtifactFileMeta[]) {
  return JSON.stringify(
    files.map((file) => ({
      absolutePath: file.absolutePath,
      contentType: file.contentType,
      hash: file.hash,
      path: file.path,
      profile: file.profile,
      rootName: file.rootName,
      rootPath: file.rootPath,
      sizeBytes: file.sizeBytes,
      updatedAt: file.updatedAt,
    })),
  );
}

function cloneLocalDocument(document: Document): Document {
  return {
    ...document,
    source: document.source ? { ...document.source } : undefined,
  };
}

function invalidateLocalFileDocumentsCache() {
  localFileDocumentsCache = null;
}

export async function listLocalFileDocuments(): Promise<Document[]> {
  const scope = localFileDocumentsCacheScope();
  if (
    localFileDocumentsCache &&
    localFileDocumentsCache.scope === scope &&
    Date.now() - localFileDocumentsCache.cachedAt <
      LOCAL_FILE_DOCUMENTS_CACHE_TTL_MS
  ) {
    return localFileDocumentsCache.documents.map(cloneLocalDocument);
  }

  const files = await listLocalArtifactFiles(localOptions());
  const signature = localFileDocumentsSignature(files);
  if (
    localFileDocumentsCache?.scope === scope &&
    localFileDocumentsCache.signature === signature
  ) {
    localFileDocumentsCache.cachedAt = Date.now();
    return localFileDocumentsCache.documents.map(cloneLocalDocument);
  }

  const folderDocuments = folderDocumentsForFiles(files);
  const fileDocuments = await Promise.all(
    files.map(async (meta, index) => {
      const file = await readLocalArtifactFile({
        ...localOptions(),
        path: meta.path,
      });
      return documentFromLocalFile(file ?? meta, file?.content ?? "", index);
    }),
  );
  const documents = [...folderDocuments, ...fileDocuments];
  localFileDocumentsCache = {
    scope,
    signature,
    documents,
    cachedAt: Date.now(),
  };
  return documents.map(cloneLocalDocument);
}

export async function getLocalFileDocument(id: string): Promise<Document> {
  const path = localDocumentPathFromId(id);
  if (isLocalFolderDocumentId(id)) {
    return documentFromFolder(path, 0);
  }

  const file = await readLocalArtifactFile({ ...localOptions(), path });
  if (!file) throw new Error(`Local file "${path}" not found`);
  return documentFromLocalFile(file, file.content, 0);
}

function splitFrontmatter(source: string) {
  const match = source.match(FRONTMATTER_RE);
  if (!match) return { frontmatter: "", body: source };
  return {
    frontmatter: match[1] ?? "",
    body: source.slice(match[0].length),
  };
}

function frontmatterLine(key: string, value: unknown) {
  if (value === undefined) return "";
  if (value === null) return `${key}: null`;
  if (typeof value === "boolean" || typeof value === "number") {
    return `${key}: ${String(value)}`;
  }
  return `${key}: ${JSON.stringify(String(value))}`;
}

function shouldAddMissingFrontmatterKey(
  key: string,
  addMissingKeys: UpsertFrontmatterOptions["addMissingKeys"],
) {
  if (typeof addMissingKeys === "function") return addMissingKeys(key);
  return addMissingKeys ?? true;
}

interface UpsertFrontmatterOptions {
  addMissingKeys?: boolean | ((key: string) => boolean);
}

function upsertFrontmatter(
  original: string,
  fields: Record<string, unknown>,
  body: string,
  options: UpsertFrontmatterOptions = {},
) {
  const { frontmatter } = splitFrontmatter(original);
  const lines = frontmatter ? frontmatter.split(/\r?\n/) : [];
  const usedKeys = new Set<string>();
  const nextLines = lines.map((line) => {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!match) return line;
    const key = match[1];
    if (!Object.prototype.hasOwnProperty.call(fields, key)) return line;
    usedKeys.add(key);
    return frontmatterLine(key, fields[key]);
  });

  for (const [key, value] of Object.entries(fields)) {
    if (usedKeys.has(key) || value === undefined) continue;
    if (!shouldAddMissingFrontmatterKey(key, options.addMissingKeys)) continue;
    nextLines.push(frontmatterLine(key, value));
  }

  if (!frontmatter && nextLines.filter(Boolean).length === 0) {
    return body;
  }

  const frontmatterBlock = `---\n${nextLines.filter(Boolean).join("\n")}\n---\n`;
  return body ? `${frontmatterBlock}\n${body}` : frontmatterBlock;
}

function stripDuplicateTitleHeading(content: string, title: string) {
  if (!title) return content;
  const h1Match = content.match(/^#\s+(.+?)(\r?\n|$)/);
  if (
    h1Match &&
    h1Match[1].trim().toLowerCase() === title.trim().toLowerCase()
  ) {
    return content.slice(h1Match[0].length).trimStart();
  }
  return content;
}

function nextContentForLocalUpdate(
  file: LocalArtifactFile,
  args: DocumentUpdateRequest,
  current: Document,
  nextTitle: string,
) {
  if (args.content === undefined) return current.content;
  if (usesDocsNoBookkeepingProfile(file.profile)) return args.content;
  return stripDuplicateTitleHeading(args.content, nextTitle);
}

function contentForLocalCreate(
  profile: string | undefined,
  args: DocumentCreateRequest,
  title: string,
) {
  const content = args.content ?? "";
  if (usesDocsNoBookkeepingProfile(profile)) return content;
  return stripDuplicateTitleHeading(content, title);
}

function usesDocsNoBookkeepingProfile(profile?: string) {
  return profile === CONTENT_PROFILE_DOCS_NO_BOOKKEEPING;
}

function updateFrontmatterFields(
  file: LocalArtifactFile,
  current: Document,
  args: DocumentUpdateRequest,
  nextTitle: string,
  titleChanged: boolean,
  iconChanged: boolean,
  favoriteChanged: boolean,
) {
  if (usesDocsNoBookkeepingProfile(file.profile)) {
    return {
      ...(titleChanged ? { title: nextTitle || "Untitled" } : {}),
      ...(iconChanged ? { icon: args.icon ?? null } : {}),
      ...(favoriteChanged ? { isFavorite: args.isFavorite ?? false } : {}),
    };
  }

  return {
    title: nextTitle || "Untitled",
    icon: args.icon !== undefined ? args.icon : current.icon,
    isFavorite:
      args.isFavorite !== undefined ? args.isFavorite : current.isFavorite,
    updatedAt: new Date().toISOString(),
  };
}

function createFrontmatterFields(
  profile: string | undefined,
  args: DocumentCreateRequest,
  title: string,
) {
  if (usesDocsNoBookkeepingProfile(profile)) {
    return {
      title,
      ...(args.icon !== undefined ? { icon: args.icon || null } : {}),
    };
  }

  return {
    title,
    icon: args.icon || null,
    isFavorite: false,
    updatedAt: new Date().toISOString(),
  };
}

export async function updateLocalFileDocument(
  id: string,
  args: DocumentUpdateRequest,
): Promise<Document> {
  if (isLocalFolderDocumentId(id)) {
    throw new Error("Folders cannot be edited directly");
  }

  const path = localDocumentPathFromId(id);
  const file = await readLocalArtifactFile({ ...localOptions(), path });
  if (!file) throw new Error(`Local file "${path}" not found`);

  const current = documentFromLocalFile(file, file.content, 0);
  const nextTitle = args.title ?? current.title;
  const nextContent = nextContentForLocalUpdate(file, args, current, nextTitle);
  const titleChanged = args.title !== undefined && args.title !== current.title;
  const contentChanged =
    args.content !== undefined && nextContent !== current.content;
  const iconChanged = args.icon !== undefined && args.icon !== current.icon;
  const favoriteChanged =
    args.isFavorite !== undefined && args.isFavorite !== current.isFavorite;

  if (!titleChanged && !contentChanged && !iconChanged && !favoriteChanged) {
    return current;
  }

  const nextSource = upsertFrontmatter(
    file.content,
    updateFrontmatterFields(
      file,
      current,
      args,
      nextTitle,
      titleChanged,
      iconChanged,
      favoriteChanged,
    ),
    nextContent,
  );

  await writeLocalArtifactFile({
    ...localOptions(),
    path,
    content: nextSource,
    expectedHash: file.hash,
  });
  invalidateLocalFileDocumentsCache();
  return getLocalFileDocument(id);
}

async function chooseCreateDirectory(parentId?: string | null) {
  if (parentId && isLocalFolderDocumentId(parentId)) {
    return localDocumentPathFromId(parentId);
  }
  if (parentId && isLocalFileDocumentId(parentId)) {
    return dirname(localDocumentPathFromId(parentId));
  }
  return (await ensureLocalArtifactRoot(localOptions())).path;
}

async function profileForDirectory(directory: string) {
  const app = await getLocalArtifactApp(localOptions());
  const root = app.roots.find(
    (candidate) =>
      directory === candidate.path ||
      directory.startsWith(`${candidate.path}/`),
  );
  return root?.profile ?? app.profile;
}

async function uniqueFilePath(directory: string, title: string) {
  const existing = new Set(
    (await listLocalArtifactFiles(localOptions())).map((file) => file.path),
  );
  const base = slugifyTitle(title || "Untitled");
  let candidate = `${directory}/${base}.mdx`;
  let suffix = 2;
  while (existing.has(candidate)) {
    candidate = `${directory}/${base}-${suffix}.mdx`;
    suffix += 1;
  }
  return candidate;
}

function isAlreadyExistsError(error: unknown) {
  return error instanceof Error && error.message.includes("already exists");
}

export async function createLocalFileDocument(
  args: DocumentCreateRequest,
): Promise<Document> {
  const title = args.title || "Untitled";
  const directory = await chooseCreateDirectory(args.parentId ?? null);
  const profile = await profileForDirectory(directory);
  const content = contentForLocalCreate(profile, args, title);
  const source = upsertFrontmatter(
    "",
    createFrontmatterFields(profile, args, title),
    content,
  );

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const path = await uniqueFilePath(directory, title);
    try {
      await writeLocalArtifactFile({
        ...localOptions(),
        path,
        content: source,
        ifNotExists: true,
      });
      invalidateLocalFileDocumentsCache();
      return getLocalFileDocument(localFileDocumentId(path));
    } catch (error) {
      if (isAlreadyExistsError(error)) continue;
      throw error;
    }
  }

  throw new Error(`Could not create a unique local file for "${title}"`);
}

export async function deleteLocalFileDocument(id: string) {
  if (isLocalFolderDocumentId(id)) {
    throw new Error("Delete local folders from the filesystem or code agent");
  }
  const path = localDocumentPathFromId(id);
  await deleteLocalArtifactFile({ ...localOptions(), path });
  invalidateLocalFileDocumentsCache();
  return { success: true, deleted: 1 };
}

export async function moveLocalFileDocument(
  id: string,
  _args: DocumentMoveRequest,
): Promise<Document> {
  localDocumentPathFromId(id);
  throw new Error(
    "Moving local file documents from the Content app is not supported yet. Move or rename the file in the workspace.",
  );
}

export async function localContentViewScreenSummary() {
  const app = await getLocalArtifactApp(localOptions());
  const documents = await listLocalFileDocuments();
  return {
    mode: "local-files" as const,
    roots: app.roots.map((root) => ({
      name: root.name,
      path: root.path,
      kind: root.kind,
      profile: root.profile,
      extensions: root.extensions,
    })),
    documents: documents.map((document) => ({
      id: document.id,
      parentId: document.parentId,
      title: document.title,
      source: document.source,
    })),
  };
}
