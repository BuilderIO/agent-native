export type ResourceKind = "file" | "skill" | "job" | "agent" | "remote-agent";

export interface ParsedFrontmatter {
  raw: string;
  body: string;
  fields: Array<{ key: string; value: string }>;
}

export interface SkillMetadata {
  name: string;
  description?: string;
}

export interface CustomAgentProfile {
  id: string;
  path: string;
  name: string;
  description?: string;
  model?: string;
  tools?: string;
  color?: string;
  delegateDefault?: boolean;
  instructions: string;
}

export interface RemoteAgentManifest {
  id: string;
  path: string;
  name: string;
  description?: string;
  url: string;
  color?: string;
}

function normalizeFrontmatterValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseFrontmatter(content: string): ParsedFrontmatter | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return null;

  const raw = match[0];
  const yamlBlock = match[1];
  const fields: Array<{ key: string; value: string }> = [];
  const lines = yamlBlock.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (!kvMatch) {
      i++;
      continue;
    }

    const key = kvMatch[1];
    let value = kvMatch[2].trim();
    if (value === ">-" || value === ">" || value === "|" || value === "|-") {
      const multiLines: string[] = [];
      i++;
      while (i < lines.length && /^\s+/.test(lines[i])) {
        multiLines.push(lines[i].trim());
        i++;
      }
      value = multiLines.join(" ");
    } else {
      i++;
    }

    fields.push({ key, value: normalizeFrontmatterValue(value) });
  }

  return {
    raw,
    body: content.slice(raw.length),
    fields,
  };
}

export function serializeFrontmatter(
  fields: Array<{ key: string; value: string }>,
): string {
  const lines = fields.map(({ key, value }) => {
    if (key === "description" && value.length > 60) {
      const words = value.split(" ");
      const wrapped: string[] = [];
      let line = "";
      for (const word of words) {
        if (line && line.length + word.length + 1 > 72) {
          wrapped.push(`  ${line}`);
          line = word;
        } else {
          line = line ? `${line} ${word}` : word;
        }
      }
      if (line) wrapped.push(`  ${line}`);
      return `${key}: >-\n${wrapped.join("\n")}`;
    }

    const needsQuotes =
      value.includes(":") || value.startsWith("[") || value.startsWith("{");
    return `${key}: ${needsQuotes ? JSON.stringify(value) : value}`;
  });

  return `---\n${lines.join("\n")}\n---\n`;
}

export function getFrontmatterValue(
  frontmatter: ParsedFrontmatter | null,
  key: string,
): string | undefined {
  return frontmatter?.fields.find((field) => field.key === key)?.value;
}

export function frontmatterFieldsToObject(
  frontmatter: ParsedFrontmatter | null,
): Record<string, string> {
  return Object.fromEntries(
    frontmatter?.fields.map((f) => [f.key, f.value]) ?? [],
  );
}

export function isSkillPath(path: string): boolean {
  return path.startsWith("skills/") && path.endsWith(".md");
}

export function isJobPath(path: string): boolean {
  return path.startsWith("jobs/") && path.endsWith(".md");
}

export function isCustomAgentPath(path: string): boolean {
  return path.startsWith("agents/") && path.endsWith(".md");
}

export function isRemoteAgentPath(path: string): boolean {
  return path.startsWith("remote-agents/") && path.endsWith(".json");
}

export function getResourceKind(path: string): ResourceKind {
  if (isSkillPath(path)) return "skill";
  if (isJobPath(path)) return "job";
  if (isCustomAgentPath(path)) return "agent";
  if (isRemoteAgentPath(path)) return "remote-agent";
  return "file";
}

export function parseSkillMetadata(
  content: string,
  path: string,
): SkillMetadata | null {
  if (!isSkillPath(path)) return null;
  const frontmatter = parseFrontmatter(content);
  return {
    name:
      getFrontmatterValue(frontmatter, "name") ||
      path.split("/").pop()?.replace(/\.md$/, "") ||
      path,
    description: getFrontmatterValue(frontmatter, "description"),
  };
}

export function parseCustomAgentProfile(
  content: string,
  path: string,
): CustomAgentProfile | null {
  if (!isCustomAgentPath(path)) return null;
  const frontmatter = parseFrontmatter(content);
  const values = frontmatterFieldsToObject(frontmatter);
  const id = path.replace(/^agents\//, "").replace(/\.md$/, "");
  return {
    id,
    path,
    name: values.name || id,
    description: values.description,
    model:
      values.model && values.model !== "inherit" ? values.model : undefined,
    tools: values.tools || undefined,
    color: values.color || undefined,
    delegateDefault: values["delegate-default"] === "true",
    instructions: (frontmatter?.body ?? content).trim(),
  };
}

export function parseRemoteAgentManifest(
  content: string,
  path: string,
): RemoteAgentManifest | null {
  if (!isRemoteAgentPath(path)) return null;
  try {
    const data = JSON.parse(content);
    const id =
      data.id || path.replace(/^remote-agents\//, "").replace(/\.json$/, "");
    if (!data.url) return null;
    return {
      id,
      path,
      name: data.name || id,
      description: data.description || "",
      url: data.url,
      color: data.color || "#6B7280",
    };
  } catch {
    return null;
  }
}
