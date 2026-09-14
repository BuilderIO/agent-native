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
  back/forward history.
- NAV-003 — Open hidden navigation with the keyboard and close it with Escape;
  repeat with mouse, touch, outside click, and browser Back.
- NAV-004 — Cycle tabs with Tab and Shift+Tab. Confirm focus ring, wraparound,
  selected tab, URL, and that Tab remains native while a button/input owns focus.
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

## Search and search autocomplete

- SEARCH-001 — Open search with `/`, Command/Ctrl+K → Search, click, and mobile
  search. Confirm focus, placeholder, caret, active route, and close behavior.
- SEARCH-002 — Type one character, two characters, three characters, spaces,
  quoted text, unicode, punctuation, and a long query. Confirm debounce,
  local-match timing, remote-search timing, and no request for short queries.
- SEARCH-003 — Navigate contact suggestions with ArrowDown/ArrowUp, Home/End
  if supported, Enter, mouse hover, mouse click, and Tab. Confirm the selected
  result is the one opened and focus/URL are correct.
- SEARCH-004 — Navigate local thread suggestions after contacts. Confirm the
  selected local item scrolls into view and does not reuse a contact index.
- SEARCH-005 — Search with Gmail operators: `from:`, `to:`, `subject:`,
  `has:attachment`, `label:`, `is:unread`, date ranges, quoted phrases, OR,
  AND, and exclusion. Confirm parser/result parity and visible query retention.
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
- SEARCH-011 — Select a suggestion, then close the dropdown and rapidly change
  between matching, no-match, and different-match queries. Confirm
  `aria-activedescendant` is absent while closed or when the selected index is
  stale, and otherwise always resolves to a rendered option in the open list.

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
- LIST-005 — Test each product's displayed e/Done/archive, d or #/trash, u
  toggle, Shift+I read, Shift+U unread, s star/pin, r reply, reply-all, f
  forward, h snooze, Shift+! spam, and z undo mappings. Record the actual key
  shown by Superhuman Command and the corresponding Mail key; do not assume
  Gmail semantics.
- LIST-006 — Select noncontiguous rows, contiguous rows with Shift, select all,
  deselect one, clear selection, then bulk archive, trash, read/unread, star,
  move, label, spam, and snooze.
- LIST-007 — Exercise each optimistic mutation before, during, and after a
  delayed request. Verify row removal/state change, count change, focus advance,
  request failure rollback, error message, and refresh reconciliation.
- LIST-008 — Undo archive, trash, read/unread, star, snooze, and send. Trigger
  with toast click, z, timeout boundary, another action, route change, and
  refresh. Confirm the undo does not restore into the wrong partition.
- LIST-009 — Drag/reorder tabs, labels, and saved filters. Test left/right drop,
  same-item drop, cross-group drop, cancelled drag, keyboard alternative, and
  persistence after reload.
- LIST-010 — Swipe left/right on touch: below threshold, threshold, fast fling,
  diagonal/vertical scroll, touch cancel, missing action, action commit, modal
  open, and trailing click suppression.
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
- THREAD-006 — Open/download one attachment, all attachments, missing URL,
  unsupported type, large file, duplicate filename, and failed download.
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

## Compose, recipients, and autocomplete

- COMPOSE-001 — Open compose with button, c, Command/Ctrl+K → Compose, reply,
  reply-all, forward, draft row, queued draft, and agent navigation. Confirm
  focus target, size, title, route/state, and account. New-message compose opens
  in the main workspace by default; minimize and restore remain reversible.
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
- COMPOSE-005 — Open alias details, edit, expand to individual recipients, save
  a group, cancel/fail/retry, remove one chip, and remove all chips.
- COMPOSE-006 — Enter subject/body with plain text, rich text, markdown, links,
  bold/italic/strike/code/quote/lists, paste plain/rich HTML, undo/redo, select
  all, keyboard navigation, and contenteditable focus transitions.
- COMPOSE-007 — Test Superhuman-style word/phrase autocomplete reference states:
  suggestion off, inline gray suggestion, accept with Tab/Right Arrow, dismiss
  with Escape, continue typing, mobile unavailable, and settings toggle. Mark
  Mail as gap until it has an intentional equivalent.
- COMPOSE-008 — Use slash menu, snippets, generate/agent handoff, code block
  language picker, link dialog, image paste/drop/upload/failure, and toolbar
  button focus/tooltip states.
- COMPOSE-009 — Add/remove/reorder attachments via picker, drag/drop, paste,
  reply/forward originals, duplicate files, invalid type, size limit, upload
  progress, upload failure, retry, and draft reopen.
- COMPOSE-010 — Test signature absent/present/multiline/quoted text, toggle
  quoted content, avoid duplicate signatures, reply quote boundaries, and
  edits before/after the quote.
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

## Send, schedule, and failure recovery

- SEND-001 — Validate empty To, malformed recipient, missing subject, empty body,
  alias expansion, duplicate recipients, self-send, and To/Cc/Bcc overlap before
  any provider side effect.
- SEND-002 — Test Send click, Cmd/Ctrl+Enter, command palette, queued draft send,
  and visible send button. Verify approval/confirmation boundary and no duplicate
  sends from double click, key repeat, retry, or rerender.
- SEND-003 — Test optimistic send, undo within window, undo at boundary, after
  toast change, after navigation, and after refresh. Never call a message
  “sent” before the provider result is authoritative.
- SEND-004 — Delay/deny the provider. Verify sending, delayed, failed, edit,
  retry, discard, rollback of optimistic reply, exact error, and preserved draft.
- SEND-005 — Send Later presets, custom date/time, natural language, timezone,
  past/minimum date, daylight saving transition, picker cancel, slow parse,
  parse failure, schedule success/failure, scheduled list, send-now, and cancel.
- SEND-006 — Test Smart Send reference states: activity recommendation,
  recipient timezone, multiple recipients, disabled/no data, scheduled override,
  and manual send. Mark Mail's intentional gap explicitly.
- SEND-007 — If a live round trip is approved, use only the exact addresses the
  current user explicitly allowlisted for this run. Send one exact approved
  test message, wait for Sent, receive on the other allowed account, verify
  thread grouping, read/unread, reply, and cleanup/archive. Do not persist those
  addresses in fixtures or documentation, and do not contact anyone else.

## Labels, folders, spam, and reminders

- ORGANIZE-001 — Open label/folder menus from list, thread, command palette, and
  Settings. Test search, nested labels, duplicate names, missing labels, create,
  rename, delete, apply, remove, move, and remove-label-and-done.
- ORGANIZE-002 — Compare Archive/Done, All Mail, Inbox, label, Sent, Trash, and
  Spam boundaries. Confirm replies to archived/done threads resurface correctly.
- ORGANIZE-003 — Report spam, undo, block sender/domain, unsubscribe, mute,
  restore from Trash/Spam, and test missing/duplicate action targets.
- ORGANIZE-004 — Snooze presets, weekday prefixes, natural-language date/time,
  timezone, multi-select, swipe, modal keyboard navigation, cancel, failure,
  resurface, and reminder list.
- ORGANIZE-005 — Compare Superhuman Auto Reminders: sent/no reply detection,
  reminder scheduling, trigger, dismiss, and cancel. Mark Mail's intentional gap
  until implemented and covered by actions/application state.

## Settings, command palette, and agent parity

- SETTINGS-001 — Open Command/Ctrl+K from list, thread, compose, search, modal,
  button, and text editor. Search commands, arrows, Enter, Escape, query reset,
  contextual command visibility, and shortcut labels.
- SETTINGS-002 — Open shortcut reference and hover every action. Confirm the
  displayed shortcut is the one that actually runs, including international
  keyboard alternatives and native Tab behavior.
- SETTINGS-003 — Settings navigation/search/back/refresh. Test signature,
  drafting style, snippets, aliases, tracking, accounts, split/combine inbox,
  filters, automations, AI filter, integrations, theme, and unsaved changes.
- SETTINGS-004 — Use `view-screen`, `navigate`, `get-thread`, `list-inbox-threads`,
  `list-emails`, `search-emails`, `find-contact`, `manage-draft`, and mutation
  actions against the same visible state. Read back after every write.
- SETTINGS-005 — Confirm navigation state includes view, tab, threadId,
  focusedEmailId, selectedThreadIds, search, label, filter, active accounts,
  queuedDraftId, settings section, and composeDraftId where applicable.
- SETTINGS-006 — Test agent-created/updated draft, agent navigation, external
  refresh signal, concurrent UI edit, stale response, action error, and recovery.

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

## Official comparison anchors

Use current official Superhuman help articles for the reference behavior and
re-open them when the product changes:

- [Keyboard shortcuts](https://help.superhuman.com/hc/en-us/articles/46005701270541-Keyboard-Shortcuts-in-Superhuman-Mail)
- [Autocomplete](https://help.superhuman.com/hc/en-us/articles/46005685782669-Autocomplete)
- [Search](https://help.superhuman.com/hc/en-us/articles/46005672652301-Search)
- [Undo](https://help.superhuman.com/hc/en-us/articles/46005666743309-Undo)
- [Mark Done](https://help.superhuman.com/hc/en-us/articles/47439134613773-Mark-Done)
- [Attachments](https://help.superhuman.com/hc/en-us/articles/46005568142989-Attachments)
- [Labels](https://help.superhuman.com/hc/en-us/articles/46005736546061-Labels)
- [Mobile navigation](https://help.superhuman.com/hc/en-us/articles/46005719737357-Mobile-Navigation)
- [Failed sends](https://help.superhuman.com/hc/en-us/articles/46005543693581-Failed-Sends)
- [Quick Quote](https://help.superhuman.com/hc/en-us/articles/46005692763661-Quick-Quote)
- [Instant Reply](https://help.superhuman.com/hc/en-us/articles/46005583725709-Instant-Reply)
