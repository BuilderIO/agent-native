import type { OperationDefinitionInput } from "../operations.js";

const repo = {
  name: "repo",
  type: "string",
  required: true,
  label: "Repository (owner/name)",
} as const;

// The merge lands on this repository and pull request, so a model never picks them.
const mergeRepo = { ...repo, target: true } as const;

export const githubOperations: OperationDefinitionInput[] = [
  {
    id: "github.listCommits",
    provider: "github",
    label: "GitHub: commits in a window",
    nodeKinds: ["source"],
    effect: "read",
    fields: [
      repo,
      {
        name: "branch",
        type: "string",
        label: "Branch (the default branch when empty)",
      },
    ],
    implementation: {
      type: "provider-request",
      method: "GET",
      pathTemplate: "/repos/{repo}/commits",
      query: {
        since: "{since}",
        until: "{until}",
        sha: "{branch}",
        per_page: "100",
      },
    },
    window: { fromParam: "since", toParam: "until" },
    itemMapping: {
      kind: "commit",
      fields: {
        title: ["commit.message", "Commit {sha}"],
        url: "html_url",
        author: "commit.author.name",
        occurredAt: "commit.committer.date",
        "extras.sha": "sha",
      },
      dedupeKey: "sha",
    },
    credential: { provider: "github" },
  },
  {
    // Dependabot alerts only; code scanning alerts are a different endpoint
    // and item shape.
    id: "github.listSecurityAlerts",
    provider: "github",
    label: "GitHub: open dependency security alerts",
    nodeKinds: ["source"],
    effect: "read",
    fields: [repo],
    implementation: {
      type: "provider-request",
      method: "GET",
      pathTemplate: "/repos/{repo}/dependabot/alerts",
      query: {
        state: "open",
        sort: "created",
        direction: "desc",
        per_page: "100",
      },
    },
    itemMapping: {
      kind: "alert",
      fields: {
        title: ["security_advisory.summary", "Dependency alert {number}"],
        text: "security_advisory.description",
        url: "html_url",
        occurredAt: "created_at",
        "extras.severity": "security_advisory.severity",
        "extras.package": "dependency.package.name",
        "extras.ecosystem": "dependency.package.ecosystem",
        "extras.manifestPath": "dependency.manifest_path",
        "extras.ghsaId": "security_advisory.ghsa_id",
      },
      dedupeKey: "number",
    },
    credential: { provider: "github" },
  },
  {
    id: "github.mergedPullRequests",
    provider: "github",
    label: "GitHub: pull requests merged since a time",
    nodeKinds: ["lookup"],
    effect: "read",
    fields: [
      repo,
      { name: "since", type: "string", required: true, label: "Merged since" },
    ],
    implementation: {
      type: "provider-request",
      method: "GET",
      pathTemplate: "/search/issues",
      query: {
        q: "repo:{repo} is:pr is:merged merged:>={since}",
        sort: "updated",
        order: "desc",
        per_page: "30",
      },
    },
    credential: { provider: "github" },
  },
  {
    // One call cannot return checks on the head commit and review threads, so
    // the host action composes them.
    id: "github.readPullRequest",
    provider: "github",
    label: "GitHub: read a pull request with its checks",
    nodeKinds: ["lookup"],
    effect: "read",
    fields: [
      repo,
      { name: "number", type: "number", required: true, label: "Pull request" },
    ],
    implementation: {
      type: "action",
      action: "get-factory-pull-request",
      argMap: { repo: "repo", number: "number" },
    },
    credential: { provider: "github" },
  },
  {
    // The action re-runs the merge gate itself: a canvas edit that rewires
    // around the gate lookup must not be able to merge. The gate also wants an
    // approving review of the head commit from a person (not a bot or Builder
    // account) who is an owner, member or collaborator other than the author, so
    // a green Builder pull request nobody has looked at is held for a person.
    id: "github.mergePullRequest",
    provider: "github",
    label: "GitHub: merge a pull request",
    nodeKinds: ["action"],
    effect: "write",
    fields: [
      mergeRepo,
      {
        name: "number",
        type: "number",
        required: true,
        target: true,
        label: "Pull request",
      },
      {
        name: "mergeMethod",
        type: "enum",
        enum: ["squash", "merge", "rebase"],
        default: "squash",
        label: "Merge method",
      },
    ],
    implementation: {
      type: "action",
      action: "merge-factory-pull-request",
      argMap: {
        repo: "repo",
        number: "number",
        mergeMethod: "mergeMethod",
      },
    },
    receipt: { externalRef: "sha", url: "url" },
    credential: { provider: "github" },
  },
  {
    id: "github.readFile",
    provider: "github",
    label: "GitHub: read a file",
    nodeKinds: ["lookup"],
    effect: "read",
    fields: [
      repo,
      { name: "path", type: "string", required: true, label: "File path" },
      { name: "ref", type: "string", label: "Branch, tag or commit" },
    ],
    implementation: {
      type: "provider-request",
      method: "GET",
      pathTemplate: "/repos/{repo}/contents/{path}",
      query: { ref: "{ref}" },
    },
    credential: { provider: "github" },
  },
  {
    id: "github.searchCode",
    provider: "github",
    label: "GitHub: search code",
    nodeKinds: ["lookup"],
    effect: "read",
    fields: [
      repo,
      { name: "query", type: "string", required: true, label: "Search for" },
    ],
    implementation: {
      type: "provider-request",
      method: "GET",
      pathTemplate: "/search/code",
      query: { q: "{query} repo:{repo}", per_page: "20" },
    },
    credential: { provider: "github" },
  },
];
