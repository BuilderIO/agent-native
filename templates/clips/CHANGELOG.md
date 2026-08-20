# Changelog

All notable user-facing changes to Clips are documented here. Open it any time
from the command menu (Cmd+K → "What's new") or from Settings.

## 2026-08-20

### Improved

- Recording controls now follow you across browser tabs and page navigations.

### Fixed

- Clips overlays now follow tab switches during the recording countdown and recover cleanly on tabs opened before Clips.
- Clips now opens provider setup instead of retrying a rejected key in a loop.

## 2026-08-19

### Added

- Clips Nightly builds are available for trying the latest updates.

### Fixed

- Shared clips now show a video frame in social previews when no thumbnail is stored.

## 2026-08-18

### Improved

- Meeting notes support rich editing for personal notes, summaries, and action items.
- Meeting notifications no longer show decorative left-side lines.

### Fixed

- Centered the clip play button and corrected the empty comment-panel hint.
- Clips no longer crashes when a camera bubble starts at a tiny size.
- Clips now recovers interrupted uploads and reliably restarts after installing desktop updates.
- Deleting a recording no longer freezes Clips or blocks starting a new recording.
- Pending recording files now use a Clips-prefixed name instead of a feature-ambiguous stem.

### Removed

- Clips no longer opens a welcome window on first launch.

## 2026-08-17

### Fixed

- Shared clips now clearly show sign-in, let signed-in viewers comment, and use neutral messaging for confirmed no-audio transcripts.

## 2026-08-14

### Improved

- Meetings now opens on your history instead of a wall of upcoming cards: past meetings with notes but no linked recording are back in the list, older ones keep loading as you go, and search reaches attendee names and transcript text so you can find a call by what was said in it.

### Fixed

- Long desktop recordings now complete or abort resumable uploads cleanly, preserve local recovery copies, and show the actual upload error when saving fails.
- Clips now uses consistent text-only share controls with compact copy actions and an expandable Share with agents section across recordings and meetings.

## 2026-08-13

### Added

- Private meeting notes can be shared with an external agent through a temporary link.

### Improved

- Comments now render inline Markdown for emphasis, inline code, links, and line breaks while keeping headings out of compact comment surfaces.

## 2026-08-12

### Improved

- Shared recordings now distinguish read-only viewers from commenters who can comment and react without editing the recording.

## 2026-08-11

### Improved

- Clips desktop settings are now easier to scan with a wider tabbed layout and clearer grouped controls.
- Google Calendar connections from Meetings now open directly
- Recording sharing now labels viewers as Commenters who can comment and react.
- System audio recording now lives inside the microphone menu for a cleaner setup.
- Timestamped comments stay on the video for three seconds while it plays.

### Fixed

- Chrome no longer offers to install Clips as a desktop app.
- Clips asks to take notes again when you join an adhoc Zoom or Teams call, and now waits until the call is actually live before offering.
- Clips recovers from transient updates and avoids macOS privacy crashes during restart.

## 2026-08-10

### Improved

- Clips desktop sign-in now starts with magic links and Google, with a password fallback.

### Fixed

- Fixed transcription failures for recordings without captured audio
- Mobile clips can now enter fullscreen on iPhone Safari

## 2026-08-07

### Added

- Full-screen recordings on a multi-monitor Mac now let you pick which display to record before capture starts.

### Improved

- Transcription now retries transient cloud failures automatically, and failure messages say what actually went wrong instead of blaming the recording.

### Fixed

- Fixed trimmed Clips durations so the main player display matches the edited timeline
- Screen recordings now capture tab and system audio even when the microphone is off, so transcripts are generated instead of failing with a misleading no-speech message.

## 2026-08-06

### Improved

- Clips starts faster after a deploy or idle period — startup no longer re-scans recordings or re-probes columns one at a time on every cold start.
- Trimmed clips play on a clean timeline without cut markers

### Fixed

- Clips recovers from stalled recording setup without requiring a restart
- Deleting a recording returns cleanly to the library, and Fit to width fits the whole timeline.
- Desktop full-screen recordings now normalize microphone level while recording, so clips are no longer quieter than the rest of your library.
- Hide clip insights from viewers without analytics access

## 2026-08-05

### Improved

- Clips can copy a linked email preview for public recordings
- Clips overlays now use clean surfaces without clipped shadows
- Clips remembers your playback position when you reopen a clip.
- Comment and video reaction pickers now include eyes and mind-blown reactions consistently.
- Preparing recording now uses a clean, shadow-free status card

### Fixed

- Activity is now the default recording tab, and Clips only shows AI setup after confirming no provider is connected.
- Clip buffering now shows buffering copy after playback starts.
- Fresh recordings now open with the complete video

## 2026-08-04

### Improved

- Cleaner Library controls with a simpler New recording button and icon-only sort control
- Recording buttons are now text-only for a cleaner Clips interface.
- Upload and Loom imports now live under one Import menu

### Fixed

- Save settings now matches the other Clips settings buttons.
- Signing out now takes effect immediately after verifying a new account.

## 2026-08-03

### Added

- Get a monthly recap email showing how many people and AI agents watched your Clips.
- Get an email the first time an AI agent reads one of your Clips.

### Improved

- Clip cleanup, titles, and meeting summaries now use Luna by default when Builder is connected.
- Restart during a recording now immediately starts a fresh take instead of cancelling.

### Fixed

- The desktop app now opens directly beneath its tray icon on first launch.

## 2026-08-01

### Fixed

- Email notifications for comments and reactions now actually send, and General settings is one Preferences card instead of five
- Recordings stored in private S3-compatible buckets finalize and play correctly.

## 2026-07-31

### Added

- Editor timeline now shows video frames behind the waveform, generated server-side as a single sprite image
- Email notifications now go out when someone comments on or reacts to your recording, following your Settings preference.
- You can now set a default visibility for new recordings in Settings, so clips no longer default to public unless you choose that.

### Improved

- Agent views now show the agent's name from the link it was given, and unidentified agents are labeled Unknown agent with their user-agent on hover.
- Clip cards and the watch/share page header now show agent views next to human views without opening view details.
- The Agent Native logo stays visible when the sidebar is collapsed and toggles the sidebar when clicked.

## 2026-07-30

### Fixed

- Meeting microphone transcription works reliably from the first start.
- Workflow generation now stops retrying after repeated failures instead of remaining active indefinitely.

## 2026-07-29

### Added

- Comments can now be edited after posting.

### Improved

- Clip share emails now open with who shared the clip, add a Summarize with AI button, and include a copyable agent link with reply-to the sender.
- Download actions now use a shorter, clearer label.
- Embedded bug reports now return a temporary agent-readable link with transcript, timestamped frames, and diagnostics.
- Finished meeting pills now have a clear close button.
- Organization name, logo, brand color, and default visibility now live in Settings → Organization alongside members, and the duplicate Profile box was removed from General.
- Sidebar footers now keep Feedback, Search, and Collapse together without a separate language shortcut.
- When a meeting wraps up, the recording pill now shows a green 'Meeting finished' banner with a button to open the meeting notes.

### Fixed

- Clearing all recording edits no longer leaves the editor unresponsive.
- Edited clips now start after trimmed intros and recover instead of getting stuck when a browser cannot start the video.
- Fixed system-audio recordings picking up your microphone in their transcript.
- Meeting cards no longer flicker or disappear when hovered in Chrome.
- Meeting notes no longer transcribe the other side twice when you are on speakers instead of headphones
- The desktop camera preview now closes after a recording finishes instead of lingering as a black circle.
- Transcript lines on the meeting page no longer jump to the recording when clicked.

## 2026-07-28

### Improved

- Copied share links no longer leave an unnecessary confirmation banner in the desktop popover.
- Public Clips share buttons now use a clean text-only label

### Fixed

- Browser recordings no longer save a truncated transcript as complete when speech recognition stops early
- Browser recordings no longer stop transcribing partway through; a partial live transcript is now flagged instead of saved as the finished one.
- Desktop full-screen clips now get an instant local transcript (and a real title) instead of waiting on cloud transcription
- Long transcriptions no longer show a false 'transcription stopped' error while they are still running
- Playback skip controls no longer show overlapping numbers.
- Profile avatars now appear in viewer and share-access lists.
- Restarting for an update now installs the newest release instead of a stale download that immediately asks you to restart again.
- The meeting recording pill now anchors to the right edge of the screen, shows a live waveform that reacts to both you and other speakers, and reads as a proper pill.

## 2026-07-27

### Added

- Share notification emails now include a clickable recording thumbnail that opens the clip

### Fixed

- Organization brand logos now upload to configured file storage so they persist and render in share emails
- Saved Clips now resume from the last uploaded byte after an interruption and promptly show when another retry is needed.
- Stopped agent runs no longer leave generated workflow cards spinning indefinitely.

## 2026-07-26

### Fixed

- Long agent chat turns now finish instead of stopping partway — they run on the durable background worker rather than being cut off by the hosting request limit.
- Recordings no longer get stuck on 'Uploading' — uploads now hold a renewable lease, can resume after a dropped connection, and stalled uploads report a clear failure instead of spinning.

## 2026-07-25

### Improved

- App branding now uses the product name without the Agent-Native prefix.
- Settings navigation now keeps Manage agent as a dedicated linked destination at the bottom.
- Two-Clip emails now include a concise summary generated securely through your Agent Chat.

## 2026-07-24

### Added

- Clip pages now show a view count with viewer avatars next to the title, and owners can click through to see who watched and how far they got.
- Clip view counts now separate human views from agent views, showing which AI agents (Claude, ChatGPT, Perplexity) read a clip through its agent APIs
- Clips actions can now be called by org service tokens, so external systems like a support desk can import recordings automatically.
- The desktop app now copies a new clip's public share link to your clipboard the moment a recording finishes and shows a notification confirming it, so it's ready to paste straight into Slack

### Improved

- Secondary controls and dashboard surfaces now use quieter borderless styling.
- Clip summaries read like a description you'd write yourself instead of narrating "the speaker", and the share page no longer repeats the title under the player
- Meeting and note recordings now start as a compact pill on the right edge with a live waveform that moves with the room, and the transcript view is grayscale with an Ask anything bar built in.
- Opening a share link as the clip's owner now goes straight to the full clip page instead of showing a near-identical page with an "Open dashboard" button.
- Permissions and Rewind controls now use compact, consistent hover states
- Sidebar utility controls now follow a consistent footer order.

### Fixed

- Clips no longer briefly shows a Dock icon while launching
- Fixed owner and editor share links redirecting to the recording dashboard
- New clips now copy a shareable link instead of the owner-only link, so the link auto-copied by the web recorder, desktop app, and Chrome extension works for everyone you paste it to
- Quitting the desktop app no longer shows a false macOS crash report
- Screen recording permission errors now name the exact app to allow in macOS System Settings, instead of pointing at an entry Clips never appears under
- The recording toolbar now stays above other apps, including on fullscreen and other Spaces
- Transcript captions now use real speech timings instead of an estimated even spread
- Video playback no longer stutters and replays the last moment during a clip

## 2026-07-23

### Improved

- Agent settings are clearly labeled Manage agent in the sidebar.

### Fixed

- Fixed recordings failing to save with a "cancelled" or "cleanup window" error during upload
- Meeting recording meters now use thin, responsive audio bars, and dismissed reminders stay dismissed.

## 2026-07-22

### Improved

- Ready clip transcripts now keep an export receipt and retry Brain delivery after temporary failures.
- Manage agent navigation now uses the connected-nodes icon.
- Permissions and Rewind controls are now grouped with clearer aligned actions.
- Permissions and Rewind now use quieter expandable rows with clearer setup guidance.

### Fixed

- Builder-connected recordings now start their resumable upload session reliably.
- Clip thumbnails now come from the recording instead of the post-stop screen
- Clips emails now render the Agent-Native logo in Gmail and other clients.
- Dismissed Zoom and Teams meeting-note prompts now stay dismissed when you switch windows.
- Fixed an intermittent hydration error on the download page
- Fixed transcript generation when native speech capture returns empty text.
- Fixed Windows recordings aborting during the countdown
- German umlauts and other non-ASCII characters now paste correctly from macOS dictation
- The desktop popover opens centered under the menu bar icon on first launch
- Native browser/OS transcripts now remain primary, with Builder transcribing the original recording only when native speech capture is unavailable.

## 2026-07-21

### Added

- Clips can now prepare an access-checked recording link for bounded CRM call evidence without exposing media or transcripts.

### Improved

- You can now choose which Whisper model to use for offline transcription in Settings — from Tiny (fast, small) to Large v3 Turbo (most accurate) — and delete previously downloaded models you no longer need.

### Fixed

- New recordings default to public link visibility across existing organizations, while admins can still choose a different default.
- Live dictation text now appears above the desktop recording pill.
- Meeting notes now stop shortly after Zoom, Teams, or Meet calls end.
- Recording retries and restarts keep their upload session so they can finish saving.

## 2026-07-20

### Added

- Meeting share links can include the full transcript with an explicit privacy control.

### Improved

- Meeting recordings now offer a cleaner transcript view with quick chat and browser actions.
- Opening a Zoom meeting from Clips now launches the native app when available.
- Rewind can set up your local agent once, so future requests work with a simple ‘Look at Rewind.’
- Shared clips can be shared with limited access, and cards show who created them and when.

### Fixed

- Agent summaries use bounded transcript context
- Clip summaries now finish without sending a long transcript through the agent chat
- Clips agents only discover recordings you own or have already viewed
- Hosted recordings now stop with a clear retryable storage message instead of failing later during chunk upload.
- Recording retries the default Mac microphone when a saved input is no longer available.
- Rewind now reports the same live capture status on Home and in Settings without mistaking an idle moment for a permission problem.
- Shared Clips now tell agents to wait while uploads and transcription finish.

## 2026-07-19

### Added

- Ready Clips transcripts can be backfilled to Brain for a bounded recent window with clear export and privacy-review results.

### Improved

- Rewind-backed recordings now start immediately after the countdown and upload progressively while you record.

## 2026-07-18

### Improved

- New recording is now emphasized as the primary action in the library sidebar.
- Rewind now divides retained screen memory into local work chapters that any connected agent can search. Agents can inspect an exact local frame or a small contact sheet before asking to turn a bounded range into a private Clip. Raw Rewind media and archive paths remain on the Mac.

  The copied Rewind prompt can repair the local connection, handles ambiguous chapters explicitly, and only escalates to a Clip when audio, motion, deeper processing, or durable queryability requires it. Rewind Settings also make agent activity and local-export receipts easier to find.

- Rewind now organizes recent activity into searchable work chapters with stronger local context, representative moments, and truthful coverage gaps.

### Fixed

- Recordings now remain safely recoverable until the stored media size is verified.

## 2026-07-17

### Added

- Capture dictation, background meeting audio, and camera videos from the Agent Native iOS and Android app with automatic recovery and resumable Clips sync.
- Choose which workspace receives new Clips recordings and desktop uploads
- Create folders directly from the move menu

### Improved

- Failed desktop uploads now offer a direct way to reopen Clips and retry without re-recording.
- Playback comments stay readable at faster playback speeds
- Rewind's Home status is now one calm line instead of repeating retention settings. Its typography matches the recorder controls, and a new copy button provides a ready-to-paste prompt that helps a local agent recover the newest relevant Rewind context without uploading raw media. Pausing and resuming also restore Recorder Home to its complete natural height, so the Clip controls and fixed footer never overlap after the shorter paused state.
- Rewind now has a calm home status, focused first-run consent, local Memory search, and dedicated privacy settings.
- Rewind now fits the Clips popover instead of taking it over. Home shows one compact status row with Pause and an on/off switch; configuration lives in Settings. Privacy language is plain, disk limits are visible, excluded apps use a native application picker instead of bundle IDs, and agent retrieval is the primary story while manual search remains a quiet local fallback.
- The full Clips interface now stays available while a recording is active. Its compact header uses a clear live REC signal and an explicit Stop button without explaining the interface back to the user. Reopening the interface respects **Show Clips in screen captures**: it remains usable but capture-excluded by default, and appears in recordings only when the user turns that setting on.

### Fixed

- Active Clips now keep Rewind's shared screen and audio capture stable until the Clip ends. Rewind's on/off, pause, and capture-mode controls visibly lock during recording, with a native safeguard for non-UI callers, so changing Rewind can no longer strand a Clip in optimization with a coverage gap.

  Rewind Settings also use application exclusions as the single privacy model, return Back through the surface that opened them, describe local-memory maintenance before asking someone to act, and speak plainly about local agents finding moments on request.

  The recording toolbar's timer now opens Clips without stopping the active recording, and Dock, tray, and shortcut opens all restore the active popover. Rewind-derived hosted Clips now create the resumable storage session they need before recording, and exact-range encoding uses an interactive-speed preset so Stop no longer appears frozen for roughly the Clip's full duration. The compact Rewind settings rows also reserve separate label and control columns to prevent overlap.

  Recorder Home now keeps its bottom navigation fixed while the content region adapts to the available popover height. After Rewind's first-time setup, its single Home switch means remembering or paused; the duplicate Pause button and active-recording lock paragraph are gone. Full disable and capture-mode setup remain in Rewind Settings, while the active-Clip switch uses an unmistakable disabled treatment until recording ends.

- Clicking the Clips icon during a recording now opens the app without stopping capture.
- Clips now retries storage verification in the background instead of failing completed uploads prematurely.
- Clips now uses the Mac's real default microphone and shares one physical mic/system capture with live transcription, preventing spoken recordings from becoming silent.
- Delayed upload verification now keeps local backups retryable and avoids showing a false processing failure.
- Dictation keeps sentence spacing and no longer crashes when submitted mid-capture
- Fixed broken thumbnail icons appearing over playable clip embeds
- Full-screen Clips now finish saving when macOS stops capture but fails to return from ScreenCaptureKit's synchronous stop callback.
- Normal full-screen Clips no longer stop immediately after the countdown.
- Shared Clips now preserve Editor access and show editor insights
- Stitching clips no longer fails when editor media metadata is loaded
- The agent chat sidebar stays closed until you open it or start a chat handoff.

### Changed

- Rewind now connects directly to Codex or Claude Code through a dedicated local Screen Memory connection. When you ask an agent about something recent, bounded matching text can be returned without exposing local archive paths.

  If the agent needs to see or hear the moment, it can request one timestamp range of up to five minutes. Clips shows **Review before sending** by default, including the exact interval, local preview, microphone and Mac-audio choices, and a clear statement that only the selected range becomes a private Clip. You can turn review off in Rewind Settings when the agent request itself is enough approval; Clips still leaves a visible handoff receipt.

  Agent-created Clips are kept in the Library by default. An optional retention setting can remove future agent-created Clips after 24 hours, 7 days, or 30 days. Renaming, sharing, commenting on, reacting to, tagging, or archiving one preserves it.

  Raw Rewind recordings and the complete local index remain on the Mac. The old Private versus Cloud-assisted mode gate has been removed; the boundary is now the bounded request and, for media, the private Clip handoff.

## 2026-07-16

### Added

- Organization admins can choose the default visibility for new recordings.

### Improved

- Camera bubble hover controls now appear above the face so it can rest flush near the bottom of the screen.
- Clips search now matches recording content without requiring exact letter case.
- Remove Silences now shows queued, active, completed, and failed progress on the recording page.
- Settings no longer repeats the Builder connection status in multiple setup cards.
- The desktop app button now shows "Open desktop app" and launches the installed app instead of re-downloading once you've downloaded it.

### Fixed

- Authorized viewers can open shared private clips without a misleading sign-in detour.
- Chrome extension recordings no longer leave a stale recorder state blocking the next start after a failed launch.
- Clips agent chat now stays inline with the recording tabs without a separate Chat or Workspace header.
- Meetings you decline no longer trigger Clips desktop reminders.
- Failed or delayed desktop saves now reopen Clips with the saved local copy visible in every view, including Settings.
- Long desktop Clips now preserve complete playback, synced audio, full transcripts, and local recovery copies until upload verification succeeds.
- Long recording lists keep Stitch actions and selected-library actions visible.
- Transcripts now appear from native browser speech sooner, with automatic recovery when transcription stalls.

## 2026-07-15

### Improved

- AI workflow generation now stays visible, avoids duplicate requests, and reports completion correctly.
- Clip playback and CTA controls remain interactive through editing and replay.
- Clip titles no longer describe the product as a Loom alternative.
- Description regeneration now opens the agent chat so progress is easy to follow.
- Folders now expose rename and delete actions directly in the library sidebar
- Public clip links are labeled Share with humans for clarity.
- Recording pages now explain sign-in access and avoid showing the same public link twice.
- The Clips extension quick-actions toolbar can be moved out of the way.
- The editor now skips cut sections during preview and keeps the full clip selection visible.
- Thumbnail capture now updates previews while scrubbing and lets uploaded files be removed.

### Fixed

- Disconnecting a calendar now clears unrecorded synced meeting placeholders.
- Folders and sidebar links are clickable again immediately after creating or renaming a folder.
- Hovering a truncated folder name now shows the full name.
- Space creation controls are now shown only to organization admins and owners.
- Vocabulary terms can now be deleted from the dictation dictionary.
- Windows permission links now open the matching system settings page.

### Security

- Direct recording URLs now respect share-link and password access controls

## 2026-07-14

### Added

- Rewind can keep recent screen context local, make it searchable on your Mac, and explicitly include the previous 30 seconds or 5 minutes in a Clip without starting another recorder

### Improved

- Desktop app prompts stay hidden after you download the installer
- The Share dialog once again makes separate links for people and agents easy to find.

### Fixed

- Clips now distinguishes transcript previews from incomplete transcriptions and queues agent-triggered retries reliably.
- Paused time no longer counts toward Chrome extension recording durations.

## 2026-07-13

### Added

- New Agent page: see and manage your agent's context, files, connections, jobs, and external access in one place

### Improved

- Desktop recordings run cooler and quieter: live transcription now uses the GPU on Apple Silicon
- Meeting transcripts now use a clean, agent-chat-style reading layout instead of chat bubbles.
- Screen recordings use less processing power during longer captures

### Fixed

- Clips Desktop now declares its macOS 13 minimum consistently with the native ScreenCaptureKit and Metal capture stack.
- Clips no longer shows meeting-notes reminders for calendar events attended only by you.
- Clips now removes duplicate mic and system transcript turns and filters more silent-audio hallucinations.
- Meeting recordings now stop after a calendar meeting ends and goes quiet
- Recording cards and player back links now support opening in a new tab.

## 2026-07-11

### Improved

- Playback controls, recording setup, reactions, and folders now move more smoothly and respect reduced-motion preferences.
- Generated titles no longer cause continuous background refreshes after a recording is ready.
- Recording overlays are lighter-weight and no longer cause page jank while capturing
- S3 storage setup stays collapsed until you choose it as the secondary storage option.

### Fixed

- Clips no longer stay stuck on Preparing clip when they are ready to play on mobile.
- Declining an invitation now requires being its recipient
- Notifications, trash, and workspace insights now show a clear retry action when loading fails.

## 2026-07-10

### Added

- Clips Desktop is now available for Linux with AppImage, Debian, and RPM installers.
- Clips shared with you now appear in a searchable Shared with me view.

### Improved

- Clips downloads updates sooner in the background and offers a one-click restart when the latest version is ready.
- Comment replies now open inline and focus immediately, while the new-comment box stays at the bottom.
- Comment URLs open as clickable links.
- Clips desktop update prompts are now more compact and easier to dismiss.
- Dismissed upload warnings now keep recordings in Clip Drafts, which opens directly from desktop settings.
- Finishing meeting notes no longer opens your browser automatically.
- MP4 downloads now show progress immediately after the options menu closes
- New recording appears once when the library sidebar is open.
- Desktop recording pages now open as soon as you stop, with a share link available while the video finishes uploading.
- Slack setup now more clearly separates the legacy unfurl token fallback from workspace connections and messaging automations.
- Timestamped comments now appear over the video as playback reaches their moment.
- Zoom meetings now open directly in the desktop app without an extra browser tab when you join from Clips.

### Fixed

- Viewer analytics stay accurate when multiple playback events arrive at the same time.
- Clips with missing mobile video frames can be repaired without losing their audio or original upload.
- Desktop recording uploads now show a brief Uploaded state with open and dismiss controls instead of staying stuck onscreen.
- Desktop recordings now retry saving their locally captured transcript after upload completes.
- Dragging the meeting recorder now moves it without opening the expanded view.
- Fixed copying agent responses and transcript text from recording pages.
- Meeting recordings now keep microphone audio and recover transcripts across every supported macOS capture path.
- Mobile camera recordings now pause while Clips is backgrounded instead of saving a misleading frozen span.
- Quiet or interrupted recordings now finish saving, and locally saved clips retry correctly.
- Recording pause and resume controls now respond reliably on the first click.
- Recordings now seek smoothly, downloads use the correct file format, and interrupted transcripts can be retried.
- S3-compatible storage now saves hosted recordings reliably instead of failing during upload.
- Shared clips now start playing instantly instead of showing a long spinner
- Starting and joining a meeting now closes the desktop popover.
- New recordings now replace rough transcript-word titles with a useful title and summary.

## 2026-07-09

### Added

- Regenerate any clip transcript from its saved recording, or retry one that failed.

### Improved

- The Clips desktop popover now sits closer to its menu-bar icon.
- Meeting reminder popovers can now be dismissed with a top-left close button on hover, and their drop shadow is no longer clipped
- On mobile, tapping a playing clip reveals playback controls without interrupting the video.
- Slack previews now show the clip length alongside its description.

### Fixed

- Desktop recording optimization progress stays visible from Stop until the finished clip opens.
- Fixed long desktop recordings and large video file uploads failing without a resumable upload session.
- New video uploads are public by default, and owners can change sharing visibility as soon as they open the Share dialog.
- Long recordings now get enough time to download their media before transcription starts.
- Meeting Notes no longer lowers your microphone volume for other people in Zoom, Meet, or Teams.
- Meeting reminders now ignore obvious solo personal calendar blocks like Gym or Dinner.

## 2026-07-08

### Added

- Clips now pops up to take notes when you join an adhoc Zoom or Teams call, like Granola.

### Improved

- Chrome extension camera and microphone menus now show which device the system default currently points to.
- Chrome extension recordings copy their share link automatically after saving.
- Meeting reminders in the desktop popover can start notes and join the call in one click.
- Meeting recaps now keep summaries, action items, and transcript controls cleaner on one page.
- Meeting reminders now appear 1 minute before start, stay until 5 minutes in, and use a Granola-style Join & open Clips button
- Mobile shared clips now support Loom-style tap-to-pause playback with 15-second skip controls.
- New recordings and uploads copy their clip link automatically after saving.
- Settings are cleaner and searchable, and the S3 fields collapse automatically once Builder storage is connected.
- Video playback controls now match Loom-style 5-second skips and pause from the video surface.

### Fixed

- After finishing a desktop recording, reopening Clips restores the camera preview and Start Recording works again instead of doing nothing.
- Chrome extension recordings now continue after granting camera or microphone access and recover the camera bubble more reliably.
- Desktop clip recordings are louder after capture — mic-only clips skip the half-volume downmix and get a stronger pre-gain before loudness normalization; mic+system clips get makeup gain so the centered mix is not systematically quieter.
- Desktop meeting notes stay active when you open the tray or shortcut controls, and the stop action targets the live meeting.
- Hosted clip uploads now clear failed buffered chunks and require connected storage before saving thumbnails.
- Hosted recording uploads now avoid storing video chunks in SQL and ask users to restart when a resumable storage session is missing.
- Meeting notes keep their recording state when the desktop popover is closed and reopened.
- Meeting reminder dropdowns now expand fully instead of being cut off.
- The desktop Meetings panel has room for its drop shadow and a little more space below the last meeting.
- Transcripts are more reliable for longer desktop recordings when audio extraction is slow.

## 2026-07-07

### Added

- AI tools can include the full video — not just the transcript — when generating titles, descriptions, and other outputs. Toggle it in the AI tools menu.

### Improved

- Clip video uploads now compress in the background while keeping a single stable playback URL.
- Clips Desktop now surfaces Meetings and Dictate directly in the popover.
- Desktop settings now include a manual update check with restart status.
- Meeting notes now explain exactly how to start Granola-style live notes from Clips Desktop.
- Meeting start alerts now include separate Start notes and Join buttons in the top-right overlay
- Native desktop recordings now reduce steady microphone background noise during audio optimization.
- Sharing public clips now stays focused on the normal link, with agent links tucked away for private clips only.
- The Clips Desktop download page now uses the Agent Native app icon in its header.

### Fixed

- A pending app update no longer blocks screen recording — updates now install when you restart, not mid-session
- Auto-generated chapter requests now open the matching agent chat tab.
- Chrome extension recordings now survive refreshing the tab being recorded: the camera bubble and recording toolbar reappear, and tab audio and microphone sound keep recording.
- Clip playback progress now starts at the beginning and reaches the end reliably.
- Desktop settings stay out of the server URL field on open, and Fn dictation recovers when macOS disables its Input Monitoring tap.
- Dictation starts faster when using Local Whisper after the first press.
- Recording transcripts now line up with the video start after the countdown.
- Recordings start more predictably and newly saved clips refresh to the playable media automatically.
- Shared clips start playback reliably from the first play click.

## 2026-07-06

### Added

- Dictation history from the desktop app now appears in the Dictate tab
- Double-tap your dictation key for hands-free dictation — tap again to finish
- Live meetings show time remaining, and you can end a meeting from the page
- Manage your personal dictation dictionary from the Dictate tab
- Paste your last dictation anytime with Cmd+Ctrl+V or from the menu bar
- Press Esc to cancel a dictation in progress
- Search inside meeting transcripts
- See who viewed your shared clips and when — click the view count on any clip to open a viewer timeline

### Improved

- Clip recordings now use streaming uploads by default when storage supports resumable video uploads, so saving finishes faster after recording stops.
- Dictation no longer overwrites your clipboard, and messaging apps skip the trailing period
- Video compression now runs in the background without blocking clip saves, while oversized compression attempts fall back gracefully to the original recording.

### Fixed

- AI setup now switches to your saved provider key and uses fallback AI keys when Builder.io credits are paused.
- Browsers that can't play a clip's video format now see a clear explanation instead of a broken player.
- Calendar connections no longer ask you to reconnect after temporary network hiccups
- Chrome extension recordings now keep your selected microphone and fall back cleanly when a saved mic or camera is unavailable.
- Clip titles in the library grid now open the clip instead of entering rename mode.
- Opening the desktop popover no longer drops Bluetooth headphones into call-quality mode before recording.
- Desktop recorder now refreshes cameras and mics when the popup opens and automatically falls back to the default device instead of erroring when your last-used camera or mic is unplugged
- Desktop recordings no longer get stuck optimizing when ScreenCaptureKit is interrupted while stopping.
- Fixed desktop recordings sometimes uploading without audio after automatic compression silently dropped the audio track
- Fixed desktop recordings that could get stuck uploading and restored native microphone audio/transcripts.
- Fixed recordings sometimes capturing from the wrong microphone (e.g. a nearby iPhone) instead of the selected Mac mic
- Hands-free dictation and meeting cleanup recover more reliably after interruptions.
- Meetings interrupted by quitting or crashing now close out cleanly with notes
- Mic-only desktop recordings now use the selected microphone instead of macOS's default input.
- Recordings whose video file contains no audio track no longer claim to have audio, and a processing failure that would silently drop audio now fails loudly instead of publishing a silent video.
- Share links for agents now appear as soon as the share menu opens.
- Share popovers now stay above video playback controls.
- Shared clip pages now recover automatically from transient video loading errors instead of showing a playback error.
- The desktop app now walks you through permissions on first launch
- Transcript cleanup preferences now save per user.
- Transcripts now retry automatically after transient failures like audio-extraction timeouts, instead of staying failed until manually retried.

### Changed

- The desktop countdown now dims the screen until recording starts.
- Desktop recordings now keep microphone volume clear while recording with live transcription.

## 2026-07-05

### Added

- Desktop Clips can now use a custom global shortcut to start or stop recording.

### Improved

- Mobile clip pages use a tighter viewer layout with inline activity and a reliable preparing overlay.
- Timeline zoom controls are now visible in the clip editor, support trackpad pinch gestures, and stay anchored while selecting ranges.

### Fixed

- Desktop full-screen recordings with system audio now finalize reliably when the microphone is enabled.
- Desktop recordings no longer fail when saved capture constraints are stale after an app update.
- Permanently deleted clips now clean up matching video and thumbnail objects from configured S3-compatible storage.

## 2026-07-03

### Fixed

- Mobile recording pages keep videos in a 16:9 player with activity below.

## 2026-07-02

### Added

- Private recordings can be shared with agents through temporary links without making them public.

### Fixed

- Recordings now wait for uploaded media to play from storage before finishing, and playback falls back when a compressed storage copy is temporarily broken.

## 2026-07-01

### Improved

- Clip uploads and Loom imports finish sooner by skipping the Builder.io compression wait after upload registration.
- Recording controls are cleaner and the countdown uses shadowed numbers instead of a filled circle.
- Shared clips can now copy a ready-to-send prompt that tells agents how to read transcripts, frames, and diagnostics.

### Fixed

- Chrome extension recordings now stream uploads while recording so saving is less likely to time out.
- Chrome recording uploads now serialize chunks to avoid resumable upload offset races.
- Clip embeds now render as a clean video-only player without extra page chrome or scrollbars.
- Clip uploads and playback recover more reliably from storage timeouts.
- Desktop recording setup no longer offers unsupported browser-tab capture in desktop app windows.
- Dictation keeps listening through natural pauses and gives clearer start feedback.
- Embedded player progress is easier to see on dark videos.
- Loom imports now show clear guidance when Loom does not provide a downloadable video.
- Move to folder now opens folder choices directly instead of starting an agent chat.
- Preserve in-flight streaming uploads when the streaming kill switch is disabled mid-recording.
- Recordings now recover when the final upload finishes but the browser receives a timeout instead of the saved clip response.
- Redoing a paused desktop recording no longer leaves the recording controls disabled.
- Shared clips now start playing and scrub instantly instead of buffering — recordings are made seekable on upload, and you can repair older clips
- Stalled clip uploads now update in the library and surface as failed instead of staying stuck as uploading.

## 2026-06-30

### Fixed

- Chrome extension recordings no longer show an upload failure when the clip finished saving successfully.
- Longer Chrome extension recordings now keep saving reliably instead of getting stuck or showing a second countdown.

## 2026-06-29

### Added

- Screen Memory keeps a local rolling screen buffer and recent app/window context for local agent context.

### Fixed

- Meeting detail layouts now adapt cleanly when the agent sidebar narrows the app.
- Video chat is easier to find on recording pages and S3 setup saves from onboarding.

## 2026-06-28

### Improved

- Builder.io credit pauses now show friendly upgrade guidance for backup transcription, transcript cleanup, summaries, and AI titles.
- Left sidebar footer controls now use less divider chrome.

### Fixed

- Transcription now auto-detects spoken language instead of following the app or system locale.
- Video uploads now finish even when the browser cannot read exact duration metadata.

## 2026-06-27

### Improved

- Desktop recording now guides you to connect storage with a friendly setup flow instead of a red error.
- Recorder download options now show the Chrome extension and desktop app choices without extra setup copy.
- Recorder setup keeps screen-capture choices desktop-only on mobile and tones down the selected mode highlight.

### Fixed

- Clips no longer shows desktop app prompts on mobile screens.
- Traditional Chinese copy now uses Taiwan terminology and clearer technical wording.

## 2026-06-26

### Added

- Bug-report recordings can keep redacted host-app context with the clip.
- Bug report widgets can launch Clips recordings from embedded product surfaces.

### Improved

- Shared clip links now guide agents through processing transcripts and exhausted transcription credits.
- Storage setup now explains why Clips needs connected storage and guides saved desktop or Chrome uploads back to Builder.io.
- The Clips library now matches the shared recessed shell styling.

### Fixed

- Brief network blips no longer block recording or wrongly prompt you to reconnect storage in the desktop app.
- Desktop recording keeps connected users out of the storage setup flow when a status check is indeterminate.
- Desktop recordings recover more reliably when macOS reports a finalization error.
- If a recording can't be uploaded, the Chrome extension now saves it to your downloads so it's never lost.
- Long desktop recordings are checkpointed so macOS finalization failures can recover the saved portions.
- Non-Mac desktop recordings now try Web Speech transcripts before falling back to upload transcription.
- The recording details button stays at the far right on small screens.
- S3-compatible storage keys now save securely from Clips Settings without requiring deployment env vars.
- Slack unfurls now recognize recording dashboard links pasted from Clips.
- The agent sidebar now slides in smoothly without duplicate edge borders.
- The clip details sidebar now collapses into a slide-out panel on smaller screens.

## 2026-06-25

### Added

- GitHub issue and pull request pages can now preview playable Clips links when the Chrome extension is installed.
- Recording pages now offer a download action for viewers with video download access.

### Improved

- Clip titles are now edited only from a clip's detail view, not from the library grid
- Console diagnostics keep more useful non-secret details when clips are shared with agents.
- Recording cards now avoid duplicate rename controls in the overflow menu.

### Fixed

- Chrome extension recordings now upload large capture bursts reliably and report extension errors to Sentry.
- Fixed owner recognition so Clips created from desktop and web sessions remain editable by the same signed-in user.
- Fixed the Mac menu bar popover so it opens reliably after launch at login.
- Localized Clips Settings changelog and extension sidebar labels in every supported interface language.

## 2026-06-24

### Added

- Added a language picker and localized app chrome for supported languages.
- Clips now includes a language picker with Simplified Chinese support for core navigation, empty states, and settings.

### Improved

- Chrome extension setup now shows a clear all-done confirmation when permissions are ready.
- Settings now link directly to Agent settings for model, API key, automation, and voice preferences.
- Settings now puts What's new in a compact sidebar, prioritizes Builder.io setup, and lets you manage S3 storage and AI provider keys in place.
- Shared clips now expose their full console log stream (all levels, redacted) to connected agents, not just warnings and errors
- Shared clips now expose their full fetch/XHR network request stream (method, sanitized URL, status, duration) to connected agents, not just failed requests

### Fixed

- Archive and spaces navigation is more resilient when sidebar count loading fails.
- Inline Slack playback controls no longer shift when adjusting volume, and compact clip times stay on one line.

### Changed

- The Chrome extension option now only appears on supported Clips hosts unless a custom deployment explicitly enables it.

## 2026-06-23

### Added

- Clips for Slack is here — connect a workspace under Settings, then paste any public clip link in Slack and it unfurls as a playable video
- Skip or cancel the recording countdown with buttons beside the number

### Improved

- Made the play button on shared and embedded clips scale with the player size so it's no longer oversized in small previews like Slack unfurls
- Public clip share links now show whether they'll play inline in Slack, with a one-click link to connect a workspace
- Removed Select button from library — hover a clip to select it
- Screen recordings now capture at a crisp 1080p bitrate instead of a compressed, fuzzy one
- The recording-start sound is now a softer, more modern chime

### Fixed

- Clips shared in Slack no longer show a 'Could not start playback' error in the inline preview — they autoplay muted where allowed and play on click otherwise
- Dragging the desktop camera bubble now glides to a stop at the screen edge instead of jittering or snapping back
- Screen + camera recordings now keep the presenter's face in the thumbnail shown on the library card, video poster, and Slack unfurl
- Shared video links now play for anyone without signing in
- The desktop camera bubble now looks sharp the instant it opens instead of staying blurry for the first several seconds
- The desktop recording widget now grows downward only when you hover it, so its buttons stay in place instead of shifting up under your cursor

For the full list of updates, see the [changelog folder](./changelog/).
