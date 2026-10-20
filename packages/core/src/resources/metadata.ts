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

export interface AgentWorkspaceResource {
  path: string;
  kind: ResourceKind;
  name?: string;
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
  workspace?: {
    root: string;
    resources: AgentWorkspaceResource[];
  };
}

export interface RemoteAgentBearerAuth {
  type: "bearer";
  credentialRef: string;
}

export interface RemoteAgentOAuthClientCredentialsAuth {
  type: "oauth-client-credentials";
  tokenUrl: string;
  clientId: string;
  clientSecretRef: string;
  scope?: string;
}

export type RemoteAgentAuth =
  | RemoteAgentBearerAuth
  | RemoteAgentOAuthClientCredentialsAuth;

export interface AnthropicManagedAgentsRemoteAgentKind {
  provider: "anthropic-managed-agents";
  agentId: string;
  environmentId: string;
  credentialRef: string;
}

export type RemoteAgentKind = AnthropicManagedAgentsRemoteAgentKind;

export interface RemoteAgentManifest {
  id: string;
  path: string;
  name: string;
  description?: string;
  url: string;
  color?: string;
  cardUrl?: string;
  /** Authentication references only; secret values never belong in a manifest. */
  auth?: RemoteAgentAuth;
  kind?: RemoteAgentKind;
}

export const REMOTE_AGENT_RESOURCE_PREFIX = "remote-agents/";
export const LEGACY_REMOTE_AGENT_RESOURCE_PREFIX = "agents/";
export const REMOTE_AGENT_RESOURCE_PREFIXES = [
  REMOTE_AGENT_RESOURCE_PREFIX,
  LEGACY_REMOTE_AGENT_RESOURCE_PREFIX,
] as const;

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
  const prefix = path.startsWith("skills/")
    ? "skills/"
    : path.match(/^agents\/[^/]+\/skills\//)?.[0];
  if (!prefix || !path.endsWith(".md")) return false;
  const relative = path.slice(prefix.length);
  return (
    relative.endsWith("/SKILL.md") ||
    (relative.endsWith(".md") && !relative.includes("/"))
  );
}

export function getSkillNameFromPath(path: string): string {
  const relative = path
    .replace(/^\.agents\/skills\//, "")
    .replace(/^agents\/[^/]+\/skills\//, "")
    .replace(/^skills\//, "");
  if (relative.endsWith("/SKILL.md")) {
    return (
      relative
        .replace(/\/SKILL\.md$/, "")
        .split("/")
        .pop() || relative
    );
  }
  return relative.split("/").pop()?.replace(/\.md$/, "") || path;
}

export function isJobPath(path: string): boolean {
  return path.startsWith("jobs/") && path.endsWith(".md");
}

export function isCustomAgentPath(path: string): boolean {
  return /^agents\/[^/]+\.md$/.test(path);
}

export function isRemoteAgentPath(path: string): boolean {
  return (
    path.endsWith(".json") &&
    REMOTE_AGENT_RESOURCE_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}

export function getRemoteAgentIdFromPath(path: string): string {
  const prefix = REMOTE_AGENT_RESOURCE_PREFIXES.find((candidate) =>
    path.startsWith(candidate),
  );
  const withoutPrefix = prefix ? path.slice(prefix.length) : path;
  return withoutPrefix.replace(/\.json$/, "");
}

export function remoteAgentResourcePath(id: string): string {
  return `${REMOTE_AGENT_RESOURCE_PREFIX}${id}.json`;
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
      getFrontmatterValue(frontmatter, "name") || getSkillNameFromPath(path),
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
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const id =
      typeof data.id === "string" && data.id.trim()
        ? data.id.trim()
        : getRemoteAgentIdFromPath(path);
    const kind = parseRemoteAgentKind(data.kind);
    if (data.kind !== undefined && data.kind !== null && !kind) return null;
    const rawUrl =
      typeof data.url === "string" && data.url.trim()
        ? data.url.trim()
        : kind?.provider === "anthropic-managed-agents"
          ? "https://api.anthropic.com"
          : "";
    if (!rawUrl || !parseRemoteAgentUrl(rawUrl)) return null;

    const cardUrl = parseRemoteAgentUrl(data.cardUrl);
    if (data.cardUrl !== undefined && data.cardUrl !== null && !cardUrl) {
      return null;
    }

    const auth = parseRemoteAgentAuth(data.auth);
    if (data.auth !== undefined && data.auth !== null && !auth) return null;
    if (
      (auth || kind) &&
      (Boolean(auth && kind) ||
        !parseRemoteAgentUrl(rawUrl, {
          allowLoopbackHttp: true,
          requireHttps: true,
        }) ||
        (cardUrl &&
          !parseRemoteAgentUrl(cardUrl, {
            allowLoopbackHttp: true,
            requireHttps: true,
          })))
    ) {
      return null;
    }

    return {
      id,
      path,
      name:
        typeof data.name === "string" && data.name.trim()
          ? data.name.trim()
          : id,
      description: typeof data.description === "string" ? data.description : "",
      url: rawUrl,
      color:
        typeof data.color === "string" && data.color.trim()
          ? data.color.trim()
          : undefined,
      ...(cardUrl ? { cardUrl } : {}),
      ...(auth ? { auth } : {}),
      ...(kind ? { kind } : {}),
    };
  } catch {
    // coercion-ok: malformed JSON or an invalid manifest is absent, never a connected agent.
    return null;
  }
}

export function parseRemoteAgentKind(
  value: unknown,
): RemoteAgentKind | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const kind = value as Record<string, unknown>;
  if (kind.provider !== "anthropic-managed-agents") return undefined;
  const agentId = typeof kind.agentId === "string" ? kind.agentId.trim() : "";
  const environmentId =
    typeof kind.environmentId === "string" ? kind.environmentId.trim() : "";
  const credentialRef =
    typeof kind.credentialRef === "string" ? kind.credentialRef.trim() : "";
  if (!agentId || !environmentId || !credentialRef) return undefined;
  return {
    provider: "anthropic-managed-agents",
    agentId,
    environmentId,
    credentialRef,
  };
}

export function parseRemoteAgentUrl(
  value: unknown,
  options?: { allowLoopbackHttp?: boolean; requireHttps?: boolean },
): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.username || url.password) return undefined;
    if (options?.requireHttps && url.protocol !== "https:") {
      const loopbackHttp =
        options.allowLoopbackHttp === true && isLoopbackHostname(url.hostname);
      if (!loopbackHttp) return undefined;
    }
    return url.toString();
  } catch {
    // coercion-ok: an invalid URL is the typed absent result for optional manifest fields.
    return undefined;
  }
}

export function parseRemoteAgentAuth(
  value: unknown,
): RemoteAgentAuth | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const auth = value as Record<string, unknown>;
  if (auth.type === "bearer") {
    const credentialRef =
      typeof auth.credentialRef === "string" ? auth.credentialRef.trim() : "";
    return credentialRef ? { type: "bearer", credentialRef } : undefined;
  }

  if (auth.type === "oauth-client-credentials") {
    const tokenUrl = parseRemoteAgentUrl(auth.tokenUrl, { requireHttps: true });
    const clientId =
      typeof auth.clientId === "string" ? auth.clientId.trim() : "";
    const clientSecretRef =
      typeof auth.clientSecretRef === "string"
        ? auth.clientSecretRef.trim()
        : "";
    if (!tokenUrl || !clientId || !clientSecretRef) return undefined;
    const scope =
      typeof auth.scope === "string" && auth.scope.trim()
        ? auth.scope.trim()
        : undefined;
    return {
      type: "oauth-client-credentials",
      tokenUrl,
      clientId,
      clientSecretRef,
      ...(scope ? { scope } : {}),
    };
  }

  return undefined;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "[::1]" ||
    normalized === "::1" ||
    normalized === "127.0.0.1" ||
    normalized.startsWith("127.")
  );
}
