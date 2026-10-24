---
record_type: "capability"
spec_version: 2
id: "content.comment.page-owned"
name: "Comments"
user_promise: "Threaded Comments stay owned by a Page while pointing at precise Blocks, one Property value, or the whole Page."
primary_user_job: "Give exact feedback that remains intelligible after the document changes or appears elsewhere."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.object.page", "content.object.blocks-field"]
related_features: ["content.feature.collaborate-in-context"]
roadmap_boundary: "feature"
acceptance_summary: "Comments preserve authoritative Page context, thread identity, rich body, precise historical Block anchors, access, and resolution across references, embeds, edits, and deletion."
proof_requirements:
  [
    "Page-owned thread and multi-Block anchor identity",
    "Anchor repair and historical target behavior after edits/deletion",
    "Access, mentions, replies, resolution, and notification behavior",
    "Shared Action/UI, embed/reference, concurrency, and recovery tests",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-10-23"
---

# Comments

## Why this exists

Feedback should remain attached to the sentence, image, or Block it concerns, even when the work is embedded in another place. Otherwise discussion becomes a trail of vague ghosts.

## Example workflow

A reviewer comments on two Blocks in a brief, replies with a Page reference, and resolves the thread after revision. Later the brief is embedded elsewhere; the comment still opens under the original Page context and its historical target.

## Product contract

- A Comment thread is owned by one Page and may target one or several Blocks or ranges in its Blocks fields. A thread with no quoted text, no Block, and no Property is a page comment about the whole Page. It is in no Blocks-field tab, so it never counts toward a tab's open comments, and a new thread in a tab must quote text from it or point at one of its videos. Where Discussion groups or filters by tab, page comments sit with the page body, as Property comments do; every thread, page comments included, lives in the Page's Discussion (`content.discussion.page`).
- A thread can point at a whole video instead of text. Each video keeps a stable id in the saved body, so the thread follows it through edits, moves, undo, and reload, and a pasted or duplicated copy gets an id of its own. The thread records the id, not a quote, and shows the video's name in the reader's language. Its margin card sits beside the video and shares a stack with text threads in the same Block; clicking the card scrolls to the video and marks it. Once the video is deleted, the thread says its highlight is unavailable rather than moving to another video. A thread from before videos had ids quoted only the word "Video": it points at the Page's video when the Page has exactly one, and with more, nothing says which, so it keeps reading as quoted text. An agent starts one with `add-comment` and the video's `blockId`, and `list-comments` returns it.
- A thread on a Collection row can instead target one Property value, such as Status or a date. It records the Property's name and the value it had when the thread started. Relations, rollups, and formulas are the exception: what they show depends on who is reading, so the thread records no value and each reader sees their own current one. Once a recorded value changes, the thread shows what it was; once the Property is deleted, the thread says so. It never moves itself onto the newer value. A Property thread has no quoted text, and replies follow the ordinary thread rules.
- A Collection table shows how many open threads each row has, and marks each cell whose Property has an open thread. The row's count opens the row's Discussion. A cell's marker opens a card on the cell with that Property's open threads, where they can be read, replied to, and resolved without leaving the table, and the card can open the row at any of them. Any cell also offers a Comment button to anyone who can comment on the row, which starts a thread on its Property in the same card; on touch screens, where nothing hovers, the button shows on a selected row and starts the thread in the row's peek, or on the row's full page when the Collection opens rows as pages. Counts include only rows the viewer can read, so a row they cannot open adds nothing. One Action reads every open thread in a Collection, with each thread's row and target, so an agent need not read row by row.
- In a Page's comment margin, a Block with two or more open threads folds into one stack. It shows the thread last clicked or rested on, else the one with the newest comment, with its reply count and the other threads' authors. Clicking the stack, or any highlight in the Block, opens it in place on that thread; Collapse or a click elsewhere folds it with that thread in front, and only one stack is open at a time. A new comment on a folded stack opens on top of it without opening it, and once posted it is the stack's front. Each Blocks-field tab keeps its own stacks; Property threads, page comments, the Discussion panel, and the narrow-screen popover never stack.
- Rich Comment bodies use the shared Blocks-field grammar; replies and mentions retain the same Page authority.
- Anchors follow stable Block identity where possible and preserve historical target context after deletion rather than attaching to plausible new text.
- Resolve, reopen, edit, reply, and notification operations use shared Actions and record attributable change.
- Comments submitted through MCP or the in-app agent's Action tools retain the authenticated account as their author and separately persist their submission source. The UI and notifications identify them as posted via AI on that person's behalf; this describes submission, not a claim that AI wrote every word. Replies record their own source, edits preserve the original submission attribution, and historical comments without provenance remain unclassified.
- A structured `@AI` or connected-model mention in the Comment composer explicitly invokes AI. The inline model tile shows the selected provider and model and is where the model is changed; a Comment addresses at most one model, while people can be mentioned freely. Send offers Auto, Reply in thread, Suggest changes, or Apply changes and resolve. Auto resolves one of those three bounded intents before execution; Suggest changes uses the existing suggested-edits availability and access rules.
- A sent Comment keeps who each `@Name` means: the person's email or the agent's model, stored beside the readable text. Each one renders as the chip the composer showed, with an avatar for a person and a provider logo for an agent. Comments from before mentions carried identity, and `@` text with no stored identity, stay plain text.
- One identity card opens from a mention, an author's avatar, or an author's name. A person shows their name, email, and workspace role. An AI author shows its model, thinking effort, and when it ran, and the requester can open the agent conversation that wrote it. Effort, time, or a conversation that was never recorded shows as not recorded rather than guessed.
- Every AI request binds the authenticated requester, Page body, original root Comment and thread, submitted conversation, revision, exact agent thread and initial turn. A scoped run can use only that intent's dedicated operation; targeting and write authority do not come from chat history or model-written arguments.
- Each explicit AI Send keeps its source Comment, submitted mode, resolved intent, operation, agent thread, provider/model identity, and reasoning attempts distinct. Unrelated Page edits trigger a bounded contextual refresh or exact-target reanchor; changed feedback, ambiguous targets, and partial saves remain typed, recoverable states on the original thread.
- Comment AI runs stay out of the active chat until a person explicitly opens them. Progress and the resulting response appear on the source Comment; an AI-addressed follow-up continues that exact agent thread, while a newly requested mutation starts a separately scoped operation. Open AI conversation reveals the exact authorized session with a Comment-specific prefill.
- Reply adds an AI-attributed answer to the original thread without editing or resolving. Suggest creates a native proposal linked in both directions and reviewed as a card inside the source thread. Accepting or rejecting it decides only the proposal: the thread stays open until someone resolves it, and acceptance moves the thread's quote onto the accepted text. An AI-addressed follow-up asking for a different change posts the reply to that thread first, then adds a revised proposal there that supersedes the requester's earlier pending one from the same thread. Apply-and-resolve verifies the saved edit and unchanged source conversation before resolving; conflicts and partial success remain available for review. The resolved thread shows a bounded before/after of what changed and stays in view until the person dismisses it. Its requester can undo the change, which reverses the exact saved edits and reopens the thread, only while the changed text is still as AI left it.
- Retrying one request recovers its retained operation and result. It does not silently replace its intent, duplicate a reply or proposal, or reapply a saved edit. Unknown historical authorship is not retrospectively labeled AI.
- References and embeds display the authoritative Page-owned thread; they do not clone or re-home it.
- A person or agent with comment access can react to a Comment or reply with one emoji at a time through the shared reaction Action. Each person reacts with a given emoji at most once, reactions inherit the Comment's access, and deleting the Comment removes them. Suggested-edit discussions present reactions the same way while keeping their own storage.

## Boundaries and non-goals

- Filtering, sorting, and the page-comment composer belong to the Discussion (`content.discussion.page`); this record covers the threads themselves.
- A comment does not create a Page, Collection membership, or independent share policy.
- This capability does not define named Version access, although Comments retain Version context.

## Acceptance stories

### React without replying

Given an open Comment, when a commenter adds 👍 twice and 🎉 once, the thread shows one 👍 and one 🎉 marked as theirs; removing 👍 leaves only 🎉, a person without comment access cannot react, and deleting the Comment removes its reactions.

### Know who a mention means

Given a Comment that mentions a teammate and Claude, when it is sent, both names render as chips with the teammate's avatar and Claude's logo, and hovering or focusing either one shows who it is. An older Comment whose `@Sam` was saved as text still reads `@Sam`. Hovering the AI reply's author shows its model, effort, and time, and its requester can open the conversation that wrote it.

### Comment on one Property value

Given a Collection row whose Status is Blocked, when a commenter starts a thread on Status from the row's peek, the thread reads "Status · Blocked" with no "Highlight unavailable" warning, and the Status cell in the table shows a marker that opens that thread. When Status later changes to Done, the thread reads "was Blocked"; when the Property is deleted, it reads "Status (removed)". A thread started on a Property that is not on the Page, or on a Property and quoted text at once, is rejected.

### Read a busy paragraph

Given a paragraph with five open threads and another with one, the margin shows one stack beside the first paragraph, with the newest thread in front and "+4 more", and the single thread's card unchanged beside its own paragraph. Resting the pointer on another highlight in the first paragraph brings its thread to the front. Clicking it opens the stack on that thread with a Collapse row above; Collapse folds it again with that thread still in front. Commenting on new text in that paragraph opens the composer on top of the folded stack, and the posted comment becomes its front.

### Comment on a video

Given a Page with a paragraph and a video, when a commenter clicks Comment on the video and posts, the margin card reads "Video" beside it with no "Highlight unavailable", and clicking the card scrolls to the video and outlines it. After a reload, or after the video moves below the paragraph, the card is still beside it. A copy of the video pasted below carries no thread. A comment on text in the same Block folds into one stack with it. An agent that reads the Page gets the video's id and can start the same kind of thread with `add-comment`.

### Comment on a cell from the table

Given a Collection table and a commenter who cannot edit its rows, when they hover a row's Due cell, a Comment button appears. Posting from the card it opens starts a thread that reads "Due · Nov 2, 2026" without opening the row, and the cell then shows a marker and the row's count goes up. Clicking the marker reopens the card on that thread, where it can be answered, and Open row opens the row's peek on it. When an editor resolves the thread from the same card, the marker and the count clear, and an editor who clicks the cell itself still edits its value.

### See open Comments from a Collection

Given a Collection where one row has two open threads and a private row has one, a viewer who can read every row but the private one sees "2" beside the first row's name and no count on the private row. Clicking the count opens that row's peek with its Discussion showing. Resolving the last open thread clears the count. An agent listing the Collection's Comments in one call gets the same threads, each naming its row and target, and nothing from the private row.

### Preserve a deleted anchor

Given a Comment on a Block range, when the range and Block are deleted, then the Comment remains resolvable and opens authorized historical context instead of moving to a new nearby range.

### Keep one authoritative thread across an embed

Given a Page with a Comment thread is referenced or embedded elsewhere, when a viewer opens the thread from either occurrence, then they see the same Page-owned thread and access decision.

### Keep concurrent AI work attached to its source

Given AI is mentioned in two Comments while the Page is also edited, when both operations reason and commit, then each uses a distinct operation and agent thread, preserves its submitted mode and resolved intent, tolerates unrelated changes, and leaves any true source or target conflict open with a typed recovery state.

### Choose how AI handles feedback

Given an open Page-body Comment and an unfinished human reply, inserting or removing the AI mention tile preserves the draft and dispatches nothing. AI Send with Reply adds one AI answer to that same thread. Suggest creates a reviewable proposal without changing accepted text. Only Apply changes and resolve may change accepted text and resolve, and only after both the saved revision and original feedback have been checked. Auto must first persist a finite resolved intent and then obey the same boundaries.

### Review an applied AI change

Given AI applied and resolved a Comment while the Page is open, the thread stays beside the changed text with what it replaced, Undo, and Done until the person moves on or dismisses it. Undo restores the original text and reopens the thread; if the changed text was edited since, Undo changes nothing and says why.

### Recover partial AI work

Given an edit was saved but its receipt or resolution failed, reopening the Page exposes that partial result. Retrying the same request reuses the saved edit receipt and attempts only unfinished work. If the Page or feedback changed in the meantime, the thread stays open for review.

## Current evidence

`document_comments` schema and editor Comment UI/actions provide anchored threaded-comment substrate. Stable multi-Block anchors, rich universal fields, historical repair, and embed authority are not fully proven; this remains `approved_shape`.

The anchored editor workflow includes document-session drafts, author text editing,
readable resolved conversations, and optimistic comment mutations with scoped
refreshes. Behavioral coverage lives in `CommentsSidebar.interaction.test.tsx`,
`comment-drafts.test.tsx`, `DocumentEditor.layout.test.ts`,
`use-comments.mutations.test.ts`, and `update-comment.test.ts`. These cover draft
retention, responsive sizing, failed and overlapping mutations, and existing
commenter/editor access. They do not establish the broader multi-Block,
historical-deletion, notification, or embed contracts above.

The action/runtime substrate now persists isolated Comment AI operations and
attempt-specific Page and discussion bases. Database-backed concurrency coverage
proves distinct operations across Comments, one active operation per source
Comment across simultaneous starts, bounded reply refresh, disjoint apply commits,
typed overlapping-target and discussion conflicts, idempotent receipts, lifecycle
status reconciliation, and agent model attribution. The editor now starts these
sessions without changing the active chat, keeps per-Comment progress and recovery
state, renders attributed replies on the source thread, and allows an explicit
same-thread continuation or handoff. Live local acceptance proved distinct hidden
threads, concurrent loading, unchanged navigation, fresh retry identity, and
recoverable failure UI; a successful model/tool completion and inline continuation
remain required integration proof.

A Comment AI proposal now renders in its source thread in place of the receipt reply, with Accept and Reject, and leaves the margin. `thread-suggestions.test.ts` covers thread grouping and receipt matching; `comment-reanchor.test.ts` covers moving the quote onto accepted text and declining to invent one across Markdown syntax. A live local run proved the full loop with a real model: comment, proposal in thread, an "actually, make it X" reply, a revised proposal superseding the first, acceptance with the thread still open and its highlight intact, then a separate resolve.

A thread can target one Property value. `content-database-comments.db.test.ts` proves the recorded name and value survive a value change, a relation's linked rows are never recorded for other readers, invalid targets are rejected, per-row and per-Property open counts follow row access and resolution, and the Collection-wide Comment read returns only readable rows. `comment-property-target.test.ts` covers how each Property type reads as text. Rich-text Property values do not yet offer a Property target; they keep body-style quoted Comments.

A Block with several open threads stacks in the margin. `comment-stacks.test.ts` covers how threads group by Block and which one fronts a stack; `CommentsSidebar.stacks.test.tsx` covers folding, hover, opening from the card or a highlight, Collapse and focus, one open stack, and new comments on folded and open stacks; `CommentsSidebar.stack-tabs.test.tsx` covers Blocks-field tabs and Property threads. A recorded local run walked the "Read a busy paragraph" story with fake data.

A thread can point at a whole video. `VideoBlockIds.test.ts` covers ids on insert, on a video saved without one, through a resize or move, on a copy pasted above or below, through undo and redo (a shared page's too), and none written by a suggesting tab or for another tab's change; `nfm.spec.ts` covers the id surviving a save. `CommentHighlight.spec.ts` and `VisualEditor.comment-highlights.test.tsx` cover the mark following the video and the one-video rule for older threads; `CommentsSidebar.stacks.test.tsx` covers the card's place, its label, and stacking with text threads; `comment-block-target.db.test.ts` covers `add-comment` and `list-comments`. A Notion page has no place for the id, so a push or pull gives each video back the id it went by, matched by its source, caption, and the text beside it, and gives a new id to a video it can't match rather than another video's (`comment-block-anchor.spec.ts`, `notion-sync.spec.ts`), and Ask AI on the thread is told which video it is on (`comment-ai-flow.test.ts`). Images and audio still quote their name as text.

## Proof plan

1. Create, reply, mention, resolve, reopen, edit, and delete Comments through UI and Actions.
2. Test anchors through Block editing, move, split, deletion, restore, and named-Version context.
3. Verify references, embeds, access changes, notifications, agents, and exports.
4. Exercise concurrent replies/resolution, reload, keyboard, and assistive technology.

## Open questions

Anchor matching heuristics may evolve, but they may never silently claim a new target is the old one.
