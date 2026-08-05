---
name: read-the-damn-docs
description: >-
  Use when implementing, integrating, upgrading, debugging, or answering
  anything involving third-party APIs, libraries, frameworks, CLIs, cloud
  services, model/provider SDKs, fast-moving product behavior, user requests for
  latest/current/official behavior, unfamiliar repo docs/specs, errors that may
  indicate API drift, or high-stakes auth, security, billing, data, migration,
  deployment, compliance, or privacy behavior. Forces Codex to web-search for
  current official docs and read primary docs before assuming from memory.
---

# Read The Damn Docs

Do not guess where authoritative docs can answer the question. The most common
right move is to web-search for the current official docs, open the relevant
pages, and read them before coding. For APIs, versions, provider behavior,
config, limits, lifecycle hooks, or security-sensitive flows, ground the answer
in what the docs actually say.

## Docs-First Triggers

Read docs before proceeding when any of these are true:

- The user asks for "latest", "current", "official", "supported", "best
  practice", "recommended", "today", "now", or "look it up".
- The needed docs are not already in the repo or supplied by the user. Search
  the web for the official docs rather than hoping model memory is current.
- The task adds, upgrades, configures, or imports a package, SDK, framework,
  plugin, CLI, model, cloud resource, or provider integration.
- The API is fast-moving or version-sensitive: AI SDKs, OpenAI/Anthropic/Google
  APIs, Next.js, React, Tailwind, Vite, Nitro, Drizzle, Prisma, Stripe, GitHub,
  Slack, Notion, browser APIs, deployment platforms, auth libraries, and similar.
- The implementation depends on auth, OAuth scopes, permissions, secrets,
  webhooks, billing, payments, PII, encryption, data retention, migrations,
  retries, rate limits, quotas, caching, deploys, or compliance.
- An error mentions deprecation, unknown options, missing exports, invalid
  config, unsupported fields, changed defaults, or version mismatch.
- A repo has local docs, ADRs, generated schemas, OpenAPI specs, route/action
  registries, design-system docs, or package-level READMEs that could define the
  contract.
- The choice is expensive to reverse: public wire formats, database schema,
  migration strategy, persistent IDs, event names, customer-visible behavior, or
  external automation contracts.
- You catch yourself about to write "usually", "probably", "I think", "from
  memory", or code copied from model memory for an external API.

## What Counts As Docs

Use the most authoritative source available:

- Local repo docs, specs, ADRs, schemas, generated types, package READMEs, and
  tests for project-specific behavior.
- Official product docs, API references, migration guides, changelogs, release
  notes, and SDK source/types for third-party behavior. Find these with web
  search when you do not already have the exact URL.
- Package registry metadata for versions. Before adding a dependency, run
  `npm view <pkg> version`, `pnpm view <pkg> version`, or the ecosystem
  equivalent, then read the docs for that major version.
- Source code or type definitions when official docs are incomplete. Treat this
  as evidence, not folklore.

Avoid Stack Overflow, old blog posts, random snippets, and memory as the primary
source when official docs exist. Use community sources only to debug symptoms
after the authoritative contract is known.

## Required Workflow

1. Identify the exact surface: package name, installed version, target version,
   provider endpoint, CLI command, config file, local helper, schema, or product
   feature.
2. Search the web for the current official docs unless the relevant docs are
   already local or the user supplied a URL. Use targeted searches such as
   `<product> <feature> official docs`, `<package> migration guide`, or
   `<provider> API reference`.
3. Open and read the docs closest to that surface. Prefer local docs first for
   internal code, then official upstream docs. For new packages, verify the
   latest version before writing imports, config, or install commands.
4. Extract the few facts needed for the task: option names, imports, lifecycle
   rules, default behavior, breaking changes, limits, permissions, and examples
   for the current major version.
5. Implement or answer using those facts. If the docs conflict with existing
   code, inspect the local code path and call out the discrepancy.
6. Verify with the smallest useful check: typecheck, tests, build, CLI dry run,
   API schema validation, or a local reproduction.
7. In the final answer, name the docs or local files consulted when that
   evidence affects the recommendation or implementation.

## Examples That Must Trigger Docs

- "Add Tailwind to this app." Check the current Tailwind major and its install
  docs from the web before creating config files or assuming old PostCSS setup.
- "Use the AI SDK to stream responses." Verify the current AI SDK major,
  imports, provider package names, streaming helpers, and server/runtime
  examples from official docs.
- "Wire up Stripe webhooks." Read Stripe's current signature verification,
  event retry, endpoint secret, and framework body-parsing docs before coding.
- "Fix this Next.js caching bug." Read the docs for the installed Next.js major
  and router mode before assuming cache invalidation semantics.
- "Add Drizzle migrations." Read the current Drizzle kit docs and existing repo
  migration conventions before generating files.
- "Create a GitHub Action." Read official Actions syntax and permissions docs,
  especially for `pull_request`, `workflow_run`, OIDC, tokens, and artifacts.
- "Why does this OAuth flow fail?" Read the provider's scopes, redirect URI,
  PKCE, token refresh, and app verification docs before changing code.
- "Use this repo's plan/comment/action system." Read local docs, route/action
  registries, schemas, and tests before inventing endpoints or props.
- "Upgrade Vite/Nitro/React." Read the migration guide for the exact target
  major before editing config or imports.
- "What model should we use?" Read current provider model docs, pricing/limits
  pages, and SDK examples before recommending.

## When A Quick Local Read Is Enough

Do not browse the web for every tiny edit. A docs pass can be local and brief
when the answer is already in the repo: existing helper usage, nearby tests,
typed interfaces, generated clients, ADRs, or package READMEs. But if the task
depends on an external tool, package, provider, or current product behavior, web
search is usually the right first step. For trivial language syntax, typo fixes,
formatting, or self-contained code with no external contract, proceed normally.

## If Docs Are Unavailable

If network access, auth, or missing local files prevents reading the docs, say
that plainly before relying on memory. Narrow the uncertainty, inspect source or
types if available, and avoid presenting the result as confirmed-current.
