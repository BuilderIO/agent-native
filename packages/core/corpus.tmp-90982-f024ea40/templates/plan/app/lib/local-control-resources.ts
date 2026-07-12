import { agentNativePath } from "@agent-native/core/client";

type LocalControlFileHandle = {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
};

type LocalControlDirectoryHandle = {
  kind: "directory";
  name: string;
  values(): AsyncIterable<LocalControlFileHandle | LocalControlDirectoryHandle>;
  getDirectoryHandle(name: string): Promise<LocalControlDirectoryHandle>;
  getFileHandle(name: string): Promise<LocalControlFileHandle>;
};

export type LocalControlResourceFiles = Record<string, string>;

type LocalControlResourceOptions = {
  folderId?: string;
  folderName: string;
};

type ResourceMeta = {
  id: string;
  path: string;
  metadata?: string | null;
};

const ROOT_INSTRUCTION_FILES = new Set([
  "AGENTS.md",
  "agent-native.json",
  "mcp.config.json",
  ".mcp.json",
]);
const CONTROL_FILE_MAX_BYTES = 2 * 1024 * 1024;
const ROOT_INSTRUCTION_FILE_NAMES = Array.from(ROOT_INSTRUCTION_FILES);
const LOCAL_CONTROL_RESOURCE_SOURCE = "local-folder-control-resource";

function slugifyResourceSegment(value: string) {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "local-folder";
}

function normalizeControlPath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/");
  if (
    !normalized ||
    normalized.includes("\0") ||
    parts.some((part) => !part || part === "." || part === "..")
  ) {
    return null;
  }
  return parts.join("/");
}

function jsonInstructionContent(name: string, content: string) {
  return [`# ${name}`, "", "```json", content.trim(), "```", ""].join("\n");
}

function skillResourcePath(sourcePath: string, folderSlug: string) {
  const parts = sourcePath.split("/");
  if (
    parts.length < 4 ||
    (parts[0] !== ".agents" && parts[0] !== ".agent") ||
    parts[1] !== "skills"
  ) {
    return null;
  }

  const skillSlug = slugifyResourceSegment(parts[2]);
  const skillFilePath = parts.slice(3).join("/");
  if (!skillFilePath) return null;
  return `skills/${folderSlug}-${skillSlug}/${skillFilePath}`;
}

export function localControlResourceNamespace(
  options: LocalControlResourceOptions,
) {
  return slugifyResourceSegment(options.folderId || options.folderName);
}

function localControlLegacyNamespace(options: LocalControlResourceOptions) {
  return slugifyResourceSegment(options.folderName);
}

function localControlNamespaces(options: LocalControlResourceOptions) {
  const namespaces = new Set<string>([
    localControlResourceNamespace(options),
    localControlLegacyNamespace(options),
  ]);
  return Array.from(namespaces);
}

function parseResourceMetadata(resource: ResourceMeta) {
  if (!resource.metadata) return null;
  try {
    const parsed = JSON.parse(resource.metadata) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function resourceMatchesLocalControlNamespace(
  resource: ResourceMeta,
  namespace: string,
) {
  return (
    resource.path.startsWith(`instructions/local-files/${namespace}/`) ||
    resource.path.startsWith(`skills/${namespace}-`)
  );
}

function resourceMatchesLocalControlSelection(
  resource: ResourceMeta,
  options: LocalControlResourceOptions,
) {
  const metadata = parseResourceMetadata(resource);
  if (metadata?.source !== LOCAL_CONTROL_RESOURCE_SOURCE) return false;
  if (options.folderId && metadata.folderId === options.folderId) return true;
  return localControlNamespaces(options).some((namespace) =>
    resourceMatchesLocalControlNamespace(resource, namespace),
  );
}

export function localControlResourceWrites(options: {
  folderId?: string;
  folderName: string;
  files: LocalControlResourceFiles;
}) {
  const folderSlug = localControlResourceNamespace(options);
  const writes = new Map<
    string,
    { path: string; content: string; sourcePath: string }
  >();

  for (const [rawPath, content] of Object.entries(options.files).sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    if (typeof content !== "string") continue;
    const sourcePath = normalizeControlPath(rawPath);
    if (!sourcePath) continue;

    if (sourcePath === "AGENTS.md") {
      const path = `instructions/local-files/${folderSlug}/AGENTS.md`;
      writes.set(path, { path, content, sourcePath });
      continue;
    }

    if (ROOT_INSTRUCTION_FILES.has(sourcePath)) {
      const path = `instructions/local-files/${folderSlug}/${sourcePath}.md`;
      writes.set(path, {
        path,
        content: jsonInstructionContent(sourcePath, content),
        sourcePath,
      });
      continue;
    }

    const path = skillResourcePath(sourcePath, folderSlug);
    if (path) writes.set(path, { path, content, sourcePath });
  }

  return Array.from(writes.values());
}

export async function deleteLocalControlResources(
  options: LocalControlResourceOptions,
) {
  const response = await fetch(
    agentNativePath("/_agent-native/resources?scope=personal"),
  );
  if (!response.ok) {
    let message = response.statusText;
    try {
      const body = (await response.json()) as { error?: string };
      message = body.error || message;
    } catch {
      // Keep the HTTP status text when the response is not JSON.
    }
    throw new Error(`Local control resource cleanup failed: ${message}`);
  }

  const body = (await response.json()) as { resources?: ResourceMeta[] };
  const resources = (body.resources ?? []).filter((resource) =>
    resourceMatchesLocalControlSelection(resource, options),
  );

  for (const resource of resources) {
    const deleteResponse = await fetch(
      agentNativePath(
        `/_agent-native/resources/${encodeURIComponent(resource.id)}`,
      ),
      { method: "DELETE" },
    );
    if (!deleteResponse.ok && deleteResponse.status !== 404) {
      let message = deleteResponse.statusText;
      try {
        const body = (await deleteResponse.json()) as { error?: string };
        message = body.error || message;
      } catch {
        // Keep the HTTP status text when the response is not JSON.
      }
      throw new Error(`Local control resource cleanup failed: ${message}`);
    }
  }

  return { count: resources.length, paths: resources.map((r) => r.path) };
}

async function readRootControlFile(
  handle: LocalControlDirectoryHandle,
  name: string,
) {
  try {
    const fileHandle = await handle.getFileHandle(name);
    const file = await fileHandle.getFile();
    if (file.size > CONTROL_FILE_MAX_BYTES) return null;
    return await file.text();
  } catch {
    return null;
  }
}

async function collectSkillFiles(
  handle: LocalControlDirectoryHandle,
  prefix: string,
): Promise<LocalControlResourceFiles> {
  const files: LocalControlResourceFiles = {};
  for await (const entry of handle.values()) {
    const path = `${prefix}${entry.name}`;
    if (entry.kind === "directory") {
      Object.assign(files, await collectSkillFiles(entry, `${path}/`));
      continue;
    }

    const file = await entry.getFile();
    if (file.size > CONTROL_FILE_MAX_BYTES) continue;
    files[path] = await file.text();
  }
  return files;
}

async function collectSkillRoot(
  handle: LocalControlDirectoryHandle,
  rootName: ".agents" | ".agent",
) {
  try {
    const root = await handle.getDirectoryHandle(rootName);
    const skills = await root.getDirectoryHandle("skills");
    return await collectSkillFiles(skills, `${rootName}/skills/`);
  } catch {
    return {};
  }
}

export async function collectLocalControlResourceFiles(
  handle: LocalControlDirectoryHandle,
): Promise<LocalControlResourceFiles> {
  const files: LocalControlResourceFiles = {};

  for (const name of ROOT_INSTRUCTION_FILE_NAMES) {
    const content = await readRootControlFile(handle, name);
    if (content !== null) files[name] = content;
  }

  Object.assign(files, await collectSkillRoot(handle, ".agents"));
  Object.assign(files, await collectSkillRoot(handle, ".agent"));
  return files;
}

export async function syncLocalControlResources(options: {
  folderId?: string;
  folderName: string;
  files: LocalControlResourceFiles | undefined;
}) {
  const removed = await deleteLocalControlResources({
    folderId: options.folderId,
    folderName: options.folderName,
  });
  const writes = localControlResourceWrites({
    folderId: options.folderId,
    folderName: options.folderName,
    files: options.files ?? {},
  });

  for (const write of writes) {
    const response = await fetch(agentNativePath("/_agent-native/resources"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: write.path,
        content: write.content,
        mimeType: "text/markdown",
        metadata: {
          source: LOCAL_CONTROL_RESOURCE_SOURCE,
          folderId: options.folderId ?? null,
          folderName: options.folderName,
          namespace: localControlResourceNamespace(options),
          sourcePath: write.sourcePath,
        },
      }),
    });
    if (!response.ok) {
      let message = response.statusText;
      try {
        const body = (await response.json()) as { error?: string };
        message = body.error || message;
      } catch {
        // Keep the HTTP status text when the response is not JSON.
      }
      throw new Error(`Local control resource sync failed: ${message}`);
    }
  }

  return {
    count: writes.length,
    paths: writes.map((write) => write.path),
    deletedCount: removed.count,
  };
}
