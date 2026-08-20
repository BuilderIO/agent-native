# Changelog

All notable user-facing changes to Agent-Native Brain are documented here. Open it any
time from the command menu (Cmd+K → "What's new") or from Settings.

## 2026-08-11

### Improved

- Full-page chat composers stay at a focused 750px width.

### Fixed

- Chrome no longer offers to install Brain as a desktop app.

## 2026-08-10

### Improved

- Full-page chat now uses the available width up to 1000px for more comfortable prompts and responses.

## 2026-08-06

### Fixed

- Brain provider setup links open Dispatch correctly in standalone and workspace deployments.

## 2026-08-03

### Fixed

- Brain now avoids unsupported company facts when verified sources are unavailable

## 2026-07-31

### Improved

- Clicking the Agent Native logo now toggles the app sidebar.

## 2026-07-30

### Added

- Blessed FAQs, docs, and other resources can publish updates to Brain for automatic distillation and cited, policy-aware answers.

### Fixed

- The left sidebar no longer shows a blank organization placeholder in its footer.

## 2026-07-29

### Improved

- Chat history now closes smoothly and stays ready when you return to Ask.
- Chat history stays visible when you return to Ask Brain.
- Extensions are no longer shown as a default command-menu destination.
- Sidebar footers now keep Feedback, Search, and Collapse together without a separate language shortcut.

### Fixed

- Brain automatically retries failed source syncs, drains search indexing backlogs faster, and guides you to connect provider APIs when setup is missing.

## 2026-07-25

### Improved

- App branding now uses the product name without the Agent-Native prefix.
- Settings navigation now keeps Manage agent as a dedicated linked destination at the bottom.

## 2026-07-24

### Improved

- Secondary controls and dashboard surfaces now use quieter borderless styling.
- Sidebar utility controls now follow a consistent footer order.

## 2026-07-23

### Improved

- Ask Brain is better centered, with quieter chat history and a left-aligned New chat action.

## 2026-07-22

### Added

- New Clips and webhook sources now show their secure connection details once, with copy controls and token rotation.

### Improved

- The sidebar footer now keeps Feedback and the collapse control on one compact row.
- Manage agent navigation now uses the connected-nodes icon.

### Fixed

- Chat runs now keep working through long source syncs and always end with a visible answer.
- Chat stays current in background tabs and keeps its latest tool visibly active without covering the first message.
- Full-page chat keeps the active conversation when moving to and from the sidebar.
- Long chat titles now stay inside the sidebar, and recent chats expand from a compact five-item list.

## 2026-07-19

### Added

- Brain now searches approved public, private, and meeting knowledge semantically while keeping sensitive material out of retrieval.

### Improved

- Slack backfills now start with a safe four-week window and resume across bounded channel pages

### Fixed

- Ask starts immediately when Builder's managed AI connection is ready
- Slack and Granola backfills now process captures concurrently while preventing overlapping source syncs.
- Slack backfills can now join configured public channels before reading their history.
- Slack backfills now continue across the configured number of history pages.
- Sources with review disabled now publish eligible distilled knowledge directly instead of sending it to the approval queue.
- The Manage agent page now opens correctly from Brain navigation.

## 2026-07-17

### Fixed

- The agent chat sidebar stays closed until you open it or start a chat handoff.

## 2026-07-13

### Added

- A full Agent page now brings context, files, connections, jobs, and external access together

## 2026-07-12

### Fixed

- Long AI responses now stay visibly in progress and automatically follow new output until you scroll away.

## 2026-07-10

### Improved

- Brain settings now separate assistant behavior, publishing review, and safety policies into focused sections.
- Slack backfills now favor workspace connections while clearly marking raw bot tokens as a local fallback.

### Fixed

- Organization settings now opens directly from the workspace menu.

## 2026-07-08

### Improved

- Settings are cleaner and searchable, with a consistent navigation that jumps straight to any setting.

## 2026-06-29

### Fixed

- Search, settings, and source layouts now adapt cleanly when the agent sidebar narrows the app.

## 2026-06-28

### Improved

- The left sidebar now collapses into an animated icon rail with quieter footer controls.

## 2026-06-27

### Fixed

- Traditional Chinese copy now uses Taiwan terminology and clearer technical wording.

## 2026-06-24

### Added

- Added a language picker and localized app chrome for supported languages.

### Improved

- Settings now link directly to Agent settings for model, API key, automation, and voice preferences.

For the full list of updates, see the [changelog folder](./changelog/).
