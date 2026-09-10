---
record_type: "capability"
spec_version: 2
id: "content.portability.roundtrip"
name: "Faithful round-tripping"
user_promise: "Content preserves provider-owned meaning it cannot safely render or edit, so a supported change never silently destroys the rest of the work."
primary_user_job: "Edit what Content understands while keeping connected and portable work recoverable and intelligible outside one application."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.portability.source-representation"]
related_features:
  [
    "content.feature.trust-your-connected-sources",
    "content.feature.cite-what-you-found",
    "content.feature.take-the-whole-vault-with-you",
    "content.feature.move-without-starting-over",
  ]
roadmap_boundary: "feature"
acceptance_summary: "Authorized imports, edits, exports, and provider write-back preserve stable identity, known semantics, provenance, and unknown provider structures through explicit raw or typed fallback representations, while reporting unsupported or unresolved material instead of silently flattening it."
proof_requirements:
  [
    "Golden import-edit-export and provider write-back fixtures covering known, unknown, mixed, and malformed representations",
    "Stable identity, provenance, block/comment/reference/custom structure, and source mapping preservation or explicit unresolved reporting",
    "Conflict, access, recovery, and lossless archive verification across at least two independently certified adapter formats",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Faithful round-tripping

## Why this exists

People bring work with structure Content may not yet understand: provider
components, bindings, embeds, custom blocks, references, comments, and other
format-specific detail. A friendly editable view is not permission to discard
what it cannot represent. Lossy simplicity has excellent manners right up to
the moment it loses a component.

## Example workflow

An editor opens a provider article containing ordinary text and an unsupported
component. Content renders and edits the text through its native grammar while
retaining the unsupported component as a preserved source-backed representation.
After the editor changes the text and completes the Source's allowed write-back
flow, the provider receives the changed text and the unknown component remains
unchanged. A later export includes the information needed to preserve both the
known Content semantics and unresolved provider material.

## Product contract

### Preserve what is known and what is not

- A source representation maps known semantics into typed Content structures
  only when that mapping is safe. It retains stable source identity,
  provenance, ordering, and enough fidelity information to reconstruct the
  provider-facing representation.
- Unknown, unsupported, or not-yet-safe provider material survives as an
  explicit raw or typed fallback with source identity and an inspectable status.
  It is not flattened into ordinary text, silently dropped, or presented as a
  fully editable native Block.
- Known native-like semantics may render through ordinary Content Blocks while
  retaining their source binding. Provider-specific reusable or custom
  components remain source-backed until explicitly forked with provenance.
- Expressions, references, custom blocks, comments, block identities, and
  other typed Content structures need exact encodings or an explicit unresolved
  representation; a best-effort export may not claim lossless completion.

### Round trips retain authority and recoverability

- Import, refresh, edit, export, and provider write-back retain the source
  mapping, baseline, ownership, and policy needed to route later work safely.
- A compatible Content edit changes only the mapped authorized portion. It
  preserves unknown siblings and provider-owned fields outside that mapping.
- Access applies before import preview, export, provider write-back, raw
  fallback inspection, and recovery. Export includes only material the acting
  user may access and reports unavailable or excluded dependencies.
- A failed conversion, stale base, malformed input, or missing payload produces
  an explicit failure or unresolved state. It never returns an empty or clean
  representation that callers can mistake for a completed round trip.

### Provider and portable forms remain distinct

- The portable source representation owns provider-neutral interchange;
  adapters and codecs own provider-specific mapping details. A provider codec
  is not the universal Content authoring grammar.
- A lossless archive may carry structured sidecars and stable asset handles in
  addition to humane Markdown/MDX. Raw payloads and assets use appropriate file
  or blob storage, not shared SQL fields.
- Detaching or converting source-backed content into Content-managed work is an
  explicit fork with provenance and policy consequences, never an accidental
  outcome of opening or editing it.

## Boundaries and non-goals

- Sync policy decides whether and when outbound work may cross a Source
  boundary; adapters certify a provider's codec and operations. This record
  defines the fidelity obligation shared by those paths.
- Faithful preservation does not promise a native editor for every provider
  feature, universal raw-source editing, or byte-identical output where the
  provider itself normalizes content.
- Publication and other provider lifecycle changes are separate guarded actions.

## Acceptance stories

### Preserve an unknown sibling during a supported edit

Given a provider representation with one editable text region and one unknown
component, when an authorized editor changes the text and completes permitted
write-back, then the provider receives the text change while the unknown
component, ordering, and source identity remain intact.

### Report an incomplete conversion honestly

Given an import whose typed extension cannot be encoded by the target format,
when a person exports it, then Content either emits the declared lossless
sidecar/fallback or reports that representation as unresolved; it does not
produce a clean-looking export that silently omits the extension.

### Recover identity through a mixed-format round trip

Given a Source with mapped Blocks, references, comments, and preserved raw
provider material, when an authorized lossless archive is exported and restored,
then stable identities, provenance, supported semantics, fallback material, and
source mappings remain coherent or each unresolved dependency is reported.

## Current evidence

Content exports editable text formats and existing source machinery includes
raw sidecars, hashes, and guarded provider paths. Those prove useful pieces,
not a generic lossless contract across representations, access, recovery, and
independently certified adapters. This Capability remains `approved_shape`.

## Proof plan

1. Build golden fixtures for known, unknown, mixed, reordered, malformed, and
   partially unavailable representations across at least two adapter formats.
2. Run import, refresh, native edit, review/write-back, export, restore, and
   re-import; compare stable identity, provenance, mapped semantics, fallback
   payloads, source mappings, and explicit unresolved reports.
3. Exercise stale bases, provider normalization, interrupted conversion,
   conflicts, retries, access denial, redaction, and missing assets or handles.
4. Verify fallback status and recovery paths in the real interface and shared
   Actions, including accessible inspection of unsupported material.

## Open questions

- The canonical sidecar envelope and the exact portable encoding for every
  typed Content structure remain implementation work.
- Fidelity equivalence must define when provider normalization is acceptable
  without weakening the obligation to preserve unknown meaning.
