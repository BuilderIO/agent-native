---
"@agent-native/core": minor
---

**Production code execution modes** (`codeExecution` plugin option + `AGENT_PROD_CODE_EXECUTION` env var)

The agent chat plugin now accepts a `codeExecution` option to enable code-execution tools in production:

- `"off"` (default) — no change to existing behaviour.
- `"sandboxed"` — registers the new `run-code` tool in the production agent's tool registry.
- `"trusted"` — registers both `run-code` and the full coding tool registry (`bash`, `read`, `edit`, `write`) in production.

The `AGENT_PROD_CODE_EXECUTION` environment variable (`"trusted"`, `"sandboxed"`, or `"off"`) takes precedence over the plugin option, allowing per-deployment overrides without code changes.

Dev-mode behaviour is unchanged.

---

**Sandboxed `run-code` tool** (new `packages/core/src/coding-tools/run-code.ts`)

A new `run-code` action lets the agent execute JavaScript (Node.js, ESM, top-level await) in an isolated child process:

- Scrubbed environment: only `PATH`, `HOME`, `TMPDIR`, and similar safe POSIX vars are passed to the child. No app env vars or secrets.
- Fresh temporary working directory per invocation.
- Configurable timeout (default 120 s, max 600 s) and output cap (default 50 000 chars, max 200 000).
- Ephemeral bridge HTTP server on `127.0.0.1` with a per-invocation random bearer token so the child can call allowlisted registered tools (`provider-api-request`, `provider-api-docs`, `provider-api-catalog`, `web-request`) with the parent's request context — without leaking secrets.
- Child globals: `providerFetch(provider, path, init?)` and `webFetch(url, init?)`.
- `run-code` is registered in dev mode unconditionally and in production when the mode is `"sandboxed"` or `"trusted"`.

---

**Per-action tool limits** (`ActionEntry.timeoutMs`, `ActionEntry.maxResultChars`)

`ActionEntry` now accepts optional `timeoutMs` and `maxResultChars` fields. When present, `runAgentLoop` uses these values instead of the global 60 s / 50 000-char defaults for that action.

App-level defaults can be set via `toolLimits: { timeoutMs?, maxResultChars? }` on `createProductionAgentHandler` or `createAgentChatPlugin`. Per-action values take precedence.

---

**`web-request` optional `maxChars` input**

The `web-request` (fetch) tool now accepts an optional `maxChars` parameter (default 32 000, max 200 000) so the agent can request larger response bodies when needed without hitting the hard-coded 32 k truncation.
