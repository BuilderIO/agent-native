---
record_type: "capability"
spec_version: 2
id: "content.embed.surface"
name: "Embedded Content surface"
user_promise: "The same Page, View, or focused Content experience can appear in another app without splitting identity, history, or permissions."
primary_user_job: "Work on a canonical Content object in the application where my work is happening."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "configured"
dependencies: ["content.agent.action-parity", "content.access.page-database"]
related_features:
  [
    "content.feature.work-on-content-inside-another-application",
    "content.feature.build-living-dashboards",
  ]
roadmap_boundary: "feature"
acceptance_summary: "A stable mount contract renders a selected canonical Content surface responsively and routes its allowed interactions through shared Actions, current access, history, and application state without cloning the object."
proof_requirements:
  [
    "Mount identity, lifecycle, responsive rendering, and application-state tests",
    "Shared Action, access, history, and concurrent-update parity tests",
    "Host workflow covering read, edit, navigation, unsupported mode, and unmount/remount",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Embedded Content surface

## Why this exists

Work often happens beside Content; moving the window should not create another truth.

## Example workflow

A planning app mounts a project Database View. A person filters it and opens a Page; the same object, access checks, and history are visible when they later return to Content.

## Product contract

- A mount identifies one Page, View, or focused surface and uses stable Content identity, not serialized copies.
- Rendering, navigation, application state, accessibility, and responsive layout have explicit mount boundaries.
- Reads and mutations use shared Actions and current viewer access; concurrent changes remain observable through the ordinary sync model.
- Unsupported surface modes say so explicitly instead of becoming a half-functional clone.

## Boundaries and non-goals

Host grants own host authority; this record owns the reusable UI and lifecycle. It is not an iframe-only requirement or a new Content shell for every host.

## Acceptance stories

### Continue the same edit

Given a Page mounted in a host, when an editor changes it through the mount, then Content records the ordinary change and the canonical editor shows it after synchronization.

### Preserve mount limits

Given a host requests a surface mode that is not supported by the mount contract, when it renders, then it receives an explicit unavailable state rather than a copied fallback editor.

## Current evidence

Donor evidence: Content components, Actions, and application-state patterns already support reuse. No stable mount lifecycle, cross-host state, or full responsive proof exists; this record remains `approved_shape`.

## Proof plan

1. Define mount inputs, lifecycle, state ownership, and supported surfaces.
2. Test parity under changing access and concurrent canonical edits.
3. Run host read/edit/navigation/remount workflows at responsive sizes.

## Open questions

- The first transport and host component packaging remain open.
