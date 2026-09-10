---
title: "Content Suggested Edits parity shape"
date: 2026-09-02
status: shape-complete
authoritySchemaVersion: 3
ledgerRevision: content-suggested-edits-shape-r5
governingArtifactRevision: content-suggested-edits-shape-r5
---

# Content Suggested Edits parity

## September 10 landing decision

Alice tested the integrated editor, accepted the current behavior, and explicitly authorized landing and merging this PR. She separately accepted the known saved code-block preview/anchor failure for this release and confirmed that its follow-up is already triaged in the vault. Do not reopen that repair as part of landing. This supersedes the September 9 no-merge instruction and H8's code-block merge gate, not the recorded failure or the broader product contract.

Main through `c22cc69cfc` is integrated in `8dc7bf67ba`, preserving the approved review layout, comment drafts, suggestion isolation, and incoming history/recovery behavior. Content typecheck/build, core build, 251 focused editor tests, 119 markdown tests, and all 71 guards passed. Independent bounded integration review found no actionable semantic findings. Focused native smoke confirmed the document/comment layout, saved-version browsing, and disabled restore while suggesting; no document text or review decisions were changed. Alice then tested this local result and approved it.

This is acceptance of the current document-markdown increment for merge, not full generic typed Revision or production acceptance. Actual-agent, representative source/local-file, deployed-role, motion, and screen-reader gaps remain explicitly unverified. The earlier local fixture-cleanup discrepancy remains recorded below. Merge, CI, and deployment results must be read back separately; no deployment is claimed by this decision.

## Current acceptance revision — September 8, r5

This is the cumulative governing story, not a replacement checklist for the latest fix. Alice requested full same-task human QA, incorporation of every earlier repair into this original Shape, and continued repair/retest until the real story passes. The dated r3/r4 diagnosis and envelopes below are historical records, not current pause instructions or permission to ship. Current work is local implementation and verification on the existing branch; no push, merge, or deployment is implied.

The behavior being protected is straightforward: propose exact changes while the original stays intact, continue and discuss those proposals without losing work, then accept or reject each one with a trustworthy result. Ordinary editing and comments must keep working throughout.

### Authorized corrections to earlier decisions

- **No feature flag.** Alice explicitly removed the flag on September 5. All earlier default-off, flag-off, or dogfood-behind-flag wording is superseded. Availability follows document eligibility and permissions, not a feature toggle. Legacy regression checks apply outside Suggesting rather than with a flag disabled.
- **Same-task human QA.** Alice explicitly requested this on September 8. Executor relationship is implementer; independence is not required and custody is same-context-allowed. Independent technical review remains a separate requirement, not independent human evidence.
- **Replacement summary order.** The final September 8 preference is blue `with` first while collapsed; expanding discloses gray `Replace` below. Earlier gray-original-first comparison scripts are superseded only on this order. Exact original/proposed material and complete line coloring remain required.
- **Current environment.** Local verification targets the merged PGlite-backed checkout, initially `93f2a38e8a`. Previous SQLite/browser results are historical, not current acceptance. The old playground remains preserved and is not a fixture to modify or migrate implicitly. Local QA does not fulfill the original deployed-beta, role-separated, or accountable-agent evidence requirements by analogy.

### Stable original assertions

These IDs preserve the original ten acceptance assertions below; A10 incorporates the explicitly authorized flag removal.

| ID  | Required result                                                                                                                                                                      | Proof boundary                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| A01 | A commenter creates Add, Delete, Replace, supported new-text-block and all supported inline-mark proposals; exit/reload preserves proposals without canonical mutation.              | Real editor, second client, canonical read-back.                                          |
| A02 | Authorized editor inspects exact material/actor/time and discussion, accepts one operation and rejects another; only accepted material enters canonical Content.                     | Real accept/reject, reload and peer observation.                                          |
| A03 | Pending and decided threads retain attribution, replies, reactions, history and working deep links.                                                                                  | Real discussion/history controls and durable read-back.                                   |
| A04 | Viewer creation, commenter acceptance, revoked access, locked/source-owned/unsupported targets fail closed without partial writes.                                                   | Role-separated UI plus action/integration denial tests.                                   |
| A05 | An accountable agent asked to suggest uses shared suggestion actions and returns inspectable pending work without direct editing.                                                    | Actual agent run and real reviewer inspection; direct helper invocation is insufficient.  |
| A06 | Concurrent edits yield a uniquely safe contextual rebase or explicit stale/conflict; no wrong-location, overwrite or accepted no-op.                                                 | Real concurrent clients plus base/CAS/Yjs fence tests.                                    |
| A07 | Create/amend/decide retries are idempotent; rollback and post-commit delivery failures preserve atomic or durably convergent truth.                                                  | Focused failure/race integration tests, recovery UI where available.                      |
| A08 | Proposal/reply/reaction/disposition and accepted canonical content converge across two live clients without reload or stale-client overwrite.                                        | Two simultaneous clients plus stale-flush integration tests.                              |
| A09 | Keyboard and assistive-technology semantics expose mode, operation, material, actor/status, decisions, replies and predictable focus return.                                         | Real keyboard/focus, accessibility inspection; label any unavailable screen-reader proof. |
| A10 | Feature is available without a flag; ordinary editing, comments, sharing/history, agent direct edits, local files and source sync retain their existing behavior outside Suggesting. | Real unaffected paths and focused isolation/eligibility tests.                            |

### Cumulative regression assertions

Every row is required, even if an earlier targeted pass omitted it. Existing source/tests and the dated QA artifacts supply provenance; earlier passing screenshots are not a pass on the merged artifact. New findings extend this table before repair; only an explicit user correction may supersede a conflicting requirement.

| ID  | Frozen behavior and regression scenario                                                                                                                                                                                                                                                                                                         | Provenance                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| R01 | Enter via page menu; menu closes and editor focus is usable. Compact Suggesting label and separately focusable Stop action; no stuck trigger outline. Exit neither opens history nor selects/scrolls to a proposal or changes utility-panel state.                                                                                              | r4 interaction repair.                                               |
| R02 | Live and saved Add/Delete/Replace stay inline at the correct location through typing elsewhere, blur, exit, reload and a second suggesting session. Drafts appear in All and Suggestions/Pending; no false empty list, disappear/reappear gap or duplicate thread.                                                                              | September 5 QA; September 6 recorded feedback F1–F5.                 |
| R03 | Canonical/draft coordinate mapping handles repeated text, spaces, adjacent changes, single-newline paragraphs, hard breaks and zero-width deletions. Ambiguous/missing anchors show an honest unavailable/stale state, never position 1 or another plausible location.                                                                          | r3/r4 anchors; September 5 invisible deletion and insertion repairs. |
| R04 | Selected phrase/sentence overwrite is one exact Replace even when the same session also inserts/deletes elsewhere; separate ranges remain independently decidable. Unselected suffix typing stays Add. Selection at whole-document/block endpoints remains valid.                                                                               | September 8 replacement and multi-location repair.                   |
| R05 | Backspacing some/all newly inserted text only changes/removes that proposal; no ghost deletion of never-canonical text. Empty drafts, undo/redo, spaces and paragraph split/merge preserve exact surrounding material; reject restores original structure.                                                                                      | September 5 repeat R1–R4.                                            |
| R06 | Saved own human-authored pending single-operation suggestions reopen for native caret editing. Add amendment stays Add; continuing Delete can become Replace; Replace amendment keeps exact original envelope. Same proposal/thread survives reload; no canonical writes or extra discussion.                                                   | September 8 continuation G2–G5.                                      |
| R07 | Multi-location amendment of an existing proposal keeps its existing single-proposal contract and exact final Markdown. Only current author with continuing access/pending status can amend; basis/proposal-revision races fail honestly and history remains durable.                                                                            | Core amendments and September 8 multi-location follow-up.            |
| R08 | Immediately accepting while an own amendment is still being typed applies the latest visible text exactly once, not the previous saved text. Failures retain recoverable draft and actionable error/retry; no fake success.                                                                                                                     | September 8 continuation G6 and decision repair.                     |
| R09 | Accept/reject each Add/Delete/Replace independently, including adjacent proposals in both orders. Accepting one refreshes remaining anchors without losing their replies or identity; rejected deletion restores original, accepted deletion removes only intended text.                                                                        | Original A02; September 5 repeat R4; latest draft/anchor repairs.    |
| R10 | Add summary including label/quotes is blue; Delete is gray. Replace collapsed shows blue with, expanded gray Replace underneath. Typed material is readable without serialized Markdown noise. Deletions are gray struck at rest and readable on hover/focus without text geometry shift.                                                       | r4 and final September 8 color/order correction.                     |
| R11 | Ordinary, live-draft and saved-suggestion cards share hover/selection shell and movement while keeping their different actions. Hover links exact anchor/card without stealing focus or opening/selecting a thread.                                                                                                                             | September 8 unified review H1–H5.                                    |
| R12 | Proposed old/new text uses I-beam/native caret and stable text size, baseline, width, padding and wrap when reopening. No button-like text treatment or paragraph displacement.                                                                                                                                                                 | September 8 unified review geometry repair.                          |
| R13 | Ordinary inline comment normal, hover and selected emphasis remain distinct; selected survives mouse-away and pending blue wins overlaps. Color transition animates without changing text geometry, respects reduced motion. Motion PASS requires continuous adequate evidence, not sparse stills.                                              | September 8 comment regression repair D2.                            |
| R14 | One chronological thread shell: proposal/comment first, replies in order, composer last. Switching adjacent threads and menus targets the right discussion. Reply typing including spaces/Enter never edits document text or activates its editor. Multiline composer grows.                                                                    | September 5 shared-thread/composer repair.                           |
| R15 | Unsent ordinary and suggestion replies survive Escape/reopen, thread switches, history/filter navigation and responsive remounts within the page session. Successful submit clears only its draft. Reload persistence of unsent replies is not promised.                                                                                        | September 5 draft store; September 8 ordinary reply retention.       |
| R16 | Resolved suggestion history has no live reply/decision composer; pending thread remains replyable. Ordinary resolve/reopen restores its anchor and retained draft; selecting history never fabricates an absent anchor.                                                                                                                         | September 6 resolved-reply repair; September 8 D6.                   |
| R17 | Existing Filter menu combines All/Comments/Suggestions with status/author; submenus stay open appropriately. Filtering does not mutate proposal state or remove editor overlays. Deep links/unanchored history retain exact context.                                                                                                            | r4; September 5 history repair.                                      |
| R18 | Closed history becomes non-interactive after transition. Rail/sheet crossing preserves one focusable surface, selection and reply draft; Escape is layered and controls have visible keyboard focus.                                                                                                                                            | September 8 history lifecycle/compact repair.                        |
| R19 | Fresh desktop load and repeat reload place inactive cards 24px from reading-column edge (1px rounding); hover/selection may translate left 8px. No resize/history trigger needed, repeated-update crash, drift or anchor lookup into sidebar cards.                                                                                             | September 5 desktop crash and September 8 lane repair.               |
| R20 | Long-page scrolling and sidebar toggles keep cards in document flow. At mobile/compact, activated ordinary thread is near its anchor within viewport, excludes unrelated suggestions, and a tall bottom-of-page thread has reachable reply/submit controls.                                                                                     | Shared-anchor isolation; September 8 D3–D4.                          |
| R21 | Complete desktop/mobile flow, compact counterparts and actual layout boundary ±1px remain readable with no clipping, lost context or inaccessible action. Test 390×844, 768×1024, 1280×800, 1440×900 where material, and initial 847/849px boundary; measure actual CSS sizes. Long title and title resize do not disrupt typing/scroll/layout. | All frozen responsive scripts; title observer merge preservation.    |
| R22 | Notifications, reactions, more menu, unread/mute and deep links use existing discussion semantics; no duplicate store, notification stream or misleading suggestion/reply count.                                                                                                                                                                | Original parity thread tools and A03/A08.                            |
| R23 | Merge compatibility: fresh PGlite boot, proposal persistence, comments and decisions remain usable without hanging reads or transactions. Preserve canonical mutation lease, transactional side effects and post-commit publication.                                                                                                            | September 8 main integration.                                        |
| R24 | Persistence handoff never accepts and then loses intervening input; leading/trailing whitespace and repeated-prefix insertion remain exact. Partial-create failure/retry produces no duplicate card. Empty/whole-document deletion, indentation and text after Markdown links retain useful review targets.                                     | September 5–6 capture/persistence repairs.                           |
| R25 | Selected compact cards have an opaque readable background. Portal interactions do not dismiss their parent; narrow history stays closed during typing until explicitly opened. Do not restore removed connector lines or selected-card outlines.                                                                                                | September 6 compact/portal fixes and September 8 comment redesign.   |
| R26 | Stale/overlap decisions stay visibly Conflict/Stale, remain discoverable even when Pending was selected and never close as success. Decided replacement history still expands to reveal retained before/after text.                                                                                                                             | September 5 reverse-order/conflict repair; shared thread history.    |
| R27 | Delayed editor mount, collaboration remount or reading-column replacement refreshes the lane observer instead of measuring an obsolete editor. Reply draft and active anchor survive the relevant layout transitions.                                                                                                                           | September 8 comment-lane lifecycle repair.                           |

**R28 — native PGlite transaction re-entry (extends A04, A07, R23).** Amending and deciding a proposal must finish while permission checks read through the same native database transaction. Subsequent ordinary reads must remain usable. Rollback preserves both access and data atomicity; unrelated concurrent requests and explicitly separate database clients must not inherit another database's transaction. Fresh global database access must honor the active transaction after singleton initialization. Nested use of the same database must not commit its parent early. Exercise the real native transaction API, not a manual `BEGIN` substitute. Added from the September 8 r5 preflight: review reads timed out after 60 seconds and stalled the local database; a server restart restored reads but did not establish a fix. H4, H6 and H16 cover this regression.

**R29 — controlled-editor toolbar handoff (extends A01, A10, R24).** An editor that already matches its initial controlled value has an established applied baseline. A stale same-revision parent update while focus is in a toolbar input must not undo a local mark edit before its controlled echo arrives or collapse its selection. Genuine newer authoritative changes still reconcile under the existing typing, collaboration and conflict guards. Exercise Link add/remove/change with delayed editor focus in both ordinary editing and Suggesting; verify live native marks, pending highlights and card anchors before saving where applicable. Added from H9's real Remove link trace: the mark was correctly removed, then the original href was restored and the selection collapsed before any draft highlight appeared. After the Suggesting repair, ordinary Remove link still retained its original URL and collapsed selection in H16; that sibling remains a failure until its own native retest passes. H9 and H16 cover this regression.

**R30 — peer presence preserves text geometry (extends A08–A10, R19).** Another client's caret, name label or selection must not split a paragraph, consume a line of document space or change its text. Labels remain content-bounded and positioned outside text flow; the caret remains an inline marker. Styling must match the actual installed caret and selection renderers rather than obsolete class names. With two real clients, place the peer caret inside a sentence, reload the observing client, move/select/blur the peer and verify unchanged text and line geometry at each checkpoint. Added from R16's ordinary reload and explicit two-client reproduction: a default-block pink name label fills the640px paragraph and forces its suffix onto another line; blur restores the unchanged sentence. H10, H12 and H16 cover the repair. Why an older awareness entry appeared after the first reload remains separate from this confirmed layout failure.

**R31 — text edits retain anchors in formatted documents (extends A01–A02, R03, R10, R29).** Exact supported text edits inside or beside formatting must map their saved Markdown ranges to the native document for both live drafts and canonical review. This includes a text-plus-mark replacement and a separate insertion whose surrounding context contains formatting; neither may report Highlight unavailable merely because Markdown delimiters are absent from rendered text. Repeated text, zero-width insertion/deletion markers, hard breaks and paragraph boundaries must retain exact placement, and genuinely ambiguous or mismatched anchors must still fail closed. H9's mixed session and H11's responsive counterpart save/reload, accept the formatted replacement and reject the independent suffix without changing neighboring content. Added from R17: both mixed proposals lose their highlights while the same first native decisions successfully apply on the backend. Bold inheritance during native replacement remains a separate behavior to diagnose, not an exception to this mapping contract.

Historical source map: `comments-human-qa-script.md` H1–H8; `suggestions-repeat-qa.md` R1–R4; `qa-sept5/report.md`; `recorded-feedback-qa.md` F1–F8; `september8-suggestion-qa.md` G1–G8; `september8-unified-review-qa.md` H1–H7; `september8-comment-regression-repair/qa-plan.md` D1–D6; and `september8-multi-location-fix/qa-plan.md` H1–H6 are retained in the task's local evidence directory. Branch repair commits are `7f0ab56a0d`, `b8f9b33a36`, `c820218ee5`, `d33a66dd21`, `2e7c9c50a2`, `e8676eee9e`, and merge `93f2a38e8a`. The historical Notion comparison is reference evidence, not permission to replace Alice's later explicit preferences or a fresh Content pass.

**R32 — accepted content agrees across editor modes and peers (extends A01–A02, A08, R24, R27).** A successful acceptance must remain visible in ordinary editing, Suggesting, reloads and an already-open peer; an empty Suggesting entry/exit must not exchange two different document versions. Another pending proposal must keep its exact anchor after the decision. Preserve concurrent local edits and surface genuine conflicts rather than silently replacing either version. Added from R18: Accept briefly shows the replacement, ordinary editing and its reload then show the old word, while an empty Suggesting session shows the accepted replacement and exiting restores the old display. Both peers show the old ordinary content, but history records Accepted. This proves a visible state disagreement, not storage loss or peer causality. H6, H9, H12 and H15 must repeat decision, settled state, empty mode round trip, reload and peer checkpoints.

R18 presentation extension to R10/R31: inline inserted/deleted comparison widgets and the sidebar must render the same supported formatting without exposing Markdown delimiters, span tags or link source. Native selection across an inline comparison must preserve the exact intended formatting scope; inspect the full selected word before applying a mark. The R18 keyboard selection applied Italic to Change but not its final d, so that full-word case remains unverified rather than passed. H9/H10 and responsive counterparts retain this check.

**R33 — ordinary formatting removal survives collaboration (extends A10, R24, R27, R32).** In ordinary editing, removing a supported mark from visibly selected task-owned text must change exactly that range and remain removed in the settled editor, a retained peer, and reload. Native pointer and keyboard controls must preserve the intended selection. H9's matched baseline and H16's ordinary-editing regression exercise this without pending proposals; do not bypass a failed ordinary command by mutating hidden editor or database state. Added from R19: whole-word Italic removal leaves Bold italic after toolbar, native pointer and keyboard attempts, with peer and reload agreeing on the unchanged mark. The cause remains uninvestigated; this observation does not establish peer causality.

R19 clarification of R33: the final diagnostic command emits correct unitalicized canonical content and both clients eventually converge. The defect is transient/inconsistent feedback, not established permanent save failure. A faithful two-client native-editor probe then reproduces an idle lead peer applying already-seen SQL over a newer remote Yjs edit before the correct SQL echo arrives. R33 requires retaining that remote edit during the gap, without treating it as a local emission or preventing genuinely newer authoritative revisions from reconciling.

R19 extension to R10/R31: live deletion/insertion widgets must render only their own proposed/original marks, never inherit the adjacent native replacement's Bold, Italic, Underline, Strike, Code or Link marks. R19's live deleted Bold becomes italic after Italic is applied to Changed, while saving restores upright Bold. Cross-paragraph original text likewise inherits replacement marks. Preserve native document formatting and selection outside the widget; test both live and saved variants.

R20 exact-scope extension to R03/R31: replacing a selected range across a marked hard break must not widen the proposal to unchanged prefix/suffix text merely to accommodate serialized mark boundaries. Native selection of only `Upper` + hard break + `Lower` within bold `Prefix Upper` / `Lower suffix.` must propose exactly that selected replacement, preserve both surrounding fragments and their marks, and show the same exact scope live and after save/reload. Correct final text alone is insufficient: R20 Accept produces bold `Prefix Across suffix.`, but the proposed comparison includes the entire original and resulting paragraph. Keep this failure under H9/H11 until exact scope and final effect both pass.

**R34 — supported indentation remains an honest proposal (extends A01–A02, R03, R24, R31).** Native paragraph/heading Tab and Shift+Tab retain their ordinary indent/outdent behavior in Suggesting. Combined text/mark/indent changes and standalone indent/outdent must preserve the complete raw operation, show the structural change visibly, and retain a useful exact anchor through draft, save, reload and decision. Do not treat arbitrary inline tabs as block indentation or silently omit indentation from the comparison. A preview that cannot be rendered must visibly say so, distinct from a genuinely empty change; an invisible DOM marker or empty quoted summary is insufficient. Added from R21 H10: Tab after Changed-to-Bright plus Italic removal indents the paragraph but produces a saved empty proposed line and Highlight unavailable, while raw operation/persistence remain intact. H8–H10 and H16 cover this boundary.

**R35 — keyboard exit preserves native editing and review state (extends A09, R18, R21).** Users can leave the rich document editor for surrounding page controls using the keyboard while Tab/Shift+Tab retain native indentation. Inner menus, popovers and composer controls handle Escape before the editor exit; composing text and non-editor controls are not intercepted. Exiting focuses a visible existing control without changing text, indentation, Suggesting mode or saving/deciding a proposal merely from focus. Verify the real subsequent Tab traversal, not a test that manually focuses its expected destination. Added from the R21 H10 source audit: both Tab directions are consumed for indentation, while the existing outer Escape only dismisses comment focus and provides no editor exit. H10/H11 must prove focus, preserved drafts and responsive behavior in the actual interface.

**R36 — pointer activation preserves native replacement selection (extends A09, R11–R12, R29, R31).** Double-clicking editable proposed text must retain the genuine selected range and reveal its formatting toolbar; activating the associated card must not collapse that selection. Preserve forward/reverse native ranges and adjacent comparison-widget behavior without fabricating a selection for widget-only, outside or unmappable content. Existing keyboard selection and collapsed-click behavior remain unchanged. Added from R21 H10: repeated double-click on Bright activates its card but does not reveal the toolbar, while Home plus Shift+Right works. A focused native-view probe reproduces active-decoration metadata erasing a pending DOM selection before the editor records it; actual browser causality and repair still require the original pointer replay. H9–H11 cover this boundary.

**R37 — review state converges without a document-content mutation (extends A03/A08, R22/R26).** A saved proposal's Reject must remove its pending inline/card state in another already-open client without a peer reload, even though canonical document text and its content revision do not change. Both clients must first show the same pending proposal on the tested revision. Saved comparison, disposition and discussion remain available in history; replies, reactions and thread state likewise refresh through the shared change stream. Refresh only the relevant document/review queries, preserving unrelated-document, resource-type and bounded database exclusions; do not add a parallel polling loop or tie review freshness to document content. Added from R22 warm-peer failure: first native Reject persists in the deciding client while the freshly reloaded peer keeps the pending card and inline suggestion after further interaction. H7/H12/H15 cover the live read-model boundary, with focused invalidation/refetch tests as supporting evidence.

**R38 — ordinary heading conversion persists before structural review (extends A10, R33–R34).** Converting a selected paragraph to a supported heading through the visible toolbar must retain the requested block type and existing inline marks in the settled editor, peer and reload. Do not prepare a passing suggestion fixture through hidden document mutations when the ordinary heading command fails. Added from the September 9 H10 baseline: Heading 2 appears immediately, then returns to a paragraph without reload; a newly opened peer also shows the paragraph. This establishes visible rollback, not its source or peer causality. H10's standalone marked-heading indentation decisions and H16's ordinary-editing coverage retain this requirement.

R24 native checkpoint on `ff0f5530`: R38's Heading 2 and reverse Text conversion now persist with inline marks in both warm clients and reload. The repair clears 568 tests, build/typecheck, all 71 guards and independent review. Standalone paragraph Tab indentation likewise retains a visible comparison through save/reload, then first Accept produces the actual indent in both clients and reload. **R34 still fails the saved inverse:** native Shift+Tab shows a useful live outdent marker, but saving removes the inline anchor and moves the card above the document; reload retains that state, and the warm peer explicitly reports Highlight unavailable. Keep the saved proposal for diagnosis without rewriting it. Its useful saved anchor and subsequent Reject/Accept remain required, as do the marked-heading matrix and remaining H10–H18.

### Frozen execution sequence H1–H18

September 9 execution correction approved by Alice: retain the original assertions and real-interface scenarios, but use one compact acceptance checklist. Preserve prior passing coverage unless a subsequent change could invalidate it; after a failure replay the broken interaction and closely related regressions. Screenshots are for meaningful visual failures, ambiguous results and representative final states, not repeated per-pass packets. This supersedes the capture/ledger requirements below, including H18's ordered packet, without weakening functional, visual or interaction acceptance. Finish with one coherent end-to-end pass and a concise pass/blocker report.

The compact `.tmp/september8-full-suggestion-qa/acceptance-checklist.md` is the current execution map. H12's accepted-change/ordinary-peer-edit race now passes in both mobile/desktop directions through reload after the bounded save-ownership repair. Current H8 mobile failure is within the existing structural contract: a paragraph merge plus a hard break before repeated text saves the hard break as two malformed fragments with unavailable previews and anchors. Repair the shared operation boundary and replay the native interaction; do not rewrite the stored proposals to fabricate recovery. Earlier unaffected passes remain retained.

**R39 — new ordinary-comment drafts survive responsive presentation changes (extends A10, R15, R18, R21).** Before first submission, new anchored comments retain their text, mentions and exact source anchor when the same page switches between narrow anchored composer and desktop rail. If the composer was focused, preserve native caret/selection so resumed typing affects the intended substring; do not steal focus intentionally moved elsewhere or reinitialize on each keystroke. Explicit cancel, a deliberately new selection, successful submit and document navigation clear only the appropriate draft; failed submit retains it. Added from R26 mobile H1: Mobile baseline comment survives 390→768 but disappears on1280 and remains empty on return390. The selected word remains, so this is composer-state loss, not a lost document anchor. Require actual mobile→compact→desktop→mobile and boundary±1px replay before closure; existing saved-reply requirements remain unchanged.

**R40 — reply Escape dismisses the inner layer first (extends A09, R18, R35, H10–H11).** With a saved ordinary or suggestion reply focused inside the narrow Comments sheet, Escape collapses only the reply composer and retains its exact draft for reopening. A mention menu consumes the first Escape without collapsing the reply or sheet; composition must not trigger dismissal. Escape from the sheet background still closes the sheet. R27 mobile H5 reproduces the defect twice with a visibly focused multiline reply: Escape closes the entire sheet, although reopening recovers the draft. Responsive text and backward-selection retention passed before this failure. Require the actual sheet/composer capture-order regression and native mobile replay; a textarea-only synthetic test or retained text alone does not close it.

R28 native replay on `075f20d2` passes reply-only Escape and exact draft recovery, but the mention picker remains open after two full Escape presses. The keydown-only mounted test misses keyup re-running the unchanged mention query and reopening it. Preserve R40's original menu-first result through the complete native key sequence, including existing ArrowUp/Down selection and Enter/Tab mention insertion. Diagnose at the query-refresh boundary rather than adding an Escape-only special case; composition and non-reply/background controls remain required. The synthetic draft was posted before stopping the runtime, with a styled mention and exact multiline text confirmed.

**R41 — accepting a multi-location envelope preserves safely identifiable unchanged targets inside it (extends A06, R07, R09).** A single amended proposal may span separate changes with a wholly unchanged paragraph between them. Accepting that proposal must retain the exact useful anchors and discussion identities of independent pending proposals in a uniquely preserved middle paragraph. UI presentation and server application must agree through the shared resolver; never recover by accepting the first matching word or weakening true ambiguity, changed-target, or competing-insertion safeguards. R28 mobile H6 on `cb9cc0dd` accepts the latest suffix Add and then the H4 first/third-location Replace. Canonical text is correct, but pending publish→review and the Review note. prefix before Editors both lose inline anchors and show Highlight unavailable in Pending, at all widths and after reload. The unchanged paragraph is exactly Editors publish carefully. Preserve the two saved proposals and posted replies for repair replay. Require exact saved-payload regression, both subsequent decision orders, unequal shifts and true-conflict controls, then native retained-fixture recovery without rewriting either proposal. The removed better anchor of the ordinary comment is genuinely unavailable and must not be fabricated.

R29 native checkpoint on `7c8387d8`: both preserved R41 pending targets recover their exact inline anchors without rewriting either proposal. The recovered replacement retains its original basis and posted reply at mobile/compact/desktop; first native mobile Reject preserves canonical publish and its discussion, while the prefix remains independently anchored through reload. Shared resolver, server application and the same mounted editor separately prove both remaining acceptance orders with strict ambiguity/reorder controls; this is not a native two-order replay of the multi-location fixture. Independent review, 669 Content tests, 34 Core tests, 35 collaboration tests, build and all 71 guards pass. The removed ordinary better anchor correctly remains unavailable. A fresh mobile H6 fixture then passes accepted Delete, rejected Replace/Add, and independently saved adjacent Add/Replace in both native acceptance orders. Each remaining anchor stays useful; exact results survive all-width comparisons, reloads and an empty Suggesting round trip. Remaining H7–H10 mobile and H12–H18 are still required. Motion remains UNVERIFIED.

R26 native checkpoint on `e96165ec`: R34's marked-heading live Tab now has a visible blue marker and correctly aligned card through save/reload. Rejecting the retained saved proposal preserves the baseline; fresh indent Accept persists with the original marks. Native Shift+Tab has a gray marker through save/reload; first Reject preserves indentation and first Accept restores the baseline, including the retained second client and reload. The indent Accept's peer check used reopened clients after a turn transition, not uninterrupted transport. These are bounded desktop passes (1280×800 and 1164×655), not H11 or full-flow acceptance. Root 579 tests, build/typecheck and all 71 guards pass. Remaining keyboard/layered Escape, responsive, role, actual-agent and release stories remain required; transient old-card/unavailable presentation on indent Accept does not establish a Motion pass. Earlier R24/R25 failures below are superseded only for this exercised structural matrix.

R25 native checkpoint on `376cd084`: the retained saved paragraph outdent now recovers its marker/card alignment in both clients without rewriting it. Reject preserves indentation; a fresh saved/reloaded outdent Accept restores the paragraph baseline in both clients and reload. **R34 remains open for the multi-block live heading draft:** Tab in a marked Heading 2 below a paragraph indents the heading, but its live card has no inline anchor and sits above the document. Saving and reloading restore the correct heading marker/card. Preserve the saved proposal and require a fresh native live-draft replay before closing the heading matrix.

Persona: a writer/commenter proposing exact edits, an authorized reviewing editor, a read-only viewer and an accountable agent. Main executor is this task, not an independent tester. Create only distinctly named private synthetic `Full suggestion QA <run> <viewport>` Pages; preserve all existing Pages and drafts. Use native visible controls for editor/review actions, not hidden editor APIs. Capture and visually inspect viewport evidence after every meaningful state before diagnostic inspection. Every H-step receives separate functional, visual, accessibility/interaction and experiential latency results (instant/brief/noticeable/disruptive; never tool duration).

1. **H1 — baseline and ordinary discussion (A10, R14–R15, R19–R21).** Create synthetic paragraphs with native Enter: `This reads better compared to the original.` / `Editors publish carefully.` / `Final sentence.` Add an anchored ordinary comment and multiline reply; reload twice and inspect initial lane. Expect exact saved text, one correct thread and stable placement; capture start/comment/reply/reload.
2. **H2 — mode and mixed live proposals (A01, R01–R04, R10).** Enter Suggesting; select entire first sentence and type `This reads more clearly than the original.`; delete publish in paragraph two and append ` Added words.` in paragraph three during the same session. Expect exactly one Replace, one Delete and one Add at those locations, canonical original intact; capture selection and each draft.
3. **H3 — persistence and re-entry (R02–R03, R17).** Inspect live All and Suggestions/Pending, exit without navigation, reload, enter again and add `Review note. ` to paragraph two. Expect old plus new proposals, accurate summaries/anchors and no duplicates; capture live/history/exit/reload/second-session states.
4. **H4 — native amendment (R06–R07, R11–R12).** Reopen saved own insertion, deletion and replacement with pointer/native keys; amend each, save/reload. Include Add→Add, Delete→Replace and two-location amendment of one saved proposal. Expect stable identity/thread, original basis and exact final text; capture before/caret/after and compare geometry.
5. **H5 — discussion/drafts (A03, R14–R18).** Reply on two adjacent proposals using spaces and Shift+Enter; Escape, switch threads, filter/history and change width with unsent text. Submit/reopen one. Expect correct chronological threads, retained unsent drafts and no document edits; capture focused composer, retained and posted states.
6. **H6 — accept/reject (A02, R08–R09).** Accept latest insertion immediately after native amendment without separate save. Accept replacement, reject deletion, retain another pending Add; reload. Then on fresh operations exercise accepted Delete and rejected Replace/Add, adjacent operations in both decision orders. Expect exactly selected canonical changes, remaining targets/threads intact; capture every decision and durable final text.
7. **H7 — history/tools (A03, R16–R18, R22).** Find accepted/rejected/pending in history, verify decision controls disappear only for resolved items, exercise reaction/unread/mute/deep-link tools on synthetic discussions, resolve/reopen ordinary comment. Expect persistent attribution/context and correct selection; capture filters, tools, link return and restored anchor.
8. **H8 — canceled/structural edits (A01, R03–R05).** Fresh synthetic fixture: partial/full backspace of new insertion, undo/redo, adjacent edits, repeated text, hard breaks, paragraph split/merge, new text block. Accept and reject structural proposals separately. Expect no ghost changes, wrong anchors or lost surrounding text; capture draft and after-reload results.
9. **H9 — formatting (A01–A02, R02–R03).** On separate supported text selections propose Bold, Italic, Underline, Strikethrough, Code and Link add/remove/change through visible controls. Inspect rendered before/after, save/reload, independently accept/reject. Link add/remove/URL-change must show the same exact pending inline highlight and adjacent card during the live draft, not only after saving. Verify the accepted destination through its visible editor without navigating. Unsupported controls fail closed; absence of a promised operation is a failure, not a skipped pass.
10. **H10 — visual/keyboard/motion (A09, R10–R13, R18–R21).** Traverse mode/anchors/cards/replies/decisions with keyboard; inspect normal/hover/selected ordinary and suggested material, caret geometry, full summary colors and reduced motion. First pointer activation of visible Accept/Reject must hit that control even while a reply is focused; More actions remains separately reachable, never an invisible overlapping target. Formatting controls remain reachable above block grips and inside the content boundary when the review rail opens/closes without reselection. Record continuous transitions when possible. Motion stays UNVERIFIED if capture cannot prove it.
11. **H11 — responsive complete flow (R21).** Repeat H1–H10 on a fresh primary-mobile fixture; capture comparable meaningful checkpoints at compact width and layout boundary ±1px. Keep history/reply draft open across boundary, test long page/tall bottom thread/sidebar and long title. No hover dependency on mobile.
12. **H12 — live peers (A01, A08).** Keep a second client open while creating, replying, reacting and deciding. Verify pending work is not canonical, accepted content arrives without reload, and stale peer editing cannot revert it. Same-identity tabs prove transport only, not role separation.
13. **H13 — roles/eligibility (A04, A10).** With actual scoped commenter/editor/viewer test identities, verify creation/decision affordances and server denials, locks and excluded content. Use local synthetic grants only; do not create organizations or change existing identities to fabricate proof. Record any unavailable fixture explicitly.
14. **H14 — accountable agent (A05).** Ask the actual agent to suggest a bounded synthetic wording change; inspect returned pending proposal and run attribution from the reviewer UI, then accept/reject. No canonical rewrite or hidden helper substitute.
15. **H15 — stale/concurrent/retry (A06–A08).** Concurrent canonical edit and competing review/amendment; verify safe unique rebase or explicit stale outcome and retry behavior. Supplement with focused rollback/CAS/Yjs-state/post-commit-failure tests; do not inject unsafe production failures.
16. **H16 — legacy and technical gates (A07, A10, R23).** Recheck ordinary editing/comment behavior, supported source boundaries, PGlite persistence and targeted Content/Core suites, typecheck, formatting, i18n and guards. Closed development-server generations must not retain sweep timers or MCP refresh listeners; test async initialization racing close and distinguish disposal of registered work from cancellation of already-running work. Tests supplement the screen, never replace it, and lifecycle cleanup alone does not establish the initiating cause of a database failure.
17. **H17 — deployed acceptance boundary.** Original beta role-separated and agent story remains required for full release acceptance. Local results are labeled local; inspect available deployment/test-user access without publishing. If unavailable, retain exact gap and unblock condition, not a local PASS substitution.
18. **H18 — cleanup/report.** Recoverably trash only this run's fixtures and verify Restore entries; remove temporary observers/viewport overrides and close only QA-created tabs. Deliver an exact-revision ordered UI review packet and one A/R coverage map including failures, stale evidence and explicit gaps.

### Current evidence status

**R44 — centered review group with independent reading width (September 10, Alice; confirmed after video and screenshot feedback).** When inline comments are visible, center the entire title/body column + gap + comment-card group within the available page area beside the navigation sidebar. The margin before the title/body column must equal the margin after the cards. Keep title and body aligned at the same normal reading width; comments may shift their position but must never squeeze them. Consume spare outer margins before collapsing cards. When the unchanged reading column and cards cannot fit together, collapse to indicators and compact review, and center the document alone. Only a viewport too narrow for the document itself may reduce its reading width. Measure available page space after navigation, agent sidebars and split view, not the full browser width. Preserve full-width database views, drafts, selection, and review state across transitions.

R44 acceptance: with inline cards, the text column is 640px wide, the column-to-card gap is 24px, and the visible cards are 296px wide; the resulting 960px group has equal outer margins. The current desktop fit boundary is 1088px of available page width, leaving 64px on either side. Verify equal margins and matching title/paragraph widths at both wide and near-boundary sizes. Below the fit boundary, verify compact review and unchanged 640px text width while the document alone still fits; verify ordinary narrowing only after that. Short lines naturally end before the column edge—measure paragraph bounds or use sufficient text rather than treating visible text endings as column boundaries. Opening compact review must not reflow the document. No comment visibility or resize operation may mutate document text or decide a suggestion.

**R43 — shared review visibility (September 10, Alice).** Hide comments and highlights also hides in-page suggestion decorations. Showing them restores both. This is presentation only: retain proposal state, drafts, discussion history and accurate anchor metadata; hiding must not accept, reject or discard edits.

**R42 — unified review status filter (September 10, Alice).** The status choices are Open, Resolved and All only. Open includes unresolved comments and pending/stale suggestions; Resolved includes resolved comments and accepted/rejected suggestions. Individual suggestions retain their precise disposition labels. Default to Open, then remember the user's explicit status choice across all pages and reloads in this browser, isolated by signed-in account. Kind and author remain page-session filters. Explicit deep-link/conflict reveal may temporarily show All without overwriting the remembered choice. Verify default, account isolation, page navigation/reload persistence, status membership and unchanged inline overlays. This supersedes earlier references to separate Pending/Accepted/Rejected filter choices, not their underlying proposal states.

### Deferred work — September 9 checkpoint

Alice explicitly authorized pushing the current incomplete checkpoint and deferring further investigation. Do not merge, deploy, or restart the full QA matrix as part of this handoff. The earlier no-shipping statement below describes the prior QA scope; this checkpoint authorizes commit/push only.

- **Code-block suggestion preview — acceptance failure, deferred.** On an ordinary editable page, enter Suggesting, choose `/code`, type `Supported text stays reviewable.`, and Stop. The saved Add shows “Preview unavailable” and “Highlight unavailable” instead of an in-place proposal. Reject succeeded and the canonical baseline remained intact. Root cause is not established. Resume with this focused reproduction, repair the operation/preview boundary, then prove saved preview, anchor, accept/reject and reload before claiming code-block support.
- **Fixture cleanup — partial, deferred.** Fourteen primary QA roots have verified Restore entries. The bypass-created database child `GlGf724WAtpp` (database `LmURo2kSpgGl`) remained listed after Delete returned success and the page reloaded. Investigate deletion/list consistency and recoverably trash this exact fixture; do not delete unrelated data. QA tabs, instrumentation and the owned server are already closed.
- **Missing acceptance evidence — blocked.** Actual-agent attribution requires a working AI connection; source/local-file exclusions need representative fixtures; beta acceptance requires an explicitly authorized deployment and role-separated access. Motion and screen-reader coverage are unverified. These remain acceptance gaps, not passes or automatically authorized future work.
- **Integration — pending.** The existing PR reports conflicts with main. Resolve them only in a later authorized integration task, then refresh affected verification and CI. This checkpoint is not merge-ready.

**September 9 final local handoff — FAILED / BLOCKED, not overall PASS.** Alice directed a timely finish of the current exclusion repair, focused replay and cleanup without another open-ended repair cycle. On frozen runtime source `67b90b92`, database/page/media command exclusions, the direct Generate shortcut guard, existing-image read-only controls in Suggesting, and ordinary text suggestions beside an image pass native replay. Independent review is clear; 37 slash and201 editor/media tests pass, with typecheck and targeted eligibility regressions. The earlier coherent desktop/mobile review/recovery flow and unaffected passing matrix are retained. A newly exercised `/code` → type → Stop path saves an Add with “Preview unavailable” and no anchor; it remains **failed** and was safely rejected, not silently omitted. Actual-agent credentials, real source/local-file fixtures and deployed acceptance remain **blocked**; motion and screen-reader proof remain unverified. Fourteen named primary QA roots have Restore entries, but bypass-created child `GlGf724WAtpp` still appears active after Delete and reload, so cleanup is partial. QA tabs, observers, emulation and the owned runtime are closed; existing user data and the original GitHub tab are preserved. The compact acceptance checklist is the current execution map; dated checkpoints below are historical evidence, not instructions to restart completed coverage. No shipping or deployment was authorized.

**R23 diagnostic checkpoint, not acceptance:** native event tracing identifies the missed boundaries. ProseMirror consumes Escape's native key code before the React bubble exit handler; synthetic tests without that code bypassed it. For double-click, hover-clear decoration metadata erases the pending native selection before click capture runs. The next repair moves exit handling after real inner ProseMirror handlers but before its fallback, and moves selection preservation to the metadata boundary while deleting the superseded click-only bridge. Temporary logs are removed before final-source verification. R37's focused refresh tests reproduce the peer failure independently. The runtime is stopped and the disposable diagnostic proposal is rejected; the canonical fixture is intact.

**R22 native replay:** the retained formerly blank comparison and a fresh native text/Italic-removal/indent proposal now preserve exact nonempty presentation through save/reload; first Reject also works while a multiline reply is focused. R35 and R36 remain **failed in the browser** despite passing mounted tests: Escape does not exit, subsequent Tab indents, and first double-click does not reveal the toolbar while keyboard reselection does. R37 records a separate warm-peer failure: after both clients reload the same pending proposal, the peer keeps it after the deciding client rejects it. Runtime is stopped with both rejections saved and the original seven-paragraph baseline intact. Temporary event-order diagnostics and a scoped shared-stream refresh repair are underway; technical gates below are not full native acceptance.

**R22 repair checkpoint:** indentation, editor keyboard exit and pointer-selection handoff have cleared combined source/test review under R34–R36. The exact final source passes 517 tests across 14 suites, Content build/typecheck and all 71 guards. A controlled removal of only the structural-indent decoration branch reproduces both native Tab failures with four controls passing; restoring the reviewed source passes all six cases. Heading outdent has a separate null-anchor RED-to-GREEN regression. Runtime is restarting on source fingerprint `c36ea557` to replay the retained saved proposal, native double-click, structural decisions and actual Escape-to-Tab focus traversal. These technical gates do not close H10 or H11–H18; the following failure is retained until native replay passes.

**H10 follow-on failure:** native keyboard entry and selected replacement formatting work, but Tab on the selected replacement indents its paragraph and turns the proposal into an empty, unanchored comparison. Saving/reloading retains the empty proposed line and Highlight unavailable while canonical original text stays intact. The shortcut's intended behavior and the source boundary are under diagnosis; this observation does not prescribe replacing an ordinary editor indent shortcut with focus traversal. Two pointer double-click attempts also fail to reveal the replacement toolbar, while native keyboard selection reveals it. Runtime is now stopped with one saved pending diagnostic proposal and no unsent text. Repair and native replay remain required under H10/H16 and the existing exact/structural/accessible comparison assertions. The preceding marked-hardbreak pass below remains valid only for its exercised path.

**Latest R21 checkpoint:** the marked hard-break scope failure below now passes its native desktop replay on source fingerprint `1c7746f2`. Only Upper/break/Lower appears in the exact formatted draft and saved/reloaded comparison; unchanged prefix/suffix remain outside it. First native Accept produces the correct bold single paragraph in both retained clients without peer reload. The inverse Across-to-two-lines proposal is likewise exact; first native Reject and reload retain Across. The whitespace/newline review regression is repaired; 389 tests, typecheck, independent review, build and all 71 guards pass. Runtime remains running at the saved seven-paragraph fixture with no pending or unsent proposal. Continue H10–H18 and the complete final-source responsive/formatting story; this is not full-flow acceptance. The R20 failure and initial R21 review state below are historical provenance superseded by this bounded replay.

**Current snapshot — R20:** local owning-task QA continues. The mixed H9 replacement retains Bold under native typing, applies Italic to the entire replacement word, and keeps both its own anchor and the independent suffix anchor through save/reload. Native Accept and Reject produce exactly bold/italic Changed and no suffix, visible in both already-open clients without reload and retained through empty Suggesting entry/exit and both reloads. Live comparison widgets now retain only their own marks, and ordinary Italic removal stays removed across the retained peer and reload. The preceding marked cross-paragraph replacement keeps its draft/saved/reloaded anchor, and Reject restores the original marked paragraphs. These are bounded desktop passes, not full-flow acceptance.

The marked hard-break case exposes overbroad proposal scope: only Upper/break/Lower is selected, but the comparison includes unchanged Prefix/suffix. Its accepted final paragraph is correct in both clients/reload; exact-scope acceptance remains failed. R21's exact-range and full-snapshot presentation repair passes 345 focused tests, a 180-test hardening rerun, typecheck, build and all 71 guards. Independent review then found that whitespace-only contextual previews lose their visible space/tab markers; that R03/R24 regression is under repair before live retesting. These technical results do not close the observed H9 failure. The runtime is stopped with all seven formatting-fixture paragraphs saved, no pending or unsent proposal, and the initial six marks retained. Next: complete the presentation repair and native exact-range retest, then finish H9 and H10–H18, including primary-mobile/compact evidence, scoped roles, actual agent, deployed acceptance boundary and cleanup. Earlier desktop H1–H8, discussion tools, native decisions, toolbar geometry and lifecycle checks remain explicitly revision-bounded. Motion remains UNVERIFIED. Nothing has been shipped or deployed. Chronological notes below preserve provenance, not an alternative current status.

Full r5 acceptance is **not yet established**. The immediately preceding merge gates passed build/typecheck and 226 focused tests; those checks do not establish the cumulative screen story. Every A/R assertion starts unverified on the merged artifact unless exact applicable evidence is explicitly attached. Repair marks all affected assertions and shared dependencies stale and reruns them without narrowing the contract. Earlier QA reports are historical provenance only. The current execution record and evidence will be linked here as they are produced.

The current local run is recorded in `.tmp/september8-full-suggestion-qa/report.md` and its cumulative `coverage.md`. Desktop H1 preserved an ordinary discussion and multiline reply through reload. H2 exposed a failure of existing R04/R05: canceling a prior insertion and then typing an unselected suffix at the paragraph end classified the final period as Replace instead of Add. The replacement-intent boundary was repaired; a fresh desktop fixture passed that exact cancellation-to-suffix sequence and the mixed Replace/Delete/Add story. H3 retained all four proposals through exit, reload and a second session. H4 has exercised saved Add amendment and Delete-to-Replace conversion through reload; multi-location amendment and subsequent decisions remain under evaluation. R28's database repair passed seven native-transaction regressions and exact-hash independent technical review, but the full real-interface acceptance remains open. These partial desktop results do not establish H5–H18 or responsive acceptance.

H5 then exposed an existing R18 continuity failure: resizing an open, focused desktop suggestion reply to compact opens Comments but collapses the active proposal and moves focus to Hide comments and highlights. Reopening preserves the text, so this is a selection/composer/focus failure, not lost draft data. Repair must cover ordinary and suggestion threads in both directions while keeping exactly one interactive surface, preserving native reply selection, and respecting explicit dismissal. H5/H11 require a fresh repaired-artifact rerun; retained text alone is insufficient.

The first continuity repair passed inline suggestion and ordinary reply transitions in both directions, including selected-text typing and explicit dismissal. A separate desktop-history-rail-to-Sheet rerun still lost focus while preserving expansion: the old rail remains mounted but becomes inert during its close transition. This sibling path remains R18 FAIL until the inert-transition blur is repaired and rerun; immediate-unmount unit tests alone do not cover it.

The subsequent inert-blur repair passed 36 focused tests, typecheck, independent technical re-review, and the real history-rail/Sheet round trip with selected-text typing. Desktop H6 has now exercised accepted latest Add without a separate save, accepted multi-location Replace, rejected Replace/Add/Delete, accepted Delete, and distinct adjacent proposals in both acceptance orders with reload. The multi-location envelope overlaps intermediate proposals: those remaining targets conservatively become unavailable; explicit stale/no-write behavior still needs its UI check under A06/R26, rather than a weaker word-only anchor fallback. H7 history tools/status and H8–H18 remain open. No full r5 acceptance is claimed.

Desktop H7 exposed existing A03/A09/R22/R26 failures: All-history cards omit Accepted/Rejected disposition; reactions, thread More/unread/mute/copy-link controls are absent; and accepting the unavailable overlapping prefix correctly leaves canonical text unchanged and shows Conflict, but the conflicted item then disappears from Pending with no Conflict filter. Accepted and Rejected filters individually find the correct retained threads. These are repair requirements under the unchanged assertions, not acceptance reductions. Shared discussion integration and conflict discoverability are being repaired; H7 and affected discussion/focus/peer assertions require fresh exact-revision checks afterward.

The H7 integration passed focused backend/UI checks and separate technical review. Its initial real-browser rerun verified visible dispositions, persisted reaction/unread/mute state, and copied-link return to the exact expanded thread with keyboard focus. The rerun then exposed an R25 boundary regression: selecting a portaled thread-menu action saves correctly but collapses the expanded comparison because the editor treats that portal as an outside click. That repair must preserve owned menu context and real outside dismissal; static menu tests do not replace the required desktop/compact rerun. Full acceptance remains open.

The portal boundary repair passed desktop and compact menu actions while preserving expanded context, plus 125 independently rerun component tests. The same compact checkpoint exposed lost filter context: Pending became All across the rail/Sheet remount, while expanded-thread state survived. Preserve kind/status/author filters for the document session across responsive remounts and keep menu controls discoverable without hover at compact/mobile widths (R17/R18/R21). A subsequent plain-route reproduction overlapped live source replacement and crashed; it is confounded development evidence, not a verified production cause or passing filter test. Clean-reload verification is required after the repair is frozen.

Clean frozen H7 retesting now preserves Pending across desktop/compact round trips, Accepted with expanded comparison/replies, and kind/person selections. Compact menu controls are visible without hover; Mark read and Copy link retain expanded context, and repeated explicit deep-link navigation reveals the accepted proposal again. These are bounded local passes, not H8–H18 completion. A separate local PostgreSQL 54001 failure interrupted testing: restarting the same PGlite data directory recovered session and fixtures without auth/schema/data resets. Isolated transaction and module-generation stress did not reproduce the initiating cause; runtime recovery is not a proven fix or full R23 acceptance.

H8 local structural checks passed insertion partial/full cancellation, suffix undo/redo, accepted paragraph split through reload, and rejected paragraph merge through reload. Hard-break presentation fails the unchanged R03/R24/A09 story: Shift+Enter shows empty Add quotes, then raw `<br>` inline after save/reload, although acceptance produces the intended rendered break. The presentation boundary requires repair and fresh structural rerun; H8 is not passed.

The r8 structural repair passed 239 focused tests and Content typecheck. Clean live retest shows readable hard-break Add/Delete markers, correctly placed draft cards, rejected insertion preserving the existing break, accepted break deletion through reload, and a newly accepted text block through reload. Independent source review remains underway; remaining H8 variants and full responsive flow are not implied. H9 then exposed overbroad formatting review scope: selecting only Echo and clicking Bold produces a whole-page highlight/summary before and after reload, although accepting it makes only Echo bold and preserves other paragraphs. The visible toolbar also lacks the promised Underline control. Diagnose and repair these under A01/H9 without weakening the frozen story.

Independent r8 review found a P1 under unchanged R03: normalizing hard-break quote/context without converting raw NFM anchor offsets can resolve repeated content to the wrong occurrence (sixth expected, thirteenth observed in a periodic fixture). The passing simple screenshots do not cover this; coordinate-space repair and repeated mixed-content regression are required before H8 can pass. H9 diagnosis separately confirms a whole-document formatting shortcut and missing Underline toolbar reachability; localized, supported-format proposal scope is required, not a full-page fallback.

The r9 coordinate repair passes the original periodic case and a real twenty-line hard-break fixture: sixth-line replacement stays beside that line through save/reload, and accepting changes only that line through reload. Independent re-review still finds an R03/P1: stale repeated-anchor fallback can choose a wrong occurrence using a weak partial-context score. Strict suggestion matching must require trusted current-source mapping or sufficient context, not merely a unique numerical winner. Repair continues before H9's scoped supported-format proposal work; H8 remains incomplete.

The strict-context follow-up now passes independent technical re-review and 110 focused tests: the periodic target stays correct and the stale split-context case returns unavailable. Ordinary comment matching is unchanged. Both technical anchor findings are closed on the recorded hashes; final combined-source structural and responsive UI checks remain open. H9 repair now covers minimal parsed-mark operations, actual styled comparisons, visible link destinations and localized Underline reachability; these additions still require their final technical gate and root UI execution.

H9's additional mixed-session technical regression found that the existing raw-text diff can separate formatting delimiters when text and marks change together. Formatting-only tests do not cover this reachable path. The same exact-edit contract requires scoped, valid mixed operations or explicit recoverable refusal, without a render crash, discarded draft, silently swallowed typing or whole-document replacement fallback. This remains part of the active repair gate before the next browser run.

The first H9 live Bold rerun now passes scoped draft/save/reload/acceptance, with a styled word-only comparison and unchanged neighboring text. Independent review still blocks the formatting repair: marked-but-unverified source silently reaches raw diff, and unsupported non-text leaf nodes can disappear from comparison text. Those require safe lifecycle refusal/recovery and honest escaped fallback text. A separate Reject-click symptom recovered with a native pointer after intervening hot reload; its cause remains unproven and does not justify a speculative rejection-code change. The final frozen-source H9 flow is still required.

## Summary

Add **Suggested Edits** to Agent-Native Content with behavioral parity to Notion's observed feature: a commenter, editor, admin, owner, or authorized agent can propose page-body text changes without changing the canonical page; reviewers inspect each proposal in place, discuss it, and accept or reject it durably. The first shipped slice deliberately matches Notion's narrow page-body boundary rather than prematurely implementing Content's broader typed-diff roadmap.

The implementation should extend Core's existing review domain with executable suggestions and let Content register the document-specific operation and renderer adapter. Content owns page semantics, supported blocks, editor mode, and canonical mutation. Core owns proposal identity, thread/disposition lifecycle, permissions integration, notifications, audit/history seams, and shared actions. Suggestions are not comments with overloaded metadata, recovery versions, raw Yjs updates, or draft copies of pages.

## 2026-09-03 return-to-shape: in-place review repair

Human QA of PR #4274 at `c820218ee5e811c0328d68e16085a0b1bcce2fc1` proved that the staged interface does not satisfy this artifact's already-frozen parity contract. While Suggesting is active, edits render as ordinary canonical-looking content and the Comments rail reports no proposal. Stopping Suggesting replaces the draft with canonical content, then creates one detached whole-session markdown diff. Pending changes have no marker in the Page after submission or reload, raw markdown leaks into the review card, and the tablet/mobile review modal obscures the Page. Accept, reject, and persistence work, but only after the reviewer discovers and reconstructs the detached proposal.

The firsthand Notion reference keeps every pending change visibly anchored in the ordinary document. Insertions, replacements, formatting, and new blocks have inline treatment and per-location counts; activating an anchor opens the exact suggestion thread with author, time, discussion, and Accept/Reject beside the affected material. The repair therefore restores the existing contract rather than adding optional polish.

## 2026-09-04 return-to-shape: calm Notion-parity interaction repair

Human QA of PR #4274 after the r3 repair, recorded at
`https://clips.agent-native.com/r/HQTpXgtD7rxX`, proves that the implementation
still fails the parity contract. The author can now see some provisional edits,
but deletions can jump to the start of the Page, the page-actions trigger keeps a
stuck focus treatment, ending Suggesting opens Comments, and activating an inline
change does not reliably expose a usable discussion and decision surface. The
rail renders suggestions as a separate custom card family and offers no way to
hide them when the user wants ordinary comments only.

The desired interaction is the observed Notion behavior: Suggesting is a quiet,
explicit toolbar mode with an adjacent close action; additions are blue;
deletions recede in gray with strikethrough until hover; exiting the mode does not
move the viewport or open a panel; and each selected suggestion behaves like a
normal anchored comment thread with replies and Accept/Reject. The Comments view
can include suggestions, exclude them, or show them alone without introducing a
second discussion system.

### Root causes in the current implementation

- `suggestionAnchorRange` reconstructs empty-range deletion positions from
  independently searched prefix/suffix strings and falls back to ProseMirror
  position `1`. That fallback converts an unresolved location into a plausible
  top-of-document location.
- Draft operations are recomputed from whole-document Markdown after every
  change. The derived deletion has no stable ProseMirror bookmark, so the
  renderer tries to rediscover a position after the deleted text is already gone.
- `handleSuggestionModeChange(false)` persists the session and then explicitly
  selects the first suggestion and opens Comments. Mode exit and review
  navigation are incorrectly coupled.
- Suggestion activation updates selection and scroll state, but the desktop
  suggestion cards are not integrated into the existing anchored comment layout.
  A click can therefore select an ID without presenting the expected adjacent
  thread.
- `CommentsSidebar` duplicates suggestion-card markup in inline and history
  modes and nests a headerless `ReviewThreadPanel` inside it. That parallel
  presentation bypasses the established comment card hierarchy, replies, and
  filtering vocabulary.
- The active style uses an outline and destructive red treatment. That conflicts
  with the requested calm gray-deletion/blue-addition visual language and makes
  transient selection look like a persistent focus defect.

### Implementation plan

#### 1. Make suggestion locations structural and fail closed

- Replace the UI's Markdown diff loop with a ProseMirror suggestion-capture
  plugin backed by the existing `suggestions/model.ts` and `controller.ts`.
  Capture insert, delete, replace, supported mark, and supported text-block
  operations from transactions before the document loses the original range.
- Give every local operation a stable local ID and mapped ProseMirror bookmark.
  Coalesce only adjacent keystrokes of the same operation kind; never merge
  unrelated ranges merely because they happened in one Suggesting session.
- Persist the operation's typed before/after material and contextual anchor at
  the edit boundary. Swap the local ID for the returned durable suggestion ID
  without replacing the decoration or losing focus.
- For reloaded suggestions, resolve exact text plus bounded prefix and suffix as
  one ordered context match. Zero or multiple matches produce an explicit
  orphaned/stale presentation in the rail; delete the `{ from: 1, to: 1 }`
  fallback. An unresolved proposal must never appear at a believable wrong
  location.
- Keep `contentRevision` and `onBaseAwareReconcile` from current `main` active on
  the canonical editor. Suggesting remains isolated from canonical autosave and
  Yjs, while external canonical movement invalidates or explicitly rebases local
  operations instead of silently shifting them.

#### 2. Make Suggesting a calm editor mode

- Replace the single secondary button with the compact observed control: pencil
  icon plus **Suggesting**, followed by a separately focusable X with tooltip and
  accessible name. The X changes authoring mode only.
- Entering from the page-actions menu must close the menu and return focus to the
  editor. Remove persistent trigger highlighting that represents neither an open
  menu nor keyboard focus; retain standards-compliant `focus-visible` treatment.
- Exiting Suggesting must not open Comments, select the first proposal, scroll,
  or alter the current utility panel. Pending and failed writes remain visible in
  place; failures expose retry without pretending the proposal exists durably.
- Render additions with the existing blue semantic accent. Render deletions as
  muted gray strikethrough at rest, removing the strike and increasing contrast
  on hover/focus so the text can be read. Use shape/line treatment in addition to
  color and remove the persistent black/blue outline from active suggestions.

#### 3. Use one anchored thread presentation for comments and suggestions

- Extract the existing comment card's header, body, reply sequence, composer,
  reactions, overflow menu, focus behavior, and anchored layout into a shared
  thread shell. Ordinary comments keep their current behavior and identity.
- Add a suggestion-thread content adapter to that shell. It supplies typed
  before/after material and pending Accept/Reject actions, then uses the same
  chronological replies, mentions, reactions, unread/mute/deep-link controls,
  spacing, and focus semantics as a normal comment.
- Remove both duplicated custom suggestion-card render loops and the nested
  headerless `ReviewThreadPanel`. A selected inline suggestion should open or
  focus its exact adjacent thread; selecting the thread should focus and center
  the exact inline anchor. Orphaned suggestions remain reviewable in a clearly
  labeled unanchored section without fabricating a document location.
- Keep decisions operation-specific and idempotent. During a pending decision,
  disable only that suggestion's controls. On success, update the canonical
  editor and thread status optimistically, reconcile from the action result, and
  restore focus to the affected material. On stale/conflict failure, preserve
  the thread and show the typed failure.

#### 4. Add a real Comments content filter

- Add a compact content-type filter with **All**, **Comments**, and
  **Suggestions** to the existing Comments filter menu. Compose it with the
  existing status and author filters rather than creating a second sidebar mode.
- Apply the filter consistently to anchored desktop cards, narrow sequential
  cards, empty states, and All discussions history. Filtering suggestions out
  must not remove their editor decorations or mutate their state.
- Persist the filter only if the ordinary Comments surface already persists
  comparable view preferences; otherwise keep it local to avoid creating a new
  settings contract for this repair.

#### 5. Lock the behavior with focused proof

- Unit-test transaction capture, keystroke coalescing, stable ID handoff,
  deletion bookmarks, ordered-context reload resolution, and explicit
  unresolved/ambiguous outcomes. Add a regression proving no path returns
  position `1` after failed resolution.
- Component-test menu focus restoration, independent X behavior, mode exit with
  every utility-panel state, visual class/state contracts, inline-to-thread and
  thread-to-inline focus, per-thread pending decisions, and content-type filters.
- Preserve and extend action/database tests for permissions, canonical
  isolation, idempotent decisions, stale bases, SQL/Yjs fencing, history, and
  cross-client convergence.
- Run formatter, Content/Core focused suites, typecheck, i18n guards, repository
  guards, and `pnpm test:content-product-impact`.
- Human-QA the exact head in the real Content editor at desktop and narrow
  widths, using a fresh uniquely marked disposable Page. Compare against the
  referenced Notion interactions for enter/edit/hover/exit/review/filter flows.
  A second authenticated client verifies that pending edits do not change
  canonical content and that accepted edits converge without reload. Record
  visible latency in coarse honest bands and clean the fixture with independent
  absence proof.

### Sequencing and ownership

1. **Editor semantics:** transaction capture, structural anchors, persistence
   handoff, and canonical/base-aware isolation.
2. **Interaction shell:** toolbar mode, exit behavior, focus restoration, and
   calm addition/deletion styling.
3. **Unified discussion:** shared thread shell, bidirectional anchoring,
   operation-scoped decisions, and orphan/stale fallback.
4. **Filtering and accessibility:** content-type filter, narrow layout,
   keyboard, screen-reader, and focus-return behavior.
5. **Proof and PR reconciliation:** automated suites, exact-head human QA,
   cleanup, product-impact declaration, and PR description/evidence refresh.

The first four steps are one coherent repair: shipping only the anchor fix would
leave the unusable parallel review model intact, while shipping only the thread
restyle would preserve data that can point at the wrong text.

### Explicit exclusions retained

- No title, Property, database, media, embed, local-file, or provider-owned
  suggestions.
- No Accept all/Reject all, dependency-aware bulk review, AI summary, or general
  typed-change graph.
- No new discussion store, REST route, permanent review dashboard, or canonical
  mutation path.
- No claim that all of Content Feature 7 is available. This remains the
  supported Page-body slice.

### Bound repair

1. **Capture semantic operations, not one markdown session diff.** The suggesting editor must translate supported ProseMirror transactions into typed Add/Delete/Replace/Add block/Set mark operations with stable operation and thread identity. Keystrokes that form one continuous edit may coalesce, but distinct ranges and operation kinds remain independently reviewable. `markdownSuggestionOperation(base, finalDraft)` may remain a compatibility/test helper; it cannot be the UI's primary capture boundary.
2. **Render one pending overlay in the ordinary editor.** Canonical Markdown/Yjs remains unchanged, while the editor projects canonical content plus local and durable pending operations. Insertions and marks receive visible non-color-only treatment; deletions remain readable with deletion treatment. Block markers/counts and keyboard-focusable anchors open the existing review rail at the matching thread.
3. **Persist without a disappearing-submit transition.** A completed semantic operation becomes a pending suggestion at a clear edit boundary and remains inline through mode exit, reload, and another authorized viewer. Exiting Suggesting changes authoring mode only; it does not submit an invisible batch or make proposed material vanish. Pending-save and failed-save states are explicit, and a failed proposal write cannot masquerade as a durable suggestion.
4. **Review the affected material, not serialized markdown.** The rail renders typed before/after content through the Content renderer, preserves formatting, identifies operation kind/author/time/status, and supports independent Accept/Reject where operations are compatible. Selecting a rail item focuses its Page anchor; selecting an anchor opens its rail item. Historical or stale operations retain an honest contextual fallback.
5. **Preserve context at narrow widths.** The narrow review surface may use a sheet, but it must provide the affected before/after material and a reliable return-to-anchor path. On widths that can support split review, the Page and decision surface remain simultaneously readable.

### Smallest implementation sequence

- Wire the existing typed suggestion model/controller into `VisualEditor` through a ProseMirror plugin that captures supported transactions and supplies decorations/markers. Delete the parallel plain-markdown draft as the source of suggestion semantics.
- Extend the existing Core suggestion aggregate only as needed for multiple stable operations and per-operation thread/decision identity; do not create a second Content-only persistence system.
- Hydrate durable pending operations through `useResourceSuggestions`, resolve their anchors against the canonical document, and render the same overlay used for local operations. Local operations transition to their returned durable IDs without visual replacement or focus loss.
- Replace the Comments rail's `operations[0]`/plain-text rendering with typed operation rows connected bidirectionally to editor anchors. Reuse existing review replies, reactions, unread, mute, deep links, and dispositions.
- Keep the already-shaped prepare/commit/publish acceptance path for canonical application. This repair changes proposal composition and presentation, not transaction ownership, access enforcement, or the SQL/Yjs authority boundary.

### Explicit exclusions for this repair

- No Property, database cell/schema, title, icon, cover, media, embed, local-file, or source-owned suggestions.
- No Accept all/Reject all, filtered-set review, AI summaries, or general change-graph work.
- No separate diff page, permanent review dashboard, duplicate discussion store, or canonical Yjs mutation while a suggestion is pending.
- No claim of complete Feature 7 availability; this remains the page-body parity slice of `content.revision.suggestions` and `content.diff.in-place`.

### QA evidence

The current exact-head report and screenshots are retained outside the product repository at `/Users/alicemoore/.codex/visualizations/2026/09/03/01a06892-a5f4-77d0-a834-27af7c39c530/suggested-edits-qa/HUMAN-QA.md`. They are task evidence, not intended shipping documentation.

## Human problem and stakes

Today, a Content collaborator can either comment without showing the exact desired edit or directly edit the canonical document. Agents face the same binary choice. Reviewers must translate prose feedback into changes or trust a direct rewrite after the fact.

After this feature, a collaborator can make the intended revision directly in the familiar editor while the canonical document stays unchanged. The owner can understand the proposed result in context, discuss it, and make an attributable accept/reject decision. This matters most for agent-assisted editing and comment-level collaborators: both can contribute exact changes without receiving direct-edit authority.

## Exact parity boundary

“Parity” means parity with the firsthand Notion behavior observed on 2026-09-01, not parity with every future capability in Content's `Review changes in place` roadmap.

| Behavior         | Content contract                                                                                                                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enter mode       | `•••` page menu exposes **Suggest edits**; active mode is labeled **Suggesting** in the page header.                                                                                                                 |
| Exit mode        | Header control or page menu stops suggesting; pending proposals remain untouched.                                                                                                                                    |
| Permissions      | Owner/admin/editor can edit and suggest. Commenter can suggest and comment but cannot directly edit. Viewer remains read-only. Server actions enforce the same matrix as the UI and agent.                           |
| Add              | Inserted text is provisional and stored as an Add operation.                                                                                                                                                         |
| Delete           | Deleted text remains represented until acceptance and is stored as a Delete operation.                                                                                                                               |
| Replace          | Replacing a selected range is one atomic Replace operation with exact before/after text.                                                                                                                             |
| Formatting       | Supported inline mark changes are typed operations, initially Bold, Italic, Underline, Strikethrough, Code, and Link add/remove/change where the renderer can preserve exact material.                               |
| New text block   | A new supported block is one proposal, even if its internal operation contains a boundary plus content insertion.                                                                                                    |
| Review           | Each suggestion has author, timestamp, typed summary, Accept, Reject, reactions, replies, and a more menu. Decisions apply immediately and idempotently.                                                             |
| History          | Pending, accepted, and rejected suggestions remain visible in **All discussions**. Resolution removes decision controls but not the thread.                                                                          |
| Thread tools     | Mark unread, copy deep link, and mute replies are available for suggestion threads.                                                                                                                                  |
| Notifications    | Page owner/relevant participants receive the existing durable notification flow for new suggestions, replies, mentions, reactions where policy calls for it, and dispositions.                                       |
| Agent parity     | Agents create the same suggestion objects through shared actions; they do not directly mutate canonical content while operating in suggestion mode.                                                                  |
| Locking          | A locked/read-only page disables suggestion creation even if the role would otherwise permit it. Existing proposals remain readable according to access.                                                             |
| Scope exclusions | No title, icon, cover, database property, inline database, media/embed, local-file, source-owned, or peek/preview suggestion editing in the first release. Unsupported content remains read-only in suggesting mode. |
| Bulk decisions   | No Accept all / Reject all in parity v1. Content's future filtered-review capability remains separate.                                                                                                               |

One intentional correction to Notion's observed UI: a block badge reports suggestions and replies separately instead of inflating “suggestions” when someone replies.

## Architecture grounding and fit

### Demonstrated caller

The demonstrated caller is an authenticated Content user or accountable agent opening a canonical Content Page and requesting “Suggest edits,” then proposing a supported body change for later review.

### Existing primitives and seams

- `templates/content/app/components/editor/VisualEditor.tsx` is the TipTap/ProseMirror editing surface and already participates in Yjs collaboration.
- `templates/content/server/plugins/collab.ts` and Core's collaboration substrate already synchronize human and agent changes, cursor state, and editor reconciliation.
- Content already exposes Page access as `canComment` and `canEdit`; Core sharing already has viewer/commenter/editor/admin/owner role ordering.
- Content's comments already provide text anchors, replies, mentions, resolution, and a comments rail.
- `packages/core/src/review` already owns reusable access-scoped review comments, threads, mentions, notifications, and review status actions.
- `packages/core/src/history` and automatic action audit provide reusable version/history and actor attribution donors.
- The approved Content records `content.diff.in-place`, `content.diff.filtered-review`, `content.diff.ai-assist`, `content.version.field-history`, and feature 7 already define the broader destination.

### Ownership boundaries

- **Core review domain:** stable suggestion/change/thread/decision types, stores, access-scoped list/create/reply/react/mute/unread/decide actions, idempotency, durable attribution, and notification hooks.
- **Content domain:** supported page-body operation grammar, document access/lock/source checks, base revision calculation, canonical apply transaction, comment-rail integration, and editor rendering.
- **TipTap editor:** ephemeral composition and provisional visual presentation. It is not the durable source of suggestion truth.
- **Yjs collaboration:** transports live canonical editor state and presence. Pending suggestions must not be written into the canonical Y.Doc as if accepted.
- **SQL:** owns durable suggestions, operations, thread state, dispositions, and canonical Content. Large editor snapshots or Yjs blobs are not copied into suggestion rows.
- **Audit/history:** records actual proposal and decision actions. A pending suggestion is not a committed Content revision; acceptance creates the canonical mutation and its normal history/audit record.

### Return-to-shape decision: canonical mutation coordination

The first implementation pass exposed one material architecture gap: suggestion acceptance can update canonical SQL and version history inside the suggestion transaction, but Core's current Yjs writer independently owns its document lock, persistence CAS, cache mutation, and broadcast. Calling that writer before the suggestion transaction commits can leak a rolled-back edit; calling it afterward leaves a committed SQL change vulnerable to an already-open client flushing stale cached Yjs state. Direct SQL from the adapter also bypasses Content's normal mutation side effects.

The compatible boundary is a **prepare / commit / publish canonical mutation coordinator**, not a suggestion-specific second write path:

1. Core collaboration provides a document-scoped mutation lease. It serializes the operation with in-process Yjs writers, loads and merges the latest durable Y.Doc, and prepares the mutation on an isolated clone. Preparation produces the next canonical text, encoded Yjs state/update, and the `_collab_docs.version` fence; it does not mutate the shared cache or emit.
2. Content provides one canonical document-body mutation helper used by both ordinary full-body saves and accepted suggestions. Given an existing database transaction and the prepared collaboration mutation, it re-resolves resource eligibility, verifies the immutable proposal base plus exact before/context against the current body, performs the document CAS, persists Blocks-field identity and the prepared `_collab_docs` state with its version fence, creates the ordinary document version/history effects, and records a durable resource-scoped sync event.
3. Core suggestion decision remains the transaction owner for acceptance. The adapter's decision coordinator acquires the document lease outside that transaction, then the existing decision transaction invokes the Content helper so suggestion disposition, decision row, canonical body, version/history, durable Yjs state, and sync event commit or roll back together.
4. After a successful commit, the lease publishes the prepared Y.Doc into the process cache and emits the minimal collaboration update. After rollback it discards the clone. If the process dies after commit but before broadcast, the durable Yjs row and sync event cause connected clients or polling/reconnect to converge; network delivery itself is not represented as transactional.
5. Cross-process safety is enforced by both the Content document CAS and `_collab_docs.version` fence. Either conflict becomes an explicit stale/retry outcome; no layer may coerce it into accepted success. A connected client based on an older Yjs version must merge/reload the committed state before its next durable write.

This coordinator is a Core collaboration primitive because locking, cached Y.Doc lifecycle, version fencing, and broadcast are framework concerns. The canonical document mutation helper is Content-owned because Markdown/Blocks reconciliation, source/database exclusions, version policy, access, and mutation history are Content semantics. The generic suggestion registry gains only the lifecycle hook needed to wrap its existing transaction in an adapter-provided decision coordinator; it does not learn Content or Yjs details.

The proposal revision token is immutable and continues to identify the exact `documents.updatedAt` observed at creation. Acceptance does not require the Page to remain globally unchanged: the Content adapter may safely rebase only when the exact before material plus bounded contextual anchor resolves uniquely against the current canonical body. The current body revision and `_collab_docs.version` are separate execution-time fences. Ambiguous, missing, multiply matched, or structurally incompatible material produces `stale`; it never silently broadens to whole-string replacement.

### Smallest compatible delta

Extend the existing Core review seam with a generic executable-suggestion lifecycle and registered resource adapter, plus the narrow decision-coordination hook required to join an adapter-owned mutation lease to Core's decision transaction. Add the Core prepare/commit/publish Yjs lease and a Content canonical body-mutation helper shared by ordinary saves and suggestion acceptance. Implement only Content document-body text and inline-mark operations first. Reuse the existing Content comments rail presentation through one review controller rather than creating a second discussion system.

Do not begin with the generic cross-object typed graph promised by feature 7. The first slice establishes the stable lifecycle and Content adapter that the broader graph can later extend without changing user-visible semantics.

### Legacy contracts that remain unchanged

- Direct editor changes by editor/admin/owner continue to update the canonical document normally.
- Ordinary comments retain their current identities, anchors, reply/resolve behavior, and Notion comment synchronization.
- Existing whole-document versions remain recovery snapshots; they are not reclassified as suggestions.
- SQL remains canonical for Content body; Yjs remains the live collaboration transport and reconciliation layer.
- Local-file and externally source-owned pages retain their current authority and synchronization rules.
- Existing sharing role names stay fixed; only commenter capability copy changes to truthfully include suggesting for Content resources.

### Evidence classification

Direct evidence comes from the verified Notion interaction memo and screenshots, Content schema/actions/editor code, Core review/history/sharing code, and approved Content product records. The proposed Core adapter shape is an architectural inference from those seams. No unresolved domain-owner question changes the public contract; storage details and ProseMirror decoration technique remain implementation choices.

## Durable model

Add a Core-owned suggestion aggregate with append-only decisions:

- `review_suggestions`: id, resource type/id, adapter kind/version, thread id, author/actor/run context, base revision token, status (`pending`, `accepted`, `rejected`, `stale`, `superseded`), summary, timestamps, access scope, and metadata.
- `review_suggestion_operations`: stable operation id, suggestion id, ordinal, operation kind, field/target identity, before/after payload, anchor/context, dependencies, and payload schema version.
- `review_suggestion_decisions`: stable idempotency key, suggestion id, reviewer, decision, observed base, outcome, failure/conflict detail, and timestamp.
- Reuse Core review comments/threads for replies, mentions, reactions, resolution, mute, unread, and deep links; link the thread to the suggestion ID explicitly.

For Content v1, the operation grammar is `insert_text`, `delete_text`, `replace_text`, `add_text_block`, and `set_inline_mark`. Each operation records the affected Blocks field, ProseMirror-compatible range/shape, exact before/after material, surrounding anchor context, and a base digest. The durable payload is typed JSON, not serialized ProseMirror transactions or Yjs client updates.

Suggestion creation validates that all operations are supported, belong to one Page body, and match the observed base. It does not mutate `documents.content` or create a document version.

Acceptance runs under one document mutation lease and one Core-owned decision transaction: re-resolve access, feature flag, source link, database membership, and lock state; load the latest durable Y.Doc and current body; verify or uniquely rebase the exact operation; prepare the isolated Yjs mutation; apply it through Content's canonical body-mutation helper; CAS `documents.content` and `updatedAt`; persist the fenced Yjs state, Blocks-field identity, ordinary Content version/history effects, accepted decision, and durable sync event; then publish the cache/update only after commit. If any transactional step fails, neither canonical content, durable Yjs state, history, sync event, nor disposition commits. Reject appends only the decision/disposition and leaves canonical content unchanged.

## Interaction design

The mode should feel like Content, not like a separate diff application:

1. The ordinary page editor stays in place. Unsupported page controls and blocks become non-editable while suggesting.
2. Provisional additions and formatting render inline; deletions remain visible with subdued strike treatment. Semantic tokens distinguish proposed material without relying on color alone.
3. A compact numbered marker aligns to each affected block. Selecting it opens the existing right utility rail on the exact suggestion thread.
4. The rail shows a typed operation summary first, then Accept/Reject for authorized reviewers, replies/reactions, and thread controls. It distinguishes counts for edits and replies.
5. **All discussions** filters ordinary comments and suggestion threads by Pending, Accepted, Rejected, and Resolved without hiding historical decisions.
6. Deep links reopen the Page, scroll to the current or historical anchor, and focus the thread. If the anchor is stale or deleted, the rail shows the retained before/after material and honest stale state.
7. Keyboard users can enter/exit suggesting, traverse markers, inspect before/after text, decide, reply, and return focus to the editor. Screen readers receive operation kind, before/after material, author, status, and affected block context.

No explanatory banner, duplicate page heading, or permanent review dashboard is added. Suggesting state lives in the header and contextual rail.

## Action surface

Core/shared actions:

- `create-resource-suggestion`
- `list-resource-suggestions`
- `get-resource-suggestion`
- `decide-resource-suggestion`
- `reply-review-comment` / existing thread actions
- `react-to-review-comment`, `set-review-thread-unread`, and `set-review-thread-muted` where missing

Content registers a `document` suggestion adapter that implements `validateProposal`, `preview`, `apply`, `resolveAnchor`, and `describeOperation`. UI calls the same actions through `useActionQuery`/`useActionMutation`; agent tools expose the identical schemas. Direct agent edits remain available when authorized, but an explicit “suggest” request must use suggestion actions and return suggestion IDs/deep links rather than claim the Page changed.

## Delivery plan

### Slice 1 — lifecycle and permissions

Add the Core suggestion types/store/registry/actions and decision-coordination hook; the Core prepare/commit/publish Yjs mutation lease; the shared Content canonical body-mutation helper; Content adapter registration; default-off `content-suggested-edits` flag; transaction-time role/lock/source/database enforcement; idempotent accept/reject; normal Content history/audit/sync effects; and focused database/collaboration tests. This slice may use fixture operations before editor composition exists.

### Slice 2 — editor composition and in-place rendering

Add Suggesting mode to `VisualEditor`, operation capture for supported text/mark changes, provisional decorations, block markers, header/menu entry/exit, pending persistence, reload restoration, and narrow/keyboard/accessibility states. Prevent pending material from entering canonical autosave/Yjs reconciliation.

### Slice 3 — discussion and history parity

Unify suggestion threads with the Content comments rail; add replies, mentions, reactions, unread, mute, deep links, pending/accepted/rejected history filters, notifications, and honest orphan/stale presentation.

### Slice 4 — agent parity and rollout proof

Teach Content's agent instructions/actions to propose rather than directly edit when asked, expose inspection links, group a run's related suggestions without bulk-deciding them, verify live cross-client updates, and dogfood behind the flag before wider rollout.

### Deferred beyond parity v1

- Titles, Properties, database cells/schema, media, embeds, and arbitrary registry blocks.
- Accept/reject all, filtered bulk review, dependency-safe sets, and agent-generated review summaries.
- Named Versions, cross-Version merge, general typed change graphs, code review, and external-provider suggestion synchronization.
- Local-file suggestions and offline portable suggestion representation.

These are plausible extensions of the stable lifecycle, not requirements for Notion parity.

## Risks and controls

- **Canonical leakage:** pending edits accidentally autosave or enter Yjs. Control with a separate suggestion editor transaction filter/state and tests that canonical Markdown/Y.Doc/drafts remain byte-identical until acceptance.
- **Split-brain acceptance:** SQL commits while a cached Y.Doc still contains the old body, allowing a connected client to overwrite the accepted edit. Control with the document mutation lease, isolated preparation, transactionally persisted fenced Yjs state, post-commit cache publication, and a two-client stale-flush test.
- **Commit/broadcast crash window:** the process dies after the database commit but before emitting to connected clients. Control by storing a resource-scoped sync event in the same transaction; reconnect/poll reloads durable canonical and Yjs state. Broadcast is an optimization, not the durable proof of mutation.
- **Stale acceptance:** current material changes after proposal. Control with base token plus exact before material and contextual anchor; fail as stale unless the adapter proves a unique safe rebase.
- **Commenter escalation:** proposal or acceptance bypasses role limits. Control at action/adaptor boundaries; commenter may create but only editor/admin/owner may accept/reject unless future policy explicitly changes.
- **Dual discussion models:** Content comments and Core review threads drift. Control by adopting the Core controller/store for suggestion threads and incrementally adapting ordinary Content comments rather than creating a third store.
- **History ambiguity:** proposal creation looks like committed content or acceptance bypasses normal document history. Control with distinct proposal/decision events and one shared Content canonical mutation helper; only acceptance emits the same body-version, audit attribution, Blocks-field reconciliation, and sync effects as an ordinary accepted body mutation.
- **External-source corruption:** suggestions apply to source-owned or syncing bodies. Control by excluding local-file, Notion-linked/source-owned conflict states, and other non-local authority in v1.
- **Payload drift:** editor schema evolves. Control with versioned operation payloads and adapter-owned migration/degraded rendering.

## Acceptance story

The acceptance interface is the real Content Page editor in a deployed beta surface with two authenticated test users (commenter and editor) plus an accountable agent run. Independence is preferred and custody may remain in the same context because the interaction is consequential but reversible, while technical review and automated invariants cover the persistence and authorization risk.

Required assertions:

1. A commenter enters Suggesting, creates Add/Delete/Replace/new-text-block/format suggestions, exits and reloads, and the canonical document and another viewer's canonical rendering remain unchanged.
2. An editor sees inline markers, exact before/after material, author/time, replies/reactions, and independently accepts one suggestion and rejects another; only the accepted operation changes canonical Content.
3. Accepted and rejected threads remain discoverable in All discussions with durable actor, time, decision, replies, reactions, and working deep links.
4. Viewer creation and commenter acceptance are denied identically through UI and actions; lock/source/unsupported-block constraints fail closed without partial state.
5. An agent asked to suggest creates inspectable pending suggestions through the same actions and does not directly modify canonical content.
6. Concurrent canonical editing produces either a uniquely proven contextual rebase or an explicit stale/conflict state; the immutable proposal base, current document CAS, and current Yjs version fence are independently enforced, and no no-op is reported as accepted.
7. Retry of create/accept/reject is idempotent; failures injected before SQL commit, during Yjs-state persistence, and after commit but before live broadcast leave canonical content, durable Yjs state, ordinary Content history, sync event, and suggestion disposition mutually consistent or durably convergent as specified.
8. With two open clients, acceptance updates the accepting client and the peer without a reload; a peer holding the pre-accept Yjs state cannot flush it over the accepted body. Proposal, reply, reaction, and disposition updates use shared sync without extra EventSource connections or editor jitter.
9. Keyboard and screen-reader workflows can enter/exit mode, identify operation types and before/after material, traverse suggestions, decide, reply, and restore focus.
10. With the feature flag Off, current editing, comments, sharing, history, agent direct-edit behavior, local files, and source sync remain unchanged.

Automated coverage is required for model/store/action/permission/idempotency/stale/persistence/canonical-isolation behavior, including transaction rollback, cross-process CAS, post-commit broadcast failure, and stale connected-client flush. Real-interface evidence is required for the complete editor workflow at desktop and narrow widths with two simultaneous clients. A proportional independent technical review is required for the Core review boundary, transaction ownership, permission checks, and Yjs/canonical isolation.

## Historical r4 architecture fingerprint (superseded by r5 above)

```yaml
stage: shape
authority-source: "User invoked $shape on 2026-09-04 after the second human QA pass of PR #4274 and requested an implementation plan against latest main."
authorized-scope:
  repositories:
    - /Users/alicemoore/.codex/worktrees/5438/agent-native
  product-surfaces:
    - Agent-Native Content page editor
    - Agent-Native Core review substrate
  outcome: Notion-parity Suggested Edits for supported Content page-body text and inline formatting
allowed-mutations:
  - artifact-write
write-targets:
  artifacts:
    - templates/content/docs/solutions/2026-09-02-content-suggested-edits-parity-shape.md
governing-artifact:
  path: templates/content/docs/solutions/2026-09-02-content-suggested-edits-parity-shape.md
  revision: content-suggested-edits-shape-r4
architecture-fingerprint:
  outcome: Commenters, editors, and agents can propose supported page-body edits without changing canonical Content until an authorized reviewer accepts them.
  shipping-surfaces:
    - id: agent-native-content-template
      repository: agent-native
      product-surface: templates/content deployed application
      constituency: authenticated Content page collaborators and accountable agents
      durable-destination: agent-native repository main plus deployed Content beta/production surfaces
      integration-action: merge
    - id: agent-native-core-packages
      repository: agent-native
      product-surface: Core review/action/client packages consumed by templates
      constituency: Agent-Native app developers and review-capable applications
      durable-destination: agent-native repository main and publishable Core package release
      integration-action: merge
  governing-architecture: Core owns the reusable executable-suggestion lifecycle plus a prepare/commit/publish Yjs mutation lease; Content owns one canonical document-body mutation helper shared by ordinary saves and suggestion acceptance; the suggestion decision transaction atomically commits disposition, canonical SQL, history, fenced durable Yjs state, and a sync event before cache publication or broadcast.
  acceptance-story:
    id: content-suggested-edits-parity-v1
    summary: A commenter or agent proposes supported edits in the ordinary Content editor; an authorized editor discusses and decides each proposal; only accepted material reaches canonical Content and every state remains attributable and recoverable.
    required-assertions:
      - proposal creation preserves canonical content
      - Suggesting uses a compact labeled mode control with an independent accessible exit action
      - entering from page actions restores focus without leaving the trigger visually stuck
      - each supported semantic edit is visibly distinguished and independently anchored while authoring and after persistence or reload
      - unresolved or ambiguous anchors are explicit and never rendered at a plausible fallback location
      - additions use blue provisional treatment and deletions use readable gray strikethrough that clarifies on hover and focus
      - exiting Suggesting changes authoring mode without removing pending material, opening Comments, scrolling, or changing the utility panel
      - typed review renders exact before and after material without exposing serialized markdown syntax
      - suggestions use the ordinary anchored comment-thread interaction with chronological replies and per-thread decisions
      - Comments can show all discussion, ordinary comments only, or suggestions only without mutating editor state
      - selective accept/reject applies exactly the decided operation
      - discussion and resolved history persist with deep links
      - UI, agent, and action permission parity fails closed
      - stale/concurrent edits never overwrite newer content
      - retries, persistence failures, and commit-to-broadcast crashes remain atomic, idempotent, or durably convergent according to the transaction boundary
      - a connected client holding pre-accept Yjs state cannot overwrite accepted content
      - cross-client sync and accessibility work through the real editor
      - flag-off legacy behavior remains unchanged
    acceptance-policy:
      modality: real-interface
      independence: preferred
      custody: same-context-allowed
      interface: deployed Content beta Page editor with commenter/editor users and an accountable agent run
      rationale: The user-visible workflow requires real editor proof; reversible review actions permit same-context custody while authorization and canonical-isolation seams receive independent technical review.
  risk-strategy:
    kind: feature-flagged
    production-validation-after-merge: true
    rationale: The repair crosses shared review persistence and collaborative SQL/Yjs mutation seams, so the existing default-off flag remains necessary for beta dogfooding and post-merge cross-client validation before ordinary-user enablement.
architecture-grounding:
  applicability: required
  reason: The feature crosses shared review, permissions, history, action, collaboration, and Content domain boundaries.
  status: grounded
  demonstrated-callers:
    - Content Page collaborator or accountable agent requesting Suggest edits
  existing-primitives:
    - Core review comments/threads/notifications/status
    - Core sharing roles and action audit
    - Core history/version donor
    - Content TipTap/Yjs editor and comments rail
    - Content document access/actions/version snapshots
  ownership-boundaries:
    - Core owns reusable suggestion lifecycle and shared actions
    - Content owns document operation semantics and canonical application
    - SQL owns durable truth; Yjs owns live collaborative transport
  legacy-contracts:
    - direct editing, comments, versions, sharing, local files, source sync, and agent direct edits remain unchanged when suggestion mode is not requested or flag is off
  shared-vocabulary:
    - Suggested Edit
    - Suggesting
    - suggestion operation
    - suggestion thread
    - pending
    - accepted
    - rejected
    - stale
  smallest-compatible-delta: Preserve the existing Core executable-suggestion lifecycle, canonical mutation coordinator, and main's base-aware editor reconciliation; replace whole-session Markdown rediscovery and parallel suggestion cards with typed transaction capture, structural/fail-closed anchors, calm Notion-like mode and decorations, one ordinary anchored thread shell, and composable discussion filtering for the Content page-body slice.
  deferred-capabilities:
    - generic typed Property/Database/media proposals
    - filtered bulk review
    - named Versions and selective cross-Version merge
    - local-file and provider suggestion synchronization
  reversibility: A default-off app-owned feature flag keeps dormant code inactive; suggestion tables are additive; pending proposals never alter canonical content.
  direct-evidence:
    - verified Notion Suggested Edits interaction memo dated 2026-09-01
    - human QA recording HQTpXgtD7rxX dated 2026-09-04
    - origin/main e4364cd716 integrated locally at merge commit 713e8a7c29
    - packages/core/src/review and packages/core/src/history
    - templates/content editor, actions, schema, comments, collaboration plugin
    - Content feature 7 and diff/history/access capability records
  inferences:
    - extending Core review with an adapter registry is the smallest reusable implementation boundary
    - typed JSON operations are more durable than persisted ProseMirror transactions or Yjs updates
    - database commit is the atomic authority while cache publication and network broadcast are post-commit delivery backed by durable sync replay
    - acquiring the document lease outside the decision transaction is necessary to prevent a live Yjs writer from straddling acceptance
  unresolved-owner-questions: []
delegation-ceiling: []
acceptance-state:
  status: blocked
  summary: WORK PAUSED — RETURNING TO SHAPE. PR #4274 remains acceptance-blocked: the second human QA pass shows wrong-location deletions, stuck menu focus, coupled mode-exit navigation, unusable inline activation, a parallel suggestion-card UI, and no comments-only filter.
  evidence:
    - templates/content/docs/solutions/evidence/suggested-edits-accept-reject.png
    - focused Core and Content automated suites
  remaining:
    - typed ProseMirror operation capture with stable structural/fail-closed anchors
    - calm Suggesting control, focus restoration, independent exit, and Notion-like addition/deletion presentation
    - one ordinary anchored thread shell for comments and suggestions with reliable bidirectional focus
    - All, Comments, and Suggestions content filtering across desktop, narrow, and history views
    - commenter/editor role-separated acceptance
    - accountable agent proposal acceptance
    - two-client sync and narrow-width accessibility acceptance
    - independent technical review closure
  blockers:
    - exact-head real-interface QA in HQTpXgtD7rxX failed the anchoring, mode-control, visual treatment, thread interaction, and filtering assertions
  last-land-packet: null
change-record:
  from-revision: content-suggested-edits-shape-r3
  to-revision: content-suggested-edits-shape-r4
  trigger: The second human QA recording proved that r3's partial overlay repair still violates the Notion-parity interaction contract and that latest main adds reconciliation/comment seams the repair must preserve.
  preserved:
    - outcome, shipping surfaces, and supported Page-body parity boundary
    - shipping surfaces and ownership split between Core and Content
    - default-off feature-flag risk strategy
    - prepare/commit/publish canonical mutation coordination
  changed:
    - structural and fail-closed anchor behavior is now explicit, including prohibition of top-of-document fallback
    - mode exit is separated from persistence selection, scrolling, and Comments navigation
    - the visual contract freezes blue additions, gray struck deletions, hover/focus legibility, and no persistent active outline
    - suggestions must use the ordinary anchored comment-thread shell rather than custom nested review cards
    - Comments gains a composable All, Comments, and Suggestions content filter
    - current main's base-aware reconciliation is a preserved implementation seam
ledger-revision: content-suggested-edits-shape-r4
status: shape-complete
```

## Superseded Work envelope

```yaml
stage: shape
authority-source: "The 2026-09-04 QA evidence materially changed the acceptance story and invalidated the prior r3 Work envelope."
ledger-revision: content-suggested-edits-work-r3-1
governing-artifact:
  path: templates/content/docs/solutions/2026-09-02-content-suggested-edits-parity-shape.md
  revision: content-suggested-edits-shape-r3
allowed-mutations:
  - artifact-write
  - ephemeral-test-resource
  - commit
  - push
  - pull-request
write-targets:
  repositories:
    - /Users/alicemoore/.codex/worktrees/5438/agent-native
  artifacts:
    - templates/content/docs/solutions/2026-09-02-content-suggested-edits-parity-shape.md
test-resources:
  - id: content-suggested-edits-r3-page
    kind: record
    surface: local Content SQLite page BI4G0ihYdTeK at http://127.0.0.1:8080
    ownership-marker: title "QA Suggested Edits 2026-09-03 A"
    baseline: task-created disposable page with Alpha, Beta, and Gamma baseline sentences before its first suggestion
    allowed-actions: [update, exercise, delete]
    cleanup-trigger: before Work completion
    cleanup-method: delete the exact page and its suggestion/review/version/collaboration rows through the local Content action or exact database transaction
    cleanup-proof: independently query every affected table for exact page id BI4G0ihYdTeK and observe zero rows
    shared-impact: none
    isolation: local-runtime
    ownership: task-created
    production-data: false
    customer-data: false
    cost: none
    boundary-evidence:
      - unique task marker and exact returned page id
      - local demo-only runtime at 127.0.0.1:8080
    max-lifetime-minutes: 720
    declared-at: 2026-09-03T15:30:00-04:00
    expires-at: 2026-09-04T03:30:00-04:00
    status: active
    phase: work
acceptance-reconciliation: consistent — schema-v3 real-interface, preferred independence, same-context-allowed custody
task-attention: autonomous
status: return-to-shape
invalidation-banner: WORK PAUSED — RETURNING TO SHAPE
```

## Next step

Execute r5 H1–H18 in the owning task, repair failures under the unchanged A/R assertions, mark affected evidence stale and rerun. Record the final exact artifact and every remaining gap in this document. No new Work invocation or independent human tester is required. Full acceptance remains open until the cumulative story, including role/agent/live-peer and deployed evidence boundaries, is demonstrated.
