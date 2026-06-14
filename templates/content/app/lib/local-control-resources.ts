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

const CONTROL_FILE_MAX_BYTES = 2 * 1024 * 1024;
const ROOT_INSTRUCTION_FILES = [
  "AGENTS.md",
  "agent-native.json",
  "mcp.config.json",
  ".mcp.json",
] as const;

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

export function localControlResourceWrites(options: {
  folderName: string;
  files: LocalControlResourceFiles;
}) {
  const folderSlug = slugifyResourceSegment(options.folderName);
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

    if (
      sourcePath === "agent-native.json" ||
      sourcePath === "mcp.config.json" ||
      sourcePath === ".mcp.json"
    ) {
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

  for (const name of ROOT_INSTRUCTION_FILES) {
    const content = await readRootControlFile(handle, name);
    if (content !== null) files[name] = content;
  }

  Object.assign(files, await collectSkillRoot(handle, ".agents"));
  Object.assign(files, await collectSkillRoot(handle, ".agent"));
  return files;
}

export async function syncLocalControlResources(options: {
  folderName: string;
  files: LocalControlResourceFiles | undefined;
}) {
  const writes = localControlResourceWrites({
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
          source: "local-folder-control-resource",
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

  return { count: writes.length, paths: writes.map((write) => write.path) };
}
