---
record_type: "capability"
spec_version: 2
id: "content.view.personal-state"
name: "Personal View state"
user_promise: "A shared View remembers one private arrangement per person and supports named Only-me Views without copying records."
primary_user_job: "Explore and remember a useful personal arrangement without changing the dependable View everyone else shares."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.view.query", "content.share.views"]
related_features: ["content.feature.make-the-workspace-yours"]
roadmap_boundary: "feature"
acceptance_summary: "Each shared View remembers one unnamed personal arrangement per user, supports any number of named Only-me Views, exposes effective state to agents, and never publishes personal exploration accidentally."
proof_requirements:
  [
    "One automatically persisted personal arrangement per user and shared View",
    "Reset, Save as new View, and permissioned Update shared View behavior",
    "Focused View Instance containing shared, personal, effective, and delta state for UI and agents",
    "Access isolation, link behavior, persistence, multi-device recovery, and no record copying",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Personal View state

## Why this exists

Shared Views need dependable defaults, but people also need to sort, filter, group, resize, and collapse data while they work. Requiring a save decision after every exploration creates meta-work; publishing every experiment creates chaos.

## Example workflow

An editor opens the team's shared Content Calendar, filters to their own recent articles, resizes columns, and groups by status. Content quietly remembers that arrangement and shows **Viewing with personal changes**. The editor can reset, save it as a named **Only me** View, or deliberately update the shared View if they have permission.

## Product contract

- Every shared saved View may remember at most one unnamed personal arrangement for each user.
- The arrangement automatically persists filters, sorting, grouping, column order/size, collapsed sections, and other supported presentation state without a recurring **Save for me** action.
- When personal state differs, the interface quietly shows **Viewing with personal changes**.
- **Reset to shared View** removes the remembered override.
- **Save as new View** creates a stable named View over the same owner input with visibility **Only me** or an allowed shared destination. A person may create many named private Views.
- **Update shared View** deliberately replaces the shared default only with the required Database/Query authority and records an ordinary reversible Revision.
- The focused View Instance contains the shared definition, remembered personal override, effective state, and delta between them.
- Agents receive that effective focused state so they understand what the person sees. They may run arbitrary ephemeral Queries behind the scenes without changing the visible arrangement.
- An agent changes the personal arrangement only when asked to show a result, saves a named View only when asked, and updates the shared default only through the explicit permitted action.
- Ordinary copied View links resolve to the saved View definition, never the sender's unnamed personal arrangement.
- Personal state changes presentation and safe creation seeds only. It never copies records, changes source truth, grants access, or creates a private fork of the Database/Query.

## Permissions and failure behavior

- Personal arrangements and Only-me Views are visible only to their owner and system processes acting within that person's authority.
- Saving a shared destination or updating a shared View requires the normal owner permissions; personal state cannot bypass them.
- Effective results still intersect all View, input, row, field, Source, and viewer access.
- If personal configuration temporarily references an unavailable field, Content preserves it in a degraded state when the absence may be temporary. Intentional field deletion follows the atomic cleanup contract.
- Persistence failure leaves the shared View unchanged and reports that the personal arrangement was not remembered; it must not silently publish the state instead.

## Boundaries and non-goals

- This Capability owns personal presentation state, not Query semantics or Database values.
- It does not make copied links carry hidden sender state.
- It does not restrict a person to one named private View; the one-item limit applies only to the automatic unnamed arrangement per shared View.
- Ephemeral agent exploration is not a saved View and does not mutate UI unless requested.

## Acceptance stories

### Remember without publishing

Given two people open the same shared View, when one changes filters, grouping, and column sizing, then only that person's effective arrangement changes and persists across reload while the other person and shared definition remain unchanged.

### Save several private alternatives

Given one personal arrangement, when its owner chooses **Save as new View** twice with **Only me**, then two stable private Views exist over the same canonical records while the shared View still retains only one unnamed override for that person.

### Keep links predictable

Given a person copies the URL while viewing personal changes, when another authorized viewer opens it, then they receive the saved View definition plus their own personal state, never the sender's override.

### Give agents the real focused surface

Given a focused View with temporary personal filters, when an agent is asked about what is visible, then it receives shared, personal, effective, and delta state and may query further without publishing or changing the arrangement unless asked.

## Current evidence

Existing View controls and application-state patterns are useful substrate, but the complete unnamed persistence model, named Only-me Views, delta indication, scoped save/update actions, multi-device behavior, and agent-effective context are not proven. This Capability remains `approved_shape`.

## Proof plan

1. Persist and reset each supported personal filter, sort, group, layout, sizing, and collapsed-state override across reload and devices.
2. Create several Only-me Views, attempt shared saves with and without authority, and verify one reversible shared Revision.
3. Copy links under personal changes and verify predictable recipient behavior.
4. Inspect application state and agent actions for shared/personal/effective/delta parity and non-mutating exploration.
5. Exercise schema deletion, temporary unavailability, access revocation, persistence failure, Undo, accessibility, and recovery.

## Open questions

Exact cross-device conflict resolution for simultaneous personal arrangements and the retention policy for long-unused unnamed overrides remain open implementation/product details.
