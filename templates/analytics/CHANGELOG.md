# Changelog

All notable user-facing changes to Agent-Native Analytics are documented here. Open it any
time from the command menu (Cmd+K → "What's new") or from Settings.

## 2026-08-20

### Improved

- Analytics now explains how to recover when staged data reaches its size limit.

## 2026-08-18

### Fixed

- Analytics no longer carries a previous dashboard into a new Ask chat.
- Feature flag changes now preserve actionable failures and verify the target app's persisted state.

## 2026-08-17

### Fixed

- Fixed dashboard editing focus, history recovery, panel setup focus, and repeated failed warehouse queries.

## 2026-08-13

### Fixed

- Account health readouts now verify customer identity, completed usage periods,
  contract metrics, and product adoption before summarizing.

## 2026-08-12

### Improved

- Ask now toggles chat history directly, and the collapsed sidebar uses a more compact navigation rhythm.
- Data source statuses now distinguish workspace access from credentials configured in Analytics.

### Fixed

- Feature flags can be managed across apps whose workspace records use different local IDs
- Kept feature flag details readable by stacking rollout controls at narrow widths.

## 2026-08-11

### Improved

- Full-page chat composers stay at a focused 750px width.

### Fixed

- Analytics custom blocks keep loading when they use the legacy BigQuery query action name.
- Analytics dashboards keep the selected tab when reopened
- Analytics routes company-knowledge and Slack-context questions to Brain
- Chrome no longer offers to install Analytics as a desktop app.

## 2026-08-10

### Improved

- Dashboard tables can be copied and sorted by multiple columns
- Full-page chat now uses the available width up to 1000px for more comfortable prompts and responses.
- Wide tables in Analytics chat now scroll horizontally within the panel

## 2026-08-07

### Added

- Added a dashboards overview with personal and shared folders.

### Improved

- Dashboard creation and edits now save faster with reliable structured mutations
- Gong searches conserve API quota and clearly report incomplete coverage
- Searchable dashboards make personal and shared folders easier to scan.
- Settings show stable skeleton placeholders while alert rules load.

### Fixed

- Analytics migrations now use bounded, pressure-aware background jobs
- Analytics no longer stalls under bursts of event ingest — key bookkeeping writes no longer serialize the whole pipeline
- Analytics tracking and chat startup no longer emit avoidable request errors
- Dashboard panels now load custom API data programs reliably
- Template activity charts now show only core Agent Native apps

### Changed

- Language selection now lives in Settings instead of the command menu.

## 2026-08-06

### Added

- Connect public HTTPS Custom APIs and hand tested endpoints to refreshable data programs
- On-demand billing is available as a native dashboard with tabs and built-in analytics panels.

### Improved

- Analytics query results now render as a table with CSV download.

### Fixed

- Analytics dashboards load reliably during background data sweeps
- Analytics dashboards remain responsive while historical data processing runs.
- Durable Analytics agent runs now have the maximum supported Netlify function memory allocation to reduce worker deaths during long analyses.
- Live dashboard panels now use the shared query timeout so slower charts fail more predictably.
- Analytics rejects duplicate names when creating or renaming visible dashboards.

## 2026-08-05

### Improved

- Analytics now flags Neon pressure and guides high-volume tracking queries to BigQuery when needed
- First-party analytics uses compact rollups for faster usage and retention queries

### Fixed

- Durable A2A workers now avoid startup migration contention so Analytics requests can complete while rollup maintenance runs separately.
- Fixed sign-in and dashboard requests failing when background jobs start
- Historical Analytics rollups now repair automatically after an upgrade

### Removed

- Settings no longer includes an unnecessary About section.

### Security

- Analytics dashboard queries keep every table tenant-scoped.

## 2026-08-04

### Added

- Choose whether Analytics plays a bell when the agent finishes a run

## 2026-08-03

### Improved

- Dashboard requests now continue through data setup, saving, embedding, and navigation without stopping for an extra confirmation.

### Changed

- New error alert emails are now off by default and can be enabled in Settings.

## 2026-08-01

### Added

- New error alerts now reach you by email, and a scheduled dashboard report that gives up retrying tells its owner instead of only logging

## 2026-07-30

### Added

- Analytics dashboards now expose native funnel, heatmap, callout, and section panels.
- Analytics now ships reusable native v2 dashboard manifests with an admin provisioning action for real Data Program bindings.

### Fixed

- Delegated analytics questions now return a useful current metric without transport hints derailing the answer
- Scheduled dashboard emails complete every panel without pooled query timeout leaks.

## 2026-07-29

### Improved

- Chat history now closes smoothly and stays ready when you return to Ask.
- Chat history stays visible when you return to the dashboard.
- Custom dashboard blocks now identify one-off agent patches and can be promoted to reusable app code.
- Dashboard chart loaders are easier to see and animate more smoothly.
- Plan mode can now query connected analytics sources while keeping changes blocked.
- Sidebar footers now keep Feedback, Search, and Collapse together without a separate language shortcut.
- Signup entry pages now show the first page viewed before each tracked signup.

### Fixed

- Dashboard chart deletions now save in order, so removed rows stay gone after refresh.
- Exports now appear in chat with a direct download instead of sending you to find the file elsewhere
- Plan mode can follow agent-readable context from shared URLs, and large Custom Blocks load focused excerpts without stalling.
- Queued chat prompts no longer resend after Analytics navigates or remounts.
- Scheduled dashboard emails load every panel reliably without database connection stalls

## 2026-07-28

### Improved

- Analytics dashboard loading states now use a simpler standard placeholder.

### Fixed

- Analytics dashboards now load first-party charts reliably instead of timing out under concurrent load.
- Analytics pages load reliably in workspaces with many saved dashboards.
- Dashboard loading shimmer now flows smoothly in one direction instead of reversing.
- Native Analytics data sources no longer show duplicate MCP setup callouts; missing sources now open a focused organization OAuth flow that returns to Ask, and connected HubSpot OAuth works across native questions and dashboards.

## 2026-07-27

### Added

- Dashboard changes can be redone with Cmd+Shift+Z or from the dashboard actions menu.

### Improved

- Chart tooltips stay beside the cursor when they extend beyond a chart
- Dashboard changes can be undone with Cmd+Z or from the dashboard actions menu, while full revision history remains available for restore.
- Dashboard loading placeholders now use softer contrast and a smoother shimmer cycle.

### Fixed

- Chat no longer claims a data source is disconnected when it simply hadn't checked, which could make the agent refuse its own follow-up as a prompt injection.

## 2026-07-26

### Added

- Line, area, and bar dashboard panels can plot series on a second right-hand y-axis, so counts and rates read correctly on one chart.

### Fixed

- Error issues now group by message as well as stack frame, and 'users affected' counts only real identities instead of every anonymous event
- Scheduled dashboard email reports now arrive complete and reliably every time
- Session replays now detect rage clicks, so the rage-click filter and badge finally surface frustrated sessions

## 2026-07-25

### Improved

- Analytics dashboards and scheduled reports are faster and more reliable with large event histories.
- App branding now uses the product name without the Agent-Native prefix.
- Settings navigation now keeps Manage agent as a dedicated linked destination at the bottom.

## 2026-07-24

### Improved

- Analytics charts now explain slow loads and offer a direct retry action.
- Analytics finds saved dashboards and queries far more reliably, and answers list and cohort questions in one query instead of grinding for minutes
- Secondary controls and dashboard surfaces now use quieter borderless styling.
- Manage agent is clearly marked as a link to its dedicated page
- Sidebar utility controls now follow a consistent footer order.

### Fixed

- Daily dashboard emails now load signed reports more reliably instead of falling back to a link-only message
- Notion access errors now explain that a page needs sharing with the integration, instead of naming an unrelated integration label

## 2026-07-23

### Improved

- Ask Analytics is better centered, with a quieter chat rail and a sidebar that stays closed until an active Ask conversation hands it off.
- Dashboard chart loading placeholders are easier to see in dark mode.
- Dashboard menus show who created and last updated each dashboard, with admin usage sorting by views or edits.
- Routine analytics lookups now search existing dashboard queries and dictionary definitions, then stop after one successful authoritative query.

### Fixed

- Daily dashboard emails now give read-heavy panels enough time to load and preserve completed image sections when a later section is unavailable.
- Dashboard usage now loads reliably for organizations with many tracked events
- Long dashboard-building requests now continue without stopping mid-run

### Changed

- Analytics now groups saved analyses and embedded extensions under dashboards

## 2026-07-22

### Added

- Export table panels directly to Google Sheets

### Improved

- Recent chats can now expand from five to fifteen items directly in the sidebar.

### Fixed

- Ask stays current in background tabs and keeps its latest tool visibly active without covering the first message.
- Daily dashboard emails now give each chart-query batch its full render window, preventing slow charts from forcing a text-only report.
- Fixed dashboards and analyses missing a copyable share link
- Full-page chat keeps the active conversation when moving to and from the sidebar.
- Show a useful error when saving a dashboard view fails

## 2026-07-21

### Fixed

- Chart series controls stay open while moving from the legend
- Daily dashboard emails now include every panel reliably, even for large dashboards.
- Fixed extension updates failing before changes could be applied.

## 2026-07-20

### Fixed

- Account deep dives now finish with partial data when HubSpot pipeline or owner lookups fail, and failed deal searches report a clear error.
- Dashboard email reports now include an image when a single panel is still loading.
- Fixed Analytics dashboard requests that stall without visible progress.

## 2026-07-17

### Added

- Analytics now includes a default inbox alert for spikes in agent chats detected as stuck.
- Dashboards can now host installed extensions as contextual, slot-backed boxes.
- Manage feature flag rollouts across your organization’s apps from one Analytics control panel.
- Resources can be added to Creative Context from their action menus.
- You can add exact, approved artifact versions to governed Creative Contexts for safe reuse.

### Improved

- Dashboard editors can add shared extensions or opt into per-viewer widget slots.
- Dashboard extensions now show a loading skeleton while their content loads.
- Gong reviews now batch transcript evidence, use provider-native synthesis when connected, and support fast direct reads from sibling apps.
- HubSpot deal filters now run in HubSpot before paging results, avoiding full-corpus scans.
- Library now flags published dashboards with newer versions and lets you submit the update in place.

### Fixed

- Errors now group repeat failures consistently and keep private replay links protected
- Notion content calendars now discover the matching database by schema instead of relying on one workspace's database ID.
- Pylon dashboard reads now use the paginated issue search API while preserving existing dashboard compatibility.
- Slack reads no longer join channels automatically, resolve message authors in bulk, and report pagination coverage explicitly.

## 2026-07-16

### Improved

- Dashboard lists load in one stable order without popping between intermediate results
- Recurring signed-in users can now be viewed as weekly bars by template.

### Fixed

- Dashboard filter defaults can now be changed reliably without unrelated chart errors blocking the edit.
- Fixed dashboard filter dropdown text alignment
- The Analytics agent can now duplicate a chart and place the copy beside it in one edit.

## 2026-07-15

### Fixed

- Daily dashboard emails now include the complete dashboard screenshot
- Fixed the agent discarding a successful dashboard edit and replacing it with an unrelated data-source message

## 2026-07-14

### Improved

- Analytics chat guides you to connect a data source with a direct setup link when live data is unavailable
- Analytics landing pages now clearly position the app as an open-source alternative to Amplitude and FullStory

### Fixed

- Daily dashboard email captures authenticate with a session cookie, fall back to a lighter panel set, and record page diagnostics when a capture fails.
- Long-running cross-app analyses now continue reliably in the background and can use synced workspace provider credentials.

## 2026-07-13

### Added

- A full Agent page now brings context, files, connections, jobs, and external access together

### Improved

- Chart legends can filter to one series or hide a series on hover.
- Session replay links now support Cmd-click and middle-click to open in a new tab

### Fixed

- All-time dashboard filters no longer send invalid dates to BigQuery
- Analytics answers can use built-in first-party event data
- Ask app now uses the current core agent loop and response guards in production MCP runs.
- Daily dashboard emails recover more reliably from serverless browser failures and report image errors accurately.
- Dashboard charts now honor the selected time range by default and reject accidental unbounded first-party queries
- Error issue titles wrap instead of overflowing
- GPT 5.6 Luna answers now recover normally instead of showing an unrelated data-source warning.
- Analytics incident lookups now use first-party session, error, and replay evidence instead of incorrectly asking you to connect a data source.
- Keep real authorized identities in Analytics incident lookups when browser Demo mode is enabled
- Saving a new dashboard view no longer fails with a server error
- Session replay cursors stay hidden until their first recorded position
- Session replays keep a visible Mac-style cursor over the visitor's recorded actions
- The Analytics Agents tab is available again from the main navigation.

## 2026-07-12

### Added

- Connected external agents can now look up sessions, error issues, and sanitized replay timelines directly, with the app agent remaining the default path.

### Improved

- Analytics uses the full in-app agent for multi-step incident investigations, with direct read tools available for focused lookups.
- Command menu loading placeholders now stay below available results without flashing.
- Demo mode line and area charts now show unique upward trends while preserving each series' original range and volatility.
- Named session incident investigations now start with session, replay, and error evidence
- Session replays load faster in demo mode while visitor emails stay anonymized.

### Fixed

- Analytics chat retries before showing a generic no-data message
- Analytics sessions search no longer loses fast keystrokes, and agent incident lookups no longer stall after background dispatch failures.
- Dashboard charts only select for chat when the chat sidebar is already open.
- Command menu search now finds settings, prioritizes the best match, and keeps keyboard selection aligned with each query.
- Daily dashboard emails reliably include the complete dashboard image.
- Demo mode trend charts now preserve the source series' real spikes, dips, and smooth stretches.
- Fixed session replays that appeared ultra-wide, hid recorded menus, or skipped captured cursor movement.
- Incident lookups include network and stuck-run evidence even when no JavaScript error is recorded
- Replay storage settings stay readable at narrow widths.
- Session identities stay visible when Demo mode is off
- Session replays preserve recorded styling and keep malformed ultra-wide captures readable.
- Session replays now show activity inside extensions and email content.

### Security

- Demo mode now reliably anonymizes email addresses throughout error reports.

## 2026-07-11

### Added

- The Agent Native dashboard now shows explicit thumbs feedback trends and sentiment by model.
- The Agent Native dashboard now shows optional inferred message sentiment overall, over time, and by main model.

### Improved

- Analytics chats now start faster by loading metric definitions only when they are needed
- Analytics only asks for replay storage when you enable session replay, with Builder.io as the primary setup path.
- The command palette now responds instantly, and SQL previews expand and collapse smoothly.
- Session filters now stay compact in a settings menu at medium widths.
- Session replays load large recordings faster and surface failed network and scroll activity in the timeline.

### Fixed

- Analytics no longer repeatedly restarts background requests when the app initializes or syncs changes.
- Charts now show their loading skeleton while refreshing.
- Command search now reports loading failures and lets you retry instead of hiding unavailable results.
- Dashboard navigation now loads faster and reports request failures instead of appearing empty.
- Microphone settings from realtime voice mode now open the Voice Transcription settings reliably.
- More dashboard edit paths are now safe against simultaneous agent and UI edits
- Realtime voice now shows a clear connection indicator, completes its greeting, and can navigate the Analytics app.
- Renaming a dashboard is now safe against simultaneous agent and UI edits
- Renaming an analysis is now safe against simultaneous edits
- Replay event counts stay hidden until recordings finish loading
- Session replay storage key mismatches now show actionable setup guidance instead of a low-level encryption error.
- Replay timelines group continuous scrolling, and Dev Tools counts and expanded details stay accurate and compact.
- Session replay console errors now link to matching issues or a filtered Monitoring search.
- Session replays preserve recorded styles and use one consistent viewport so previews match the original browser more closely.
- Session replays stay centered instead of clipping wide recordings
- Workspace-mounted Analytics now opens Ask reliably and routes between pages correctly.

## 2026-07-10

### Improved

- Agent-created uptime monitors now return a direct link to their Analytics detail view
- Analytics answers simple time-bounded metrics without unnecessary follow-up queries.
- Context chips can now be selected and removed one at a time with Backspace from the start of the Ask composer.
- Slack data-source setup now favors workspace connections and identifies raw bot tokens as a legacy local fallback.

### Fixed

- Analytics chat reliably uses connected data sources across supported models
- Chat threads now stay clear of top actions and fade smoothly beneath them while scrolling.
- Dashboard edits from the agent and the UI at the same time no longer overwrite each other
- Dashboard email reports still arrive when screenshot capture temporarily fails.
- The Ask composer no longer carries dashboard or panel context after leaving a dashboard.
- The Ask section stays highlighted while its chat history is expanded.
- Timed-out BigQuery jobs are now cancelled so they stop consuming warehouse quota.

## 2026-07-09

### Added

- Dashboard charts, tables, and extensions can be selected and discussed directly with the agent.

### Improved

- Uptime check history now shows timing diagnostics so slow or timed-out probes are easier to debug.

### Fixed

- Analytics no longer forgets successful data queries when a long request continues in the background.
- Dashboard action menus now close cleanly before opening history, email, archive, or delete dialogs.
- Dashboard charts keep consistent spacing when they stack vertically
- Dashboard email report screenshots load reliably after dashboard URL redirects.
- Long-running Analytics requests now recover automatically when a background handoff is interrupted.
- Uptime alerts now suppress recovery noise during flapping and confirm slow-response spikes before emailing.
- Uptime monitors now skip in-process sweeps in production serverless runtimes and rely on scheduled workers to avoid false timeout alerts.
- Uptime recovery alerts now send when the original outage notification reached email, Slack, or webhook channels.

## 2026-07-08

### Added

- Add uptime monitors that ping your URLs and alert you when they go down or return the wrong content
- Admins can audit dashboard usage, ownership, and cleanup signals from a new Admin view.
- Create public status pages that share the live health of chosen monitors at a shareable link
- Capture JavaScript errors automatically and jump straight to the session replay where each one happened.
- Publish a public uptime status page with colorful uptime timelines and overall uptime stats

### Improved

- Alert rules are easier to scan, expand, and edit from Settings.
- Analytics alert forms remember your last email recipients when creating the next rule.
- Analytics alert rules can now use per-rule Slack and webhook URLs.
- Analytics chats keep large data dictionaries compact so provider investigations start faster.
- Console details expand inline under each row, and the event timeline highlights, auto-scrolls, and supports search
- Dashboard extension panels use clearer menu wording when opening an embedded extension.
- Dashboards and saved analyses now keep restorable history, and the active dashboard or database table appears as context in chat.
- Error issue details now show Sentry-style stack frames, source snippets, and a recent frequency bar chart.
- Error issue detail now shows the latest occurrence message and metadata for faster triage.
- Jump straight from an error in a session recording to its full error detail
- Monitor detail and list now show colorful uptime timelines, response-time charts, and 24h/7d/30d/90d uptime cards
- Session replay keeps a usable stage when Dev Tools is open and shows the event timeline on medium screens
- Session replay resumes after scrubbing and expands console rows without jumping the playhead
- Settings are cleaner and searchable, and alert rules now live in their own dedicated Alerts tab.
- Sidebar sections stay quieter by default, while Ask, dashboards, and analyses can each be expanded or collapsed manually.
- Team settings now show organization access controls next to long member lists when there is room.
- The uptime monitor list now has a current-status overview with up/degraded/down counts, overall uptime, and open incidents
- Uptime alerting clarifies in-app inbox vs email and lets you paste Slack or webhook URLs per monitor.
- Uptime checks reuse one keep-alive connection, so recorded latency reflects the real response time instead of a fresh handshake each probe.
- Uptime monitors now use a 10-second request timeout by default and update existing short-timeout checks.

### Fixed

- Agent monitoring stays available to non-admin users while admin-only dashboard and database tools remain restricted.
- Alert emails now show the message without raw metadata JSON.
- Dashboard charts and tables keep their layout steady while loading.
- Dashboard usage now counts explorer dashboard traffic and links to explorer dashboards correctly.
- Demo mode now filters session replay data to Builder sessions and anonymizes session email addresses everywhere sessions are shown.
- Fixed single-panel dashboard drags so they no longer rewrite unchanged extension dashboards.
- Monitoring errors only shows the test-error action when no errors have been captured yet.
- Monitoring Uptime and Errors tabs now clearly show which view is active.
- Pinned Ask chats now show a pin icon in the sidebar.
- Production session replay now requires private blob storage when full snapshot playback is enabled.
- Session replay uses stock rrweb sizing again so recorded pages reassemble correctly instead of showing a blank stage
- Session replays wait for full load, keep a normal viewport, and scrub the timeline reliably
- Sessions now hide visitor emails in demo mode and show cleaner replay row details.
- Shared extension links now show a clear message when you do not have access.
- Sidebar dashboard menus now open above the dashboard canvas
- Uptime checks no longer count SSRF setup time against the request timeout, cutting false timeout alerts
- Uptime monitors now confirm transient timeout failures before alerting, reducing noisy false alarms.

## 2026-07-07

### Improved

- Session replays load sooner, show clearer activity timelines, and keep Dev Tools fast on large recordings.

### Fixed

- Analytics now recovers from stale route chunks after deploys instead of leaving dashboards stuck on failed module loads.
- Metric dashboard cards now show warehouse-backed numeric values correctly when query results return numbers as strings.

## 2026-07-06

### Added

- Dashboards can now chart data programs — saved server-side scripts that join data from any connected provider

### Fixed

- Dashboard lists and headers stay compact by keeping owner and sharing details out of always-visible labels.
- Extension pages and mobile headers now share one consistent app background shade.
- Mobile chat now has a tighter matching header, stable Safari viewport sizing, working navigation menu, and New chat action in the top bar.

## 2026-07-03

### Added

- Added an Agents page that brings monitoring, evals, experiments, feedback, and advanced database tools into one organized admin surface.
- The Agent Native dashboard now shows model cost, token usage, latency, and error tracking.
- Analytics admins can now connect other agent-native app databases from Agents and inspect or repair those target databases without exposing Analytics data to all users.

### Improved

- Session recordings now include response bodies for 5xx errors so agents can see the actual server error

## 2026-07-02

### Added

- Alert rules can now be viewed and managed from Settings.
- Session replays can be copied as temporary private links for agents.
- Session replays now capture console logs and network requests so agents can debug user-reported issues from a shared link.
- The session replay viewer has a Dev Tools panel with console and network tabs.

### Improved

- Recent Ask chats show a loading placeholder while your chat history loads.
- Sharing status labels use neutral icons instead of colored dots.

### Fixed

- Agent chat can keep working through longer data queries instead of stopping mid-action.
- Session replay playback now preserves the initial page snapshot when an upload needs to retry.

## 2026-07-01

### Added

- Analytics can now notify inbox, email, Slack, or webhook channels when first-party events spike.

### Improved

- Dashboard filters take less space and keep view actions tucked to the side.
- Analytics chat responses stream more smoothly during long background runs and guarded final answers.

### Fixed

- Dashboard charts no longer show future dates when clients send bad event timestamps.
- Session replay recordings upload reliably in production.
- Session replay playback keeps rrweb's inlined stylesheet snapshots while stripping live resource loads, reducing blank replay frames for captured pages with external CSS.
- Session replays load large production recordings from scoped chunks instead of truncating playback.
- Session replays now play back in production instead of showing a blank recording, because chunk downloads no longer rely on a manual gzip content-encoding that serverless hosts corrupted.

## 2026-06-30

### Improved

- Ask opens a fresh chat unless you were just chatting, and dashboard navigation keeps the sidebar closed from an empty Ask state.
- Dashboard toolbar controls use a quieter share button and vertical actions menu.
- Session replay rows show whole-minute durations in the playlist.

### Fixed

- Dashboard charts now use theme-aware tooltip and grid colors in light and dark mode.
- Dashboard email reports are more reliable and use cleaner header copy.
- Fixed Ask composer spacing so the chat field has a comfortable side inset.
- Session replays now render captured styling and keep the event timeline out of compact layouts.

## 2026-06-29

### Added

- Agents can search and read connected GitHub repositories when auditing tracking events.
- Dashboards can now include extension panels that embed a sandboxed extension inline instead of a SQL chart
- Set up session replay storage from settings: connect Builder.io or add S3-compatible storage

### Improved

- Analytics pages now sit closer under the header with tighter content padding.

### Fixed

- Analytics agents can now place new charts into requested dashboard rows.
- Analytics queries now report failed source-query errors instead of falling back to a vague no-data message.
- Charts can now be dropped between full dashboard rows to create wider rows.
- Dashboard email reports include the full dashboard image without an extra image border.
- The main dashboard surface border now reaches the top edge and keeps its rounded corners.
- Session replay now records playable sessions in production and shows them to your whole workspace
- Sessions and explorer dashboard layouts now adapt cleanly when the agent sidebar narrows the app.

## 2026-06-28

### Improved

- Dashboard email reports now use cleaner light-mode snapshots with direct subscription settings links.
- The left sidebar now collapses into an animated icon rail with quieter footer controls.

### Fixed

- The Ask tab now matches the darker background used across the rest of Analytics.
- Sessions now show only signed-in recordings with playable replay events.
- The Sessions page shows scoped recordings even when replay events are unavailable, with a cleaner setup snippet.

## 2026-06-27

### Added

- Dashboards can now nest under a parent in the sidebar via a parentId field

### Improved

- Dashboard charts drag smoothly when rearranging panels.
- Improved mobile navigation chrome and sidebar drawer motion.

### Fixed

- Anonymous replay recordings remain visible in session lists when signed-in replay is disabled.
- Dashboard email reports still send when the live screenshot renderer fails.
- Fixed dashboard edits so charts no longer briefly snap back to an old layout after agent updates or drag-and-drop.
- Session replay lists now show only signed-in recordings with real activity and reliable durations.
- Sidebar loading placeholders are visible in light mode.
- Traditional Chinese copy now uses Taiwan terminology and clearer technical wording.

## 2026-06-26

### Added

- Dashboards can now send scheduled daily email reports with inline screenshots of the live dashboard.
- Session replay browser sessions can now be reviewed from a Sessions page and opened from first-party dashboard rows.

### Improved

- Agents can now edit dashboards through a typed mutation script API for faster, more reliable multi-step changes.
- Dashboard chart moves are now handled by panel id, making simple reorders faster and more reliable for the agent.
- Dashboard charts show a refresh spinner while keeping existing data visible.
- Dashboard email reports queue immediate sends through the background sender for more reliable delivery.
- Dashboard templates are tucked into settings and show simpler, clearer cards.
- Explorer dashboards now drag charts with a stable preview and smoother placement.
- Session replay playback can now be toggled by clicking the replay preview.
- Session replays now open from the full row and play with timeline controls, speed settings, inactivity skipping, and an agent prompt popover.

### Fixed

- Dashboard bar chart hovers stay subtle in dark mode.
- Dashboard charts drag smoothly with stable cards, inactive chart hovers, and reliable blue placement lines.
- Dashboard edits stay stable while chart order and deletions save.
- Session replay uploads now accept compressed payloads so larger recordings ingest more reliably.
- SQL chart tooltips now stay stable while moving across dense charts.
- The Ask tab uses a softer dark-gray canvas while sidebar chat stays black.
- The Sessions page shows a single page title instead of repeating itself.

## 2026-06-25

### Improved

- First-party dashboards use indexed event dates for faster date-range charts.
- SQL dashboard panels now offer refresh and clearer SQL formatting feedback.
- The sidebar footer and command palette now open language settings directly.

### Fixed

- Dashboard cards now stay in their row when deleted and show a blue placement line while dragging.
- Dashboard charts no longer refresh in the background during agent activity and load more steadily on large dashboards.
- Dashboard charts now show reliable blue placement lines while dragging.
- First-party dashboard charts avoid surprise reloads and use faster retention queries.
- Fixed HubSpot data source status so private app tokens, legacy tokens, and shared workspace grants show as ready consistently.
- Per-template activity charts now exclude unattributed telemetry so CLI events no longer appear as Unknown.
- Referrer dashboard panels now show external domains without SQL parameter placeholder errors.
- Retention and active-user dashboard panels now exclude docs traffic, smooth retention cohorts, and use clearer signed-in visitor labels.

### Removed

- Analytics now opens directly to Ask instead of the old Overview page.
- The sidebar footer no longer shows a sign-out shortcut.

## 2026-06-24

### Added

- Added a language picker and localized app chrome for supported languages.
- Dashboard traffic tables now show top URLs and shared Clips with clickable links.
- First-party template dashboards now show key activity, signup, retention, DAU, and WAU trends over time by template.
- Retention charts now break out 1-day and 7-day return rates by template.

### Improved

- Analytics navigation, command palette, and settings now honor the selected interface language.
- Dashboard charts now fill sparse template time series, support legend toggles, and sort tooltip values by impact.
- Dashboard rows now auto-fit panels so one, two, or three charts fill the row naturally.
- Settings now link directly to Agent settings for model, API key, automation, and voice preferences.
- SQL panel editors now highlight query syntax and keep one-click formatting available.

### Fixed

- Active-user dashboard panels classify templates more accurately instead of overusing the unknown bucket.
- Daily dashboard charts now show the in-progress day as a dashed segment.
- Dashboard filters now apply consistently to first-party traffic panels and unsafe table links render as plain text.
- Dashboard loading placeholders now span the available page width.
- Dashboard panel deletes now stay deleted after refresh.
- First-party dashboard dates now align to Pacific time for daily activity and retention panels.
- First-party signup and pageview dashboard panels now use the selected time range and email filters consistently.

## 2026-06-23

### Added

- Build large first-party analytics dashboards in one fast call by naming metrics
- Open any dashboard chart full screen in a modal from the panel's three-dots menu

### Improved

- The Dashboards and Analyses sidebar settings buttons now stay hidden until you hover the section, for a cleaner sidebar

### Fixed

- Long dashboard and analysis names in the sidebar now truncate with an ellipsis instead of being clipped

For the full list of updates, see the [changelog folder](./changelog/).
