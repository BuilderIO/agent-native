---
name: full-app-build
description: >-
  Build and iterate on a full real app from Design, backed by a running
  Builder Fusion cloud container instead of an inline HTML prototype. Use
  when the user wants a real/full app end-to-end through publishing, and
  only when FULL_APP_BUILDING_ENABLED is true.
metadata:
  visibility: exported
---

# Full App Building

Full app building turns a Design project into a real, running app instead of
an inline Alpine/HTML prototype. The source of truth is a live dev server
inside a Builder Fusion cloud container — one Builder project branch per
design. Screens are URL-backed iframes of that container's dev server, the
same model as `/visual-edit` localhost screens (`sourceType: "fusion"`), but
the container runs remotely instead of on the user's machine.

## Flag Gate

This feature is gated by the code boolean `FULL_APP_BUILDING_ENABLED` in
`templates/design/shared/full-app.ts`, currently `false`. Check it (or trust
that the fusion actions are unavailable/erroring) before proposing this flow.
If the flag is off, tell the user full app building isn't enabled yet instead
of attempting the actions.

Even when the flag is on, the fusion actions require Builder credentials and
a configured branch project ID. When those aren't set up, actions return a
`not-configured` CTA instead of throwing — see **Not Configured** below.

## When To Use

Reach for full app building only when the user wants a real, working app —
not a prototype — and wants to go end-to-end through publishing: real
routing, real backend behavior, a deployable URL. For UI exploration, visual
review, and iteration on look/feel, stay in the normal inline design flow
(`design-generation`) or `/visual-edit` for connecting an existing local app.
Do not switch a normal design into fusion mode unless the user explicitly
asks for a full/real app.

## Lifecycle

1. **Create the design shell** the normal way (`create-design`), or continue
   from an existing design.
2. **`create-fusion-app`** `{designId, prompt, branchName?}` creates the app
   branch via the Builder cloud agent. Returns
   `{status: "building", projectId, branchName, editorUrl}` once started, or
   the not-configured CTA. One branch per design — calling it again on an
   already-linked design returns the existing linkage instead of creating a
   second branch.
3. **Poll `sync-fusion-app`** `{designId, paths?}` while the container boots.
   It attaches to the container and reports `status: building|ready|error`.
   Tell the user the app is building and keep polling — don't block on a
   single call. Once `ready`, it updates `previewUrl` and upserts URL-backed
   screens (default path `"/"` when `paths` is omitted).
4. **Screens appear as URL-backed artboards** in the overview canvas, same
   as localhost screens: iframe of `previewUrl` + route, not copied HTML.
5. **Iterate** using the editing rules below, then push and publish when
   ready.

## Editing Rules — the critical distinction

Fusion screens are NOT inline HTML files. **Never** edit a fusion screen's
markup directly and never use `generate-design`, `edit-design`, or
`apply-visual-edit` on it — those tools rewrite inline `design_files` rows,
which fusion screens don't have. Writing to the wrong layer silently does
nothing to the running app.

Instead:

- **`queue-fusion-edit`** `{designId, instruction, screenFileId?, target?}` —
  queue one edit intent. Use `target` (`selector`, `path`, `url`, `nodeName`)
  to point at the specific element/screen the user means, the same way you'd
  describe a selection for `apply-visual-edit`. Queuing does not touch the
  running app yet — it only records intent in `design_fusion_edits`.
- **`list-fusion-edits`** `{designId, status?}` — inspect the queue before
  dispatching, e.g. to confirm what's pending or to show the user a summary.
- **`apply-fusion-edits`** `{designId, editIds?}` — batches all pending edits
  (or the given `editIds`) into one prompt and dispatches it to the app's
  in-container coding agent. This is fire-and-forget: it marks the edits
  "sent" and returns immediately, it does not wait for the app agent to
  finish.
- **`send-fusion-message`** `{designId, prompt}` — for larger freeform
  requests that don't fit the "queue small edits, batch them" model (new
  features, structural changes, "wire up the backend for X"), relay a
  message straight to the app's coding agent instead of queuing edits.

After dispatching (`apply-fusion-edits` or `send-fusion-message`), tell the
user the change was sent to the app's agent and is being applied
asynchronously — it is not applied synchronously like an inline `edit-design`
call. Screens reflect the change once the in-container agent finishes and the
dev server updates; call `sync-fusion-app` again or have the user reload the
screen to see it land.

## Adding More Routes As Screens

Once `previewUrl` is known (after `sync-fusion-app` reports `ready`), use
**`add-fusion-screens`** `{designId, paths, width?, height?}` to place
additional routes as screens on the overview canvas — the fusion equivalent
of `add-localhost-screens`.

## Push And Publish Flow

1. **`push-fusion-app`** `{designId}` — pushes the branch's code to its git
   remote. Do this before or as part of publishing so the code is durably
   saved, not just running in the container.
2. **`deploy-fusion-app`** `{designId, slug?}` — reserves
   `<slug>.builder.cloud` (derived from the design title when `slug` is
   omitted) and triggers a deploy.
3. **`get-fusion-deploy-status`** `{designId}` — poll until the deploy status
   is `live`, `failed`, or `canceled`. Report the live `deployedUrl` once it
   resolves; report the failure reason if it doesn't.

## Not Configured

When Builder credentials or the branch project ID aren't set up, the fusion
actions return a `not-configured` status with a `cta` object instead of
throwing — mirror the guidance `migrate-inline-design-to-app` already gives:
surface the CTA's `label`/`description` and point the user at
`connect-builder-app` or the given `connectUrl` to connect Builder, then
retry the same fusion action. Don't silently fall back to an inline design in
this case — tell the user full app building needs Builder connected first.

## Timing Expectations

Set expectations up front so polling doesn't read as broken:

- Creating the app branch and booting the container can take a few minutes —
  this is a real cloud container starting a real dev server, not an inline
  HTML render. Keep polling `sync-fusion-app` and give the user a short
  status update rather than going silent.
- Edits are asynchronous. `apply-fusion-edits` and `send-fusion-message`
  return as soon as the prompt is dispatched, not when the app agent finishes
  making the change. Don't promise the screen updated instantly — remind the
  user the app's agent is working on it and the screen will reflect the
  change once it's done and the dev server picks it up.
- Deploys also take real time; poll `get-fusion-deploy-status` rather than
  assuming `deploy-fusion-app` finished the deploy synchronously.
