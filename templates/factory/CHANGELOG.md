# Changelog

All notable user-facing changes to Chat are documented here. Open it any
time from the command menu (Cmd+K → "What's new").

## 2026-08-31

### Improved

- Audit runs now show what was added to the inbox, what the job worked on, and which actions it took.

### Fixed

- The connect banner now opens the workspace Dispatch host, and a vault outage no longer looks like a missing Slack connection.
- Creating or editing a Slack, GitHub, or Sentry job now shows a Dispatch connect banner above Run when that source is missing, and Create stays off until the channel, repo, or Sentry slugs are filled.
- Creating a Slack, GitHub, or Sentry job now works when the token is already in the vault, not only when Dispatch Integrations is connected.
- You can disable a Slack, GitHub, or Sentry job even when that connector is missing or the vault is down.
- Inbox and Audit stay usable when a connector lookup fails, and disabled job drafts can still set a destination.

## 2026-08-29

### Added

- New factories start with an empty Automations tab. Create one Slack, GitHub, or Sentry job at a time, with author ids and hard inbox and work limits.

### Improved

- Audit recent runs support automation and day filters, pagination, and smooth scroll when a run is selected.

### Changed

- `dispatch-factory-item` no longer always adds 👀. Pass optional `reaction` (for example `robot_face`) to mark the item source when Slack or GitHub can; omit it to add none.
- Factory now names its dispatch and PR review actions after what they do, so the agent can tell a write apart from a proposal.

## 2026-08-28

### Improved

- PR babysit runs now list each reviewed pull request and skip reason on the audit page.

### Fixed

- PR babysitting now reviews the next GitHub pull requests like Slack reviews the next messages, and only acts on authors named in that factory's prompt.
- PR babysitting now leaves out-of-scope pull requests out of the review window until the author changes, and audit runs count only new or changed PRs.
- PR babysitting now reads review comments and CI through the workspace GitHub connection, so watching Builder-bot pull requests no longer needs Builder AI services credentials.

### Changed

- Factory automations now use only the workspace Slack and GitHub connections, so this template does not need Builder AI services credentials and is not locked to that vendor API.

### Removed

- Inbox no longer has Approve and start. Clear bugs are started by tagging Builder in Slack or @builderio-bot on a GitHub issue.

## 2026-08-27

### Added

- Inbox can filter by date, status, risk, and source. Filters stay in the URL and clear when you leave Inbox.

### Improved

- Audit recent runs stack name, status, time, and outcome when the list is narrow, including when chat is open.
- Opening a factory now lands on Inbox, with signal, decision, and run counts above the list.
- GitHub source settings accept a repository page URL. Trailing slashes and extra path are stripped automatically.

### Fixed

- Long automation names in Audit recent runs wrap instead of overflowing the list.
- The Builder-bot PR babysitter can refresh open pull requests when it runs, instead of stopping before it looks at the queue.

### Changed

- Enabling Slack, GitHub, or Sentry polling no longer turns on the related automations. Enable those jobs from Automations when you want them to run.

## 2026-08-26

### Improved

- Inbox opens the full list first, then a full-screen thread with named people, standard emoji, and a back arrow.
- Inbox is a two-pane workbench with the Slack thread and item actions beside the reason, and Audit now labels runs clearly and shows the full message when a row is open.

## 2026-08-24

### Added

- You can permanently delete a user-created Factory from Settings after typing its name.

### Improved

- Workspace teammates can edit and run Factory jobs, not only the person who created them.

### Fixed

- Slack checking now works for factories created by someone other than the deploy owner.
- Slack polling now recognizes the Agent-Native bot when Slack reports its handle as @agentnative.

## 2026-08-21

### Improved

- Activity run history labels each run with the automation's display name instead of its full resource path.
- Create Factory and Settings now share the same labeled source cards, Enable polling toggles, and uncrowded scheduler health rows.
- Factory settings now show a sticky Save and Discard bar at the top as soon as a field changes, instead of a save button buried below the page.

### Fixed

- Automations remain visible while running, with live status updates in Automations and Activity.
- Factory Slack, GitHub, and Sentry automations now run for nested factories instead of failing before they can poll.

## 2026-08-11

### Fixed

- Chrome no longer offers to install Factory as a desktop app.

## 2026-08-10

### Improved

- Full-page chat now uses the available width up to 1000px for more comfortable prompts and responses.

## 2026-08-08

### Improved

- Scheduler health now stays in Settings until diagnostics are needed.

## 2026-08-07

### Added

- Factory can keep Builder bot pull requests moving by requesting fixes for review feedback, CI failures, and merge conflicts.

## 2026-08-05

### Improved

- Factory now keeps production automations running, shows scheduler health and run errors, and can email failure diagnostics.

## 2026-08-04

### Added

- Added organization-owned Factory automations for Slack bug triage, Builder handoffs, Sentry/GitHub intake, and governed PR approval.

### Improved

- Improved Factory automation editing with reliable tab navigation, a model picker that explains Auto, and map selection that no longer creates false unsaved changes.

## 2026-07-31

### Added

- Added Factory, an inspectable foundation for agent factories with Slack and pull-request evidence, shadow decisions, feedback, and guarded agent handoffs.

### Improved

- Clicking the Agent-Native logo now toggles the app sidebar.

## 2026-07-29

### Improved

- Sidebar footers now keep Feedback, Search, and Collapse together without a separate language shortcut.

## 2026-07-25

### Improved

- Settings navigation now keeps Manage agent as a dedicated linked destination at the bottom.

## 2026-07-24

### Improved

- Secondary controls and dashboard surfaces now use quieter borderless styling.
- Sidebar utility controls now follow a consistent footer order.

## 2026-07-23

### Improved

- Full-page chat is better centered, with quieter chat history and a left-aligned New chat action.

## 2026-07-22

### Improved

- The sidebar footer now keeps Feedback and the collapse control on one compact row.
- Manage agent navigation now uses the connected-nodes icon.
- Recent chats now expand from a compact five-item list with New chat anchored at the bottom.

### Fixed

- Full-page chat keeps the active conversation when moving to and from the sidebar.

## 2026-07-17

### Fixed

- The agent chat sidebar stays closed until you open it or start a chat handoff.

## 2026-07-15

### Removed

- The main navigation is now focused on Chat, Agent, and essential workspace settings.

## 2026-07-14

### Fixed

- Chat opens reliably on hosted deployments instead of failing during startup
- Fixed chat template startup with older core versions

## 2026-07-13

### Added

- A full Agent page now brings context, files, connections, jobs, and external access together

## 2026-07-10

### Improved

- Chat now makes AI connection setup clear without shifting the composer.

## 2026-07-08

### Improved

- Settings are cleaner and searchable, with a consistent navigation that jumps straight to any setting.

## 2026-06-29

### Improved

- Chat layouts adapt when the agent sidebar is open.

## 2026-06-28

### Improved

- Left sidebar collapse motion and footer controls now feel smoother and use less divider chrome.

## 2026-06-27

### Fixed

- Traditional Chinese copy now uses Taiwan terminology and clearer technical wording.

## 2026-06-24

### Added

- A new Settings page gives quick access to language, workspace, and agent preferences.
- Added a language picker and localized app chrome for supported languages.

For the full list of updates, see the [changelog folder](./changelog/).
