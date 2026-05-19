---
"@agent-native/core": patch
---

Bound every DB init/query op with a timeout (`withDbTimeout`, `DB_OP_TIMEOUT_MS`, default 8s on serverless). A frozen→thawed serverless instance could leave the Neon WebSocket hung mid-query so the promise never settled and never errored — `retryOnConnectionError` only retries thrown errors, so authenticated requests (which run a session lookup on every navigation) hung until the platform killed the function (~30s on Netlify), surfacing as "the site won't load". The timeout reports as a retryable `CONNECT_TIMEOUT`, so the existing retry and reject-reset paths recover and the cached session-table init promise no longer stays poisoned. Also drop a failed/hung `getDbExec` init promise so the next call retries a fresh connection instead of re-awaiting a permanently rejected/pending one.
