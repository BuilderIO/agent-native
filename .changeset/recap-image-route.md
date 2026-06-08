---
"@agent-native/core": patch
---

Add a signed, content-only recap PNG image route so the PR visual-recap GitHub
Action can inline a recap screenshot into a (private-repo) PR comment.

- `POST /_agent-native/recap-image` stores a PNG (raw `image/png` bytes or JSON
  `{ pngBase64 }`, capped at ~5 MB) and returns
  `{ imageUrl: "<origin>/_agent-native/recap-image/<token>.png" }`. It
  authenticates with the SAME `agent-native connect` bearer token the MCP /
  action surface accepts (legacy `sessions` bearer or a connect-minted MCP
  OAuth access token, audience-bound to this app's MCP resource via the
  canonical `verifyAuth`), plus normal browser session cookies. Unauthenticated
  callers get a 401.
- `GET /_agent-native/recap-image/<token>.png` serves the opaque bytes
  anonymously (so GitHub's camo image proxy can fetch them) with a strict
  `Content-Type: image/png` and a long immutable cache header. Tokens are 32+
  hex chars (no directory traversal); unknown tokens 404. The interactive plan
  stays login-gated.

Storage is a new additive, dialect-agnostic `recap_images` table created via
`CREATE TABLE IF NOT EXISTS` (PNG kept as base64 TEXT for portability across
SQLite / Neon-Postgres / libSQL / D1).
