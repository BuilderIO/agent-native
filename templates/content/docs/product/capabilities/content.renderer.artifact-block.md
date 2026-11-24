---
record_type: "capability"
spec_version: 2
id: "content.renderer.artifact-block"
name: "Artifact Blocks"
user_promise: "Make a one-off interactive or visual artifact on one page, then promote it only if reuse becomes real."
primary_user_job: "Build a safe page-local artifact before deliberate promotion."
kind: "surface"
state: "in_progress"
publicness: "public"
availability: "universal"
dependencies: ["content.renderer.custom-block"]
related_features: ["content.feature.build-new-surfaces"]
roadmap_boundary: "feature"
acceptance_summary: "An Artifact Block is page-owned HTML/CSS/JS kept as an `html interactive` code block. It runs in a sealed frame, sizes itself, opens full screen from its own link, shows its source, and becomes a captioned link where it cannot run. Optional typed props and explicit Save as Custom Block promotion follow."
proof_requirements:
  [
    "Artifact Blocks have no catalog identity until a user explicitly saves one as a Custom Block.",
    "The sandbox never shares the app's origin, receives only bound typed props, and has no ambient Content data, actions, cookies, filesystem, parent DOM, or secrets. Its only network is one script library host and the image and media hosts the deployment allows.",
    "A block runs on its own only on a page its reader owns. On any other page, public ones included, it waits for Run.",
    "Exports, Notion, Builder, and files carry the block's caption as a link to it; promotion preserves provenance rather than silently changing reuse scope.",
  ]
evidence:
  - "../../../app/components/editor/interactive-html/sealed-frame.spec.ts"
  - "../../../app/components/editor/interactive-html-block.spec.ts"
  - "../../../app/components/editor/StaticDocumentBody.test.tsx"
  - "../../../app/components/editor/block-links.test.tsx"
  - "../../../app/__tests__/public-document-route.test.ts"
  - "../../../shared/interactive-html.spec.ts"
  - "../../../shared/interactive-html-fallback.spec.ts"
  - "../../../actions/_document-edit-mutation.db.test.ts"
  - "../../../actions/suggest-document-edit.db.test.ts"
  - "../../../actions/blocks-field-suggestions.db.test.ts"
  - "../../../actions/get-document.agent-read.db.test.ts"
  - "../../../actions/export-document.db.test.ts"
  - "../../../actions/builder-refresh-local-edits.db.test.ts"
  - "../../../server/lib/public-reader.db.test.ts"
  - "../../../server/lib/private-media-references.db.test.ts"
superseded_by: null
last_reviewed: "2026-11-24"
---

# Artifact Blocks

## Why this exists

Many useful artifacts begin as one-page experiments, before anyone can justify governing them for reuse. That early experiment still needs a sandbox strong enough that a decorative widget cannot acquire host authority.

## Example workflow

Tess asks an agent for a scoring widget on a planning Page, plays with it there, sends a coworker its own link, and checks that the exported Page links to it. Later Tess chooses Save as Custom Block; the original remains local.

## Product contract

- Artifact Blocks have no catalog identity until a user explicitly saves one as a Custom Block.
- An Artifact Block is a code block whose language is `html interactive`. Its source is ordinary page text, so agents and people read it, edit part of it, suggest changes to it, and find its earlier versions in page history as they do for any code. Its `<title>` is its caption. A plain `html` code block stays code, and the static HTML block stays static.
- The block runs in a sandboxed frame that is never granted `allow-same-origin`, inside a second frame whose policy forbids loading any other page. It has no Content data, actions, cookies, storage, filesystem, parent DOM, secrets, popups, or nested frames. Links inside it go nowhere but its own fragments.
- Scripts, stylesheets, and fonts load only from `cdn.jsdelivr.net`. Images and media load only from hosts the deployment allows and `data:` addresses. Images kept in Content are written into the block's HTML before it runs, up to 40 of them and about 30 MB together; the rest don't load. Every other request is refused.
- The block tells its host only how tall it is and that Escape was pressed. Its frame grows to 1,000px and scrolls past that. A block whose content grows when its frame shrinks settles at the taller height. Full screen covers the window without reloading the block; Escape or its Close button leaves it, and a block may ask the browser for real full screen.
- A block runs when its page opens only for the page's owner. Everyone else, readers of a public page included, sees its caption and a Run button.
- A block in the page's body has its own link, which opens it full screen for anyone who can open the page, public readers included. Its source opens beside it and copies.
- An agent's write or suggestion that adds or changes a block that could not work is refused, with what to change; blocks already on the page never stop an edit elsewhere. Agent reads list each block with its title, ID, and link, and an agent in the app is told which block is selected.
- Where a block cannot run it becomes its caption linked to it: in HTML and PDF exports, agent files, Builder, and a public page before its editor loads. The link names the block, so a body pulled back from Builder has each block's source wherever its link stands, and a block whose link was deleted is gone. Notion gets the block's code, whose first line is a comment saying where it runs, with the link below; code that keeps that comment comes back as the block, with what was edited in it. Markdown keeps the source. An export never runs it.
- Promotion preserves provenance rather than silently changing reuse scope.

## Boundaries and non-goals

- `content.renderer.custom-block` owns reusable catalog definitions; Artifact Blocks own a page/block-local instance and explicit promotion.
- Artifacts are not Extensions, do not receive ambient host grants, and do not enter a catalog merely because they ran.
- This slice leaves out typed props, promotion, comments on a block, sending a message to an agent from a block, remembered state, and anything that runs on a server. No host helpers reach the frame.
- A block in one of a page's other Blocks fields runs, opens full screen, and shows its source, but has no link of its own, as no block there has one yet.
- Suggestions from an agent that sends each piece of one change as its own suggestion are checked piece by piece; `suggest-document-edit` and comment replies check the whole change.
- Browsers have no policy that turns off WebRTC or `preconnect`. The frame removes the WebRTC constructors and any page nested in the block before it loads, as a best effort; neither carries Content data the block was not already given.

## Acceptance stories

### Keep it page-owned

Given the artifact is copied, when the original changes, then the copy is not silently shared.

### Deny ambient authority

Given artifact code requests cookies, Content actions, parent DOM, or network beyond the allowed hosts, or tries to replace itself with another page, then the sandbox rejects it.

### Wait for a reader who didn't write it

Given a Page someone shared, when a reader opens it, then each block shows its caption and runs only after Run.

### Say where it went

Given a Page with a block, when it is exported, synced, or published somewhere the block cannot run, then the block's caption links to it and pulling the Page back restores the block.

## Current evidence

`app/components/editor/interactive-html/sealed-frame.ts` builds the double frame and its policy, and `sealed-frame.spec.ts` holds its grants. `extensions/InteractiveHtmlBlockView.tsx` draws the block; `interactive-html-block.spec.ts` covers running, Run, sizing, source, full screen, and selection. `StaticDocumentBody.test.tsx` covers the stored-body stand-in and `block-links.test.tsx` the block's own link. `shared/interactive-html.ts` decides what an agent's block may load, and `server/lib/interactive-html-blocks.ts` refuses what would not work. `shared/interactive-html-fallback.ts` writes and reads the stand-ins, with `actions/_interactive-html-blocks.ts` naming each block in its link; their tests cover exports, Notion, Builder, and public pages. No test reaches Notion's or Builder's own service. A probe in Chromium, Firefox, and WebKit found no request leaving the double frame, where a single frame leaked through its own navigation.

## Proof plan

1. Create artifacts with no catalog record, then typed-prop ones.
2. Deny SQL/actions/cookies/secrets/DOM/filesystem and every host but the allowed ones, in each browser engine.
3. Verify copy and static export never execute for readers.
4. Promote and inspect distinct catalog provenance.

## Open questions

Typed props and promotion wait for `content.renderer.custom-block`. Whether a block may remember state or send an agent a message is undecided.
