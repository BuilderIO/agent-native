---
name: company-policies
description: {{APP_TITLE}}-wide policies the agent must enforce for every app — data handling, PII, approval flows, compliance rules.
---

# {{APP_TITLE}} Company Policies

Every app in the workspace shares these policies. Read this skill before
taking any action that touches customer data, external services, or
deployed state.

## Data handling

- **PII minimization.** Only load the fields you actually need. Never
  `SELECT *` on a table that contains customer records.
- **No raw customer email in logs.** Hash or redact before logging.
- **Retention.** Deleted records are soft-deleted first and purged by a
  scheduled job. Do not write actions that hard-delete customer data.

## Third-party calls

- **Allowlist only.** Only call domains on the approved allowlist
  (documented in the root `README.md`). If an integration needs a new
  domain, surface a warning and wait for human approval before making
  the call.
- **Secrets come from `resolveCompanyCredential`.** Never hardcode.
  Never check secrets into git. Rotating a key in the central store
  updates every app on the next request.

## Approval flows

- **Destructive operations need a confirmation preview.** Any action
  that modifies production data must first return a preview of the
  change (what will be created / updated / deleted) and wait for
  explicit user confirmation before executing.

## Apply across apps

This skill is loaded automatically in every workspace app. If an
individual app needs different behavior, it can add a same-named skill
under its own `.agents/skills/company-policies/SKILL.md` and that copy
will win for that app only.
