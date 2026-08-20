# Changelog

All notable user-facing changes to Agent-Native Dispatch are documented here. Open it any
time from the command menu (Cmd+K → "What's new").

## 2026-08-20

### Fixed

- Dispatch chat now loads its OpenRouter provider reliably in production.

## 2026-08-12

### Improved

- Search and pin workspace apps from the app catalog
- Workspace integration access now shows exactly which apps can reuse each connection.

### Fixed

- Dispatch now appears in authorized workspace app directories for fleet-wide administration

## 2026-08-11

### Added

- Dispatch shows usage trends, recent prompts, and an agent review path

### Improved

- Dispatch no longer shows the generic Chat starter among default app launchers
- Dispatch settings now link directly to Admin
- New apps accept human-friendly names and convert them to URL-safe IDs automatically.
- Integrations and scheduled work open as first-class Electron pages without a duplicate Dispatch navigation shell.
- Sidebar text is slightly easier to read in light and dark mode.

### Fixed

- Chrome no longer offers to install Dispatch as a desktop app.
- Clicking the Dispatch logo returns to the Overview page
- Dispatch omits its own app entry from the app switcher.

## 2026-08-10

### Added

- Desktop workspace sign-in can now be rolled out gradually while ordinary app sign-in remains unchanged by default.

### Improved

- Full-page chat now uses the available width up to 1000px for more comfortable prompts and responses.

## 2026-08-08

### Added

- Chat-first navigation keeps conversations central while opening workspace apps and watched sessions beside them.

## 2026-08-07

### Changed

- Language selection now lives in Settings instead of the Dispatch header.

## 2026-08-06

### Improved

- Dispatch keeps everyday navigation focused while management tools live in a dedicated Admin area
- Ready workspace apps stay one click away in a compact Dispatch navigation rail

### Security

- Shared Vault values and management are now restricted to workspace owners and admins

## 2026-08-05

### Fixed

- Transactional email catalogs and delivery activity are available in Dispatch again.

## 2026-08-04

### Improved

- Dispatch keeps connected chats out of local history by default and lets you show all sources on demand.

## 2026-08-03

### Improved

- Automation details now show scheduler checks, past runs, and actionable failure diagnostics

## 2026-07-30

### Improved

- Delegated Dispatch work can now continue reliably in the background.
- Thread Debug now lists recent failed agent runs across connected workspace apps for one-click inspection.

## 2026-07-29

### Added

- Browser chat can securely connect the Agent-Native Chrome extension to Dispatch with page context.

### Fixed

- Workspace members without admin access now see a clear permission message when opening usage metrics.

## 2026-07-28

### Improved

- Pending apps are hidden by default and app ownership details are available from the overflow menu

## 2026-07-27

### Improved

- Creating an app from a curated template now uses clearer, more direct language.
- Thread Debug can open a run directly from the copied request ID in an Agent Native chat.

## 2026-07-26

### Fixed

- Slack replies now recover after a connected app finishes an update, without repeating the update or losing the delivered reply from future thread context.

## 2026-07-25

### Improved

- App branding now uses the product name without the Agent-Native prefix.
- Settings navigation now keeps Manage agent as a dedicated linked destination at the bottom.

## 2026-07-24

### Improved

- Secondary controls and dashboard surfaces now use quieter borderless styling.
- Sidebar utility controls now follow a consistent footer order.

### Fixed

- Signing in now reliably puts you in your company's workspace instead of stranding you in a personal one, and the workspace switcher stays reachable when the sidebar is collapsed.

## 2026-07-23

### Improved

- Agent settings are clearly labeled Manage agent in the sidebar.
- Dispatch keeps messaging setup and destination details behind focused expandable panels.

## 2026-07-22

### Improved

- Manage agent navigation now uses the connected-nodes icon.

## 2026-07-21

### Fixed

- Slack agent requests recover automatically when the first background handoff is interrupted.

## 2026-07-17

### Added

- Dispatch now offers curated workspace templates that can be used to create private apps.

### Improved

- Dispatch now links to other available apps from the Apps page.

### Fixed

- The agent chat sidebar stays closed until you open it or start a chat handoff.

## 2026-07-14

### Fixed

- Dispatch now distinguishes connected agents from locally mounted apps when routing cross-app work.

## 2026-07-13

### Added

- New Agent page: see and manage your agent's context, files, connections, jobs, and external access in one place

## 2026-07-11

### Improved

- Dispatch MCP connections now start with safer app access and stay signed in more reliably in ChatGPT.
- Overview and Chat now share a cleaner flow with cross-app prompting, smoother transitions, and a stable bottom chat field.

### Fixed

- Data loading failures now show a clear error with a retry option instead of appearing as empty lists.

## 2026-07-10

### Added

- Connect Slack workspaces with OAuth, Agent view, and direct messages, then manage channel identity, memory, routines, policies, and AI budgets.
- Microsoft Teams bots and Discord slash commands can now connect with verified webhooks, while Telegram topics and WhatsApp replies preserve conversation context.

### Improved

- Dispatch now has a cleaner chat history and quieter sidebar identity.
- Dispatch now groups its workspace controls more clearly and adds an Operations console for agent monitoring, experiments, feedback, and Code-mode database inspection.
- Slack and Telegram now route uptime-monitor requests to Analytics and return the created monitor link

## 2026-07-08

### Added

- Added an Automations page to review, pause, and create scheduled or event-triggered jobs.

### Improved

- Destinations now shows outbound delivery-queue health, and Overview links quietly to Automations and other workspace tools.
- Settings are cleaner and searchable, with a consistent navigation that jumps straight to any setting.

## 2026-07-07

### Improved

- Overview is now just Ask Dispatch and a list of apps you can open.

## 2026-06-29

### Fixed

- Integration layouts now adapt cleanly when the agent sidebar narrows the app.

## 2026-06-27

### Fixed

- Traditional Chinese copy now uses Taiwan terminology and clearer technical wording.

## 2026-06-24

### Added

- A new Settings page gives quick access to language, workspace, and agent preferences.
- Added a language picker and localized app chrome for supported languages.

For the full list of updates, see the [changelog folder](./changelog/).
