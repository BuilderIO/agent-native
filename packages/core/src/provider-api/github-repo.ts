import type { ActionEntry } from "../agent/production-agent.js";
import type { CredentialContext } from "../credentials/index.js";
import {
  canUseDeployCredentialFallbackForRequest,
  readDeployCredentialEnv,
} from "../server/credential-provider.js";
import { getCredentialContext } from "../server/request-context.js";
import {
  createProviderApiRuntime,
  defaultProviderApiCredentialResolver,
  type ProviderApiCredentialResolver,
  type ProviderApiRequestArgs,
} from "./index.js";

interface GitHubRepoToolOptions {
  appId?: string;
  getCredentialContext?: () => CredentialContext | null;
  resolveCredential?: ProviderApiCredentialResolver;
}

interface ProviderApiResult {
  response?: {
    status?: number;
    statusText?: string;
    ok?: boolean;
    json?: unknown;
    text?: string;
  };
}

interface ResolvedRepo {
  owner: string;
  repo: string;
  repository: string;
}

const REPO_PART_RE = /^[A-Za-z0-9_.-]{1,100}$/;

function normalizePath(path: unknown, { allowEmpty = false } = {}): string {
  if (typeof path !== "string") {
    if (allowEmpty) return "";
    throw new Error("path is required");
  }
  const trimmed = path.trim().replace(/^\/+/, "");
  if (!trimmed) {
    if (allowEmpty) return "";
    throw new Error("path is required");
  }
  const parts = trimmed.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Invalid repository path "${path}"`);
  }
  return parts.join("/");
}

function encodePath(path: string): string {
  return path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function normalizeRepoPart(value: string, label: string): string {
  const normalized = value.trim();
  if (!REPO_PART_RE.test(normalized)) {
    throw new Error(
      `Invalid GitHub ${label} "${value}". Expected letters, numbers, dot, underscore, or hyphen.`,
    );
  }
  return normalized;
}

function repoFromString(value: string): ResolvedRepo {
  const [rawOwner, rawRepo, ...extra] = value.trim().split("/");
  if (!rawOwner || !rawRepo || extra.length > 0) {
    throw new Error(
      `Invalid GitHub repository "${value}". Expected "owner/repo".`,
    );
  }
  const owner = normalizeRepoPart(rawOwner, "owner");
  const repo = normalizeRepoPart(rawRepo, "repo");
  return { owner, repo, repository: `${owner}/${repo}` };
}

async function resolveConfiguredRepository(
  options: GitHubRepoToolOptions,
): Promise<string | undefined> {
  const ctx = options.getCredentialContext?.() ?? getCredentialContext();
  if (ctx?.userEmail) {
    try {
      const { resolveCredential } = await import("../credentials/index.js");
      const configured = await resolveCredential("GITHUB_REPOSITORY", ctx);
      if (configured) return configured;
    } catch {
      // Fall through to scoped secrets and single-tenant deploy/local env.
    }
    try {
      const configured = await resolveScopedSecret("GITHUB_REPOSITORY", ctx);
      if (configured) return configured;
    } catch {
      // Fall through to the authenticated missing-repository error below.
    }
    return undefined;
  }
  return readDeployCredentialEnv("GITHUB_REPOSITORY");
}

async function resolveScopedSecret(
  key: string,
  ctx: CredentialContext,
): Promise<string | undefined> {
  const { readAppSecret } = await import("../secrets/storage.js");
  const refs: Array<{
    scope: "user" | "org" | "workspace";
    scopeId: string;
  }> = [{ scope: "user", scopeId: ctx.userEmail }];
  if (ctx.orgId) {
    refs.push(
      { scope: "org", scopeId: ctx.orgId },
      { scope: "workspace", scopeId: ctx.orgId },
    );
  } else {
    refs.push({ scope: "workspace", scopeId: `solo:${ctx.userEmail}` });
  }
  for (const ref of refs) {
    const secret = await readAppSecret({
      key,
      scope: ref.scope,
      scopeId: ref.scopeId,
    });
    if (secret?.value) return secret.value;
  }
  return undefined;
}

async function resolveRepo(
  args: Record<string, unknown>,
  options: GitHubRepoToolOptions,
): Promise<ResolvedRepo> {
  const repository =
    typeof args.repository === "string" && args.repository.trim()
      ? args.repository.trim()
      : typeof args.owner === "string" &&
          args.owner.trim() &&
          typeof args.repo === "string" &&
          args.repo.trim()
        ? `${args.owner.trim()}/${args.repo.trim()}`
        : await resolveConfiguredRepository(options);
  if (!repository) {
    throw new Error(
      'GitHub repository is required. Pass repository="owner/repo" or configure GITHUB_REPOSITORY in setup.',
    );
  }
  return repoFromString(repository);
}

function createRuntime(options: GitHubRepoToolOptions) {
  const resolver: ProviderApiCredentialResolver = async (lookup) => {
    const custom = await options.resolveCredential?.(lookup);
    if (custom?.value) return custom;

    const configured = await defaultProviderApiCredentialResolver(lookup);
    if (configured?.value) return configured;

    const scopedSecret = await resolveScopedSecret(lookup.key, lookup.ctx);
    if (scopedSecret) {
      return {
        key: lookup.key,
        value: scopedSecret,
        source: "app_secret",
        provider: lookup.provider,
      };
    }

    if (canUseDeployCredentialFallbackForRequest()) {
      const value =
        readDeployCredentialEnv(lookup.key) ??
        (lookup.key === "GITHUB_TOKEN"
          ? readDeployCredentialEnv("GH_TOKEN")
          : undefined);
      if (value) {
        return {
          key: lookup.key,
          value,
          source: "deploy_env",
          provider: lookup.provider,
          scope: "deploy",
        };
      }
    }

    return null;
  };

  return createProviderApiRuntime({
    appId: options.appId ?? "app",
    providerIds: ["github"],
    localCredentialSource: "github_repo",
    getCredentialContext: options.getCredentialContext ?? getCredentialContext,
    resolveCredential: resolver,
  });
}

async function githubRequest(
  runtime: ReturnType<typeof createProviderApiRuntime>,
  args: Omit<ProviderApiRequestArgs, "provider">,
): Promise<ProviderApiResult> {
  const result = (await runtime.executeRequest({
    provider: "github",
    ...args,
  })) as ProviderApiResult;
  return result;
}

function responseStatus(result: ProviderApiResult): number {
  return Number(result.response?.status ?? 0);
}

function responseJson(result: ProviderApiResult): unknown {
  return result.response?.json;
}

function assertOk(result: ProviderApiResult, action: string): void {
  const status = responseStatus(result);
  if (status >= 200 && status < 300) return;
  const payload = responseJson(result);
  const message =
    payload && typeof payload === "object" && "message" in payload
      ? String((payload as { message?: unknown }).message)
      : (result.response?.text ?? result.response?.statusText ?? "failed");
  throw new Error(
    `GitHub ${action} failed (${status || "unknown"}): ${message}`,
  );
}

function decodeGitHubContent(value: unknown): string {
  if (typeof value !== "string") return "";
  return Buffer.from(value.replace(/\s/g, ""), "base64").toString("utf8");
}

function entryResponse<T>(value: T): T {
  return value;
}

async function readFileImpl(
  args: Record<string, unknown>,
  options: GitHubRepoToolOptions,
) {
  const repo = await resolveRepo(args, options);
  const path = normalizePath(args.path);
  const ref =
    typeof args.ref === "string" && args.ref.trim()
      ? args.ref.trim()
      : typeof args.branch === "string" && args.branch.trim()
        ? args.branch.trim()
        : undefined;
  const runtime = createRuntime(options);
  const result = await githubRequest(runtime, {
    method: "GET",
    path: `/repos/${repo.owner}/${repo.repo}/contents/${encodePath(path)}`,
    query: ref ? { ref } : undefined,
  });
  assertOk(result, "read file");
  const json = responseJson(result) as Record<string, unknown>;
  if (Array.isArray(json) || json.type !== "file") {
    throw new Error(`GitHub path "${path}" is not a file.`);
  }
  return entryResponse({
    repository: repo.repository,
    path,
    ref,
    sha: typeof json.sha === "string" ? json.sha : undefined,
    size: typeof json.size === "number" ? json.size : undefined,
    encoding: json.encoding,
    content: decodeGitHubContent(json.content),
    htmlUrl: json.html_url,
    downloadUrl: json.download_url,
  });
}

async function getExistingFileSha(
  runtime: ReturnType<typeof createProviderApiRuntime>,
  repo: ResolvedRepo,
  path: string,
  ref?: string,
): Promise<string | undefined> {
  const result = await githubRequest(runtime, {
    method: "GET",
    path: `/repos/${repo.owner}/${repo.repo}/contents/${encodePath(path)}`,
    query: ref ? { ref } : undefined,
  });
  const status = responseStatus(result);
  if (status === 404) return undefined;
  assertOk(result, "load file sha");
  const json = responseJson(result) as Record<string, unknown>;
  return typeof json.sha === "string" ? json.sha : undefined;
}

async function writeFileImpl(
  args: Record<string, unknown>,
  options: GitHubRepoToolOptions,
) {
  const repo = await resolveRepo(args, options);
  const path = normalizePath(args.path);
  const content =
    typeof args.content === "string"
      ? args.content
      : String(args.content ?? "");
  const message =
    typeof args.message === "string" && args.message.trim()
      ? args.message.trim()
      : `Update ${path}`;
  const branch =
    typeof args.branch === "string" && args.branch.trim()
      ? args.branch.trim()
      : undefined;
  const runtime = createRuntime(options);
  const explicitSha =
    typeof args.sha === "string" && args.sha.trim() ? args.sha.trim() : "";
  const sha =
    explicitSha ||
    (await getExistingFileSha(runtime, repo, path, branch).catch((error) => {
      if (
        error instanceof Error &&
        /GitHub load file sha failed \(404\)/.test(error.message)
      ) {
        return undefined;
      }
      throw error;
    }));
  if (args.overwrite === false && sha) {
    throw new Error(
      `GitHub file "${path}" already exists. Pass overwrite=true or provide a different path.`,
    );
  }
  const result = await githubRequest(runtime, {
    method: "PUT",
    path: `/repos/${repo.owner}/${repo.repo}/contents/${encodePath(path)}`,
    body: {
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      ...(branch ? { branch } : {}),
      ...(sha ? { sha } : {}),
    },
  });
  assertOk(result, "write file");
  const json = responseJson(result) as Record<string, unknown>;
  const commit = json.commit as Record<string, unknown> | undefined;
  const file = json.content as Record<string, unknown> | undefined;
  return entryResponse({
    repository: repo.repository,
    path,
    branch,
    sha: file?.sha,
    commitSha: commit?.sha,
    htmlUrl: file?.html_url,
  });
}

async function deleteFileImpl(
  args: Record<string, unknown>,
  options: GitHubRepoToolOptions,
) {
  const repo = await resolveRepo(args, options);
  const path = normalizePath(args.path);
  const message =
    typeof args.message === "string" && args.message.trim()
      ? args.message.trim()
      : `Delete ${path}`;
  const branch =
    typeof args.branch === "string" && args.branch.trim()
      ? args.branch.trim()
      : undefined;
  const runtime = createRuntime(options);
  const sha =
    typeof args.sha === "string" && args.sha.trim()
      ? args.sha.trim()
      : await getExistingFileSha(runtime, repo, path, branch);
  if (!sha) throw new Error(`GitHub file "${path}" does not exist.`);
  const result = await githubRequest(runtime, {
    method: "DELETE",
    path: `/repos/${repo.owner}/${repo.repo}/contents/${encodePath(path)}`,
    body: {
      message,
      sha,
      ...(branch ? { branch } : {}),
    },
  });
  assertOk(result, "delete file");
  const json = responseJson(result) as Record<string, unknown>;
  const commit = json.commit as Record<string, unknown> | undefined;
  return entryResponse({
    repository: repo.repository,
    path,
    branch,
    deleted: true,
    commitSha: commit?.sha,
  });
}

async function listFilesImpl(
  args: Record<string, unknown>,
  options: GitHubRepoToolOptions,
) {
  const repo = await resolveRepo(args, options);
  const path = normalizePath(args.path, { allowEmpty: true });
  const ref =
    typeof args.ref === "string" && args.ref.trim()
      ? args.ref.trim()
      : typeof args.branch === "string" && args.branch.trim()
        ? args.branch.trim()
        : undefined;
  const runtime = createRuntime(options);
  const result = await githubRequest(runtime, {
    method: "GET",
    path: `/repos/${repo.owner}/${repo.repo}/contents${path ? `/${encodePath(path)}` : ""}`,
    query: ref ? { ref } : undefined,
  });
  assertOk(result, "list files");
  const json = responseJson(result);
  const entries = (Array.isArray(json) ? json : [json])
    .filter((item): item is Record<string, unknown> => !!item)
    .map((item) => ({
      name: item.name,
      path: item.path,
      type: item.type,
      sha: item.sha,
      size: item.size,
      htmlUrl: item.html_url,
    }));
  return entryResponse({
    repository: repo.repository,
    path,
    ref,
    entries,
    total: entries.length,
  });
}

async function searchCodeImpl(
  args: Record<string, unknown>,
  options: GitHubRepoToolOptions,
) {
  const repo = await resolveRepo(args, options);
  const query =
    typeof args.query === "string" && args.query.trim()
      ? args.query.trim()
      : "";
  if (!query) throw new Error("query is required");
  const path =
    typeof args.path === "string" && args.path.trim()
      ? normalizePath(args.path)
      : "";
  const extension =
    typeof args.extension === "string" && args.extension.trim()
      ? args.extension.trim().replace(/^\./, "")
      : "";
  const q = [
    query,
    `repo:${repo.repository}`,
    path ? `path:${path}` : "",
    extension ? `extension:${extension}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const runtime = createRuntime(options);
  const result = await githubRequest(runtime, {
    method: "GET",
    path: "/search/code",
    query: {
      q,
      per_page:
        typeof args.limit === "number"
          ? Math.max(1, Math.min(100, Math.floor(args.limit)))
          : 20,
    },
  });
  assertOk(result, "search code");
  const json = responseJson(result) as Record<string, unknown>;
  const items = Array.isArray(json.items) ? json.items : [];
  return entryResponse({
    repository: repo.repository,
    query,
    path,
    extension,
    totalCount: json.total_count,
    incompleteResults: json.incomplete_results,
    items: items.map((item) => {
      const row = item as Record<string, unknown>;
      const repository = row.repository as Record<string, unknown> | undefined;
      return {
        name: row.name,
        path: row.path,
        sha: row.sha,
        htmlUrl: row.html_url,
        repository: repository?.full_name,
      };
    }),
  });
}

const repoParams = {
  repository: {
    type: "string",
    description:
      "Optional owner/repo. Defaults to configured GITHUB_REPOSITORY.",
  },
  owner: {
    type: "string",
    description: "Optional repository owner when repository is not provided.",
  },
  repo: {
    type: "string",
    description: "Optional repository name when repository is not provided.",
  },
} as const;

export function createGitHubRepoToolEntries(
  options: GitHubRepoToolOptions = {},
): Record<string, ActionEntry> {
  return {
    "github-repo-list-files": {
      readOnly: true,
      parallelSafe: true,
      tool: {
        description:
          "List files or directories in the connected GitHub repository through the GitHub connector/token. Use this for cloud/headless repo context without cloning.",
        parameters: {
          type: "object",
          properties: {
            ...repoParams,
            path: {
              type: "string",
              description:
                "Directory or file path to list. Defaults to repo root.",
            },
            ref: {
              type: "string",
              description: "Optional branch, tag, or commit SHA.",
            },
            branch: {
              type: "string",
              description: "Optional branch name alias for ref.",
            },
          },
        },
      },
      run: (args) => listFilesImpl(args ?? {}, options),
    },
    "github-repo-read-file": {
      readOnly: true,
      parallelSafe: true,
      tool: {
        description:
          "Read a UTF-8 text file from the connected GitHub repository through the GitHub connector/token. Returns content plus SHA for later writes.",
        parameters: {
          type: "object",
          properties: {
            ...repoParams,
            path: { type: "string", description: "Repository file path." },
            ref: {
              type: "string",
              description: "Optional branch, tag, or commit SHA.",
            },
            branch: {
              type: "string",
              description: "Optional branch name alias for ref.",
            },
          },
          required: ["path"],
        },
      },
      run: (args) => readFileImpl(args ?? {}, options),
    },
    "github-repo-search-code": {
      readOnly: true,
      parallelSafe: true,
      tool: {
        description:
          "Search code in the connected GitHub repository through the GitHub connector/token. Use before reading likely files.",
        parameters: {
          type: "object",
          properties: {
            ...repoParams,
            query: {
              type: "string",
              description: "GitHub code-search query text.",
            },
            path: {
              type: "string",
              description: "Optional path qualifier.",
            },
            extension: {
              type: "string",
              description: "Optional file extension qualifier.",
            },
            limit: {
              type: "number",
              description: "Maximum results, 1-100. Default 20.",
            },
          },
          required: ["query"],
        },
      },
      run: (args) => searchCodeImpl(args ?? {}, options),
    },
    "github-repo-write-file": {
      needsApproval: true,
      tool: {
        description:
          "Create or update a file in the connected GitHub repository through the GitHub connector/token. Auto-loads the current SHA when updating an existing file.",
        parameters: {
          type: "object",
          properties: {
            ...repoParams,
            path: { type: "string", description: "Repository file path." },
            content: {
              type: "string",
              description: "New UTF-8 file content.",
            },
            message: {
              type: "string",
              description: "Commit message. Defaults to Update <path>.",
            },
            branch: {
              type: "string",
              description: "Optional branch to write to.",
            },
            sha: {
              type: "string",
              description:
                "Optional current file SHA. If omitted, the tool reads it first.",
            },
            overwrite: {
              type: "boolean",
              description:
                "Set false to fail instead of updating an existing file.",
            },
          },
          required: ["path", "content"],
        },
      },
      run: (args) => writeFileImpl(args ?? {}, options),
    },
    "github-repo-delete-file": {
      needsApproval: true,
      tool: {
        description:
          "Delete a file from the connected GitHub repository through the GitHub connector/token. Auto-loads the current SHA when omitted.",
        parameters: {
          type: "object",
          properties: {
            ...repoParams,
            path: { type: "string", description: "Repository file path." },
            message: {
              type: "string",
              description: "Commit message. Defaults to Delete <path>.",
            },
            branch: {
              type: "string",
              description: "Optional branch to write to.",
            },
            sha: {
              type: "string",
              description:
                "Optional current file SHA. If omitted, the tool reads it first.",
            },
          },
          required: ["path"],
        },
      },
      run: (args) => deleteFileImpl(args ?? {}, options),
    },
  };
}
