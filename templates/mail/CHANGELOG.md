# Changelog

All notable user-facing changes to Agent-Native Mail are documented here. Open it any
time from the command menu (Cmd+K → "What's new") or from Settings.

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
