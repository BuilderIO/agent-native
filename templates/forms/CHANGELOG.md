# Changelog

All notable user-facing changes to Agent-Native Forms are documented here. Open it any
time from the command menu (Cmd+K → "What's new").

## 2026-08-11

### Improved

- Full-page chat composers stay at a focused 750px width.

### Fixed

- Chrome no longer offers to install Forms as a desktop app.
- Fixed public forms so conditional questions stay hidden until relevant and submissions retain a safe page link.

## 2026-08-10

### Improved

- Full-page chat now uses the available width up to 1000px for more comfortable prompts and responses.

### Fixed

- Forms now keep agent-applied field changes visible after an edit
- Published form links always use the working public form URL

## 2026-08-06

### Improved

- Long-running form requests now continue in the background instead of stopping at the foreground time limit.

## 2026-08-05

### Fixed

- Form links can now be Cmd-clicked to open in a new tab

## 2026-07-31

### Improved

- The Agent Native logo stays visible when the sidebar is collapsed and toggles the sidebar when clicked.

## 2026-07-29

### Improved

- Sidebar footers now keep Feedback, Search, and Collapse together without a separate language shortcut.

## 2026-07-25

### Improved

- App branding now uses the product name without the Agent-Native prefix.
- Response exports now save to file storage and return a downloadable URL.
- Settings navigation now keeps Manage agent as a dedicated linked destination at the bottom.

### Fixed

- Forms can create and update fields without manually supplied IDs.

## 2026-07-24

### Improved

- Secondary controls and dashboard surfaces now use quieter borderless styling.
- Forms sidebar actions now keep search, language, feedback, and collapse controls together.
- Sidebar utility controls now follow a consistent footer order.

## 2026-07-23

### Improved

- Agent settings are clearly labeled Manage agent in the sidebar.
- Ask Forms is better centered, with quieter chat history and a left-aligned New chat action.
- Forms can branch into follow-up questions and route responses to configured destinations.

### Fixed

- Published form links can be copied without being asked to reconnect the database.

## 2026-07-22

### Improved

- Forms now archive with immediate list updates and clear recovery feedback when an archive fails.
- Manage agent navigation now uses the connected-nodes icon.

### Fixed

- Full-page chat keeps the active conversation when moving to and from the sidebar.

## 2026-07-17

### Fixed

- Form builder popovers stay within the viewport
- Form editor loading now matches the current sidebar-free layout.
- The agent chat sidebar stays closed until you open it or start a chat handoff.

## 2026-07-15

### Fixed

- Published forms now reflect field updates immediately at their shared links
- Response rows now keep every column aligned to the top for consistent scanning

## 2026-07-14

### Added

- Forms can email the form owner when new responses arrive

### Fixed

- Fixed the Ask Forms loading input appearing above the welcome message.
- Form social previews now show the form title, description, and owner photo.

## 2026-07-13

### Added

- New Agent page: see and manage your agent's context, files, connections, jobs, and external access in one place

### Fixed

- Form navigation links now support opening in a new tab.

## 2026-07-12

### Improved

- Ask Forms suggestions now sit beneath the composer and prefill it when clicked
- Builder response tables now fill the view without a redundant response count badge
- Form builder surfaces are calmer, fields stay stable on hover, and integration icons load correctly
- Response tables now fill the available pane with a flexible trailing cell
- Smoother, more tactile controls throughout: animated icon and sort toggles, press feedback on buttons and cards, and larger click targets

## 2026-07-10

### Improved

- Agent-created published forms now return the anonymous public response link

### Fixed

- Published forms can no longer be edited into an unusable empty or optionless state.
- Simultaneous edits to different form fields no longer overwrite each other

## 2026-07-08

### Improved

- Settings are cleaner and searchable, with a consistent navigation that jumps straight to any setting.

## 2026-07-06

### Removed

- The form builder header no longer shows the global notifications bell.

## 2026-06-29

### Fixed

- Form lists and response insights now adapt cleanly when the agent sidebar narrows the app.

## 2026-06-28

### Improved

- The left sidebar now collapses into an animated icon rail with quieter footer controls.

## 2026-06-27

### Fixed

- Anonymous feedback no longer shows internal Agent Native anonymous-owner emails as submitter addresses.
- Traditional Chinese copy now uses Taiwan terminology and clearer technical wording.

## 2026-06-26

### Improved

- Ask Forms opens as a standard app tab with a simpler sidebar.
- Forms are shown in a tighter row list with a denser sidebar.

## 2026-06-25

### Improved

- Form previews now show the content directly on the grid background.

## 2026-06-24

### Added

- A new Settings page gives quick access to language, workspace, and agent preferences.
- Added a language picker and localized app chrome for supported languages.

## 2026-06-23

### Added

- Response tables now show the page each submission came from, passed through from embedded feedback widgets
- Response tables now show whether feedback came from the web, the Electron desktop app, or a Tauri app

For the full list of updates, see the [changelog folder](./changelog/).
