---
"@agent-native/core": patch
---

Security hardening for the agent's raw-SQL tools, cross-tenant run isolation,
server-side SSRF, and CSRF:

- **db-query / db-exec scope bypass (cross-tenant read/write):** schema-qualified
  table references (`public.<table>` on Postgres, `main.<table>` on SQLite) now
  fail with a clear error, since a qualified name bypasses the per-user/per-org
  temporary views that isolate each tenant's rows. The same guard protects the
  extension SQL surface, which routes through the same tools.
- **Credential exfiltration via db tools:** per-user credential rows
  (`u:<email>:credential:*`, stored by `resolveCredential`) are now excluded from
  the agent's scoped `settings` view, so a prompt-injected agent can no longer
  read the user's own API keys/tokens through `db-query` and send them out.
- **Cross-tenant agent run leak + abort:** `GET /runs/:id/events`,
  `GET /runs/active`, and `POST /runs/:id/abort` now verify the caller owns the
  run's thread (404 otherwise), closing a hole where any authenticated tenant who
  learned another tenant's runId/threadId could stream their live agent turn
  (assistant text + tool-result payloads) or abort their run.
- **Server-side SSRF:** the `upload-image` action and the `import-from-url`
  design-token fetcher now route untrusted URLs through a shared `ssrfSafeFetch`
  (DNS-aware private-address check, connect-time IP guard, per-redirect
  re-validation), so they can no longer be steered to cloud metadata, localhost,
  or internal services.
- **CSRF:** `Sec-Fetch-Site: same-site` is no longer trusted as first-party, so a
  sibling-subdomain page under a shared cookie domain can't ride the session
  cookie for a state-changing request. Legitimate first-party clients still pass
  via the custom-header / JSON paths; iframe and embed flows are unaffected.
