---
"@agent-native/core": patch
---

Build the audit-redaction test fixture from concatenated parts so Netlify's
secret scanner no longer flags a literal `sk-` token pattern and blocks the
deploy.
