---
"@agent-native/core": patch
---

Remove the background-worker diagnostic instrumentation added during the
analytics-freeze investigation (breadcrumb sink route, awaited diag writes,
per-branch timeout wrappers, dedicated connection, fetch-POST breadcrumbs),
restoring the clean post-DDL-guard worker hot path. The DDL guard (#1514) and
background-function pool fix (#1523) — the real fixes — are retained.
