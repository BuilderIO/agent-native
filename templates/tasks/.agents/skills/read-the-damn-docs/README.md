# /read-the-damn-docs

Make agents web-search for the docs before they guess.

`/read-the-damn-docs` is a docs-first discipline skill for implementation,
debugging, and technical answers that depend on versioned or external behavior.
It tells the agent when docs are mandatory, why web search is usually the right
way to find them, which sources count as authoritative, and how to report the
evidence it used.

## What It Does

- Forces a docs pass for third-party APIs, libraries, frameworks, CLIs, cloud
  services, model SDKs, and provider integrations.
- Directs the agent to web-search for current official docs unless the relevant
  docs are already local or supplied by the user.
- Requires current version checks before adding packages or writing install,
  import, config, or CLI commands.
- Prioritizes local repo docs, specs, schemas, generated types, and tests for
  internal contracts.
- Treats auth, security, billing, data, migrations, deploys, quotas, caching,
  and compliance as docs-required surfaces.
- Makes the agent name the docs or files it relied on when that evidence affects
  the implementation.

## When To Use It

Use it when an agent might otherwise rely on stale model memory. Most of the
time, that means it should search the web for official docs first: latest/current
behavior, package setup, SDK usage, platform limits, provider APIs, upgrade
guides, framework config, OAuth, payments, webhooks, migrations, CI/CD, browser
APIs, and repo-specific contracts.

Skip it for trivial typo fixes, formatting, self-contained local code, or cases
where nearby tests and types fully answer the question.

## Examples

These should trigger docs before code:

- Adding Tailwind, Next.js, React, Vite, Nitro, Drizzle, Prisma, or an AI SDK.
- Streaming model responses with OpenAI, Anthropic, Google, or a provider SDK.
- Wiring Stripe webhooks, OAuth, GitHub Actions, Slack apps, or Notion APIs.
- Debugging deprecations, unknown config fields, missing exports, or changed
  framework defaults.
- Choosing a model, package, cloud API, storage strategy, or migration path.
- Implementing a repo-specific system where local docs, schemas, or generated
  clients define the contract.

## Install

```sh
npx @agent-native/skills@latest add --skill read-the-damn-docs
```
