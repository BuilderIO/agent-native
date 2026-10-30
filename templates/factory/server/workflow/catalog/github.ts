import type { OperationDefinitionInput } from "../operations.js";

const repo = {
  name: "repo",
  type: "string",
  required: true,
  label: "Repository (owner/name)",
} as const;

// A write lands on this repository and number, so a model never picks them.
const targetRepo = { ...repo, target: true } as const;
const targetNumber = {
  name: "number",
  type: "number",
  required: true,
  target: true,
  label: "Issue or pull request",
} as const;

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
    outputs: [
      { name: "ok", type: "boolean" },
      { name: "repo", type: "string" },
      { name: "number", type: "number" },
      { name: "url", type: "string" },
      { name: "title", type: "string" },
      { name: "state", type: "string", description: "open, closed or merged." },
      { name: "draft", type: "boolean" },
      { name: "merged", type: "boolean" },
      { name: "mergedAt", type: "string", nullable: true },
      { name: "mergeCommitSha", type: "string", nullable: true },
      { name: "headSha", type: "string" },
      { name: "headRef", type: "string" },
      { name: "baseRef", type: "string" },
      {
        name: "author",
        type: "object",
        description: "login, kind and builderAuthored.",
      },
      { name: "mergeable", type: "boolean", nullable: true },
      { name: "mergeableState", type: "string", nullable: true },
      { name: "additions", type: "number" },
      { name: "deletions", type: "number" },
      { name: "changedFiles", type: "number" },
      {
        name: "checks",
        type: "object",
        description:
          "coverage, total, passed, failed, pending, informational, allPassing, notPassing and notPassingTruncated.",
      },
      {
        name: "reviewThreads",
        type: "object",
        description:
          "complete, total, unresolved, unresolvedThreads and unresolvedThreadsTruncated.",
      },
      { name: "reviews", type: "object", description: "complete and total." },
      {
        name: "verification",
        type: "object",
        description:
          "What the description says about how the change was checked, under its `### Verified` heading: present (the heading has text or a screenshot or recording under it; false when there is no description), hasMedia (an image, video or recording link is there) and excerpt (the start of that section, at most 1,500 characters, HTML and URLs removed). The description itself is not returned.",
      },
    ],
    credential: { provider: "github" },
  },
  {
    // The action re-runs the merge gate itself: a canvas edit that rewires
    // around the gate lookup must not be able to merge. The gate also wants an
    // approving review of the head commit from a person (not a bot or Builder
    // account) who is an owner, member or collaborator other than the author, so
    // a green Builder pull request nobody has looked at is held for a person.
    // It also holds a code change with no test change and a description with no
    // `### Verified` section.
    id: "github.mergePullRequest",
    provider: "github",
    label: "GitHub: merge a pull request",
    nodeKinds: ["action"],
    effect: "write",
    fields: [
      targetRepo,
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
    outputs: [
      { name: "ok", type: "boolean" },
      { name: "merged", type: "boolean" },
      { name: "repo", type: "string" },
      { name: "number", type: "number" },
      {
        name: "sha",
        type: "string",
        description: "The merge commit; the same value is externalRef.",
      },
      { name: "headSha", type: "string" },
      { name: "mergeMethod", type: "string", nullable: true },
      { name: "alreadyMerged", type: "boolean" },
      { name: "reconciled", type: "boolean" },
    ],
    receipt: { externalRef: "sha", url: "url" },
    credential: { provider: "github" },
  },
  {
    id: "github.addLabels",
    provider: "github",
    label: "GitHub: add labels",
    description:
      "Adds 1 to 5 labels to an issue or pull request in the factory's own repository; each is text of up to 50 characters with no comma. One it already has stays, so a repeat changes nothing; a name the repository lacks is created.",
    nodeKinds: ["action"],
    effect: "write",
    fields: [
      targetRepo,
      targetNumber,
      {
        name: "labels",
        type: "json",
        required: true,
        // A label can trigger automation in the repository, so a person or a
        // fixed route picks it and an AI step's answer cannot.
        target: true,
        label: "Labels",
        description: 'A list of label names, such as ["bug", "triage"].',
      },
    ],
    implementation: {
      type: "action",
      action: "add-github-labels",
      argMap: { repo: "repo", number: "number", labels: "labels" },
    },
    outputs: [
      { name: "ok", type: "boolean" },
      {
        name: "labels",
        type: "list",
        description: "Every label the item has now.",
      },
    ],
    receipt: { externalRef: "externalRef" },
    credential: { provider: "github" },
  },
  {
    id: "github.removeLabel",
    provider: "github",
    label: "GitHub: remove a label",
    description:
      "Removes one label from an issue or pull request in the factory's own repository. An item without it is a success with alreadyAbsent true; a missing issue or repository fails.",
    nodeKinds: ["action"],
    effect: "write",
    fields: [
      targetRepo,
      targetNumber,
      {
        name: "label",
        type: "string",
        required: true,
        target: true,
        label: "Label",
      },
    ],
    implementation: {
      type: "action",
      action: "remove-github-label",
      argMap: { repo: "repo", number: "number", label: "label" },
    },
    outputs: [
      { name: "ok", type: "boolean" },
      {
        name: "alreadyAbsent",
        type: "boolean",
        description: "True when the item did not have the label.",
      },
    ],
    receipt: { externalRef: "externalRef" },
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
