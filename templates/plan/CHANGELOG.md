# Changelog

All notable user-facing changes to Agent-Native Plan are documented here. Open it any
time from the command menu (Cmd+K → "What's new").

## 2026-08-19

### Improved

- Plan prompts now guide you to connect AI before sending and offer a clear retry after setup.

## 2026-08-12

### Improved

- Shared plans now distinguish read-only viewers from commenters who can add review feedback without editing the plan.

## 2026-08-11

### Improved

- Plan sharing now identifies viewers who can add comments

### Fixed

- Chrome no longer offers to install Plan as a desktop app.
- Plan no longer reloads when runtime state changes

## 2026-08-10

### Improved

- Full-page chat now uses the available width up to 1000px for more comfortable prompts and responses.

## 2026-08-07

### Improved

- Inline help icons now stay visually balanced with nearby text

## 2026-08-04

### Improved

- Canvas zoom controls now explain the Command/Ctrl plus scroll shortcut
- Pinch to zoom is now supported on touchscreens in visual plan canvases

## 2026-07-31

### Improved

- Clicking the Agent Native logo now toggles the app sidebar.

## 2026-07-30

### Fixed

- Plan agents now recover interrupted edits with small targeted writes.

## 2026-07-29

### Improved

- Chat history now closes smoothly and stays ready when you return to Ask.
- Chat history stays visible when you return to Ask Plan.
- Sidebar footers now keep Feedback, Search, and Collapse together without a separate language shortcut.

### Fixed

- Fixed Plan pages crashing when recent activity is unavailable.

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

- Ask Plan is now a clean full-page chat surface with better centering and quieter chat history.

## 2026-07-22

### Improved

- The sidebar footer now keeps Feedback and the collapse control on one compact row.
- Manage agent navigation now uses the connected-nodes icon.
- Recent chats now expand from a compact five-item list with New chat anchored at the bottom.

### Fixed

- Full-page chat keeps the active conversation when moving to and from the sidebar.
- High-fidelity mockup requests now preserve branded CSS, use Design mode, and update existing plans in place.
- Recover stale pages after a deployment refresh automatically

## 2026-07-20

### Fixed

- Bridged local plans now load comments from the local workspace.

## 2026-07-18

### Improved

- Visual plans now open on Wireframes by default when a prototype is also available.

## 2026-07-17

### Added

- Diagrams can opt into a polished clean rendering mode without sketch styling.

### Fixed

- The agent chat sidebar stays closed until you open it or start a chat handoff.

## 2026-07-16

### Fixed

- Local Plan previews now load annotations containing HTML-like text.
- Plan agents now prevent stale edits from overwriting newer plan content

## 2026-07-13

### Added

- New Agent page: see and manage your agent's context, files, connections, jobs, and external access in one place

### Fixed

- Fixed local plan previews continuously flickering while reviewing unchanged content

## 2026-07-12

### Security

- Local plan source now stays on your device during verification and is excluded from content autocapture and session replay.

## 2026-07-11

### Improved

- Plan pages stay current while making far fewer background requests when nothing has changed.

### Fixed

- Local plans now explain and recover from browser permission blocks when connecting to files on your computer.
- Plan edits now save atomically and can no longer partially apply if a save fails midway
- Plan lists now show a clear error with a retry action when they cannot be loaded.

## 2026-07-10

### Fixed

- Local plans now keep valid content visible when one generated block is malformed
- Restoring a plan version can no longer leave a plan half-restored if something fails mid-restore

## 2026-07-09

### Fixed

- Canvas panning now keeps zoom fixed, even at the edges.

## 2026-07-08

### Improved

- Settings are cleaner and searchable, with a consistent navigation that jumps straight to any setting.

### Fixed

- Hosted visual plan images now require connected storage instead of saving image files in SQL.

## 2026-07-06

### Fixed

- Fixed collaborative plan editing so content no longer duplicates after reloads.
- Fixed visual reports using excessive CPU while rendering sketchy wireframes.

## 2026-07-05

### Fixed

- Images in Plan documents open reliably in the full-size preview.
- Plan pages open at the top unless a shared link targets a specific section.

## 2026-07-03

### Added

- Plans are now fully real-time collaborative: multiple people (and the AI) can edit the same plan together with live cursors, and edits merge instantly without overwriting each other

### Improved

- Plan error screens now include a feedback button with debug context and a prefilled GitHub issue fallback.
- Plans open and refresh faster, especially long-lived plans with lots of activity
- Undo now survives agent edits — Cmd+Z keeps working on your own changes while the AI patches other blocks, and agent-edited blocks glow briefly with an AI flag

### Fixed

- Local visual plans and recaps can save comments without signing in and stay in the correct review mode after saving.
- Plan tabs render nested text blocks normally instead of showing their raw JSON.

## 2026-07-02

### Improved

- Plan comment shortcuts now open comment mode from the keyboard and PR recaps target the PR author for human feedback.
- Wireframe and diagram blocks can now show or hide their outer frame based on the surface they appear in.

### Fixed

- Agent chat can keep working through longer visual plan updates instead of stopping mid-action.
- Fixed hosted visual plans getting stuck loading when a database migration left newer plan columns unavailable.
- Plan chat keeps the composer anchored when Connect AI appears, and recap contents highlight the current section more clearly.
- Trying to edit a recap or plan you can only view now explains how to comment or publish a replacement instead of failing repeatedly

## 2026-07-01

### Fixed

- Visual plan and recap diagram labels now wrap inside their boxes instead of spilling outside.

## 2026-06-29

### Improved

- Plan titles and summaries can be edited inline without focus outlines.

### Fixed

- Plan canvases open without an initial pan-and-zoom flicker while the first view settles.
- Plan document blocks now adapt to the available document width when sidebars are open.

## 2026-06-28

### Improved

- Left sidebar collapse motion and footer controls now feel smoother and use less divider chrome.
- Wireframe style can now be switched between sketchy and clean from Cmd+K.

### Fixed

- Plan canvases stay stable while panning and zooming in Chrome.
- Plan wireframes keep dense mockups readable by avoiding overlapping sketch outlines around broad panels.
- Plan wireframes ignore host color utility classes so canvas mockups stay readable in dark mode.
- Plans now use the shared neutral light and dark theme instead of a warm-tinted palette.
- Sending open feedback from a plan now opens the inline Plan agent reliably.

## 2026-06-27

### Improved

- Exported MDX keeps ordinary prose readable as plain Markdown while preserving stable review anchors.

### Fixed

- Traditional Chinese copy now uses Taiwan terminology and clearer technical wording.

## 2026-06-26

### Fixed

- Canvas grid panning now stays smooth and fills the workspace while navigating large plans.

## 2026-06-25

### Added

- Settings now link to the Agent-Native Plans VS Code extension.

### Improved

- Hosted signup now shows how to switch `/visual-plan` to local files only.
- Plan documents keep their full reading width below 1200px and show the contents rail only on wider screens.

### Fixed

- Plan access request pages stay visible during background refreshes instead of flashing back to loading.

## 2026-06-24

### Added

- A new Settings page gives quick access to language, workspace, and agent preferences.
- Added a language picker and localized app chrome for supported languages.

### Improved

- Annotated code callouts now use numbered gutter markers that match annotated diffs.

### Fixed

- Invalid generated recap blocks now show a clear warning with validation details instead of raw block markers.

## 2026-06-23

### Fixed

- Large diagrams in a plan now scroll within their block instead of being cut off
- Plan loading skeleton no longer cuts off the canvas preview on short screens

For the full list of updates, see the [changelog folder](./changelog/).
