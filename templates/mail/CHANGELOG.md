# Changelog

All notable user-facing changes to Agent-Native Mail are documented here. Open it any
time from the command menu (Cmd+K → "What's new") or from Settings.

## 2026-09-25

### Improved

- Tune inbox priorities with Jev, label messages clearly, and teach importance with feedback.

### Fixed

- Editing importance rules preserves disabled instructions and recovers from duplicate-rule deletion failures
- Handle astral Unicode letters in autocomplete word boundaries
- Keep existing AI filter rules intact when saving a prompt
- Keep inbox tab counts consistent when switching tabs

## 2026-09-24

### Improved

- Add an All inbox tab that shows every inbox thread and can be hidden in tab settings.
- Priority sort keeps results when switching inbox tabs, and loading tabs show a skeleton
- The composer keeps its taller layout in a narrower window.
- The compose window opens larger, leaving more room to write with quieter toolbar icons.

### Fixed

- Gmail inboxes refresh reliably when push notifications are delayed.
- Priority sorting stays in place when you return to the inbox

### Security

- Mail automations no longer fall back to shared deployment LLM keys; connect a provider in Settings to enable them.

## 2026-09-23

### Improved

- Jev email matches now show match probability instead of calling it confidence.

### Fixed

- Mail keeps Priority sort selected when Jev availability is temporarily unavailable.

## 2026-09-22

### Improved

- Jev-powered Mail rules and Priority sort work with an enabled Builder space or your personal Jev key.
- Apps start with an app-shaped skeleton while session data loads immediately.

### Fixed

- Signed-out desktop tabs now show sign-in instead of retrying the inbox every 20 seconds.
- Mail keeps cached messages visible when an account refresh fails

## 2026-09-19

### Fixed

- New Mail drafts stay pinned to the bottom of the viewport.
- OpenAI automation settings load without a missing engine package error

## 2026-09-18

### Added

- Mail rules can tag messages or move spam out of Inbox with Jev-powered previews and feedback

## 2026-09-17

### Fixed

- Mail undo keeps newer thread actions intact

## 2026-09-16

### Fixed

- Light and dark mode choices now persist while navigating in the desktop app.
- Moving a conversation to a label now shows it in that label's list immediately, and when two quick actions touch the same conversation, undoing or failing one no longer makes the other one reappear in the inbox.
- Reporting spam, blocking a sender, or muting a conversation now updates the inbox immediately, and if the action fails only that conversation comes back instead of other recent changes being undone.

## 2026-09-15

### Improved

- Account menus are now shorter, with workspace apps and agent management available in Settings.
- Mail labels recipient and account controls for keyboard and assistive-technology parity.
- Match Superhuman's compact compose card geometry on desktop

### Fixed

- Google connections now open reliably in embedded browsers
- Inbox archive and read-state changes stay consistent during rapid actions
- Mail keeps rapid archive and read actions in sync
- Mail recovers cleanly when an email view or navigation takes too long to load.
- New drafts focus the To field immediately for keyboard-first composing

## 2026-09-14

### Added

- Find implemented keyboard shortcuts by context from the Command menu.

### Improved

- Choose a send time by typing a date or time in natural language.
- Keyboard navigation keeps recipient suggestions visible
- Mail Trash shortcuts now also support #
- Make Mail search clear buttons keyboard-activatable while preserving input focus
- New and reopened drafts open in a compact compose card, with fullscreen opt-in.
- Replies can be sent and marked Done with a shortcut or preference
- Screen readers can identify Mail's Search and clear controls.
- Send Later and Send + Mark Done are available in the compose command palette

### Fixed

- Canceled inbox swipes no longer suppress the next tap on a message.
- Expired multi-key shortcuts no longer fire after a layout refresh.
- Mail move actions stay on the selected mailbox account
- Mail now prompts you to finish or clear recipient text before sending or scheduling.
- Mail triage actions stay on the selected mailbox account
- Recipient autocomplete resets its highlighted suggestion when the search query changes.
- Search works on keyboard layouts that require Shift to type the slash key.
- Starting another draft brings it into view even when an existing draft is minimized.
- The message-list A shortcut now opens a Reply All draft
- Forward drafts now retain the original message attachments
- Undo for archive and trash actions now targets only the latest operation and expires after 10 seconds.

## 2026-09-13

### Added

- Compose can suggest common phrases on desktop when autocomplete is enabled

### Improved

- Escape clears the command search before closing the palette and returns focus to the control that opened it.
- Tab stays in compose fields, and a shortcut opens Bcc directly.

### Fixed

- All Mail and Archive now show their correct keyboard shortcuts in the command palette.
- Drafts and sent messages now use the selected Gmail account.
- Fixed Mail to keep scheduled sends bound to the selected account, validate recipients, and report incomplete account and move operations.
- G+A now opens All Mail instead of Archive.
- Gmail drafts report account refresh failures clearly, and multi-account inbox sync avoids repeated lookups.
- Harden scheduled sends and mixed-account moves; localize move confirmations.
- Mail chooses a usable connected account when the default mailbox cannot refresh
- Mail fetches labels from a managed Gmail account when its cache is empty alongside OAuth accounts
- Mail no longer shows a failed OAuth account as connected through a same-address workspace grant.
- Mail reports Gmail account read failures instead of showing incomplete results as empty.
- Search and recipient autocomplete keep keyboard selection aligned with current suggestions
- Search opens and focuses from the command menu

## 2026-09-12

### Improved

- Inbox tabs are easier to distinguish
- New-message compose opens in the main workspace by default

### Fixed

- Closing a draft preserves its saved account and backend so recovery actions affect the correct mailbox.
- Harden draft close recovery and keyboard interaction states
- Keep mail autocomplete accessibility references valid while suggestions close or filter
- Mail keeps saved drafts on their owning backend and preserves them through Send Undo and close-all.
- Saved drafts stay in their original mailbox when reopened, autosaved, or discarded.
- Send status now follows provider results, undo stays available only before dispatch, and draft-save failures are visible. Closing drafts no longer claims a save is complete before persistence, and deleting a draft targets the draft endpoint.

## 2026-09-11

### Fixed

- Inbox tabs now load from a synced local index: counts match the rows shown, custom label and filter tabs only show unarchived mail, and the inbox stays fast under Gmail rate limits.
- Inline images in Gmail emails display reliably, including embedded image data
- Nested Gmail labels now render under their parent labels in the label list.
- On mobile the sidebar shows a close button instead of a pin control that did nothing.
- Opening a label no longer fails with a 502 while Gmail is rate limiting; the app now reports the brief pause with a retry time.
- The inbox tab bar stays on one line and scrolls instead of wrapping.

## 2026-09-10

### Fixed

- Attachments use your connected Builder.io storage in hosted Mail
- Fixed Google sign-in being blocked with an 'unverified password account' error for workspace users provisioned through cross-app SSO.

## 2026-09-09

### Improved

- Account avatars use a slimmer border.

### Fixed

- Select the first top label by default on open, cycle labels with Tab from anywhere, and eliminate skeleton flicker on label change

## 2026-09-08

### Improved

- Login pages use the same mouse-reactive wave background as the docs and booking experiences.

### Fixed

- Mail renders Gmail signature email and social links correctly

## 2026-09-04

### Fixed

- Mail sidebar remains toggleable while agent chat is open.

## 2026-09-03

### Improved

- Faster Mail screen previews
- Mail keeps Gmail labels and agent-created drafts in sync with the inbox.

### Fixed

- Mail filters exclude archived messages, Tab navigation no longer reloads the page, and inbox tabs open faster.

## 2026-09-02

### Improved

- Mail now links pasted URLs, offers a combined inbox, and restores recipient contact autocomplete.

## 2026-08-28

### Fixed

- Mail Settings now shows scheduled automations created from Mail chat.

## 2026-08-22

### Improved

- Gmail can now connect with the shared Google OAuth app in one click

### Fixed

- Gmail Filters in Settings now shows the actual reason for a failure, like needing to connect Google, instead of a generic server error.
- Visiting an unrecognized mail URL now shows the 404 page instead of silently loading the inbox.

## 2026-08-18

### Fixed

- Pinned labels now keep loading until matching inbox messages are found.

## 2026-08-17

### Fixed

- Gmail signatures now preserve images and support paste or upload in Mail
- Mail now updates durable drafting preferences without opening a draft

## 2026-08-12

### Fixed

- Agent-sent messages appear in Mail immediately after Gmail sends them.

## 2026-08-11

### Improved

- Google sign-in now opens the Gmail connection flow directly

### Fixed

- Chrome no longer offers to install Mail as a desktop app.

## 2026-08-06

### Improved

- Long-running mail requests now continue in the background instead of stopping at the foreground time limit.

## 2026-08-03

### Improved

- Inbox automations now prefer the lowest-cost Luna model when a Luna-capable provider is available.

## 2026-07-29

### Improved

- Sidebar footers now keep Feedback, Search, and Collapse together without a separate language shortcut.

## 2026-07-25

### Improved

- App branding now uses the product name without the Agent-Native prefix.
- Settings navigation now keeps Manage agent as a dedicated linked destination at the bottom.

## 2026-07-24

### Improved

- Secondary controls and dashboard surfaces now use quieter borderless styling.
- Sidebar utility controls now follow a consistent footer order.

## 2026-07-23

### Fixed

- Scheduled emails now send only once when multiple requests race.

## 2026-07-22

### Improved

- Manage agent navigation now uses the connected-nodes icon.

### Fixed

- Email messages no longer flash with an unstyled page while loading

## 2026-07-17

### Fixed

- The agent chat sidebar stays closed until you open it or start a chat handoff.

## 2026-07-16

### Fixed

- Mail previews now expand to show the full message without an inner scrollbar

## 2026-07-15

### Fixed

- Unread inbox cleanup now completes reliably in one verified operation while preserving excluded conversations.

## 2026-07-14

### Added

- Connected agents can now securely upload local attachments, honor an exact send you explicitly authorized in chat, and otherwise pause real sends for browser approval.

## 2026-07-13

### Added

- Mail can now return a compact coverage-aware direct inventory across selected connected inboxes.
- New Agent page: see and manage your agent's context, files, connections, jobs, and external access in one place

### Fixed

- Settings links now support opening in a new tab.

## 2026-07-11

### Improved

- Compose resizing and secondary-page navigation now move smoothly without sluggish layout animation.
- Swipe to archive or snooze now responds to quick flicks, not just long drags

### Fixed

- The assistant now sees the same inbox you do — snoozed mail stays hidden and rate limits are handled gracefully

## 2026-07-10

### Improved

- Mail navigation now uses a clean, borderless drawer.
- Mail settings now group drafting, automation, and connected-service controls for quicker scanning.
- Slack intake settings now distinguish the legacy custom integration from the recommended workspace connection flow.

### Fixed

- Email content backgrounds now blend cleanly with dark mode
- Fixed calendar RSVP buttons in emails firing duplicate responses after theme changes
- Organization settings now opens directly from the workspace menu.

## 2026-07-08

### Improved

- Rapid archive and mark-read now batch Gmail updates so the inbox stays snappy under rate limits
- Settings are redesigned with a consistent, edge-to-edge navigation and a search box that jumps straight to any setting.

### Fixed

- Mail attachments in hosted environments now require file storage instead of falling back to database-stored file bytes.

## 2026-07-06

### Added

- Paste or drop images straight into the composer to send them inline
- Save reusable snippets and insert them from the compose slash menu

### Improved

- Bulk archive, trash, star, and mark-read now complete in one fast batch
- Dark mode sidebars and notifications now use the softer gray Mail theme.
- Inbox automations pick up new mail faster
- Inbox lists stay fast as scheduled and snoozed mail accumulates
- Long inboxes scroll smoothly and stay fast as more mail loads
- Search shows instant matches from already-loaded mail while Gmail search runs

### Fixed

- A queued draft can no longer be sent twice by simultaneous send attempts
- Scrolling older mail keeps loading correctly when no Gmail account is connected
- Sends now fail with a clear error instead of quietly missing attachments

### Removed

- The mail header no longer shows the global notifications bell.

## 2026-07-03

### Improved

- Mail error screens now include a feedback button with debug context and a prefilled GitHub issue fallback.

## 2026-06-30

### Fixed

- Compose floating toolbars now use theme-aware colors in light and dark mode.

## 2026-06-29

### Fixed

- The contact panel now adapts to the available mail pane width when the agent sidebar is open.

## 2026-06-28

### Improved

- The pinned sidebar now collapses into an animated icon rail with quieter footer controls.

## 2026-06-27

### Fixed

- Traditional Chinese copy now uses Taiwan terminology and clearer technical wording.

## 2026-06-26

### Improved

- Mail avoids unnecessary message list reloads after background updates.

## 2026-06-25

### Improved

- Settings now open to General by default and use the standard blue active highlight.

### Fixed

- Account avatars stay stable while Mail refreshes Google account status.
- Archive failures now explain when Gmail needs reconnecting, permission, or a retry.
- Archived conversations stay hidden while Gmail catches up, and failed archives now show an error.
- Background draft saves and thread prefetches no longer show as inbox crashes when Gmail returns a transient error.

## 2026-06-24

### Added

- Added a language picker and localized app chrome for supported languages.

### Improved

- Interface language support now covers more Mail controls and email workflows.
- Settings now link directly to Agent settings for model, API key, automation, and voice preferences.

For the full list of updates, see the [changelog folder](./changelog/).
