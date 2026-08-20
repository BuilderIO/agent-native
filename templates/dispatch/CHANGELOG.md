# Changelog

All notable user-facing changes to Agent-Native Dispatch are documented here. Open it any
time from the command menu (Cmd+K → "What's new").

Older updates live in [the changelog folder](./changelog/) and are included in the in-app "What's new" view.

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
