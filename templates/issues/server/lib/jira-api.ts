// ── Low-level Atlassian API client ──

const ATLASSIAN_AUTH_URL = "https://auth.atlassian.com/authorize";
const ATLASSIAN_TOKEN_URL = "https://auth.atlassian.com/oauth/token";
const ATLASSIAN_RESOURCES_URL =
  "https://api.atlassian.com/oauth/token/accessible-resources";

const SCOPES = [
  "read:jira-work",
  "write:jira-work",
  "read:jira-user",
  "read:board-scope:jira-software",
  "read:sprint:jira-software",
  "read:issue:jira-software",
  "read:project:jira",
  "offline_access",
];

// ── OAuth2 client ──

export function createOAuth2Client(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
) {
  return {
    generateAuthUrl(opts: {
      scope: string[];
      state?: string;
      prompt?: string;
    }) {
      const params = new URLSearchParams({
        audience: "api.atlassian.com",
        client_id: clientId,
        scope: opts.scope.join(" "),
        redirect_uri: redirectUri,
        response_type: "code",
        prompt: opts.prompt || "consent",
      });
      if (opts.state) params.set("state", opts.state);
      return `${ATLASSIAN_AUTH_URL}?${params}`;
    },

    async getToken(code: string) {
      const res = await fetch(ATLASSIAN_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Token exchange failed: ${res.status} ${text}`);
      }
      return res.json() as Promise<{
        access_token: string;
        refresh_token: string;
        expires_in: number;
        token_type: string;
        scope: string;
      }>;
    },

    async refreshToken(refreshToken: string) {
      const res = await fetch(ATLASSIAN_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Token refresh failed: ${res.status} ${text}`);
      }
      return res.json() as Promise<{
        access_token: string;
        refresh_token?: string;
        expires_in: number;
        token_type: string;
        scope: string;
      }>;
    },
  };
}

export { SCOPES };

// ── Authenticated fetch ──

export class AtlassianApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    let message: string;
    switch (status) {
      case 401:
        message = `Jira authentication failed — token may be expired. Re-connect your Jira account.`;
        break;
      case 403:
        message = `Jira permission denied — your account doesn't have access to this resource.`;
        break;
      case 404:
        message = `Jira resource not found — the issue, project, or board may not exist or you may lack permission to view it.`;
        break;
      case 429:
        message = `Jira rate limit exceeded — try again in a few seconds.`;
        break;
      default:
        message = `Atlassian API error ${status}: ${body}`;
    }
    super(message);
    this.name = "AtlassianApiError";
    this.status = status;
    this.body = body;
  }
}

async function atlassianFetch(
  url: string,
  accessToken: string,
  opts?: RequestInit,
): Promise<Response> {
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...opts?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new AtlassianApiError(res.status, text);
  }
  return res;
}

// ── Accessible resources (cloud ID) ──

export interface AccessibleResource {
  id: string;
  url: string;
  name: string;
  scopes: string[];
  avatarUrl: string;
}

export async function getAccessibleResources(
  accessToken: string,
): Promise<AccessibleResource[]> {
  const res = await atlassianFetch(ATLASSIAN_RESOURCES_URL, accessToken);
  return res.json();
}

// ── Jira REST API v3 ──

function jiraUrl(cloudId: string, path: string) {
  return `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3${path}`;
}

function agileUrl(cloudId: string, path: string) {
  return `https://api.atlassian.com/ex/jira/${cloudId}/rest/agile/1.0${path}`;
}

// User
export async function jiraGetMyself(cloudId: string, accessToken: string) {
  const res = await atlassianFetch(jiraUrl(cloudId, "/myself"), accessToken);
  return res.json();
}

// Search issues (using /search/jql endpoint — the old /search was removed)
export async function jiraSearchIssues(
  cloudId: string,
  accessToken: string,
  params: {
    jql?: string;
    maxResults?: number;
    fields?: string[];
    expand?: string[];
    nextPageToken?: string;
  },
) {
  const body: Record<string, unknown> = {};
  if (params.jql) body.jql = params.jql;
  if (params.maxResults !== undefined) body.maxResults = params.maxResults;
  if (params.fields?.length) body.fields = params.fields;
  if (params.expand?.length) body.expand = params.expand;
  if (params.nextPageToken) body.nextPageToken = params.nextPageToken;
  const res = await atlassianFetch(
    jiraUrl(cloudId, "/search/jql"),
    accessToken,
    { method: "POST", body: JSON.stringify(body) },
  );
  return res.json() as Promise<{
    issues: any[];
    nextPageToken?: string;
  }>;
}

// Get single issue
export async function jiraGetIssue(
  cloudId: string,
  accessToken: string,
  issueKey: string,
  params?: { fields?: string[]; expand?: string[] },
) {
  const query = new URLSearchParams();
  if (params?.fields?.length) query.set("fields", params.fields.join(","));
  if (params?.expand?.length) query.set("expand", params.expand.join(","));
  const qs = query.toString();
  const res = await atlassianFetch(
    jiraUrl(cloudId, `/issue/${issueKey}${qs ? `?${qs}` : ""}`),
    accessToken,
  );
  return res.json();
}

// Create issue
export async function jiraCreateIssue(
  cloudId: string,
  accessToken: string,
  body: Record<string, unknown>,
) {
  const res = await atlassianFetch(jiraUrl(cloudId, "/issue"), accessToken, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return res.json();
}

// Update issue
export async function jiraUpdateIssue(
  cloudId: string,
  accessToken: string,
  issueKey: string,
  body: Record<string, unknown>,
) {
  await atlassianFetch(jiraUrl(cloudId, `/issue/${issueKey}`), accessToken, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

// Transitions
export async function jiraGetTransitions(
  cloudId: string,
  accessToken: string,
  issueKey: string,
) {
  const res = await atlassianFetch(
    jiraUrl(cloudId, `/issue/${issueKey}/transitions`),
    accessToken,
  );
  return res.json() as Promise<{ transitions: any[] }>;
}

export async function jiraDoTransition(
  cloudId: string,
  accessToken: string,
  issueKey: string,
  transitionId: string,
) {
  await atlassianFetch(
    jiraUrl(cloudId, `/issue/${issueKey}/transitions`),
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({ transition: { id: transitionId } }),
    },
  );
}

// Comments
export async function jiraGetComments(
  cloudId: string,
  accessToken: string,
  issueKey: string,
  params?: { startAt?: number; maxResults?: number; orderBy?: string },
) {
  const query = new URLSearchParams();
  if (params?.startAt !== undefined)
    query.set("startAt", String(params.startAt));
  if (params?.maxResults !== undefined)
    query.set("maxResults", String(params.maxResults));
  if (params?.orderBy) query.set("orderBy", params.orderBy);
  const qs = query.toString();
  const res = await atlassianFetch(
    jiraUrl(cloudId, `/issue/${issueKey}/comment${qs ? `?${qs}` : ""}`),
    accessToken,
  );
  return res.json() as Promise<{
    startAt: number;
    maxResults: number;
    total: number;
    comments: any[];
  }>;
}

export async function jiraAddComment(
  cloudId: string,
  accessToken: string,
  issueKey: string,
  body: unknown,
) {
  const res = await atlassianFetch(
    jiraUrl(cloudId, `/issue/${issueKey}/comment`),
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({ body }),
    },
  );
  return res.json();
}

export async function jiraUpdateComment(
  cloudId: string,
  accessToken: string,
  issueKey: string,
  commentId: string,
  body: unknown,
) {
  const res = await atlassianFetch(
    jiraUrl(cloudId, `/issue/${issueKey}/comment/${commentId}`),
    accessToken,
    {
      method: "PUT",
      body: JSON.stringify({ body }),
    },
  );
  return res.json();
}

export async function jiraDeleteComment(
  cloudId: string,
  accessToken: string,
  issueKey: string,
  commentId: string,
) {
  await atlassianFetch(
    jiraUrl(cloudId, `/issue/${issueKey}/comment/${commentId}`),
    accessToken,
    { method: "DELETE" },
  );
}

// Projects
export async function jiraListProjects(
  cloudId: string,
  accessToken: string,
  params?: { startAt?: number; maxResults?: number },
) {
  const query = new URLSearchParams();
  if (params?.startAt !== undefined)
    query.set("startAt", String(params.startAt));
  if (params?.maxResults !== undefined)
    query.set("maxResults", String(params.maxResults));
  const qs = query.toString();
  const res = await atlassianFetch(
    jiraUrl(cloudId, `/project/search${qs ? `?${qs}` : ""}`),
    accessToken,
  );
  return res.json() as Promise<{
    values: any[];
    total: number;
  }>;
}

export async function jiraGetProject(
  cloudId: string,
  accessToken: string,
  projectKey: string,
) {
  const res = await atlassianFetch(
    jiraUrl(cloudId, `/project/${projectKey}`),
    accessToken,
  );
  return res.json();
}

export async function jiraGetProjectStatuses(
  cloudId: string,
  accessToken: string,
  projectKey: string,
) {
  const res = await atlassianFetch(
    jiraUrl(cloudId, `/project/${projectKey}/statuses`),
    accessToken,
  );
  return res.json();
}

// Users
export async function jiraSearchUsers(
  cloudId: string,
  accessToken: string,
  query: string,
) {
  const params = new URLSearchParams({ query });
  const res = await atlassianFetch(
    jiraUrl(cloudId, `/user/search?${params}`),
    accessToken,
  );
  return res.json();
}

// Agile API
export async function agileListBoards(
  cloudId: string,
  accessToken: string,
  params?: { startAt?: number; maxResults?: number; projectKeyOrId?: string },
) {
  const query = new URLSearchParams();
  if (params?.startAt !== undefined)
    query.set("startAt", String(params.startAt));
  if (params?.maxResults !== undefined)
    query.set("maxResults", String(params.maxResults));
  if (params?.projectKeyOrId)
    query.set("projectKeyOrId", params.projectKeyOrId);
  const qs = query.toString();
  const res = await atlassianFetch(
    agileUrl(cloudId, `/board${qs ? `?${qs}` : ""}`),
    accessToken,
  );
  return res.json() as Promise<{ values: any[]; total: number }>;
}

export async function agileGetBoardConfig(
  cloudId: string,
  accessToken: string,
  boardId: string | number,
) {
  const res = await atlassianFetch(
    agileUrl(cloudId, `/board/${boardId}/configuration`),
    accessToken,
  );
  return res.json();
}

export async function agileListSprints(
  cloudId: string,
  accessToken: string,
  boardId: string | number,
  params?: { startAt?: number; maxResults?: number; state?: string },
) {
  const query = new URLSearchParams();
  if (params?.startAt !== undefined)
    query.set("startAt", String(params.startAt));
  if (params?.maxResults !== undefined)
    query.set("maxResults", String(params.maxResults));
  if (params?.state) query.set("state", params.state);
  const qs = query.toString();
  const res = await atlassianFetch(
    agileUrl(cloudId, `/board/${boardId}/sprint${qs ? `?${qs}` : ""}`),
    accessToken,
  );
  return res.json() as Promise<{ values: any[]; total: number }>;
}

export async function agileGetSprintIssues(
  cloudId: string,
  accessToken: string,
  sprintId: string | number,
  params?: { startAt?: number; maxResults?: number; fields?: string[] },
) {
  const query = new URLSearchParams();
  if (params?.startAt !== undefined)
    query.set("startAt", String(params.startAt));
  if (params?.maxResults !== undefined)
    query.set("maxResults", String(params.maxResults));
  if (params?.fields?.length) query.set("fields", params.fields.join(","));
  const qs = query.toString();
  const res = await atlassianFetch(
    agileUrl(cloudId, `/sprint/${sprintId}/issue${qs ? `?${qs}` : ""}`),
    accessToken,
  );
  return res.json() as Promise<{
    startAt: number;
    maxResults: number;
    total: number;
    issues: any[];
  }>;
}

// Issue types for a project
export async function jiraGetIssueTypesForProject(
  cloudId: string,
  accessToken: string,
  projectKey: string,
) {
  const res = await atlassianFetch(
    jiraUrl(cloudId, `/issue/createmeta/${projectKey}/issuetypes`),
    accessToken,
  );
  return res.json() as Promise<{ values: any[] }>;
}
