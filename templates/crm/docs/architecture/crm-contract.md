# CRM kernel contract

This contract is the boundary for the HubSpot companion implementation. It is
intentionally valid for Salesforce before Salesforce transport is built, so
HubSpot-specific assumptions do not become the product model.

## Canonical vocabulary

- **Connection**: an authorized workspace integration grant and provider
  account. Tokens remain in workspace connections; CRM stores only the
  connection id and non-secret account metadata.
- **Object definition**: provider schema for one object type, including field
  types and effective capabilities for the connection actor.
- **Record**: one provider or native object instance. Canonical kinds are
  `account`, `person`, `opportunity`, `activity`, `task`, and `custom`.
- **Relationship**: a directed edge between records. It preserves a provider
  relationship id or source reference field and optional directional labels.
- **Interaction**: a bounded relationship event such as a meeting, call,
  email, or note. Rich media remains in its source app/provider.
- **Evidence**: a URL/id plus bounded quote, timestamp, speaker, and source
  metadata supporting a CRM claim. Evidence is not a transcript or media blob.
- **Cadence**: desired contact interval, last meaningful interaction, and next
  contact date for an account or person.
- **Mirror**: a scoped local projection for fast lists, monitoring, joins, and
  agent context. It is not a second ungoverned copy of the upstream CRM.
- **Local field**: a derived or user-authored field whose authority is CRM.
- **Mutation**: a typed create/update/delete/association request with an
  idempotency key and optional expected remote revision.
- **Proposal**: a mutation awaiting review or an agent-generated preview.

The TypeScript source of truth is
[`shared/crm-contract.ts`](../../shared/crm-contract.ts).

## Identity and provenance

Provider identity is the tuple:

`connection_id + provider + object_type + remote_id`

Local ids are opaque and never sent upstream. Email and domain are matching
signals, not identity keys. Every mirrored field keeps field-level provenance:
provider, connection, object type, remote id, optional field name, observed
revision/time, and optional evidence reference.

Relationships preserve direction because HubSpot association type ids and
Salesforce reference fields are directional. Identity resolution may link two
records, but never merges provider identities or silently overwrites one
provider with another.

## Thin mirror and authority

The mirror contains only configured cohorts: selected pipelines, active
accounts, their linked people, explicitly linked records, recent interaction
metadata, and local-owned objects. List and monitoring views read from it;
record detail performs a read-through refresh; long-tail or exhaustive work
uses provider API requests and staged data programs.

Every mirrored record stores the remote revision, sync cursor/time, tombstone,
connection identity, and access-scope key. Upstream is authoritative in
Connected mode. In Hybrid mode, upstream remains authoritative for remote
fields while CRM is authoritative for `derived-local` and
`local-authoritative` fields. Native mode is out of scope for this run.

No raw provider response, audio, video, transcript, screenshot, base64 body, or
file payload is stored in CRM SQL.

## Field storage policy

Unknown fields are **not mirrored**. A field value enters the mirror only when
it is on the configured allow-list.

| Policy                | Stored locally                            | Read behavior                     | Write authority                |
| --------------------- | ----------------------------------------- | --------------------------------- | ------------------------------ |
| `mirrored`            | Bounded typed value                       | Mirror, then read-through refresh | Provider                       |
| `remote-only`         | Metadata, never the value                 | Fetch ephemerally from provider   | Provider                       |
| `redacted`            | Neither metadata value nor value          | Do not fetch or expose            | None                           |
| `derived-local`       | Typed value plus provenance/evidence refs | Local                             | CRM computation                |
| `local-authoritative` | Typed value                               | Local                             | Human or approved CRM workflow |

Sensitive fields default to `redacted`; other newly discovered fields default
to `remote-only`. An admin must explicitly allow-list a field as `mirrored`.

## Access-scope semantics

`ownableColumns()` and framework access checks provide the local privacy
boundary. Provider access remains a second, non-substitutable boundary.

Each record and field projection carries the connection actor, grant id,
record-visibility mode, object CRUD capabilities, and hashes/fingerprints for
effective field and sharing access. A service-account mirror must not be shown
as though it inherited a human user's Salesforce sharing or field-level
permissions. Reads fail closed when the current access scope cannot be proven
compatible. Scope changes invalidate or quarantine affected mirror rows until
they are refreshed.

## Write policy matrix

| Initiator and operation                                             | Default decision      | Required behavior                                         |
| ------------------------------------------------------------------- | --------------------- | --------------------------------------------------------- |
| Human, direct scoped edit                                           | Execute               | Optimistic UI, conflict check, undo where possible, audit |
| Agent, local and reversible                                         | Execute               | Must pass access and stored policy; audit                 |
| Agent, provider and reversible                                      | Propose               | Preview first; execute only with delegated authority      |
| Agent, bulk/destructive/ownership/amount/stage/external side effect | Require approval      | Preview exact scope and changed fields; fail closed       |
| Automation with stored policy                                       | Execute inside policy | No per-run prompt; stop and propose/deny outside policy   |

All mutations are idempotent, access-checked, audited, and record the actor,
policy decision, before/after field summary, provider response status, and
remote revision. Provider conflicts never overwrite silently.

## Provider-model validation

| Contract concern              | HubSpot                                       | Salesforce                                                  | Contract consequence                                          |
| ----------------------------- | --------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------- |
| Object names                  | Built-ins plus numeric/custom object type ids | Standard and `__c` API names                                | `objectType` is an opaque case-preserving string              |
| Record ids                    | String ids                                    | 15/18-character string ids                                  | `remoteId` is an opaque string                                |
| Schema discovery              | Properties and CRM schemas APIs               | sObject/Object Info describe                                | Adapter returns object and field capabilities                 |
| Accounts/people/opportunities | Companies/contacts/deals                      | Account/Contact/Opportunity                                 | Canonical kind is separate from provider object type          |
| Relationships                 | Directional association type ids and labels   | Reference fields and child relationships                    | Directed edge preserves type, label, and source field         |
| Custom objects                | Schema-discovered                             | `__c` and describe-discovered                               | V1 generic discover/search/display/link/write support         |
| Remote revision               | `updatedAt`                                   | `LastModifiedDate` or `SystemModstamp`                      | Revision is an opaque string with observed timestamp          |
| Deletion                      | Archived records                              | Deleted records/query-all semantics                         | Tombstone is first-class and sync-capability gated            |
| Permissions                   | OAuth scopes, object/property sensitivity     | CRUD, FLS, record sharing                                   | Access scope is stored and checked independently of local ACL |
| Conditional write             | Provider-specific conflict strategy           | `If-Unmodified-Since`/revision-aware update where available | Adapter reports capability and never invents success          |

Reference checks used for this validation:

- [HubSpot CRM objects and associations](https://developers.hubspot.com/docs/api-reference/latest/crm/understanding-the-crm)
- [HubSpot association definitions and labels](https://developers.hubspot.com/docs/api-reference/latest/crm/associations/associations-schema/guide)
- [Salesforce object metadata](https://developer.salesforce.com/docs/platform/graphql/guide/query-objectinfo.html)
- [Salesforce record queries and effective permissions](https://developer.salesforce.com/docs/platform/graphql/guide/query-record-objects.html)
- [Salesforce revision-aware record updates](https://developer.salesforce.com/docs/platform/lwc/guide/reference-update-record.html)

## Phase boundary

This run builds HubSpot Connected/Hybrid companion behavior only. Salesforce
is a contract acceptance target, not an implementation target. Native storage,
provider migration, object authoring, a page builder, and a Salesforce
transport require a later green light.
