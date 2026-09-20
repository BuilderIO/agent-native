const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);
const GITHUB_NAME_RE = /^[A-Za-z0-9._-]+$/;
const RESERVED_GITHUB_OWNERS = new Set([
  "orgs",
  "users",
  "settings",
  "marketplace",
  "login",
  "new",
  "topics",
  "explore",
  "notifications",
  "pulls",
  "issues",
  "search",
  "about",
]);

export interface GitHubRepositoryRef {
  owner: string;
  repo: string;
}

const INVALID_REPOSITORY =
  "Factory repository must be a GitHub URL or owner/repository.";

function normalizeName(value: string): string {
  return value.replace(/\.git$/i, "");
}

function assertGitHubName(value: string, label: string): string {
  const name = normalizeName(value);
  if (!name || name === "." || name === ".." || !GITHUB_NAME_RE.test(name)) {
    throw new Error(INVALID_REPOSITORY);
  }
  if (label === "owner" && RESERVED_GITHUB_OWNERS.has(name.toLowerCase())) {
    throw new Error(INVALID_REPOSITORY);
  }
  return name;
}

function refFromOwnerRepo(owner: string, repo: string): GitHubRepositoryRef {
  return {
    owner: assertGitHubName(owner, "owner"),
    repo: assertGitHubName(repo, "repo"),
  };
}

function looksLikeGitHubUrl(value: string): boolean {
  if (value.includes("://") || value.startsWith("git@")) return true;
  const host = value.split("/")[0]?.toLowerCase();
  return host === "github.com" || host === "www.github.com";
}

export function parseGitHubRepositoryRef(value: string): GitHubRepositoryRef {
  const trimmed = value.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) {
    throw new Error(INVALID_REPOSITORY);
  }

  const ssh = /^git@github\.com:([^/]+)\/(.+)$/i.exec(trimmed);
  if (ssh) return refFromOwnerRepo(ssh[1], ssh[2].split("/")[0] ?? "");

  if (!looksLikeGitHubUrl(trimmed)) {
    const slash = trimmed.replace(/\/+$/, "").split("/");
    if (slash.length === 2) return refFromOwnerRepo(slash[0], slash[1]);
    throw new Error(INVALID_REPOSITORY);
  }

  let url: URL;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error(INVALID_REPOSITORY);
  }
  if (!GITHUB_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error(INVALID_REPOSITORY);
  }
  const parts = url.pathname.split("/").filter(Boolean);
  // Extra path (/pull/1, /tree/main) is ignored; owner and repo are the first two segments.
  if (parts.length < 2) throw new Error(INVALID_REPOSITORY);
  return refFromOwnerRepo(parts[0], parts[1]);
}

export function canonicalGitHubRepository(value: string): string {
  const { owner, repo } = parseGitHubRepositoryRef(value);
  return `${owner}/${repo}`;
}

export function persistGitHubRepository(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return canonicalGitHubRepository(trimmed);
}

export function gitHubRepositoriesEqual(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  if (!left?.trim() || !right?.trim()) return false;
  return canonicalGitHubRepository(left) === canonicalGitHubRepository(right);
}
