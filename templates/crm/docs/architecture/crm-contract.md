# CRM kernel contract

This contract is the boundary for the Native SQL CRM and the HubSpot and
Salesforce companion implementations. It prevents either connected provider's
object model or permission semantics from becoming the product model.

It is the _design_ record: identity, field policy, access scope, the write
matrix, and the provider-model validation behind them. The operating rules an
agent follows every turn live in [`AGENTS.md`](../../AGENTS.md), and the
workflows behind them in the [`crm` skill](../../.agents/skills/crm/SKILL.md).
Those two are the single source; this document explains _why_ they say what they
say and must not restate them differently.

## Canonical vocabulary

- **Connection**: an authorized workspace integration grant and provider
  account. Tokens remain in workspace connections; CRM stores only the
  connection id and non-secret account metadata. Native SQL uses a CRM-owned
  native connection identity and never has an integration token.
- **Object definition**: a provider or CRM-owned schema for one object type,
  including field types and effective capabilities for its authority.
- **Attribute**: one typed field definition on an object type or a list. Its
  type comes from the registry in `shared/crm-attributes.ts`; its `apiSlug` and
  type are immutable once assigned, because every stored value row is keyed and
  typed by them. Authority is `provider`, `derived-local`, or
  `local-authoritative` per attribute — this, not the connection mode, is what
  decides who may write a field.
- **Attribute option**: a managed allowed value for a `status` or `select`
  attribute, optionally carrying a stage SLA (`targetDays`). Options are never
  auto-created by a value write; an unknown value is a typed 422.
- **Field value**: bitemporal. A change closes the current row (`activeUntil`)
  and opens a new one (`activeFrom`) with its actor and provenance, so value
  history and stage history are the same thing. An equal write is suppressed
  entirely. `historyTracked = false` opts a churny mirror field out of history
  by updating in place; that is not the same as "never changed".
- **Record**: one provider or native object instance. Canonical kinds are
  `account`, `person`, `opportunity`, `activity`, `task`, and `custom`.
- **List**: a workflow overlay over exactly one object type, with its own entry
  attributes. **List entry**: one record's membership in a list, holding that
  list's attribute values. Lists and entries are local-authoritative on every
  backend including HubSpot and Salesforce, so a pipeline never requires a
  provider write. There is deliberately no unique constraint on
  `(list_id, record_id)`: two open deals for one company are two entries.
- **Saved view**: stored filter, ordered sort, columns, audience, and a `table`
  or `board` presentation (a board groups by a status attribute). A filter
  condition value may be the literal `"@currentUser"`, resolved server-side
  against the calling actor.
- **Relationship**: a directed edge between records. It preserves a provider
  relationship id or source reference field and optional directional labels.
- **Interaction**: a bounded relationship event such as a meeting, call,
  email, or note. Rich media remains in its source app/provider.
- **Evidence**: a URL/id plus bounded quote, timestamp, speaker, and source
  metadata supporting a CRM claim. Evidence is not a transcript or media blob.
- **Signal**: a first-class, reviewable moment, call summary, or next step with
  a bounded quote/summary, timestamp, confidence, detector/model metadata, and
  an evidence reference. Signals never contain transcript bodies.
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

Connected-provider identity is the tuple:

`connection_id + provider + object_type + remote_id`

Native SQL record ids are opaque CRM-local identifiers with `provider: native`;
they are never sent upstream. Email and domain are matching
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
connection identity, and access-scope key. Upstream is authoritative for every
attribute whose authority is `provider`; CRM is authoritative for
`derived-local` and `local-authoritative` attributes, and for all lists, list
entries, and entry values regardless of backend. In Native SQL mode CRM is
authoritative for the record and all its fields; no remote revision, provider
token, or sync cursor is invented.

Authority is per attribute, which is what the `hybrid` connection mode was for.
That mode is deprecated: the enum value stays for rows already carrying it
(schema changes are additive), it is no longer offered or documented, and it
must be read as `mirrored`.

No raw provider response, audio, video, transcript, screenshot, base64 body, or
file payload is stored in CRM SQL.

## Call intelligence boundary

CRM may link one Clips artifact to several CRM records through separate scoped
evidence rows. Deterministic keyword detectors operate only on the bounded
stored excerpts. Smart detectors and summaries are delegated to agent chat;
server actions do not call a model. Delegated results are accepted only when
the run, record, tracker, and evidence scopes agree and every quote/timestamp
is grounded to the stored evidence excerpt. Clips retains recording,
transcript, consent, recovery, and media ownership.

The default-off Clips review recipe is scoped to one explicitly selected CRM
record, and its trigger is installed in Clips because that is where
`clip.created` is registered. The contract's requirement is only that CRM
receives an opaque id and a durable page reference — never media, a transcript,
a temporary grant, an inferred record, or a provider write — so both CRM record
ACLs and Clips page access hold without duplicating source media. The exact
activation sequence is in the `crm` skill.

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

Connected records and field projections carry the connection actor, grant id,
record-visibility mode, object CRUD capabilities, and hashes/fingerprints for
effective field and sharing access. A service-account mirror must not be shown
as though it inherited a human user's Salesforce sharing or field-level
permissions. Reads fail closed when the current access scope cannot be proven
compatible. Scope changes invalidate or quarantine affected mirror rows until
they are refreshed. Native SQL uses its CRM ownership/share scope and does not
claim or emulate an upstream provider permission.

## Write policy matrix

| Initiator and operation                                             | Default decision      | Required behavior                                         |
| ------------------------------------------------------------------- | --------------------- | --------------------------------------------------------- |
| Human, direct scoped edit                                           | Execute               | Optimistic UI, conflict check, undo where possible, audit |
| Agent, local and reversible                                         | Execute               | Must pass access and stored policy; audit                 |
| Agent, provider and reversible                                      | Propose               | Preview first; execute only with delegated authority      |
| Agent, bulk/destructive/ownership/amount/stage/external side effect | Require approval      | Preview exact scope and changed fields; fail closed       |
| Automation with stored policy                                       | Execute inside policy | No per-run prompt; stop and propose/deny outside policy   |

Named high-risk classes remain approval-gated even when routine provider writes
have delegated authority. A later policy version may add field-specific
delegation without weakening the destructive/bulk boundary. A human `execute`
decision assumes the initiating UI has already collected any required
destructive confirmation; the policy layer does not add a second prompt.

All mutations are idempotent, access-checked, audited, and record the actor,
policy decision, before/after field summary, provider response status, and
remote revision. Provider conflicts never overwrite silently.

`applyMutation` represents one logical record mutation, not one HTTP request.
Adapters may use provider batch endpoints internally. A future bulk action can
add an `applyMutations` adapter method without changing the single-mutation
contract.

## Provider-model validation

| Contract concern              | Native SQL                                      | HubSpot                                       | Salesforce                                                  | Contract consequence                                          |
| ----------------------------- | ----------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------- |
| Object names                  | Canonical CRM and generic custom object names   | Built-ins plus numeric/custom object type ids | Standard and `__c` API names                                | `objectType` is an opaque case-preserving string              |
| Record ids                    | CRM-local opaque id                             | String ids                                    | 15/18-character string ids                                  | Record refs preserve provider and opaque identity             |
| Schema discovery              | CRM-owned canonical schema                      | Properties and CRM schemas APIs               | sObject/Object Info describe                                | Adapter returns object and field capabilities                 |
| Accounts/people/opportunities | Account/person/opportunity                      | Companies/contacts/deals                      | Account/Contact/Opportunity                                 | Canonical kind is separate from provider object type          |
| Relationships                 | CRM-directed edge                               | Directional association type ids and labels   | Reference fields and child relationships                    | Directed edge preserves type, label, and source field         |
| Custom objects                | Generic display/link/write, no object authoring | Schema-discovered                             | `__c` and describe-discovered                               | V1 generic discover/search/display/link/write support         |
| Remote revision               | Local mutation version                          | `updatedAt`                                   | `LastModifiedDate` or `SystemModstamp`                      | Revision is opaque; Native never claims a remote revision     |
| Deletion                      | CRM tombstone/archive policy                    | Archived records                              | Deleted records/query-all semantics                         | Tombstone is first-class and sync-capability gated            |
| Permissions                   | CRM ownership and sharing scope                 | OAuth scopes, object/property sensitivity     | CRUD, FLS, record sharing                                   | Access scope is stored and checked independently of local ACL |
| Conditional write             | Local version check                             | Provider-specific conflict strategy           | `If-Unmodified-Since`/revision-aware update where available | Adapter reports capability and never invents success          |

Reference checks used for this validation:

- [HubSpot CRM objects and associations](https://developers.hubspot.com/docs/api-reference/latest/crm/understanding-the-crm)
- [HubSpot association definitions and labels](https://developers.hubspot.com/docs/api-reference/latest/crm/associations/associations-schema/guide)
- [Salesforce object metadata](https://developer.salesforce.com/docs/platform/graphql/guide/query-objectinfo.html)
- [Salesforce record queries and effective permissions](https://developer.salesforce.com/docs/platform/graphql/guide/query-record-objects.html)
- [Salesforce revision-aware record updates](https://developer.salesforce.com/docs/platform/lwc/guide/reference-update-record.html)

## Initial-scope boundary

This scope is Native SQL plus a HubSpot and Salesforce companion. Native SQL is
the portable, local-authoritative replacement path; it does not depend on or
synchronize to HubSpot or Salesforce. Provider migration, a full
object-authoring engine, and a page builder remain out of scope. Provider writes
stay proposal-first until an adapter can prove the required revision,
access-scope, and approval guarantees — a proposal handed off for completion
upstream is the finished state of that flow, not a degraded one.
