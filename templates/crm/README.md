# CRM

CRM is an agent-native CRM that runs either as a standalone Native SQL system
or as a scoped companion for connected HubSpot and Salesforce workspaces. It
provides fast record work, saved views, tasks, cadence, evidence, reviewable
call signals, and agent workflows without forcing a provider choice.

Native SQL is local-authoritative and portable across SQLite, Postgres, and D1.
The connected modes support scoped Connected and Hybrid behavior: HubSpot maps
companies, contacts, and deals; Salesforce maps Accounts, Contacts, and
Opportunities.

## Guardrails

- Native SQL requires no external connection or provider credential.
- Provider credentials are workspace Connections only.
- The mirror contains configured cohorts and allow-listed fields, not raw
  provider exports.
- Sensitive fields default to redacted and unknown fields are remote-only.
- Evidence stores a bounded quote and source reference, never transcripts or
  media.
- Signal detectors produce timestamped evidence citations. Keyword matching is
  local; smart moments and summaries are delegated through agent chat and saved
  only after grounding validation.
- Provider mutations are revision-aware, audited, and proposed when agent risk
  requires approval.

## Start or connect CRM

1. Open **Set up CRM** and select **Start with Native SQL** to use CRM without
   HubSpot or Salesforce. Native records and fields are local-authoritative.
2. To use CRM as a companion, in shared **Settings → Connections**, authorize
   HubSpot or Salesforce and
   grant the connection to CRM. OAuth and refresh tokens stay in workspace
   Connections; CRM never accepts a token or key. Salesforce production is the
   default. For a sandbox, use **Authorize the sandbox directly** on Set up CRM;
   the selected login environment is retained for token refresh.
3. Choose the granted connection and select a recent
   history window. HubSpot may be narrowed to deal pipeline IDs; Salesforce
   starts with recently updated Accounts, Contacts, and Opportunities.
4. CRM mirrors the selected cohort and allow-listed fields only. Confirm the
   connection actor's access before relying on a record in the local mirror.

## Operating model

- **Connected**: the source CRM is authoritative. CRM is a scoped companion
  for record work, saved views, tasks, call evidence, and analysis.
- **Hybrid**: the source CRM remains authoritative for remote fields; CRM may
  own explicitly configured derived-local and local-authoritative fields.
- **Native SQL**: CRM is the system of record for its accounts, people,
  opportunities, relationships, saved views, tasks, cadence, and local fields.
  It has no upstream provider, sync job, or provider token.
- **Signals**: attach one Clips call-evidence artifact to one or more CRM
  records, run the default Pricing, Competitors, Objections, Next steps,
  Budget, and Timing detectors, then confirm or dismiss the grounded results.
  Clips remains the owner of recording, transcript, consent, and media access.
- **Read and write safety**: provider reads use the connection's effective
  permissions. Upstream changes are revision-aware, access-checked proposals
  in this release; finish the approved change in HubSpot or Salesforce and do
  not claim a provider write completed from CRM.

Salesforce reads are validated against the current connection actor and field
permissions before mirrored data is returned. A service-account mirror never
proves a user's access; ambiguous or changed access fails closed until refresh.

## Live testing

Use a shared, already-authorized workspace Connection—never copy its secret
into an environment file. Choose a small recent cohort, verify the resulting
records and access scope in CRM, then test a proposal without applying a
provider change. Record only connection labels, counts, and non-sensitive
results in test evidence.

See [the CRM contract](docs/architecture/crm-contract.md) for field policies,
identity, access scope, and write decisions.

## Local development

```bash
pnpm install
pnpm dev
```

Set `DATABASE_URL` for persistent deployment storage. Native SQL works without
external credentials. Connect HubSpot or Salesforce from the workspace
Connections surface; do not add provider secrets to `.env`.
