# CRM

CRM is an agent-native companion for a connected HubSpot workspace. It provides
fast, scoped CRM work from a thin local mirror while keeping HubSpot
authoritative for remote fields and mutations.

The first phase supports HubSpot Connected/Hybrid behavior. Salesforce is a
future contract target; native CRM storage is not part of this template.

## Guardrails

- Provider credentials are workspace Connections only.
- The mirror contains configured cohorts and allow-listed fields, not raw
  provider exports.
- Sensitive fields default to redacted and unknown fields are remote-only.
- Evidence stores a bounded quote and source reference, never transcripts or
  media.
- Provider mutations are revision-aware, audited, and proposed when agent risk
  requires approval.

See [the CRM contract](docs/architecture/crm-contract.md) for field policies,
identity, access scope, and write decisions.

## Local development

```bash
pnpm install
pnpm dev
```

Set `DATABASE_URL` for persistent deployment storage. Connect HubSpot from the
workspace Connections surface; do not add provider secrets to `.env`.
