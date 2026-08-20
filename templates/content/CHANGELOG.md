# Changelog

All notable user-facing changes to Agent-Native Content are documented here. Open it any
time from the command menu (Cmd+K → "What's new").

## 2026-08-14

### Fixed

- Images fill the page width by default and remain visible when more images are added
- Images inserted from the slash command stay saved after upload
- SVG files can be selected reliably from the image picker

## 2026-08-13

### Fixed

- Blocks field conflicts now keep the newer saved version visible instead of leaving a rejected edit on screen

## 2026-08-12

### Improved

- Toggle blocks now follow Notion-style Enter and Shift-Tab behavior while preserving summaries and nested paragraphs.
- Shared Content documents now keep viewers read-only and let commenters add comments without editing the document.

### Fixed

- Image uploads now confirm the image can be displayed before reporting success

## 2026-08-11

### Improved

- Content opens your last page on return and gives new users a private welcome page.

### Fixed

- Chrome no longer offers to install Content as a desktop app.
- Content mutations delegated from verified Slack DMs now use the member's exact Personal scope and return verified row receipts.

## 2026-08-10

### Added

- Agents can safely insert, update, upsert, delete, and reorder one stable block in a database Blocks field.

### Improved

- Database Blocks fields now keep logical block identity through editing, reordering, deletion recovery, and reloads
- Database row actions now validate exact schemas and safe retries before changing data.

## 2026-08-07

### Fixed

- Collapsed sidebar utility buttons stay anchored at the bottom.

## 2026-08-06

### Fixed

- Database exports now include their pages instead of downloading an empty collection.

## 2026-08-05

### Improved

- Add column now opens Sources for connections and returns with new fields grouped by source.

## 2026-08-03

### Improved

- Choose Text or a heading from one compact formatting control.

## 2026-08-02

### Fixed

- Pages opened from a database now keep that database’s fields and loading state, even when the page also belongs to a Builder-connected database.

## 2026-08-01

### Added

- Content can reorganize every row in an existing database as one verified, reversible operation.
- Get an email when someone comments on, replies in, or mentions you on your document, with a new toggle in Settings

### Improved

- Large Builder databases now show rows immediately and finish syncing much faster.

## 2026-07-31

### Improved

- The Agent Native logo stays visible when the sidebar is collapsed and toggles the sidebar when clicked.

## 2026-07-30

### Improved

- Builder source columns now appear immediately when connected entries already contain the selected field, including empty values.
- Large Builder-backed tables show useful rows sooner and finish loading in the background.

### Fixed

- Breadcrumb menus now show only relevant page peers instead of internal system pages, with reliable keyboard selection between pages.
- Database rows can now be removed without deleting their pages, and bulk actions only appear when you have permission.
- Deleting a page no longer leaves the Content sidebar unresponsive.
- Long-running delegated requests now continue reliably.
- The slash-command hint now stays on only the active empty line in the document editor.

## 2026-07-29

### Improved

- Large databases keep useful rows visible while table sorting and Builder review details load.
- Sidebar footers now keep Feedback, Search, and Collapse together without a separate language shortcut.

### Fixed

- Missing databases no longer trigger repeated personal-view errors in the editor or sidebar.

## 2026-07-28

### Improved

- Builder content reads now negotiate the newest MCP protocol while remaining compatible with legacy servers.
- Public content pages load faster before the optional Ask sidebar appears

### Fixed

- Builder-backed Files & media fields now accept direct file URLs in bulk updates.

## 2026-07-27

### Improved

- Content sidebar page lists now load with quiet skeletons and less visual chrome.

## 2026-07-26

### Added

- Sidebar references can now be personally reordered, with Custom, Name, Last edited, and Created options for workspace Files.

### Improved

- Builder reviews stay responsive on large collections and preserve refresh progress when source settings change

### Fixed

- Builder publishing now shows safe validation details instead of a generic server error.
- Collaborative documents no longer flash duplicated recent blocks when reopened
- Corrected Builder updates are now reviewed separately from failed earlier attempts, slow hosted writes get a full provider response window, and uncertain outcomes still require reconciliation before retry.
- Documents now remain read-only until their live collaborative content finishes initial sync.
- Slash command menus now stay reachable when editing near the bottom of the screen.
- The slash menu now shows one clear Callout choice instead of duplicate actions
- View-only collaborators can pin or unpin shared pages while the unavailable add-child control stays aligned and visibly disabled.

## 2026-07-25

### Improved

- App branding now uses the product name without the Agent-Native prefix.
- Settings navigation now keeps Manage agent as a dedicated linked destination at the bottom.

### Fixed

- Database page preview action menus open reliably with pointer and keyboard.

## 2026-07-24

### Improved

- Secondary controls and dashboard surfaces now use quieter borderless styling.
- Sidebar utility controls now follow a consistent footer order.

### Fixed

- Builder can now publish approved updates to entries that are already live.
- Builder collection loading no longer restarts from the beginning when overlapping refreshes finish out of order.
- Builder connections now complete securely from Netlify deploy previews.
- Builder draft creation now scopes execution to the selected article, avoiding hosted timeouts on large synced collections.
- Builder review now distinguishes preparing a safe dry run from sending the confirmed update to Builder.
- Builder source imports now recover from a transient pagination failure without discarding already loaded rows.
- Builder source refresh now preserves the provider-bound field when local properties share the same label, so follow-up edits remain reviewable.
- Builder update reviews now open reliably on large collections by loading full article details only for pending changes.
- Builder write policy controls now reflect successful changes immediately.
- Comment drafts now stay open when saving fails, and long-lived document sessions no longer flood the browser with sync requests.
- Database pages now keep the correct properties when opened from a database or moved to the full-page editor.
- Date properties now save reliably when selected with the native date picker.
- Editor slash search now keeps multi-word block names such as Heading 2 open instead of inserting them as literal text.
- Exact editor slash commands now execute on Enter even if the command menu fails to appear.
- New collaborative pages now save their first text and media edits before you navigate away.
- New local Builder rows no longer remain locked behind a nonexistent body sync.
- Opening or closing a collaborative document no longer lets unfocused editor normalization overwrite saved rich content.
- Selected text now opens the link editor with Command-K or Control-K instead of opening global search.
- Code Block and other slash-menu choices now finish without hanging the collaborative editor, even when closing the menu unmounts the selected choice.
- Rich document edits, including uploaded and embedded media, now stay intact while collaborative drafts save.
- Video link insertion now keeps its source panel open while the editor reconciles.

## 2026-07-23

### Improved

- Agent settings are clearly labeled Manage agent in the sidebar.

### Fixed

- Database toolbar Sort and Filter controls now open reliably with pointer and keyboard activation.
- New pages wait until they are ready before offering database conversion.
- New pages open immediately while slow network work continues
- Shared pages now keep durable content visible, and comment threads stay stable and connected while you navigate.

## 2026-07-22

### Improved

- Manage agent navigation now uses the connected-nodes icon.
- Page actions are grouped into the three-dots menu for a cleaner editor toolbar

## 2026-07-21

### Fixed

- Editing a database page no longer refreshes unrelated Content workspace data or interrupts typing in the originating tab.

## 2026-07-20

### Improved

- Workspaces can be added from a blank workspace or a connected local folder from any creation menu.

### Fixed

- Trash actions now preserve independent archived pages, enforce access, and restore database rows in order
- Workspace toggles now stay independently open or closed, and nested pages remain grouped beneath their parents.

## 2026-07-19

### Improved

- Favorites is now a full, filterable database with per-user membership, and compact breadcrumbs make workspace and sibling navigation easier.
- Files databases now start unfiltered, sidebar rows exactly follow the active filter and sort, and Favorites can be collapsed.
- Workspace file databases now use the workspace name, open as tables, appear at the start of page breadcrumbs, nest and align child pages beneath their parents, rename sidebar rows immediately, truncate long workspace names, and provide working page actions.

### Fixed

- Pages now move to a reversible Trash, the organization picker is restored, and sidebar disclosure icons behave consistently.
- Sidebar page trees now open only when expanded, remember their state across devices, and keep renamed titles intact when icons change.
- Workspace navigation now stays stable on hover, uses folder icons, and links each Files database back to Workspaces.
- Workspace rows now use folder icons, and deleting a user-created workspace removes it cleanly instead of failing.
- Workspaces can be created without leaving the Workspaces database, and renamed workspaces update everywhere immediately.

## 2026-07-18

### Added

- Create named workspaces, each with its own private Files database

### Improved

- Favorites align with workspace and file rows in the sidebar
- Made Content workspaces independently expandable, restored organization switching, and added local folders as workspace sources.
- Page details now live in a shared Info and Comments rail, databases stay focused on their data, and Favorites update immediately.
- Workspace navigation now aligns Favorites with workspace pages, supports named workspaces, and gives every Files database filterable Kind, Parent, and Source fields.

### Fixed

- Local folder selection avoids unsafe embedded pickers, remembers picker attempts that never returned so they cannot cause a crash loop, and continues to support Agent Native Desktop and native folder access in Chrome, Edge, and other Chromium browsers.
- Workspace database views now control sidebar workspace navigation, and local folders attach to the correct Files database.

## 2026-07-17

### Added

- Resources can be added to Creative Context from their action menus.
- You can add exact, approved artifact versions to governed Creative Contexts for safe reuse.

### Improved

- Library now flags published documents with newer versions and lets you submit the update in place.
- Workspaces now stay independently expanded as compact sidebar headers above their pages, with instant new pages, clear active titles, contextual page actions, and the Page or Database choice in the editor body.

### Fixed

- Creating a database now completes reliably in hosted workspaces
- Slack-created database entries now record Slack as their submission source when the intake form supports it.
- The agent chat sidebar stays closed until you open it or start a chat handoff.
- Workspace files now stay in a loading state until automatic setup finishes, with a retry when setup fails
- Workspace switching now opens the selected Files database, preserves the choice across reloads, provisions organization Files for every member, and creates new pages in the selected workspace.

## 2026-07-16

### Added

- The Agent workspace now includes a Library for reusing verified creative context and choosing when it applies to content.
- Organize every workspace through a customizable Files database and sync local folders into the same database-backed experience.

### Fixed

- Content callout blocks now convert into safe Builder text callouts instead of blocking the publication review.
- Heading 5 and Heading 6 are available from the editor slash menu.
- Slack corrections now preserve newer Content values unless you explicitly change or clear them.

## 2026-07-15

### Improved

- Page and database descriptions now start compactly and wrap naturally as they grow.

### Fixed

- Selected Builder reviews now load only the chosen rows, avoiding production timeouts on large collections.

## 2026-07-14

### Added

- Create inline or block LaTeX equations from the slash menu or by typing `$…$`, with live validation and preview; existing GitHub-style equation syntax remains compatible, and equations render on public pages and in exports.
- Pages and databases can describe themselves, with guidance for properties and select options.

### Fixed

- Builder account connection now remains available when branch creation is not configured, with clearer guidance when a preview still needs relay setup.
- Builder-backed articles now preserve fifth- and sixth-level headings in the editor.
- Builder sources now review and publish rich article updates with guarded writes and preserved media.
- Builder writes now prevent duplicate retries when another push is running or reconciliation is required.
- File and media links now validate before saving and include the pending valid link on save.
- Slack follow-ups now retain created Content identity and person-field intent across corrections.

## 2026-07-13

### Added

- New Agent page: see and manage your agent's context, files, connections, jobs, and external access in one place
- You can now cancel a prepared Builder update safely before it is sent.

### Improved

- Builder connection setup is now available directly from Connections settings.

### Fixed

- Builder reviews now hide already-applied writes, detect native media converter updates, and show the linked entry target.
- Document links now support opening in a new tab.
- Required Builder publishing fields can now be added directly from the connected source settings.

## 2026-07-12

### Fixed

- The left sidebar stays fixed horizontally while scrolling on desktop and mobile.

## 2026-07-11

### Improved

- Comments now update from live collaboration events without continuous background requests
- Editor toggle feedback now feels more responsive.
- Public document chats now start faster while keeping full document details available when needed

### Fixed

- Document loading failures now show a clear retry action instead of an empty workspace.
- Moving documents at the same time no longer scrambles their order
- Reopening a comment now uses consistent permissions everywhere
- Sidebar resizing now tracks your cursor instantly instead of lagging behind

## 2026-07-10

### Added

- Database form views now collect ordered, required answers and create verified response pages.
- Notion databases can now add read-only details to Content tables through a safe, refreshable source connection.

### Improved

- Builder CMS sources can now be enabled for guarded staged or published updates by page administrators.
- Database tables now use a quieter, more compact layout with clearer filters and contextual shared-view controls.
- Open documents no longer make constant background requests while waiting for sync operations.
- Slack request intake can preserve its source thread, validate required database form fields, and return the exact submitted Content page.

### Fixed

- Builder-backed preview edits are preserved when article bodies finish syncing.
- Builder-backed properties now load current source values as soon as you add them.
- Builder database snapshots now refresh only when requested, continue past 500 rows, and ignore unchanged select values when counting pending changes.
- Failed row creation and source attach now show an error instead of silently doing nothing
- Items added at the same time no longer end up with identical sort positions
- Local folders now wait for an explicit pull before Content reads them

## 2026-07-09

### Fixed

- Builder source refreshes now keep mapped fields such as topics and tags, preserve existing rows when a read unexpectedly returns empty, and load large databases more reliably.
- Notion conflict choices and version restores preserve document paragraphs and protect live edits.
- Notion conflict warnings no longer flash during normal synced editing
- Property menus and delete confirmations now open visibly and respond reliably in database tables.

## 2026-07-08

### Improved

- Database filters now support Notion-style reset, save-for-everyone, and additive option selections.
- Date filters can now target a between range.
- Settings are cleaner and searchable, with a consistent navigation that jumps straight to any setting.

### Fixed

- Builder source sync now completes reliably on hosted databases with hundreds of entries.
- Fixed Builder database sync so large sources continue past the first batch without leaving the table stuck mid-refresh.

## 2026-07-07

### Fixed

- Builder-backed database fields now edit like normal Content fields while still creating reviewable Builder diffs.
- Builder source tag fields now import as multi-select properties with their available choices.
- Permanently deleting trashed databases now finishes reliably instead of timing out.

## 2026-07-06

### Improved

- Local files now remember sidebar collapse state and include folder management controls.

### Fixed

- Builder sync progress no longer shows a Continue button while loading is already continuing automatically.
- Document headers and page bodies now share one consistent background shade.
- Export options stay visible outside the page actions menu instead of being clipped.
- Fixed collaborative documents reapplying content before saved edits finish loading.
- Notion comment sync now preserves threads — replies stay attached to their conversation in both directions
- Notion sync is far more reliable: auto-sync no longer overwrites concurrent edits on either side, and imported and exported pages preserve formatting exactly
- Opening pages now highlights the sidebar item and shows the editor loading state immediately.
- Presence markers in the editor are now compact instead of covering content with color blocks.
- Sidebar collapse now keeps the same background shade as the expanded sidebar.

### Removed

- The content header no longer shows the global notifications bell.

## 2026-07-03

### Added

- Agent document edits now appear as a live collaborator — presence avatar, editing indicator, and a brief highlight on the changed text

### Improved

- Document search and list views load faster on large workspaces
- Content error screens now include a feedback button with debug context and a prefilled GitHub issue fallback.

## 2026-07-02

### Fixed

- Builder source refreshes recover from stalled background row loading.
- Builder-sourced database rows now open with sync protection immediately and keep source-field columns stable during background refreshes.
- Database rows and pages open faster from recently loaded data.
- Preview panels close reliably, narrow sidebar row actions stay reachable, and adding properties now shows progress.

## 2026-07-01

### Added

- Builder source rows can be staged in bulk with a reviewable diff before writeback.

### Improved

- Builder database sources keep loading rows in the background with clearer progress and page-opening feedback.
- Builder source components now show clearer preservation and review states during readable body sync; previously hydrated Builder bodies may need refresh before guarded push.
- Builder source refreshes now show progress and keep large docs/blog databases usable while large row sets load incrementally.

### Fixed

- Builder source attachment now starts with a usable first batch of rows while larger docs/blog collections continue loading.
- Builder source attachment now stays connected after large collections finish attaching.
- Database pages now delete to Trash without leaving the app on a failed page route.

## 2026-06-30

### Improved

- Builder source components now render as preserved preview blocks inside hydrated article bodies.
- Cmd+K search now opens from the editor and finds real documents, databases, and local-file results.

### Fixed

- Builder article media now render as images and embeds when readable body content syncs from Builder.
- /database once again creates an inline database in the current page instead of opening a child database page, and the sidebar restores Page/Database create menus plus inline database Trash controls.
- Editor floating toolbars now use theme-aware colors in light and dark mode.
- Sidebar favorites now keep long titles tidy and stay in sync with saved page titles.

## 2026-06-29

### Added

- Builder CMS sources now sync article bodies into Content and push approved body edits through the Builder review flow.
- Reusable MDX references now preview linked local documents inline.

### Improved

- Database sources can now be added as more rows or matched details, with an in-app role repair path and field picker.

### Fixed

- Builder review checks now preserve publish and unpublish choices before sending updates.
- Database gallery layouts now adapt cleanly when the agent sidebar narrows the app.
- Fixed loading the final rows in larger databases without breaking the table.
- Read-only pages no longer try to autosave or open editor-only realtime connections.

## 2026-06-28

### Improved

- Left sidebar collapse motion and footer controls now feel smoother and use less divider chrome.

## 2026-06-27

### Fixed

- Traditional Chinese copy now uses Taiwan terminology and clearer technical wording.

## 2026-06-25

### Improved

- The editor toolbar now has a one-click page link copy button next to Share.
- The editor toolbar now shows page breadcrumbs and the latest edit time like Notion.

### Fixed

- Comment cards now track their highlighted text while scrolling and no longer stay open after you click away.
- Comments now scroll with the document and stay below the page toolbar.
- Creating a database from the slash menu no longer leaves stale command text or a purple selected strip when returning to the page.
- Sidebar hover controls no longer leave a lingering fade when moving between pages.
- Sidebar page actions are now easier to see when hovering inactive pages.
- Text selections in the editor no longer show white gaps when the formatting toolbar appears.
- The /page command now leaves a Notion-style page reference and clears stale cursor labels when you return.

## 2026-06-24

### Added

- A new Settings page gives quick access to language, workspace, and agent preferences.
- Added a language picker and localized app chrome for supported languages.

For the full list of updates, see the [changelog folder](./changelog/).
