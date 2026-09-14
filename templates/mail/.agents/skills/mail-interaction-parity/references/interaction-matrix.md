# Mail interaction matrix

This is the working ledger for the side-by-side pass. Each case is intentionally
small enough to run, observe, fix, and re-run. `SH` means the Superhuman
reference sequence; `MAIL` means the corresponding Mail sequence.

## Navigation, focus, and layout

- NAV-001 — Load the root route. SH: confirm the default inbox, active tab,
  counts, search, compose, account state, and first message. MAIL: confirm the
  same landmarks and that no connect banner replaces a known local mailbox.
- NAV-002 — Open each primary view from the visible nav: Inbox, Unread,
  Starred, Snoozed, Sent, Drafts, Archive/Done, Trash, All Mail, Scheduled,
  and labels. Confirm URL, active tab, count source, rows, empty state, and
  back/forward history. An isolated, disconnected browser pass on 2026-09-14
  used sidebar clicks to verify `/mail/unread`, `/mail/starred`,
  `/mail/snoozed`, `/mail/sent`, `/mail/draft-queue`, `/mail/scheduled`,
  `/mail/drafts`, `/mail/archive`, and `/mail/trash`; All Mail was selected
  from Command and landed on `/mail/all`. Important and Other landed on
  `/mail/inbox?tab=important` and `/mail/inbox?tab=other`; Back from Other
  returned to `/mail/all` and Forward restored Other. Draft queue showed 0
  drafts awaiting approval, while Drafts had no rows. The message views showed
  the connect-account state instead of mailbox rows; counts, message/label
  behavior, and connected-account empty states remain unverified. Only the
  built-in Important and Other links appeared under Labels. No paired
  Superhuman replay has been captured.
- NAV-003 — Open hidden navigation with the keyboard and close it with Escape;
  repeat with mouse, touch, outside click, and browser Back.
- NAV-004 — Cycle tabs with Tab and Shift+Tab from the workspace and tab bar.
  Confirm focus ring, wraparound, selected tab, and URL. With multiple Split
  tabs open, verify inputs, recipient suggestions, contenteditable, buttons,
  popovers, and dialogs retain native focus/selection behavior instead of
  switching tabs. Mail's guard is covered by
  `use-keyboard-shortcuts.spec.ts`; paired runtime replay remains required.
- NAV-005 — Open a thread, return with Back/Escape/visible back button, then
  restore the same tab, query, label, selected accounts, and focused row.
- NAV-006 — Open a direct deep link for every view and a thread id. Refresh at
  each URL and confirm the rendered screen, title, error boundary, and state.
- NAV-007 — Resize 1440×900 → 1024×768 → 768×1024 → 390×844 while a list,
  thread, dropdown, snooze modal, and compose are open. Check overflow,
  popover anchoring, focus, and action reachability.
- NAV-008 — Collapse, pin, expand, and unpin the sidebar. Reload and confirm
  the preference persists without changing the mailbox view.
- NAV-009 — Switch one account, multiple accounts, and combined inbox. Confirm
  rows, labels, counts, sender dots, account selector, and mutation targets are
  scoped to the same accounts.
- NAV-010 — Use browser Back/Forward through search, thread, compose fullscreen,
  settings, and draft queue. Confirm no stale optimistic screen remains.
- NAV-011 — Open Important and Other from navigation and their documented
  shortcuts. With synthetic messages, verify partition membership, counts,
  account scope, and how read, Done, archive, and move actions affect each
  partition. Check Back/Forward and refresh after every membership change.
- NAV-012 — Open No Reply from navigation and its documented shortcut. Use
  synthetic sent, unanswered, and later-answered threads to verify membership,
  counts, removal after a reply, and Back/Forward/refresh behavior. Keep this
  surface distinct from reminder scheduling and auto-reminder detection.
- NAV-013 — On mobile, open Command from the inbox pull-down/right-swipe gesture
  and from an open message pull-down; two-finger tap a specific message for
  message-scoped Command. Also test bottom-bar Search, pull-down Search,
  pull-down/left refresh, folder menu, Split cycling by bottom controls and
  horizontal swipe, iOS swipe-right return, and Android Back. Record each
  starting surface, gesture threshold, animation, dismissal, refresh result, and
  focus/scroll restoration. Compare platform-specific reference behavior rather
  than treating gestures as interchangeable.

## Search and search autocomplete

- SEARCH-001 — Open search with `/`, Command/Ctrl+K → Search, click, and mobile
  search. Repeat from body/list focus and while a button, input, editor, or
  compose owns focus. After selecting the palette command, confirm the palette
  closes, Search mounts and receives focus, the caret/placeholder are correct,
  and the underlying route/query is not replaced by an empty search. Type a
  query, submit, dismiss, and reopen by each entry path; record focus, route,
  close behavior, and whether the query is retained. An isolated, disconnected
  browser pass on 2026-09-14 confirmed click and `/` from page focus open and
  focus Search; Cmd+K opens Command from page focus, the To field, the compose
  body, and Search. Selecting `Search emails /` closes Command and focuses
  Search; when compose is open it stays open. A synthetic no-match query showed
  no suggestions, and Escape closed Search and restored the original route;
  reopening showed a blank field. A second synthetic query was reflected in
  `/mail/all?q=local-nav-focus-probe`; Escape from Search returned to the
  original `/mail/inbox?tab=important` route. With the compose body focused,
  `/` inserted a slash and opened the editor's block picker instead of global
  Search. With the Toggle menu button focused, `/` did not open Search. These
  focus-context behaviors need paired Superhuman replay before treating either
  as a parity gap. No mailbox contacts/results were available, and mobile plus
  Superhuman behavior remain unverified.
- SEARCH-002 — Type one character, two characters, three characters, spaces,
  quoted text, unicode, punctuation, and a long query. Confirm debounce,
  local-match timing, remote-search timing, and no request for short queries.
  Mail source audit found contact/local matches start at two trimmed characters
  and automatic navigation to `/all?q=...` starts at three after 400 ms.
  Superhuman's official [Search in Seconds](https://help.superhuman.com/hc/en-us/articles/46005814266253-Search-in-Seconds)
  workflow says to type a query and press Enter. Treat the timing/submit
  difference as a candidate for authenticated paired replay, not a confirmed
  discrepancy; the disconnected runtime had no mailbox results.
- SEARCH-003 — Navigate contact suggestions with ArrowDown/ArrowUp, Home/End
  if supported, Enter, mouse hover, mouse click, and Tab. Confirm the selected
  result is the one opened and focus/URL are correct.
- SEARCH-004 — Navigate local thread suggestions after contacts. Confirm the
  selected local item scrolls into view and does not reuse a contact index.
- SEARCH-005 — Search with `from:`, `to:`, `subject:`, `has:attachment`,
  `label:`, `is:unread`, date ranges, quoted phrases, OR, AND, and exclusion.
  Verify documented Superhuman behavior: separate terms combine with AND,
  explicit OR broadens results, a leading hyphen excludes, and common operators
  are discoverable from the desktop sidebar/mobile picker. Record provider- and
  operator-specific support; do not infer that every Gmail operator is parsed
  identically. Confirm result parity and visible query retention.
- SEARCH-006 — Submit with Enter, click a result, click outside, clear with the
  X, and press Escape. Confirm whether the active query stays, clears, or
  restores the pre-search route exactly as the reference does.
- SEARCH-007 — Save a search as a tab. Test empty name, whitespace, duplicate
  name, max-count limit, success, slow response, failure, retry, cancel, and
  reopened tab.
- SEARCH-008 — Search with no results, local-only results, remote results,
  remote error, rate limit, stale cached results, and partial account coverage.
  Empty and unreadable must remain different states.
- SEARCH-009 — Search from Inbox, Starred, Sent, Archive, Trash, label, and
  thread. Clear each and verify the original route/query/tab is restored.
- SEARCH-010 — Open a thread and use in-thread search. Test next/previous,
  match count, case/phrase boundaries, Escape, thread navigation, and refresh.
- SEARCH-011 — Type a query with both contact and thread suggestions, ArrowDown
  to one result, then rapidly replace the query with a no-match query and a
  different-match query before pressing Enter. Confirm selection resets or
  follows the visible result, focus stays intentional, and
  `aria-activedescendant` is absent while closed or stale and otherwise always
  resolves to a rendered option in the open list. Drive this in a browser and
  assert the selection-reset rule at the smallest unit boundary available.
  The synthetic `SearchBar.interaction.test.tsx` cases cover a same-size result
  replacement and two rapid query changes ending with no results; the full
  Mail suite passed on 2026-09-14 (102 files, 838 tests). This is local
  regression proof, not account-backed or paired runtime evidence.
- SEARCH-012 — Compare offline cache eligibility with synthetic messages that
  were received, opened, or searched within the last 30 days, plus older items.
  Include an attachment and more than 1,250 messages in a Split; record which
  messages remain available without assuming the eviction order, and verify
  the per-Split cache limit. Search for a cached match and an offline miss, then
  reconnect and repeat. Confirm an incomplete offline search is not presented
  as a complete empty result; verify the “Connecting…” notice and sync count.
  Use network interception for Mail and the same fixture in Superhuman; do not
  send provider email in this case.

## Inbox rows, selection, and triage

- LIST-001 — Hover a row, move away, move across action buttons, and move the
  pointer while the layout changes. Confirm hover actions do not steal DOM
  focus from keyboard focus.
- LIST-002 — Click sender, subject, snippet, whitespace, checkbox, star, read,
  archive, snooze, trash, send-now, cancel-schedule, and label controls.
  Confirm only the intended action runs and a nested button never opens the row.
- LIST-003 — Focus a row and use j/k, ArrowUp/ArrowDown, Enter, o, Space,
  Shift+j/k, Shift+ArrowUp/Down, and Escape. Test first, middle, last, one-row,
  empty, virtualized, and newly fetched rows.
- LIST-004 — Use Cmd/Ctrl+A in the list, with a selected subset, on an input,
  in a thread, and in compose. Confirm scope and native text selection behavior.
- LIST-005 — For each product, record the actual key shown by its command
  surface for Done/archive, trash, read/unread, star, reply/reply-all, forward,
  snooze, spam, and undo. The 2026-09-13 Superhuman inventory maps `u` to
  Read/Unread, Shift+U to Unread, and Shift+I to Important; do not classify
  Shift+I as Read or infer either product's mapping from Gmail semantics.
- LIST-006 — Select noncontiguous rows, contiguous rows with Shift, select all,
  deselect one, clear selection, then bulk archive, trash, read/unread, star,
  move, label, spam, and snooze.
- LIST-007 — Exercise each optimistic mutation before, during, and after a
  delayed request. Verify row removal/state change, count change, focus advance,
  request failure rollback, error message, and refresh reconciliation.
- LIST-008 — Undo archive, trash, read/unread, star, snooze, and send. Trigger
  with toast click, z, timeout boundary, another action, route change, and
  refresh. At the narrow/mobile viewport, use the visible Undo affordance and
  repeat after a second action replaces the toast; confirm only the latest
  action is reversed. Confirm the undo does not restore into the wrong
  partition. If the responsive Mail surface has no on-screen Undo, record the
  exact parity gap instead of treating the keyboard shortcut as equivalent.
- LIST-009 — Drag/reorder tabs, labels, and saved filters. Test left/right drop,
  same-item drop, cross-group drop, cancelled drag, keyboard alternative, and
  persistence after reload.
- LIST-010 — Swipe left/right on touch: below threshold, threshold, fast fling,
  diagonal/vertical scroll, touch cancel, missing action, action commit, modal
  open, and trailing click suppression. Compare default left=Done/right=Reminder;
  customize both in Swipes settings, add/remove/reorder actions, and re-run the
  same gesture matrix to verify the active mapping and triage-bar actions.
- LIST-011 — Open an inbox tab with zero rows, loading rows, exhausted pages,
  fetch-more error, account error, rate limit, needs-reauth, and sync-in-progress.
  Confirm skeleton, retry, partial coverage, and Inbox Zero are distinct.
- LIST-012 — Mark a multi-message thread read/unread from list, thread, shortcut,
  and action button. Confirm unread count and every message boundary agree.

## Thread and message reading

- THREAD-001 — Open one- and multi-message threads from every view. Confirm URL,
  sender/recipient display, dates, labels, attachment summary, quoted content,
  collapsed/expanded default, and focus.
- THREAD-002 — Navigate sibling threads with j/k, previous/next buttons, and
  mobile action bar. Test first/last/no sibling and preserve list context.
- THREAD-003 — Navigate messages with n/p, focus message cards, Enter/o toggle,
  expand/collapse all, and return to the same focused message after refresh.
- THREAD-004 — Use thread e/archive, d/trash, s star, u read/unread, Shift+I/U,
  r reply, a reply-all, f forward, h snooze, spam, unsubscribe, block, mute,
  label/move, and undo. Confirm action scope and post-action destination.
- THREAD-005 — Test HTML/plain text/markdown bodies, long lines, tables, code,
  inline images, blocked remote images, unsafe links, new-tab links, sanitized
  markup, iframe load/error, dark mode, and responsive height.
- THREAD-006 — From a message with several attachments, invoke Cmd/Ctrl+O,
  click, and use context-menu Open Link/Copy Link. Verify PDF in-app preview,
  PNG preview-then-download, MOV/MP4/DOCX download-first, unsupported Office or
  cloud links, and the 8-second slow-download fallback. Include missing URL,
  large file, duplicate name, failure/retry, mobile native viewer and
  platform-specific Save to Photos/Files actions. Confirm each action targets
  the selected message and preserves thread focus/scroll.
- THREAD-007 — Test calendar invite RSVP accept/decline/tentative, missing event,
  repeated response, loading, failure, and refresh/read-back.
- THREAD-008 — Test GitHub/extracted external action, no match, multiple matches,
  blocked popup, external navigation, and return to the thread.
- THREAD-009 — Open thread search, type, move among matches, close with Escape,
  select text, and use browser find. Confirm shortcuts do not conflict.
- THREAD-010 — Mark read on open, partial unread thread, rapid back navigation,
  delayed provider response, and failed mark-read. Confirm no silent state drift.
- THREAD-011 — Select a message that offers Quick Quote or Instant Reply. Test
  Enter for Reply All, R for Reply, and F for Forward; verify the selected
  message, quoted text, recipients, and draft state. Record Mail as a gap if the
  corresponding feature is absent rather than assigning the key to another
  action.
- THREAD-012 — In a multi-message thread, select a phrase and triple-click a
  line to exercise Quick Quote; press Enter, R, and F separately. Verify the
  selected message, quoted text, recipients, and resulting draft for each key.
  On mobile, confirm Quick Quote is absent (the reference documents it as
  desktop-only). This is a manual side-by-side sequence; do not count ordinary
  reply/forward coverage as Quick Quote coverage.
- THREAD-013 — On an eligible synthetic thread, cycle all Instant Reply
  suggestions with Tab and verify there are three previews at the latest
  received message; insert each with Enter (Reply All), R (Reply), and F
  (Forward), then edit the draft and verify its recipient scope and body. Also
  test mobile chip switching and opening a suggestion for editing. With one
  exclusion changed at a time, confirm suggestions are absent for calendar
  invites, Social/Promotion, SendGrid, financial-institution mail, messages
  never delivered to Inbox (Done/Auto Archived), Spam/Trash, mail dated before
  the feature release, threads where the user replied last, any existing draft,
  and bodies over roughly 20,000 words/80 pages. Activate Superhuman AI for the
  reference only; use synthetic fixtures, never send the generated drafts, and
  record a feature gap if Mail has no equivalent. Cover deterministic Mail
  eligibility with unit/browser tests.
- THREAD-014 — Use Ask AI/Summarize on a synthetic one-message and multi-message
  thread with a quote, attachment, and new-message arrival. Check the exact
  source thread, loading/cancel/error/retry states, unsupported or missing
  context, summary refresh, and that the result does not invent recipients or
  send anything. Compare on the same synthetic content; record a feature gap
  when one product lacks an equivalent. Do not use unrelated private mail as
  the prompt fixture.
- THREAD-015 — Exercise the Contact Pane with a synthetic person and a company
  address: select/open a message, add a recipient, and hover each sender name
  and address. Check right-pane appearance, partial/missing profile data, the
  four recent-message links, and loading/error states. Click a name to search,
  an address to start a draft, copy controls, and a synthetic social/site link;
  verify focus and return path.
  On mobile, open it from the participant area above Subject and swipe between
  participants. Edit only the signed-in user's profile; do not use referral,
  team-invite, or other outbound actions.
- THREAD-016 — On a mobile viewport, reply and reply-all from the open thread,
  then reply to an earlier message through its overflow menu. Verify target
  message, recipient scope, quoted text, signature, keyboard-open/dismissed
  layout, scroll and focus, and draft persistence after leaving and reopening.
  Exercise mocked send failure and recovery. Keep notification Quick Reply as
  the distinct SEND-009 case; never send during the default pass.
- THREAD-017 — Open message details from the sender/header area. Record how SH
  reveals full From/To/Cc/Bcc addresses, sent/received time, and account; then
  repeat for each message in a multi-message thread. Exercise copy-address
  controls, keyboard focus, Escape/outside-click dismissal, missing or malformed
  headers, and clipboard permission denial. In Mail, verify copied values are
  exact and no detail panel changes recipients or draft state. Capture SH's
  precise affordances and dismissal rules side by side rather than assuming
  them. Close the details view and confirm the original thread/message focus.

## Compose, recipients, and autocomplete

- COMPOSE-001 — Open compose with button, c, Command/Ctrl+K → Compose, reply,
  reply-all, forward, draft row, queued draft, and agent navigation. Confirm
  focus target, size, title, route/state, and account. New-message compose opens
  in the main workspace by default; minimize and restore remain reversible.
  An isolated, memory-backed browser pass on 2026-09-13 opened New message from
  both the Compose email button and `c`; both focused the To field and left Send
  disabled. Command palette, reply/forward, route persistence, and paired
  Superhuman behavior remain unverified.
- COMPOSE-002 — Minimize, restore, fullscreen, pop out, close, close all, switch
  draft tabs, create a second draft, and reopen a closed draft. Test mouse,
  keyboard, outside click, Escape, and browser navigation.
- COMPOSE-003 — Type To/Cc/Bcc recipients by name, full/partial address, aliases,
  commas, semicolons, newline paste, drag between fields, duplicate casing,
  invalid address, display name, whitespace, Backspace, Delete, Enter, Tab,
  arrows, Escape, blur, and mouse click.
- COMPOSE-004 — Navigate recipient suggestions with arrows, Enter, Tab, hover,
  click, scroll, and no-match/error/slow contact data. Confirm selected option,
  chip order, focus, `aria-selected`, and no duplicate send target.
  Add two contacts with the same display name and compare ranking for name vs.
  exact-address queries in To/Cc/Bcc. The public phrase-Autocomplete article
  does not specify contact ranking; record that rule from live observation, or
  mark it unknown rather than inferring from phrase suggestions.
  Mail-only regression evidence (not paired parity) is in
  `RecipientInput.interaction.test.tsx`: ArrowDown/ArrowUp/Tab keep the active
  descendant aligned; Escape preserves the query; duplicate addresses are
  filtered case-insensitively; and single/multi-address paste plus blur keep
  valid chips and leftovers distinct. Superhuman behavior remains unobserved
  until a paired replay. An isolated, disconnected browser pass on 2026-09-13
  typed a unique no-match query into To: no suggestions appeared, Escape kept
  the query, and Tab committed it as a removable recipient chip with a “Save as
  alias” action. The chip was removed without sending; contact-backed ranking
  and Superhuman's matching behavior remain unknown.
- COMPOSE-005 — Open alias details, edit, expand to individual recipients, save
  a group, cancel/fail/retry, remove one chip, and remove all chips.
- COMPOSE-006 — Enter subject/body with plain text, rich text, markdown, links,
  bold/italic/strike/code/quote/lists, paste plain/rich HTML, undo/redo, select
  all, keyboard navigation, and contenteditable focus transitions. If
  autocorrect changes a word, use Cmd/Ctrl+Z to undo that correction, then test
  the offered “Learn word” action without losing adjacent draft text.
- COMPOSE-007 — Autocomplete. In SH, record the initial preference, enable it
  in Settings, and disable/enable it again from Cmd/Ctrl+K. Type matching phrase
  prefixes in a new message, reply, inline reply, and popped-out draft. Compare
  the gray inline suffix, timing, caret placement, wrapping, and exact suggestion
  against Mail. Accept with Tab and Right Arrow; confirm each suffix is inserted
  exactly once and saved as body text. Dismiss with Escape (then verify the next
  Escape follows the normal compose-close behavior) or by continuing to type.
  Try upper/lower case, partial words, trailing spaces, punctuation, paragraph
  boundaries, cursor-in-middle, a selection, link/code marks, paste, and a
  suggestion that changes as the current draft changes. Confirm no suggestion
  on mobile or when disabled, native Tab/Right Arrow behavior without a live
  suggestion, and that an unaccepted gray suffix is never saved or sent. Verify
  settings survive reload and a second compose surface. The reference is
  desktop-only and English-only; it uses the current draft and common phrases,
  not prior emails or drafts. Mail currently uses a small deterministic local
  phrase list, so keyboard/state parity is partial and prediction quality,
  timing, and exact visual parity remain unverified until paired browser replay.
  A synthetic Mail browser pass at commit `baba8a1` verified the gray preview,
  Settings and Cmd/Ctrl+K toggles, Tab acceptance, and Escape dismissal before
  the next Escape closed the unsent compose. Send stayed disabled with no
  recipient. No Superhuman state was observed in that run. Unit regressions in
  `app/components/email/compose-autocomplete.test.ts` also cover preference
  refresh, caret/range movement, continued typing, code/link marks, external
  edits, and IME acceptance suppression; these Mail-only checks do not close
  paired replay.
- COMPOSE-008 — Use slash menu, generate/agent handoff, code block language
  picker, link dialog, image paste/drop/upload/failure, and toolbar
  button focus/tooltip states.
- COMPOSE-009 — Add/remove/reorder attachments via picker, drag/drop, paste,
  reply/forward originals, duplicate files, invalid type, size limit, upload
  progress, upload failure, retry, and draft reopen. Compare Cmd/Ctrl+Shift+U
  with drag/drop. Select the original message before Reply/Reply All and use
  Include Original Attachments; Forward appends the original files. On mobile,
  test New Message/Reply `+ → Attach`, Forward from the reply menu, and image vs.
  document save/share paths.
- COMPOSE-010 — Test signature absent/present/multiline/quoted text, Gmail
  signature refresh, Outlook rich signature with image/link, include/remove on
  replies and forwards, and how signatures are exposed from draft overflow.
  Verify mobile respects desktop reply/forward settings but cannot configure
  that option, only one signature is available, quoted content does not
  duplicate it, and edits before/after the quote persist. Compare the optional
  “Sent via Superhuman” signature setting and its desktop/mobile entry points.
- COMPOSE-011 — Change From account and test last-used account, unavailable
  account, reauth, account-specific contacts, and preserved draft account.
- COMPOSE-012 — Type, blur, route-change, refresh, close, reopen, multi-tab, and
  concurrent-agent draft updates. Confirm app state and persistent draft stay
  distinct and failure is visible.
- COMPOSE-013 — Close one or all popout/inline drafts while persistence is
  pending; choose Reopen or Delete from the recovery toast. Repeat with To-only,
  Cc-only, Bcc-only, failed save, existing Gmail draft, local fallback, and a
  secondary account. Confirm the action targets the saved backend/account and
  the correct mailbox list refreshes.
- COMPOSE-014 — Hold an autosave request open, edit again, then close one draft
  or close all. Confirm saves serialize, the final body wins, and the close save
  updates the ID returned by the first save instead of creating another draft.
  Repeat with existing Gmail and local draft IDs and reversed network timing.
  While close-all waits on a captured draft write, open another compose tab and
  confirm it survives the close-all deletion and refresh.
- COMPOSE-015 — Hold an autosave request open, then discard, send, or schedule
  the draft from popout and inline compose. Resolve success and failure after
  removal. Confirm any resulting saved copy is deleted, app state stays removed,
  and no stale query result resurrects the compose tab. For deferred popout
  Send, keep the saved copy untouched through Undo; delete it only after provider
  success, and restore the same compose draft on failure.
- COMPOSE-016 — Reopen a local-fallback saved draft after Gmail connects, then
  edit, autosave, close, and reopen it. Confirm it stays local and does not
  create a Gmail duplicate. Repeat with legacy draft rows lacking backend
  metadata: identify ownership from the exact local/Gmail draft record, keep a
  verified legacy Gmail draft on its owning account, and reject unknown ownership
  without creating or deleting a replacement. Disconnect Gmail for a saved
  Gmail draft and confirm an explicit error instead of silently switching to
  local.
- COMPOSE-017 — Trace the owning mailbox through Drafts-row open, sender state,
  autosave, close-toast Reopen/Delete, discard, and manage-draft delete/delete-all.
  Repeat on primary and secondary accounts; confirm mutations use the saved
  account metadata even if the default sender account differs.
- COMPOSE-018 — Create Snippets from scratch, the current draft, and a read
  message; compare Private and Team visibility. Add a built-in variable and
  curly-brace placeholder, then attempt Send in a mocked composer and verify an
  unresolved-placeholder warning appears; record whether it can be dismissed
  without causing a provider side effect. Insert via Command → Use Snippet,
  Cmd/Ctrl+;, and inline `;`; type to filter, choose with Enter,
  and verify body formatting, caret, recipients, and existing draft text.
  Edit/save with Cmd/Ctrl+Enter and inspect seeded/mocked usage metrics. On mobile,
  test Add Snippet while composing and record that snippet creation remains a
  desktop-only reference capability. Use a disposable team fixture; do not
  share a real snippet or send a message.
- COMPOSE-019 — From To, Cc, Bcc, subject, and body, invoke Cmd/Ctrl+Shift+B.
  Confirm Cc/Bcc rows appear once, absent values initialize to empty without
  replacing typed chips, Bcc receives focus, and repeating the shortcut focuses
  Bcc without hiding rows. Confirm the shortcut is scoped to an active compose
  and never changes To/Cc recipients. Mail's component regression is covered in
  `ComposeModal.schedule.test.tsx`; verify paired desktop behavior and Windows
  modifier mapping. An isolated, memory-backed browser replay on 2026-09-13
  staged `steve@builder.io` in To and `sewell.steve@gmail.com` in Cc without
  sending. Cmd+Shift+B from To, Cc, Subject, and body focused Bcc; repeating
  with Bcc focused kept Cc/Bcc expanded, and collapsing then invoking the
  shortcut restored both rows without losing the Cc chip. On a blank compose,
  the shortcut opened empty Cc/Bcc rows and focused Bcc; after discarding that
  test draft, the shortcut had no visible effect on the inbox. This confirms
  local focus/recipient preservation only: Windows runtime mapping and
  Superhuman paired behavior remain unverified.
- COMPOSE-020 — With at least two Split tabs open, move focus through To/Cc/Bcc,
  recipient autocomplete, subject, body/editor, formatting controls, and dialogs
  using Tab/Shift+Tab. Confirm the suggestion list consumes Tab only when its
  selection behavior is active, then ordinary compose focus traversal resumes;
  no compose Tab may navigate to another Split. From the workspace/tab bar,
  confirm Tab/Shift+Tab still wraps through Splits. Verify exact focus and URL
  after each press. An isolated, memory-backed browser pass on 2026-09-13 traced
  reverse focus Bcc → Cc → Cc/Bcc toggle → To without navigation, and forward
  focus Bcc → Subject → body → Bold → Italic → Insert link → Attach → Generate
  → Delete draft. Tab after Delete draft left no focused AX element and did not
  change the route; from that unfocused state, Tab cycled Other → Important and
  Shift+Tab cycled Important → Other. This appears to be global tab cycling
  after focus leaves Compose, but AX did not expose the handoff target; paired
  replay is needed to determine whether the boundary matches Superhuman.
- COMPOSE-021 — Keep sender aliases distinct from recipient/group aliases and
  mailbox switching. For Gmail, add an alias through Alias Settings, refresh,
  select it through Command or Cmd/Ctrl+Shift+F, set default/Always Reply
  behavior, and verify From on desktop. On mobile, expand an existing reply and
  change From; record that alias setup remains desktop-only. For Outlook, verify
  the primary alias is respected and cannot be switched in Mail. Use provider
  mocks; do not alter a real provider account.

## Send, schedule, and failure recovery

- SEND-001 — Validate empty To, malformed recipient, missing subject, empty body,
  alias expansion, duplicate recipients, self-send, and To/Cc/Bcc overlap before
  any provider side effect.
- SEND-002 — Test Send click, Cmd/Ctrl+Enter, command palette, queued draft send,
  visible send button, and Cmd/Ctrl+Shift+Enter Send + Done. Verify the latter's
  exact Done target (reply thread versus new message), archive timing, failure
  recovery, approval/confirmation boundary, and no duplicate sends from double
  click, key repeat, retry, or rerender. Mail's source currently routes
  Cmd/Ctrl+Shift+Enter through ordinary Send; this is a known mismatch, not a
  completed parity case. Use mocked sends only.
- SEND-003 — Test optimistic send, `Z` Undo within the reference’s 10-second
  window and at the boundary, after toast change, after navigation, and after
  refresh. Never call a message “sent” before the provider result is
  authoritative.
- SEND-004 — Delay/deny the provider. Verify sending, delayed, failed, edit,
  retry, discard, rollback of optimistic reply, exact error, and preserved draft.
- SEND-005 — Send Later presets, custom date/time, natural language, timezone,
  past/minimum date, daylight saving transition, picker cancel, slow parse,
  parse failure, schedule success/failure, scheduled list, send-now, and cancel.
  With a mocked provider, verify an email scheduled before going offline still
  sends at its scheduled time, while a send/schedule queued offline waits for
  connectivity and syncs after reconnect; never use a real send for this case.
- SEND-006 — Test Smart Send on an eligible Business/Enterprise desktop account:
  activity-data eligibility, no recommendation, recipient timezone, multiple
  recipients and optimization choice, no-reply reminder mode, scheduled-send
  override, reply arriving before delivery (scheduled message returns to Drafts),
  manual Send, and plan/platform gating. Mark Mail's intentional gap explicitly.
- SEND-007 — If a live round trip is approved, use only the exact addresses the
  current user explicitly allowlisted for this run. Send one exact approved
  test message, wait for Sent, receive on the other allowed account, verify
  thread grouping, read/unread, reply, and cleanup/archive. Do not persist those
  addresses in fixtures or documentation, and do not contact anyone else.
- SEND-008 — Force a provider send failure in a mocked browser test. Verify the
  failure notification is discoverable, open its recovery entry point, edit or
  discard, then read back Sent and Drafts to rule out silent loss or duplicate
  delivery. Compare Superhuman's failed-send notification and recovery flow
  manually; do not trigger a real failed send to an external recipient.
- SEND-009 — Exercise notification Quick Reply with mocked OS notifications on
  iOS and Android. On iOS, long-press and choose Quick Reply All; on Android,
  choose Quick Reply All directly. Contrast with a normal notification tap,
  which opens the thread. Verify Reply-All recipient scope, signature, inline
  focus/editing, send failure, and Undo (30 seconds on iOS, 20 on Android).
  Confirm muted threads do not surface a notification action and notification
  permission denial is distinct from no new mail. Use a mocked provider only;
  never send a live Quick Reply.

## Labels, folders, spam, and reminders

- ORGANIZE-001 — Open label/folder menus from list, thread, command palette, and
  Settings. Test search, nested labels, duplicate names, missing labels, create,
  rename, delete, apply, remove, move, and remove-label-and-done. Compare Gmail
  labels versus Outlook categories, category-vs-folder semantics in Move, and
  provider handoff for deleting/renaming labels; verify folder overflow and
  mobile platform/account support. Label and remove-label alone keep mail in
  Inbox; Remove from Label/Shift+Y labels then Done; Move removes it from Inbox,
  while removing a message from a folder sends it to Done. Test slash-created
  subfolders and provider handoff for folder deletion.
- ORGANIZE-002 — Compare Archive/Done, All Mail, Inbox, label, Sent, Trash, and
  Spam boundaries. Confirm replies to archived/done threads resurface correctly.
- ORGANIZE-003 — On synthetic messages, distinguish Delete, Unsubscribe,
  Block, and Mark Spam. Test Unsubscribe alone, Unsubscribe + Mark Done all, and
  Unsubscribe + Trash all, including email-based versus provider-page handoff
  and cancellation. Test Block sender/domain and unblock from Blocked Senders.
  Test Mark Spam alone, Spam + block full address, and Spam + block domain;
  verify Spam moves to the Spam/Junk partition and is not silently equivalent
  to blocking. Cover mute/unmute and reply notification behavior, Undo,
  future-message handling, restore from Trash/Spam, missing/duplicate targets,
  and account scope. Use mocked unsubscribe and provider effects; never
  unsubscribe, block, or report a real personal message.
- ORGANIZE-004 — Snooze presets, weekday prefixes, natural-language date/time,
  timezone, multi-select, swipe, modal keyboard navigation, cancel, failure,
  resurface, and reminder list.
- ORGANIZE-005 — Compare Superhuman Auto Reminders: sent/no reply detection,
  reminder scheduling, trigger, dismiss, and cancel. Test needs-follow-up,
  all-external, and off modes, default reminder time, and weekday behavior.
  Mark Mail's intentional gap until implemented and covered by
  actions/application state.
- ORGANIZE-006 — Compare Auto Labels, Auto Archive, and Auto Drafts when the
  reference account/plan exposes them: onboarding and enablement, existing mail
  versus new mail, exclusions/overrides, incremental processing, draft
  suggestions/versions/placeholders, user review, disablement, and recovery.
  Confirm an AI draft is never sent automatically. Treat plan-gated features as
  a documented product gap when they are unavailable, not as a failed test.
- ORGANIZE-007 — Create a disposable filter/rule from Settings and, if SH
  exposes it, from a message. Use synthetic messages that separately match
  sender, recipient, subject, and label criteria; exercise AND/OR combinations,
  empty/invalid criteria, duplicate rules, enable/disable, edit, reorder if
  available, delete/cancel, and apply-to-existing if offered. Deliver matching
  and nonmatching fixtures through the synthetic provider; verify resulting
  folder/label/read state and counts, then refresh and reopen Settings. Record
  SH's available criteria, precedence, preview, and retroactive-apply semantics
  rather than inferring them. Remove the disposable rule and its fixtures.
- ORGANIZE-008 — Compare manual Remind Me from `h`, Command, and
  Cmd/Ctrl+Shift+H in compose. Exercise day/time presets, custom time, timezone,
  “if no reply” vs “regardless,” editing/removing a pending reminder,
  reply-before-due behavior,
  “someday,” reminders on an existing-conversation draft, and the boundary that
  a new-message draft cannot have a reminder. Verify pending Reminders-folder
  membership, returned Reminder split/purple dot, same-thread duplicates when
  newer mail arrives, and account scope. Use synthetic threads and mocked time.
- ORGANIZE-009 — Customize left/right swipes and conversation triage actions:
  Command → Swipes → each direction, plus/minus actions, drag reordering, save,
  and cancellation. Re-run list gestures and in-thread triage to verify new
  mappings. Compare iOS triage-bar customization and the documented Android
  availability boundary; verify ordinary vertical scroll never triggers a
  swipe action.

## Account connection and recovery

- ACCOUNT-001 — Using a mocked OAuth/provider boundary and synthetic accounts,
  exercise add-account start/cancel, consent success, denied consent, missing
  scopes, expired authorization, reconnect, duplicate account identity, and
  disconnect. After each transition verify account-picker state, affected
  mailbox coverage, error/retry affordance, and whether cached rows remain
  distinguishable from current provider data. Confirm disconnect/reconnect does
  not silently retarget an open draft or mutate another account. Record SH's
  exact confirmation, cache, and recovery behavior side by side; do not connect,
  disconnect, or modify a real mailbox. Remove synthetic accounts and reset
  provider mocks after the case.
- ACCOUNT-002 — With two synthetic accounts, compare Command-based desktop add,
  desktop account switching/reordering/sign-out, and per-account draft sender.
  Repeat setup on mobile (accounts added on desktop do not auto-sync); test tap
  to cycle and long-press to choose an account. Compare Windows' documented
  account-switch modifier with the live shortcut inventory. Record that the
  current Superhuman guide documents no Unified Inbox; treat Mail's combined
  inbox as an additional capability, not parity. Verify switching never
  silently changes an open draft's sender or mutation target.

## Splits, calendar, and collaboration

- SPLIT-001 — Build a custom Split Inbox from From/To/Subject/Cc/Bcc criteria
  with AND/OR and Auto Labels. Test duplicate criteria, invalid/empty names,
  empty-result hiding, counts, more than 999 matches, Also show in Important,
  edit/disable/delete, reorder, reload, and Add to Split Inbox from a message.
  Verify messages are still in the underlying mailbox and account-scoped.
- CAL-001 — Open calendar from navigation and keyboard. Compare day/week views,
  previous/next periods, time zones, all-day/multi-day events, event details,
  search, refresh, and the return path to the same mail thread. Test missing,
  disconnected, and partially granted calendar access distinctly.
- CAL-002 — Start an event from the calendar, an open message, and Ask AI.
  Exercise generated invitees, purpose, availability, meeting link, edit,
  save/cancel, timezone/DST, recurrence, overlap, and event read-back. Keep
  browser tests mocked or save only a draft event; do not invite real attendees
  without explicit authorization for those recipients.
- TEAM-001 — Inspect Share Conversation and stop-sharing dialogs, publisher and
  participant visibility, copied-link states, guest access, future-message
  visibility, subthreads, risk warning after removing a recipient, and re-share
  eligibility. Test only with a synthetic fixture and disposable test team; do
  not publish a real conversation or send a collaboration invitation during
  the parity pass.
- TEAM-002 — Exercise comments, @mention autocomplete, participant list, send,
  notification, delete-own-comment, comment-bar hide/show, mute, and mobile
  comment affordance. Use mocked sends or a dedicated test team; never mention
  or notify a real person without explicit authorization.
- TEAM-003 — Share/unshare a standalone or reply draft; test real-time peer
  edits, conflicts, draft labels, comments, send-after-edit, and disconnect.
  Confirm sharing stops access as the reference specifies. Use disposable test
  identities only; do not expose a user's live draft.
- TEAM-004 — Compare Team Snippets, teammate reply/scheduled indicators, team
  scheduling, and CRM sidebars. Test enabled/disabled,
  permission-denied, stale, and competing-writer states. No real mail open
  tracking, team sharing, meeting invitation, or CRM write is part of the live
  test without separate authorization.
- TEAM-005 — For Read Statuses, test per-account enable/disable via Command,
  checkmarks beside message headers, hover details (time, device, and opener),
  and the status below the latest message. Verify only eligible mail sent
  through the reference is tracked and that tracking-pixel protection suppresses
  the status. On an eligible Business/Enterprise fixture, open Recent Opens,
  follow an item to its conversation, and compare individual statuses. Use
  synthetic pixel/open events; do not enable tracking on a real mailbox or send
  a tracked email to a real person.

## Settings, command palette, and agent parity

- SETTINGS-001 — Open Command/Ctrl+K from list, thread, compose, search, modal,
  button, and text editor. Search commands, arrows, Enter, Escape, query reset,
  contextual command visibility, and shortcut labels.
- KEYBOARD-PALETTE-003 — Start in Search with a nonempty query and focus in the
  search field. Open Command/Ctrl+K, type a command query, and press Escape.
  Confirm the first Escape clears only the palette query and keeps palette
  focus; the next Escape closes it and returns focus to Search without changing
  its query or route. Repeat with an empty palette query, from button/body/editor
  focus, and after selecting a command; selection must not be mistaken for
  dismissal.
- SETTINGS-002 — Open shortcut reference and hover every action. Confirm the
  displayed shortcut is the one that actually runs. Compare US QWERTY with the
  documented Belgian/French/German alternatives for Search, Trash, Tab, snippet,
  and calendar; test Colemak's listed reply/navigation/snippet overrides. Do not
  infer native support for an unlisted international layout.
- SETTINGS-003 — Settings navigation/search/back/refresh. Test signature,
  drafting style, snippets, aliases, tracking, accounts, split/combine inbox,
  filters, automations, AI filter, Auto Labels/Archive/Drafts/Reminders,
  integration/team permissions, theme, and unsaved changes.
- SETTINGS-004 — Use `view-screen`, `navigate`, `get-thread`, `list-inbox-threads`,
  `list-emails`, `search-emails`, `find-contact`, `manage-draft`, and mutation
  actions against the same visible state. Read back after every write.
- SETTINGS-005 — Confirm navigation state includes view, tab, threadId,
  focusedEmailId, selectedThreadIds, search, label, filter, active accounts,
  queuedDraftId, settings section, and composeDraftId where applicable.
- SETTINGS-006 — Test agent-created/updated draft, agent navigation, external
  refresh signal, concurrent UI edit, stale response, action error, and recovery.
- SETTINGS-007 — Open Superhuman Command → Shortcuts from the inbox, an open
  thread, and compose. Compare every displayed shortcut and its context, then
  exercise it with focus in the list, thread, To/Cc/Bcc, subject, body, search,
  and modal. Baseline captured from the live desktop reference on 2026-09-13:

  | Surface            | Shortcut inventory to compare and exercise                                                                                                                                                                                                                                                                                                                                                                            |
  | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Global/navigation  | Cmd+K Command; `/` Search; `z` Undo; `?` Ask AI; `j`/`k` next/previous conversation; `n`/`p` next/previous message; Enter Open; Esc Back; Tab/Shift+Tab next/previous Split; Left Arrow label menu; Space/Shift+Space page down/up; Cmd+Up/Down jump top/bottom; Ctrl+1–9 switch account; arrows Superhuman Focus.                                                                                                    |
  | Conversation       | `e` Done/Archive; Shift+E not Done; `h` Remind Me; `s` Star; `u` Read/Unread; `i` Summarize; Shift+M Mute; `#` Trash; `!` Spam; Cmd+U Unsubscribe; Cmd+P Print; `x` select; Esc clear selection; Cmd+A select all from here; Cmd+Shift+A select all; Cmd+S share; `m` comment; Cmd+Delete delete comment.                                                                                                             |
  | Labels/messages    | `v` Move; `l` Add/Remove Label; `y` Remove Label; `[`/`]` next/previous label; Shift+Y remove all labels; `c` Compose; Enter Reply All; `r` Reply; `f` Forward; Cmd+O Open Links & Attachments; Tab cycle links; `o` Expand Message; Shift+H expand header; Shift+O expand all; Shift+N show new messages; Cmd+; use snippet.                                                                                         |
  | Compose            | Cmd+Shift+O To; Cmd+Shift+C Cc; Cmd+Shift+B Bcc; Cmd+Shift+F From; Cmd+Shift+S Subject; Cmd+J Superhuman AI; Cmd+Shift+U Attach; Cmd+Shift+, Discard; Cmd+Shift+I Instant Intro/Bcc; Cmd+Shift+H Remind Me; Cmd+Shift+L Send Later; `;` insert snippet; `:` insert emoji; Cmd+Enter Send; Cmd+Shift+Z Send Instantly; Cmd+Shift+Enter Send + Done.                                                                    |
  | Pop-out and format | Shift+C pop out; Shift+Enter Reply All pop-out; Shift+R Reply pop-out; Shift+F Forward pop-out; Cmd+Shift+P pop in/out; Cmd+/ pop out draft and search; Cmd+D Toggle Focus; Cmd+B bold; Cmd+I italic; Cmd+U underline; Cmd+K hyperlink; Cmd+O color; Cmd+Shift+X strike; Cmd+Shift+7/8/9 numbered list/bullets/quote; Tab/Shift+Tab indent/outdent; Cmd+]/[ increase/decrease indent.                                 |
  | Folders/filters    | G then I Inbox and Important; G then O Other; G then S Starred; G then D Drafts; G then T Sent; G then E Done; G then H Reminders; G then M Muted; G then ; Snippets; G then ! Spam; G then # Trash; G then A All Mail; G then L label; Shift+U Unread; Shift+S Starred; Shift+I Important; Shift+R No reply. Verify the live G-then-I mapping because the reference sheet displayed it for both Inbox and Important. |
  | Window/calendar    | Cmd+T new tab; Cmd+Shift+]/[ next/previous tab; Cmd+W close tab; Cmd+=/-/0 font size up/down/reset; Cmd+F find; Ctrl+/ copy private link; `0` day view; `2` week view; `-` previous day/week; `=` next day/week; Cmd+Shift+A share availability; `b` create event; Shift+B empty event.                                                                                                                               |

  Confirm contextual conflicts resolve intentionally (including Enter, Tab,
  Cmd+Shift+A, Cmd+O, Cmd+K, Shift+U, and Shift+R), native text editing is not
  intercepted, and international keyboard layouts have usable alternatives.
  Mail source audit on 2026-09-13 found additional mappings that need paired
  replay: Shift+I marks read in list/thread rather than Important; G+I routes
  only to Inbox despite the reference sheet's ambiguous Inbox/Important label;
  and Cmd+O has a Mail-specific GitHub-link handler when a PR link is detected;
  compare ordinary attachment/link handling with Superhuman separately. G+A
  routes to `/all`; an isolated, memory-backed browser replay on 2026-09-13
  verified the palette labels and G+A → `/all` / G+E → `/archive` routes.
  Superhuman paired replay is still pending. The other source findings remain
  gaps to validate, not runtime parity evidence.

- SETTINGS-008 — Compare notification preferences by platform and account.
  On desktop, toggle Email Notifications from Command and distinguish the app
  toggle from browser/OS permission; with Important • Other enabled, verify
  only high-priority mail notifies. On mobile, test per-account All, High
  Priority, selected Split Inboxes, and Off, plus OS permission denial. Compare
  desktop badge count (all messages in the active Split, not just unread), iOS
  badge choices (high-priority unread, unread, off), and Android's fixed badge.
  Mock notification delivery and device permission state; do not change the
  user's OS notification settings or emit real notifications.
- SETTINGS-009 — Configure Auto Bcc through desktop Command or mobile Command →
  Auto Bcc Settings. Paste an address, save with Enter, add/remove excluded
  domains and addresses, and record whether settings are shared or per sender
  account. In a mocked compose, confirm the address is added to Bcc; use
  Cmd/Ctrl+Shift+B to reveal Bcc and remove the automatic address for one
  message, then open a later draft and another account to verify the rule's
  persistence/scope. Test malformed/duplicate addresses, cancellation, and
  settings failure without sending any message.

## Performance and quality gates

- PERF-001 — Cold load, warm load, route transition, search open, thread open,
  compose open, first key, first hover action, optimistic mutation, and undo.
  Record perceived response and main-thread stalls; target the existing 100/400ms
  feedback contract.
- PERF-002 — 25, 100, 500, and 2,000-row synthetic mailboxes. Verify virtual
  focus, scroll anchoring, pagination, search, selection, and mutation latency.
- PERF-003 — Slow network, offline, reconnect, rate limit, provider 401/403/5xx,
  expired upload, stale action result, and partial multi-account responses.
  Verify errors do not become empty/success states.
- PERF-004 — Screen reader landmarks, keyboard-only pass, focus-visible styling,
  reduced motion, high contrast/theme, 200% text zoom, RTL locale, touch target
  size, and no horizontal overflow.
- PERF-005 — After every fix, run the affected case, its neighboring cases,
  focused unit/action tests, typecheck/format/guards, and the complete Mail
  matrix that is available in the environment. Record skipped cases and why.

## Visual and interaction-state parity

Run Superhuman and Mail at the same content viewport (CSS-pixel width and
height), zoom, theme, text scale, and matched synthetic message/draft state.
Record the environment with each comparison; do not compare a native window's
outer frame to a browser's outer frame. Capture both products before a change
and again after a fix. A visual case is not verified from source inspection or
an automated DOM assertion alone.

- VIS-001 — Compare the shell and inbox at rest: navigation/header geometry,
  density, row height, typography, color, separators, icons, account state,
  unread/selected indicators, and scroll position.
- VIS-002 — Compare a synthetic message row at idle, pointer hover, keyboard
  focus, selected, unread, starred, multi-select, loading, and action-in-flight
  states. Check that transient row actions do not shift content or steal focus.
- VIS-003 — Compare one-message and multi-message thread states: collapsed and
  expanded cards, sender/recipient details, quote, attachment, toolbar, body
  typography, long lines, inline media, and bottom action placement.
- VIS-004 — Compare blank compose, recipient query with suggestions open,
  accepted recipient chip, Cc/Bcc open, subject/body entered, minimized,
  expanded/fullscreen, attachment progress, send failure, and saved state.
  Capture focus, caret, menu anchoring, and layout after each transition.
- VIS-005 — Compare command palette, search suggestions, account selector,
  label menu, snooze/date picker, confirmation, error, undo toast, and empty
  state at open, keyboard-focus, hover, and dismissal transitions.
- VIS-006 — Compare responsive layouts at 1024×768, 768×1024, and 390×844 CSS
  pixels, including touch targets, safe areas, overflow, popover placement, and
  whether the same primary actions remain reachable.
- VIS-007 — For every discrepancy, record the case ID, viewport/theme/state,
  exact key/mouse sequence, expected Superhuman appearance/behavior, actual
  Mail appearance/behavior, before screenshot for each product, the fix, and
  after screenshots for both products. Re-run the exact sequence after the fix.

Use synthetic fixture mail only. Inbox screenshots must not capture unrelated
personal messages; crop or obscure unrelated content before saving evidence.

## Official comparison anchors

Use current official Superhuman help articles for the reference behavior and
re-open them when the product changes:

- [Keyboard shortcuts](https://help.superhuman.com/hc/en-us/articles/46005701270541-Keyboard-Shortcuts-in-Superhuman-Mail)
- [Autocomplete](https://help.superhuman.com/hc/en-us/articles/46005685782669-Autocomplete)
- [Search](https://help.superhuman.com/hc/en-us/articles/46005672652301-Search)
- [Search in Seconds](https://help.superhuman.com/hc/en-us/articles/46005814266253-Search-in-Seconds)
- [Offline Access](https://help.superhuman.com/hc/en-us/articles/46005499629325-Offline-Access)
- [Undo](https://help.superhuman.com/hc/en-us/articles/46005666743309-Undo)
- [Mark Done](https://help.superhuman.com/hc/en-us/articles/47439134613773-Mark-Done)
- [Attachments](https://help.superhuman.com/hc/en-us/articles/46005568142989-Attachments)
- [Labels](https://help.superhuman.com/hc/en-us/articles/46005736546061-Labels)
- [Folders](https://help.superhuman.com/hc/en-us/articles/46005732666253-Folders)
- [Aliases](https://help.superhuman.com/hc/en-us/articles/46005743269901-Alias)
- [Signatures](https://help.superhuman.com/hc/en-us/articles/46005771841933-Signatures)
- [International keyboard shortcuts](https://help.superhuman.com/hc/en-us/articles/46005584339597-Shortcuts-for-International-Keyboards)
- [Managing Accounts](https://help.superhuman.com/hc/en-us/articles/46005777934733-Managing-Accounts)
- [Customizing Swipes and Triage Bar](https://help.superhuman.com/hc/en-us/articles/46005742942861-Customizing-Swipes-and-Triage-Bar)
- [Remind Me](https://help.superhuman.com/hc/en-us/articles/46005666142733-Remind-Me)
- [Reminders on Autopilot](https://help.superhuman.com/hc/en-us/articles/46005807905421-Reminders-on-Autopilot)
- [Smart Send](https://help.superhuman.com/hc/en-us/articles/46005572688525-Smart-Send)
- [Auto Bcc](https://help.superhuman.com/hc/en-us/articles/46005654497549-Auto-Bcc)
- [Mobile navigation](https://help.superhuman.com/hc/en-us/articles/46005719737357-Mobile-Navigation)
- [Failed sends](https://help.superhuman.com/hc/en-us/articles/46005543693581-Failed-Sends)
- [Quick Quote](https://help.superhuman.com/hc/en-us/articles/46005692763661-Quick-Quote)
- [Instant Reply](https://help.superhuman.com/hc/en-us/articles/46005583725709-Instant-Reply)
- [Shared Conversations and Team Comments](https://help.superhuman.com/hc/en-us/articles/46005593675917-Shared-Conversations-and-Team-Comments)
- [Custom Split Inbox](https://help.superhuman.com/hc/en-us/articles/46005636204941-Custom-Split-Inbox)
- [Your AI Assistant](https://help.superhuman.com/hc/en-us/articles/46005792429965-Your-AI-Assistant)
- [Create Event](https://help.superhuman.com/hc/en-us/articles/46005621734669-Create-Event)
- [Auto Reminders & Auto Drafts](https://help.superhuman.com/hc/en-us/articles/46005658551053-Auto-Reminders-Auto-Drafts)
- [Shared Drafts](https://help.superhuman.com/hc/en-us/articles/46005578703885-Shared-Drafts)
- [Team Features Overview](https://help.superhuman.com/hc/en-us/articles/46005696084109-Team-Features-Overview)
- [Dates, Deadlines, Done](https://help.superhuman.com/hc/en-us/articles/46005854169357-Dates-Deadlines-Done)
- [Read Statuses and Recent Opens Feed](https://help.superhuman.com/hc/en-us/articles/46005603745293-Read-Statuses-and-Recent-Opens-Feed)
- [Email Notifications](https://help.superhuman.com/hc/en-us/articles/46005802618765-Email-Notifications)
- [Reply to Email on Mobile](https://help.superhuman.com/hc/en-us/articles/46005712692877-Reply-to-Email-on-Mobile)
- [Contact Pane](https://help.superhuman.com/hc/en-us/articles/46005778939789-Contact-Pane)
- [Snippets](https://help.superhuman.com/hc/en-us/articles/46005686571149-Snippets)
- [Dealing with Unwanted Emails](https://help.superhuman.com/hc/en-us/articles/46005635358349-Dealing-with-Unwanted-Emails)
