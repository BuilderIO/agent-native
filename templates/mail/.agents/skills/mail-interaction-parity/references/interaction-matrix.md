# Mail interaction matrix

This is the working ledger for the side-by-side pass. Each case is intentionally
small enough to run, observe, fix, and re-run. `SH` means the Superhuman
reference sequence; `MAIL` means the corresponding Mail sequence.

## Visual and latency evidence

Pair each replay at the same viewport with the same realistic, non-sensitive
fixture or approved test thread. Capture both products at the key resulting
states, including inbox/list, thread, compose, menus, and applicable
empty/loading/error states. Record concrete differences in density, alignment,
typography, focus/hover, menu behavior, and compose/thread geometry. Link each
observation to its case ID and replay the exact state after a fix.

For repeatable hot paths, define the trigger and endpoint before timing. Record
input/click-to-first-visible-acknowledgment separately from trigger-to-usable
content. Keep viewport, fixture, account, network, and cache conditions fixed,
alternate product order, and report cold and warm runs separately. Use a
monotonic clock. After three warmups, collect 30 samples per metric where the
interaction is safe and repeatable. Report `n`, p50, and empirical p95 only at
`n >= 30`; below that, report `n`, median, and range, and mark p95 unsupported.
Do not treat live provider-send time as a client-latency benchmark.

Unverified local performance lead (reported 2026-09-14 by the coordinating
task, not a controlled profile): the normal Mail server logged about 408
requests over 23 minutes. Repeated `GET /api/emails` and
`/_agent-native/actions/list-inbox-threads` reads took roughly 1.6–9.0 seconds,
and the PGlite worker briefly reached about 34% CPU. The helper server was
stopped to free the shared validation lane. On the Mail pass, capture request
cadence and per-endpoint timings, then distinguish polling, mutation-driven
refreshes, and expensive reads before changing code. This lead is not a
reproduced result or root-cause finding. Static source leads to check later:
`useInboxThreads()` polls every 3 seconds while a response reports syncing and
every 20 seconds otherwise; `useEmails()` polls every 2 minutes; the visibility
refresh invalidates at most once per minute; and `useDbSync()` invalidates on
external refresh-signal, settings, or screen-refresh events. Confirm exact
request timestamps and active query state before attributing the observed
traffic to any one path.

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
  repeat with mouse, touch, outside click, and browser Back. An isolated,
  disconnected desktop browser pass on 2026-09-14 opened the full rail by
  clicking Toggle menu; Escape left it open, while clicking the main pane
  closed it. Keyboard toggle, touch, browser Back, and paired Superhuman
  behavior remain unverified.
- NAV-004 — Cycle tabs with Tab and Shift+Tab from the workspace and tab bar.
  Confirm focus ring, wraparound, selected tab, and URL. With multiple Split
  tabs open, verify inputs, recipient suggestions, contenteditable, buttons,
  popovers, and dialogs retain native focus/selection behavior instead of
  switching tabs. Mail's guard is covered by
  `use-keyboard-shortcuts.spec.ts`. In the isolated desktop pass, Tab from page
  focus on Important selected Other and Shift+Tab returned to Important; Tab
  from Search moved focus to Refresh inbox without changing the route. Focus
  ring, wraparound, other controls, and paired Superhuman behavior remain
  unverified.
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
  horizontal swipe, iOS swipe-right return, and Android Back. For each gesture,
  record platform, starting surface, direction/touch count, threshold,
  animation, destination or dismissed surface, refresh result, and restored
  focus/scroll. Treat the documented iOS swipe-right-to-return and Android
  system Back outcomes as separate contracts; do not infer one from the other
  or from desktop Escape. Use the [Mobile Navigation](https://help.superhuman.com/hc/en-us/articles/46005719737357-Mobile-Navigation)
  guide as the reference, and label unlisted platform variants unknown until
  observed. Planned/reference comparison is not executable proof.

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
  reopening showed a blank field. In a separate `/all` pass, Escape with a
  synthetic query active cleared it back to `/all` and left the open compose
  panel intact. A second synthetic query was reflected in
  `/mail/all?q=local-nav-focus-probe`; Escape from Search returned to the
  original `/mail/inbox?tab=important` route. With the compose body focused,
  `/` inserted a slash and opened the editor's block picker instead of global
  Search. With the Toggle menu button focused, `/` did not open Search. These
  focus-context behaviors need paired Superhuman replay before treating either
  as a parity gap. No mailbox contacts/results were available, and mobile plus
  Superhuman behavior remain unverified. The active search combobox, query-clear
  button, and hidden keyboard-focus target lacked accessible names in the local
  accessibility tree; they now use existing localized labels with regression
  coverage. On 2026-09-14, the live local browser also confirmed `/` from page
  focus focuses `#mail-search` without changing `/all`; when the recipient
  input owns focus, `/` stays in that input and global Search does not launch.
  The synthetic keystroke was removed before continuing, and no message was
  opened or sent. A live synthetic no-result
  query showed zero suggestions; clicking outside Search moved focus to the
  page without changing the query or URL, and `/` restored Search focus while
  preserving both. Escape cleared the query back to `/all`, and the existing
  compose panel remained open. In this maximized-draft state, the compose
  surface covers the toolbar Search button, so mouse-opening Search could not
  be tested without disturbing the user-owned draft.
- SEARCH-002 — Type one character, two characters, three characters, spaces,
  quoted text, unicode, punctuation, and a long query. Confirm debounce,
  local-match timing, remote-search timing, and no request for short queries.
  Mail source audit found contact/local matches start at two trimmed characters
  and automatic navigation to `/all?q=...` starts at three after 400 ms.
  Superhuman's official [Search in Seconds](https://help.superhuman.com/hc/en-us/articles/46005814266253-Search-in-Seconds)
  workflow says to type a query and press Enter. Treat the timing/submit
  difference as a candidate for authenticated paired replay, not a confirmed
  discrepancy. In the isolated browser pass, a two-character query remained on
  the current route after about 700 ms; a three-character query navigated to
  `/mail/all?q=abc` after about 700 ms. The disconnected runtime had no mailbox
  results. Fake-timer regressions in `SearchBar.interaction.test.tsx` also prove
  that trimmed one- and two-character queries do not auto-navigate, a
  three-character query navigates at 400 ms (not 399 ms), and Enter submits
  exactly once without waiting for the timer. These tests characterize Mail
  only; no paired Superhuman replay has been captured.
- SEARCH-003 — Navigate contact suggestions with ArrowDown/ArrowUp, Home/End
  if supported, Enter, mouse hover, mouse click, and Tab. Confirm the selected
  result is the one opened and focus/URL are correct.
- SEARCH-004 — Navigate local thread suggestions after contacts. Confirm the
  selected local item scrolls into view and does not reuse a contact index.
- SEARCH-005 — Search with `from:`, `to:`, `subject:`, `has:attachment`,
  `label:`, `is:unread`, date ranges, quoted phrases, OR, AND, and exclusion.
  Verify documented Superhuman behavior: separate terms combine with AND,
  explicit OR broadens results, a leading hyphen excludes, and common operators
  are discoverable from the desktop sidebar/mobile picker. On mobile, open the
  operator picker, inspect available operators and labels, select each by tap,
  then edit/remove its value, dismiss/reopen the picker, and submit with the
  keyboard. Confirm insertion point, spacing, query retention, and whether
  selecting an operator runs search or only edits the query. Record provider-
  and operator-specific support; do not infer that every Gmail operator is
  parsed identically. Use the official [Search](https://help.superhuman.com/hc/en-us/articles/46005672652301-Search)
  guide as reference. This planned comparison is not runtime proof.
- SEARCH-006 — Submit with Enter, click a result, click outside, clear with the
  X, and press Escape. Confirm whether the active query stays, clears, or
  restores the pre-search route exactly as the reference does. An isolated
  browser pass cleared `/all?q=abc` with the X and landed at `/all`; Escape
  from the command palette returned focus to Search without changing that
  query. With `archive` in Command and `q=abc` in Search, the first Escape
  cleared only the Command query and kept the palette open; the second closed
  it, restored Search focus, and preserved `/all?q=abc`. A regression in
  `SearchBar.interaction.test.tsx` now covers the two-stage dismissal, active
  Search query preservation, focus restoration, and absence of navigation.
  Paired Superhuman behavior remains unverified. A 390px local browser replay
  on 2026-09-14 had an existing full-screen compose draft layered above the
  header, so the clear control's pointer hit area was occluded. The same flow
  in an isolated local QA tab with the compose surface minimized restored
  `/all` and removed the clear control; keyboard activation also cleared the
  query. Mail preserves pointer focus on mousedown and covers both pointer and
  keyboard activation with regression tests.
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
  reconnect and repeat. Apply the documented [Offline Access](https://help.superhuman.com/hc/en-us/articles/46005499629325-Offline-Access)
  eligibility and per-Split limit independently, without assuming undocumented
  eviction order. Confirm an incomplete offline search is not presented as a
  complete empty result; verify the “Connecting…” notice, sync count, and which
  cached message/attachment content can be opened. After reconnect, verify
  missing data becomes available and cached content reconciles. Use network
  interception for Mail and the same fixture in Superhuman. This is a planned
  comparison, not executable proof; do not send provider email.

## Inbox rows, selection, and triage

- LIST-001 — Hover a row, move away, move across action buttons, and move the
  pointer while the layout changes. Confirm hover actions do not steal DOM
  focus from keyboard focus.
- LIST-002 — Click sender, subject, snippet, whitespace, checkbox, star, read,
  archive, snooze, trash, send-now, cancel-schedule, and label controls.
  Confirm only the intended action runs and a nested button never opens the row.
- LIST-003 — Focus a row and use j/k, ArrowUp/ArrowDown, Enter, o, Space,
  Shift+j/k, Shift+ArrowUp/Down, and Escape. Test first, middle, last, one-row,
  empty, virtualized, and newly fetched rows. Local synthetic keyboard coverage
  on 2026-09-14 confirms `r` starts Reply and `a` starts Reply All for the
  focused conversation; paired Superhuman list behavior remains unverified.
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
  Source and action regression evidence on 2026-09-14 now confirms that Move
  carries each selected row's account and thread provenance positionally, and
  the server uses an explicitly selected account without probing another
  connected mailbox. Paired Superhuman selection/menu behavior and the full
  multi-account browser replay remain unverified.
- LIST-007 — Exercise each optimistic mutation before, during, and after a
  delayed request. Verify row removal/state change, count change, focus advance,
  request failure rollback, error message, and refresh reconciliation.
- LIST-008 — Undo archive, trash, read/unread, star, snooze, and send. Trigger
  with toast click, z, timeout boundary, another action, route change, and
  refresh. At the narrow/mobile viewport, use the visible Undo affordance and
  repeat after a second action replaces the toast; confirm only the latest
  action is reversed. Confirm the undo does not restore into the wrong
  partition. On mobile, verify the visible Undo control, location, label,
  duration, replacement by a subsequent action, and tap result against the
  official [Undo](https://help.superhuman.com/hc/en-us/articles/46005666743309-Undo)
  reference. If the responsive Mail surface has no on-screen Undo, record the
  exact parity gap instead of treating the keyboard shortcut as equivalent.
  Official reference: Superhuman's [Undo](https://help.superhuman.com/hc/en-us/articles/46005666743309-Undo)
  guide documents `Z` to undo the last action within 10 seconds. Local
  regression evidence on 2026-09-14: `pnpm --filter mail exec vitest run
  app/hooks/use-undo.test.tsx app/components/email/EmailList.keyboard-navigation.test.tsx`
  passed (2 files, 15 tests). The hook tests cover before/at/after expiry,
  latest-action replacement, stale toast callbacks, keyboard/toast
  consume-once behavior, active-toast-only dismissal, clearing, and
  `useHasUndo`; list/thread archive and trash toast wiring uses the same
  10,000 ms duration and consume-once callback. These are local deterministic
  tests, not a paired UI replay. Live Superhuman toast placement, appearance,
  and tap behavior remain unverified; do not claim those match.
  Keep manual/reference observation distinct from toast/action unit-test proof.
- LIST-009 — Drag/reorder tabs, labels, and saved filters. Test left/right drop,
  same-item drop, cross-group drop, cancelled drag, keyboard alternative, and
  persistence after reload.
- LIST-010 — Swipe left/right on touch: below threshold, threshold, fast fling,
  diagonal/vertical scroll, touch cancel, missing action, action commit, modal
  open, and trailing click suppression. Compare default left=Done/right=Reminder;
  customize both in Swipes settings, add/remove/reorder actions, and re-run the
  same gesture matrix to verify the active mapping and triage-bar actions. On
  iOS, separately open Command → Swipes and customize each triage-bar direction:
  inspect available actions, order, add/remove/reorder controls, save/cancel,
  and the resulting visible bar. Verify the documented Android availability
  boundary rather than assuming iOS customization exists there. Use
  [Customizing Swipes and Triage Bar](https://help.superhuman.com/hc/en-us/articles/46005742942861-Customizing-Swipes-and-Triage-Bar)
  as the platform reference. Mail source maps left to archive and right to
  snooze, with an 80px commit threshold, a 56px minimum fling distance at
  0.11px/ms, and a 180ms archive handoff; those implementation values do not
  establish equivalence with Superhuman's Done/Reminder actions. A synthetic
  touch suite now covers both directions, threshold/fling boundaries,
  vertical/diagonal locks, cancellation, missing handlers, and trailing clicks
  (`EmailListItem.touch.interaction.test.tsx`; focused run: 2 files, 12 tests).
  It found and fixed cancellation leaving the click-suppression flag set, which
  swallowed the next independent row click. These are Mail-only tests; paired
  mapping, thresholds, animation, and settings behavior remain unverified.
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
  Local deterministic evidence on 2026-09-14: six synthetic draft-builder cases
  cover Reply, Reply All, and Forward recipients, subject/body, source
  message/thread/account metadata, and forwarded attachment metadata. The tests
  exposed that thread-view Forward omitted original attachments; Mail now
  carries the existing Gmail attachment references into both inline and
  list-modal forward drafts. This is Mail-only builder evidence, not a UI replay
  or sent-message test; paired Superhuman recipient/focus behavior remains
  unverified.
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
  disabled. Command palette, reply/forward, route persistence, and further
  paired behavior from other starting states remain unverified.
  Paired live check on 2026-09-14 (Superhuman 1041.0.54; Mail baseline commit
  `13aa214a29cbd5142d94f12d8ff85168c5372dad`; 1280×720): `c` from a Superhuman
  search-result view opened a main-workspace compose with To focused. In Mail,
  `c` did nothing while the minimized-draft Restore button held focus. Before
  the fix, moving focus to the inbox and pressing `c` created a draft but left
  the compose stack minimized. The working-tree fix now reveals a newly active
  draft and expands new-message compose; a live replay from inbox focus showed
  To focused and Send disabled. The blank test draft was discarded, and the
  pre-existing draft was left untouched and minimized again. Mail's expanded
  composer still overlays the main pane, so its layout is not yet verified as
  equivalent to Superhuman's main-workspace compose. The focus-dependent no-op
  and other focus targets remain open. A further live `⌘K` → Compose check on
  2026-09-14 (1280×720; Superhuman 1041.0.54; Mail branch `e8d8ab3c39`)
  selected `Compose C` in Superhuman and `Compose new email C` in Mail. Both
  opened a blank composer with To focused. At that baseline, Mail marked Send
  disabled while Superhuman did not. The follow-up Mail change keeps Send
  available and routes empty-recipient submission through the existing
  validation before staging or provider calls; focused tests and a live palette
  selection confirm the recipient warning and no send. A paired compose-palette
  replay found Superhuman's Send, Send Later, and Send + Mark Done commands; Mail
  now exposes Send, Schedule send, and Send and mark Done only in compose
  context. Mail's Schedule send command and Cmd+Shift+L both open the existing
  preset/date picker without scheduling. Superhuman opens a natural-language
  time field with suggestions, so Mail's fixed presets/date picker remain a
  concrete difference. Starting states differed: Superhuman had no existing
  draft while Mail did. The blank Mail test draft was discarded and the existing
  draft restored untouched; the Superhuman blank compose was closed with
  Escape. No email was sent. No screenshot/layout or latency comparison was
  performed, and remaining compose actions and aligned-state replay are still
  open.
- COMPOSE-002 — Minimize, restore, fullscreen, pop out, close, close all, switch
  draft tabs, create a second draft, and reopen a closed draft. Test mouse,
  keyboard, outside click, Escape, and browser navigation. On 2026-09-14,
  Superhuman's pop-out was returned with Pop In, and Escape from a blank
  main-workspace compose returned to the prior view. In Mail, synthetic A/B
  drafts displayed the matching body after switching tabs; fullscreen toggled
  on and back off. With an existing draft minimized, `c` from inbox focus
  created a visible second draft with To focused and Send disabled. Escape
  closed that blank test draft and restored the pre-existing draft expanded;
  it was minimized again without editing it. This Escape replay did not match
  Superhuman's starting state (no existing minimized draft), so there is no
  parity conclusion yet. A second replay through `⌘K` → Compose likewise
  returned to the pre-existing draft on Escape; it was minimized again without
  changing its contents. The command-palette replay also lacked a matching
  Superhuman minimized-draft starting state. The other blank test drafts were
  also discarded. In the later schedule-command replay, the blank Mail test
  draft was discarded and the pre-existing draft restored/minimized; the blank
  Superhuman compose was closed with Escape. Neither draft's contents were
  changed and no message was sent.
  Close/close-all recovery, outside click, browser navigation, and other
  platform/focus variants remain unverified.
- COMPOSE-003 — Type To/Cc/Bcc recipients by name, full/partial address, aliases,
  commas, semicolons, newline paste, drag between fields, duplicate casing,
  invalid address, display name, whitespace, Backspace, Delete, Enter, Tab,
  arrows, Escape, blur, and mouse click. A 2026-09-14 regression pass found
  that unfinished recipient text could remain local to To/Cc/Bcc while Send or
  Schedule snapshotted the committed draft, silently omitting the visible text.
  `ComposeModal` now blocks both paths while any recipient input still contains
  uncommitted text; mocked interaction tests cover all three fields and assert
  no send staging or provider call occurs. An isolated memory-backed browser
  replay with one allowlisted recipient confirmed that Send and Schedule each
  show the localized finish-input notice and leave the compose open; no Google
  account was connected and no provider call occurred. `RecipientInput` tests
  also verify that comma commits a typed address, empty commas add no chip, and
  Backspace removes the last chip only when the input is empty. The focused
  recipient interaction suite passes 15 tests. Superhuman behavior and a
  connected-provider round trip remain unverified.
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
  and Superhuman's matching behavior remain unknown. A supplemental synthetic
  component case on 2026-09-14 seeded same-name contacts in descending
  frequency order: a name query preserved that order, Enter committed the first
  result, and a mixed-case exact-address query narrowed to one contact. This
  confirms Mail's current UI behavior only; Superhuman's matching and ranking
  remain unknown pending paired observation. A new eight-contact regression
  reaches the last option in the 200px scrollable list and verifies that the
  active option requests `scrollIntoView({ block: "nearest" })`; Mail previously
  changed `aria-selected` without scrolling it into view. This is Mail-only
  interaction proof, not a confirmed Superhuman discrepancy. Further isolated
  regressions verify that combined alias/contact options keep keyboard indexes
  and `aria-activedescendant` aligned, and Enter accepts an alias and resets the
  query. The recipient interaction suite passes 15 tests; Superhuman's
  alias-ranking and selection behavior remains unobserved.
- COMPOSE-005 — Open alias details, edit, expand to individual recipients, save
  a group, cancel/fail/retry, remove one chip, and remove all chips.
- COMPOSE-006 — Enter subject/body with plain text, rich text, markdown, links,
  bold/italic/strike/code/quote/lists, paste plain/rich HTML, undo/redo, select
  all, keyboard navigation, and contenteditable focus transitions. If
  autocorrect changes a word, use Cmd/Ctrl+Z to undo that correction, then test
  the offered “Learn word” action without losing adjacent draft text. On mobile,
  tap the frame icon above Send, double-tap text, open the selection arrow, then
  tap Format; inspect the actual menu before comparing documented desktop styles
  (bold, italic, underline, lists, quote) with iOS and Android. For links, use
  the bottom link icon and paste a URL. Record toolbar visibility with the
  keyboard open/closed, selection handling, and whether formatting applies to
  selected text or the insertion point. Use the official
  [Formatting Text](https://help.superhuman.com/hc/en-us/articles/46005721681165-Formatting-Text)
  guide; it does not enumerate the full mobile Format menu, so do not assume
  every desktop style is available on mobile.
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
  not prior emails or drafts. Confirm platform and language boundaries before
  interpreting a missing suggestion: test desktop English, mobile, and a
  non-English compose locale, recording whether the feature is absent, disabled,
  or produces no match. The official [Autocomplete](https://help.superhuman.com/hc/en-us/articles/46005685782669-Autocomplete)
  article documents phrase autocomplete, not recipient/contact ranking. Keep
  those sources and behaviors separate. Mail currently uses a small deterministic
  local phrase list, so keyboard/state parity is partial; prediction quality,
  timing, and exact visual parity remain unverified beyond the paired live sample
  below.
  A synthetic Mail browser pass at commit `baba8a1` verified the gray preview,
  Settings and Cmd/Ctrl+K toggles, Tab acceptance, and Escape dismissal before
  the next Escape closed the unsent compose. Send stayed disabled with no
  recipient. No Superhuman state was observed in that run. Unit regressions in
  `app/components/email/compose-autocomplete.test.ts` also cover preference
  refresh, caret/range movement, continued typing, code/link marks, external
  edits, and IME acceptance suppression; these Mail-only checks do not close
  paired replay. A 2026-09-14 isolated in-memory browser pass with no connected
  Google account verified the default-off → Command enable toggle, a gray
  `Thanks` suffix, single-insertion Tab/Right acceptance, Escape dismissal
  without text mutation, and a second Escape closing the compose. Send stayed
  disabled, and the test draft disappeared with the memory-only server.
  That run was Mail-only, not paired evidence. A paired live replay on 2026-09-14
  used Superhuman 1041.0.54 and Mail commit
  `13aa214a29cbd5142d94f12d8ff85168c5372dad` at 1280×720. Each pass started from
  a signed-in surface and a new recipient-free compose. The identical synthetic
  prefix `Thanks for` showed an inline suffix in both apps, but the observed
  text differed (Superhuman `the`; Mail `taking the time.`), so this sample does
  not establish prediction-quality parity. Escape removed the preview without
  changing the typed prefix in Superhuman (`Thanks for`) and in Mail's separate
  `Thanks` case. Tab acceptance was confirmed for `Thanks for` in both (in
  Superhuman, the suffix remained after Tab and a subsequent Escape).
  Superhuman Autocomplete was on when first inspected and left unchanged; Mail
  was off at the start, enabled for its test, then restored off. No recipient
  was entered and no message was sent. Both test drafts were discarded; the
  pre-existing local draft was left untouched. No screenshot artifacts were
  saved. Timing, caret/wrapping, Right Arrow acceptance in Superhuman, toggle
  persistence, mobile/language boundaries, and the other COMPOSE-007 cases
  remain unverified.
- COMPOSE-008 — Use slash menu, generate/agent handoff, code block language
  picker, link dialog, image paste/drop/upload/failure, and toolbar
  button focus/tooltip states.
- COMPOSE-009 — Add/remove/reorder attachments via picker, drag/drop, paste,
  reply/forward originals, duplicate files, invalid type, size limit, upload
  progress, upload failure, retry, and draft reopen. Compare Cmd/Ctrl+Shift+U
  with drag/drop. Select the original message before Reply/Reply All and use
  Include Original Attachments; Forward appends the original files. On mobile,
  separately test New Message and Reply `+ → Attach`, then Forward from the
  reply menu. Compare photo/library, camera, and document picker entry points
  where offered; cancel each picker, attach multiple files, remove an
  attachment, and reopen the draft. For received attachments, test preview/open,
  save, and share, distinguishing iOS inline-image Save to Photos, attached-image
  Save to Files, attached-document Share → Save to Files, and Android's
  long-press View attachment versus Save attachment. Include cancel/failure and
  return-to-thread state. Use the official
  [Attachments](https://help.superhuman.com/hc/en-us/articles/46005568142989-Attachments)
  guide; picker paths may differ by platform.
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
  any provider side effect. On 2026-09-14, selecting Send from Mail's compose
  palette with empty To produced the recipient warning; focused tests confirm
  that neither send staging nor the send/schedule provider is called. Other
  validation cases remain open; no live email was sent.
- SEND-002 — Test Send click, Cmd/Ctrl+Enter, command palette, queued draft send,
  visible send button, and Cmd/Ctrl+Shift+Enter Send + Done. Verify the latter's
  exact Done target (reply thread versus new message), archive timing, failure
  recovery, approval/confirmation boundary, and no duplicate sends from double
  click, key repeat, retry, or rerender. With the preference off, ordinary reply
  sends leave the thread in Inbox and Cmd/Ctrl+Shift+Enter marks the replied-to
  thread Done; with it on, ordinary reply sends also mark that thread Done.
  New-message and forward drafts never archive a source thread. Archive only
  after send succeeds; if archive fails, preserve the sent state and do not
  retry the send. Mail now implements these paths locally, based on the
  [official Send + Mark Done guide](https://help.superhuman.com/hc/en-us/articles/47439134613773-Mark-Done).
  A 2026-09-14 paired palette replay confirmed Superhuman exposes Send, Send
  Later, and Send + Mark Done in compose; Mail now exposes the corresponding
  actions, routes Send + Mark Done through the existing explicit-send path, and
  opens its scheduler without committing a time. Tests cover the empty-To guard
  and mocked explicit-send/archive path. No live message was sent. Continue to
  use mocked sends; valid-recipient dispatch, queued-draft send, duplicate-send
  defenses, retry, and archive-failure behavior remain unverified. Do not mark
  SEND-002 complete from command visibility alone.
- SEND-003 — Test optimistic send, `Z` Undo within the reference’s 10-second
  window and at the boundary, after toast change, after navigation, and after
  refresh. Never call a message “sent” before the provider result is
  authoritative.
- SEND-004 — Delay/deny the provider. Verify sending, delayed, failed, edit,
  retry, discard, rollback of optimistic reply, exact error, and preserved draft.
- SEND-005 — Open Send Later from the split-button, Command, and
  Cmd/Ctrl+Shift+L. Record the preset order and dates. Type a relative date,
  weekday plus time, time-only value, yearless date, day-part phrase, invalid
  phrase, and a past date. Check suggestion text, local timezone, ArrowUp and
  ArrowDown, Enter, click, first and second Escape, outside click, reopen, and
  custom date/time selection. Verify minimum time, daylight-saving boundaries,
  parse latency, schedule success/failure, scheduled-list read-back, send-now,
  cancel, and undo. With a mocked provider, verify an email scheduled before
  going offline still sends at its scheduled time, while a send/schedule queued
  offline waits for connectivity and syncs after reconnect. Never use a real
  send for this case. On mobile, open Send Later from a new compose and a
  reply, choose a suggested day/time, then Pick date & time; verify touch
  selection, picker confirm/cancel, local timezone, minimum time, dismissal,
  reopen state, and that scheduling never falls through to Send. Record whether
  the mobile surface omits natural-language input as documented. Compare the
  official [Schedule Emails](https://help.superhuman.com/hc/en-us/articles/47206763851533-Switching-from-Notion-Mail-to-Superhuman-Mail)
  guide with the live behavior.
  Superhuman baseline (2026-09-14, no message sent): an empty picker suggested
  tomorrow at 8:00 AM, tomorrow at 1:00 PM, and next Monday at 8:00 AM. The
  input placeholder was “Try: 8 am, 3 days, aug 7”. `Monday 9:45am` resolved to
  the next Monday at 9:45 AM, `3 days` to 8:00 AM in three days, `8 am` to the
  next day at 8:00 AM, and yearless `aug 7` to August 7, 2027. The first Escape
  cleared typed text while keeping the picker open; the second closed it.
  Mail now has a local natural-language parser, those three preset equivalents,
  two-step Escape handling, and a native-picker fallback with the hidden input
  kept out of tab order. Parser/component regression cases were added for the
  observed phrases, future-only dates, keyboard commitment, Escape, and picker
  fallback. They have not been run yet because Mail browser/e2e verification is
  serialized behind the active Slides QA pass. No Mail parity claim is made
  until those tests and a same-state browser replay pass. With a mocked
  provider, verify schedule success/failure and offline behavior without
  sending real mail.
- SEND-006 — Test Smart Send on an eligible Business/Enterprise desktop account:
  activity-data eligibility, no recommendation, recipient timezone, multiple
  recipients and optimization choice, no-reply reminder mode, scheduled-send
  override, reply arriving before delivery (scheduled message returns to Drafts),
  manual Send, and plan/platform gating. Mark Mail's intentional gap explicitly.
- SEND-007 — If a live round trip is approved, use only the exact addresses the
  current user explicitly allowlisted for this run. Send one exact approved
  test message, wait for Sent, receive on the other allowed account, verify
  thread grouping, read/unread, reply, and cleanup/archive. Do not persist those
  addresses in fixtures or documentation, and do not contact anyone else. Live
  evidence (2026-09-14): one self-directed message was sent using an explicitly
  approved account; Superhuman showed “Message sent,” and an exact-subject
  search showed the message as “Me.” Only one Superhuman account was connected.
  Mail was on its local development account and the second allowed mailbox was
  not connected, so cross-account receive/thread/reply/read-state verification
  and Mail real-provider send remain unverified. SEND-007 is not complete.
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
  and account scope. Mail's global Spam, Block, and Mute handlers now forward
  the focused message's account into their provider requests, and the server
  validates that requested account before Gmail mutation; source and handler
  regression coverage passed on 2026-09-15. Use mocked unsubscribe and
  provider effects; never unsubscribe, block, or report a real personal
  message.
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
  rather than inferring them. For Mail's Gmail filter editor, explicitly verify
  account selection/scope, create and edit-or-replace semantics, each available
  filter action, and loading, error, and retry states. Use synthetic accounts
  and data only; read back the saved filter and matching effects in the same
  account scope. Remove the disposable rule and its fixtures.
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
  provider mocks after the case. Auth proof is split: a live Gmail provider
  connection through the local-dev session confirms provider-mail access, but
  does not prove normal Google identity sign-in. A delegated identity attempt
  reached the callback but failed with `account_owner_mismatch`; the local
  sign-in view observed then exposed no normal sign-out control, so no safe
  sign-out and retry path was available at that time. Recheck the affordance
  during the focused pass. No account/user rows or OAuth tokens were
  changed, no consent screen was accepted, and repeated live login attempts
  are out of scope. Inspect the exact error UX during the focused pass. If safe
  reauthentication remains unavailable, report the
  Google identity sign-in case as unverified while continuing provider-mail
  E2E tests through the existing connection.
- ACCOUNT-002 — With two synthetic accounts, compare Command-based desktop add,
  desktop account switching/reordering/sign-out, and per-account draft sender.
  Repeat setup on mobile (accounts added on desktop do not auto-sync); test the
  add-account flow, tap to cycle, and long-press to choose an account. Verify
  account order after adding, switching, and reordering, and that the selected
  identity is consistent in the picker and compose From field. Use the official
  [Managing Accounts](https://help.superhuman.com/hc/en-us/articles/46005777934733-Managing-Accounts)
  guide as reference. Compare Windows' documented account-switch modifier with
  the live shortcut inventory. Record that the
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
  dismissal. An isolated browser pass with Search value `abc` confirmed that
  Cmd+K focuses the palette, typing `archive` selects Go to Archive, the first
  Escape clears the palette query while keeping it open, and the second closes
  it and restores Search focus, query `abc`, and `/all?q=abc`. On 2026-09-14,
  a local Mail replay opened
  Command from the To field on a synthetic no-result route, selected
  Shortcuts, and confirmed the first Escape cleared the palette query while
  leaving the shortcut reference open; the second Escape closed Command,
  restored focus to To, and preserved the route and open compose. The compose
  draft was not edited or sent. Automated focus regressions now cover Cmd+K and
  Ctrl+K from To, the two-step Escape behavior, recipient/search preservation,
  and route preservation. A paired live replay on 2026-09-14 confirmed that
  Superhuman's Cmd+K opens Command from a selected thread with the search field
  focused; `shortcuts` filters to Shortcuts, the first Escape clears the query
  while keeping Command open, and the second closes it and returns focus to the
  thread. Superhuman's Shortcuts result opens a categorized reference, which
  closes with Escape. In local Mail, Cmd+K from To with an empty query closes
  with one Escape, restores To focus, and preserves the synthetic route, search
  query, and existing draft; automated Cmd+K/Ctrl+K regressions now cover that
  one-Escape path. No message content was edited and nothing was sent. A later
  blank-compose replay searched `send`: Superhuman showed Send, Send Later, and
  Send + Mark Done among broader search matches; Mail showed only its three
  compose-safe actions plus Ask AI, with Spam/Block/Mute/Snooze absent. Mail's
  Schedule send action opened its existing presets/date picker; Cmd+Shift+L
  opened the same picker. Mail also exposes a natural-language date field with
  suggestions: `schedule-date.spec.ts` and `SendLaterButton.test.tsx` cover
  relative/day-part/weekday parsing, preview without scheduling, invalid input,
  keyboard selection, native-picker fallback, and two-step Escape. Superhuman's
  paired replay exposed its corresponding natural-language scheduler; exact
  grammar, suggestion ordering, and matched visual states still need a paired
  replay. Escape closed both test composers/pickers without choosing a send
  time; the Mail test draft was discarded and the prior draft restored. No
  email was sent. Starting states differed because Mail had a pre-existing
  draft; other SETTINGS-001 contexts remain open.
- SETTINGS-002 — Open shortcut reference and hover every action. Confirm the
  displayed shortcut is the one that actually runs. Compare US QWERTY with the
  documented Belgian/French/German alternatives for Search, Trash, Tab, snippet,
  and calendar; test Colemak's listed reply/navigation/snippet overrides. Do not
  infer native support for an unlisted international layout. The official
  [International keyboard shortcuts](https://help.superhuman.com/hc/en-us/articles/46005584339597-Shortcuts-for-International-Keyboards)
  article documents Shift+7 for Search on Belgian/French/German layouts. Mail
  now accepts `/` with either Shift state for Search only; focused hook
  regressions cover shifted and unshifted `/`, reject Alt, and preserve strict
  Shift matching for other shortcuts. The local live browser verified the
  canonical US `/` path; the generated international key event and paired
  Superhuman behavior remain unverified on physical international hardware.
- SETTINGS-003 — Settings navigation/search/back/refresh. Test signature,
  drafting style, snippets, aliases, tracking, accounts, split/combine inbox,
  filters, automations, AI filter, Auto Labels/Archive/Drafts/Reminders,
  integration/team permissions, theme, and unsaved changes. Exercise the
  rendered theme control toggles light ↔ dark; with system or no saved
  preference, verify it follows the resolved OS theme and a click selects the
  opposite explicit theme. Verify saved preference after reload and behavior
  when the OS theme changes while system is selected. In AI Filter settings,
  test enable/disable and auto-filter toggles,
  threshold changes and persistence, editing/saving/canceling instructions,
  and Keep/Filter review decisions, including loading, error, retry, and state
  readback; use synthetic messages only.
- SETTINGS-004 — Use `view-screen`, `navigate`, `get-thread`, `list-inbox-threads`,
  `list-emails`, `search-emails`, `find-contact`, `manage-draft`, and mutation
  actions against the same visible state. Include the `export-emails` action;
  verify its success/output shape and safely read back the exported message
  identifiers/content against the synthetic source state, without exposing
  unrelated personal mail. Read back after every write.
- SETTINGS-005 — Confirm navigation state includes view, tab, threadId,
  focusedEmailId, selectedThreadIds, search, label, filter, active accounts,
  queuedDraftId, settings section, and composeDraftId where applicable.
- SETTINGS-006 — Test agent-created/updated draft, agent navigation, external
  refresh signal, concurrent UI edit, stale response, action error, and recovery.
- SETTINGS-007 — Open Superhuman Command → Shortcuts from the inbox, an open
  thread, and compose. Compare the displayed shortcut and context, then hover
  the corresponding Mail controls and compare each tooltip with the action it
  triggers. Use the official
  [Keyboard shortcuts](https://help.superhuman.com/hc/en-us/articles/46005701270541-Keyboard-Shortcuts-in-Superhuman-Mail)
  guide as reference. Compare every displayed shortcut, then
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
  On 2026-09-14, paired desktop replay from a Superhuman thread verified
  Cmd+K opens Command with search focused, `shortcuts` filters to the Shortcuts
  result, and the first Escape clears the query while the second closes Command
  and returns focus to the thread. The Shortcuts result opened the categorized
  reference and Escape returned to the thread. Empty-query Command dismissal
  closed in one Escape in both Superhuman and local Mail. This verifies only
  these Command/Shortcuts paths; the other source findings remain gaps to
  validate, not runtime parity evidence. On 2026-09-14, a hook test
  exposed a stale-sequence bug: AppLayout's inline sequence list caused the
  listener effect to restart on rerender, canceling the one-second expiry while
  leaving the partial key buffered. `useSequenceShortcuts` now keeps one
  listener, reads the latest sequence list through a ref, and clears pending
  keys when disabled or unmounted. Regression coverage checks successful
  one-shot dispatch, input exclusion, timeout across rerender, and disable
  cleanup; a fresh full Mail suite run on 2026-09-14 passes 963 tests across
  112 files.
  An earlier disconnected browser pass searched the Mail command palette for
  `shortcut` and found no shortcut-reference entry. A local browser replay on
  2026-09-14 now opens Command with Cmd+K, finds `Shortcuts`, and displays the
  Global, Message list, Conversation, and Compose scopes. Escape clears the
  palette query while keeping the reference open; a second Escape closes
  Command, returns to `/all`, restores page focus, and leaves the existing
  compose panel open. Mail now has a four-scope local
  Command → Shortcuts reference (Global, Message list, Conversation, Compose)
  cross-checked against the actual shortcut handlers. Regression coverage
  checks scope-specific mappings including list versus conversation J/K,
  conversation N/P and Escape, read-state toggling, conversation select-all,
  and compose send-and-mark-done. The paired 2026-09-14 live replay verifies
  Command/Shortcuts behavior only; the full Superhuman shortcut baseline and
  behavior parity across its mappings remain unverified. A separate compose
  replay confirms Mail's Cmd+Shift+L opens the schedule picker without
  scheduling; regression tests cover Cmd+Shift+L and Ctrl+Shift+L. Superhuman
  uses Cmd+Shift+L for Send Later but opens a natural-language scheduler, which
  remains a difference. The direct Trash action now accepts both Mail's
  existing `D` shortcut and Superhuman's `#` alias in list and conversation
  contexts, including either Shift state for the browser key event; the
  Command → Shortcuts reference displays both. Focused list mutation coverage,
  conversation source coverage, and the full Mail suite passed on 2026-09-14
  (963 tests across 112 files).
  The thread toolbar now advertises the same `D / #` aliases as the local
  Command → Shortcuts reference; the paired toolbar tooltip appearance and
  full shortcut replay remain unverified.

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

For every paired live observation, record the exact Superhuman build/version,
Mail commit, matched viewport dimensions, matched starting state, and a
screenshot or artifact reference for each product. If any item is unavailable,
mark the observation non-reproducible and do not treat it as complete parity
evidence.

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
