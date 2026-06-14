import { agentNativePath } from "@agent-native/core/client";

export type LocalControlResourceFiles = Record<string, string>;

const ROOT_INSTRUCTION_FILES = new Set([
  "AGENTS.md",
  "agent-native.json",
  "mcp.config.json",
  ".mcp.json",
]);

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
