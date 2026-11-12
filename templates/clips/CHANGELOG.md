# Changelog

All notable user-facing changes to Clips are documented here. Open it any time
from the command menu (Cmd+K → "What's new") or from Settings.

## 2026-11-12

### Improved

- New Clips users can set up Builder automatically during signup.

## 2026-11-10

### Fixed

- Builder account setup can finish after verified sign-in even if the app page closes. Clips Google signup now preserves the signup consent through its custom callback.

## 2026-11-09

### Improved

- Sharing controls now match other apps, with password protection available for public links.
- More save failures now say why, such as being offline or lacking permission.
- Some new accounts now connect to Builder automatically during signup, with the Builder terms and privacy notice shown before signup.

### Fixed

- Mac app: opening Clips before Screen Recording is allowed no longer risks a macOS permission prompt; Clips asks when you start recording.
- Rewind now starts when the screen is still, instead of timing out and falling back to slower capture.
- Starting meeting notes from the notification now opens only the notes widget, the widget stays up until you stop notes, and hovering it reliably shows the live transcript.

## 2026-11-07

### Fixed

- Inspect frames from large recordings stored in S3-compatible storage.
- Restarting notes on a meeting no longer adds what they already saved a second time.
- Shared meetings and clips now say a transcript couldn't be read when its saved lines are damaged, instead of showing no transcript, no speech, or lines with made-up speakers. On your own clip, a Regenerate transcript button sits under the message.

## 2026-11-06

### Added

- Agents working for a recording's owner can now get a link that downloads its video file for 10 minutes, including private recordings.

### Fixed

- Chrome extension: the popup now switches to Record as soon as sign-in completes, and the website shows an error if the extension handoff fails.

## 2026-11-05

### Improved

- Failed saves now show a clear error message instead of failing silently.
- Reference recordings directly from the composer

### Fixed

- Recording thumbnails show hours for longer clips.

## 2026-11-04

### Added

- Agents connected to Clips over MCP can see a recording's frames as images

## 2026-11-03

### Added

- Meeting notes that include audio from before you started now say so, and Remove takes that audio out of the transcript and the summary.

### Fixed

- After you drag a block down by its handle, the caret stays on that block instead of landing in the one below it.
- Commenting on a Clip while in fullscreen now works reliably in Safari.
- Meeting notes open on a page now pick up changes made elsewhere, and clicking in and out of them no longer saves an older version.
- Rewind's Clear History now reports it when something can't be removed, and history held during another recording now expires on schedule.

## 2026-11-02

### Fixed

- Transcripts that get cut off now show the text that was captured, with a partial-transcript note, instead of failing completely.
- Editing a clip in two tabs, or alongside the agent, now keeps both sets of trims. If you both change the same section, you choose which version to keep and can get the other one back.
- Password-protected transcripts stay protected in search and agent context.
- The desktop app no longer uploads a second copy of a saved recording you already uploaded another way.

## 2026-10-31

### Added

- Mac dictation can run on Parakeet, an on-device English model that transcribes while you hold the key, so text pastes almost as soon as you let go; new English installs start on it.

### Improved

- Desktop dictation settings now pick the transcription engine and AI polish separately, so Local Whisper can be polished too, and the polished text is what pastes
- Dictation keeps the last word you say as you let go, ignores stray taps of the key, and ends a silent hold at once instead of after a few seconds.
- Local Whisper transcribes faster and its models are smaller; your selected model downloads once more after updating, and the previous copy keeps transcribing until it finishes.

### Fixed

- AI polish in the desktop app now cleans up dictation instead of quietly pasting the raw text
- Local Whisper dictation hears your selected microphone again
- A comment posted from a Content page is saved once when Content sends it again after a slow answer
- Shared clips now show Claude and other agents the trimmed video, with cut footage and speech removed and the trimmed length.

## 2026-10-30

### Fixed

- The recording timer in the Chrome extension keeps its elapsed time when you refresh the page, including in incognito windows.
- Trash now says whether Clips is still checking a deleted video's files, couldn't confirm they were deleted, or needs to retry a storage usage update, and each retry button retries only that step.

## 2026-10-29

### Improved

- Share lists show each person's name and email, roles read "Can view", "Can comment" and "Can edit", and Remove access is in each person's role menu.

### Fixed

- Window recording now shows the countdown and recording pill on the picked window's Space and display, including full-screen apps

### Changed

- Screenshots are available when enabled in Labs.

## 2026-10-28

### Improved

- Clip menus use consistent text-only actions.
- Recording menus use consistent text-only actions.
- Recording options are easier to find and titles appear sooner

### Fixed

- Deleted recordings retain media removal status and retries until storage cleanup is confirmed
- Fixed the Share → Advanced popover so the Save buttons fit and the password toggle matches other switches
- Clips desktop preserves your server choice across updates and reconnects after temporary sign-in outages.
- Recording chapters remain reachable when the list extends below the player.
- The Chrome extension recorder has more room and a clearer feedback link.
- The recorder refreshes storage connection status when opened

### Changed

- Earlier screen time is now off by default until you enable it in Labs.

## 2026-10-27

### Improved

- First-run setup makes free credits the primary path while keeping personal API keys one click away

### Fixed

- Failed fullscreen comments remain available to retry without replacing newer drafts
- Password-protected discussions stay private in agent context and comment search.
- Meeting transcripts follow their sharing settings and the linked Clip's access protections.
- The Rewind consent dialog stays visible on shorter screens.
- Thumbnails respect attached footage availability.
- Workflow generation now shows updates while it runs, offers cancellation, and settles cleanly when an agent run ends.
- Workflow generation avoids duplicate runs when its state is incomplete and reports rejected starts or ended runs clearly.
- Workflow generation progress and cancellation stay tied to the viewer who started them

## 2026-10-26

### Improved

- Agents reading a clip now get its recommended frames from storage instead of re-downloading the video on every request.
- Clip cleanup waits for active transcripts and offers recovery when a transcript has failed.

### Fixed

- Opening a private clip while signed out goes straight to the Private clip screen, without a brief error first
- Recording activity notifications follow Trash visibility.
- Recording search and shared access respect expiry, and owners can delete their own saved comments while discussion is disabled.
- Silence and filler-word cleanup wait until a transcript is ready
- Silence cleanup waits for an in-progress transcript before offering regeneration
- Agents now get frames spread across the whole clip, and the opening frame skips the black first moment.

## 2026-10-25

### Fixed

- Long recordings remain scrollable in short desktop windows

## 2026-10-23

### Fixed

- Comment access and deletion follow recording permissions and settings consistently.
- Password-unlocked viewers retain comment access while protected recording permissions stay enforced
- Video playback respects Clip availability.

## 2026-10-22

### Improved

- Approval links from a connected agent, such as Claude Code, now open the review inside the app, in its own theme.

### Fixed

- Recording sharing and discussion settings apply consistently.
- Turning comments off hides saved comments from viewers while keeping them available to the owner

## 2026-10-21

### Improved

- Meeting notes check sooner when a meeting ends on the web and retry failed end checks
- New meetings show their transcript on the share link by default; meetings you already have keep their setting.
- The clip Share panel has People, Agents, Embed and Social tabs, and password, expiry and the meeting transcript setting now live under Advanced.
- Share panels describe general access in a sentence and no longer open an empty people list when you click into them.

## 2026-10-20

### Fixed

- Expired Clips hide comments from viewers while owners retain access
- Locally saved desktop recordings now appear in the recovery list with upload and storage setup actions.

### Changed

- Clips asks you to connect storage before recording when no storage destination is available.

## 2026-10-19

### Added

- Agents connected over MCP can import video links, update Clip chapters, read comments and reply in threads

### Fixed

- Agents see a clip's frames as soon as it finishes processing instead of a cached "still processing" answer.
- Chapter list times now match the player's clock, and each chapter shows a focus ring when you tab to it.
- Editing a comment puts the cursor after its text, and Reply on another notification moves the cursor to its reply box.
- Video imports use clearer labels, YouTube links work without connected storage, and embedded players stay clear of timeline hover previews.
- Screen Memory can transcribe desktop recordings without a separate FFmpeg install.

### Changed

- Apps no longer keep server functions and databases warm by default; set `AGENT_NATIVE_ENABLE_KEEP_WARM=1` to opt in.

## 2026-10-18

### Fixed

- Workflow generation reports a failure when the agent session is rejected and allows a retry when its state is stale.

## 2026-10-17

### Added

- Agents can see a clip's animations and transitions frame by frame in one contact-sheet image instead of requesting each frame separately.

### Improved

- Desktop recordings include balanced audio and compress large clips without extra setup

### Fixed

- Clips waits for meeting startup and cleanup to settle before quitting
- Dictation explains when meeting capture is using the microphone.
- Meeting notes keep the final spoken phrase on stop and pause reliably while the microphone is still starting.

## 2026-10-16

### Added

- Paste a YouTube link to make a clip that plays in YouTube's player, with timed comments, chapters, and an imported transcript that follows playback.
- Replacing a transcript, by importing a file or regenerating it, now keeps the old one to restore from Earlier transcripts in the transcript panel, and an import or restore can be undone right away from its toast.
- Select a timeline range to cut or delete the middle of a recording.

### Improved

- Share dialogs make it easier to see who has access and manage common sharing changes.
- Rewind settings now show whether Rewind is remembering screen only or screen + audio.
- Clips detects browser meetings more reliably and keeps notes until the meeting stop and transcript save are confirmed.
- Clips detects browser meetings sooner, asks before starting when the active tab is unclear, and retries failed stops.
- Desktop dictation confirms when text is pasted or copied and keeps transcripts available when saving fails.
- Meeting notes recover when a recording upload fails
- Recordings show the silence warning only until microphone audio is detected.
- Select and remove a precise timeline range by holding R while dragging.
- Stepping forward through a clip that hasn't played gets quick after the first few presses, and no longer flashes the previous frame.
- Storage setup explains Builder.io's free video storage and one-click setup, and opens custom keys in a new tab.
- The agent now asks you to approve each workspace invitation it sends, each member it removes, and each role it changes.

### Fixed

- If permanently deleting a Clip fails, the Clip and its video are left intact.
- Rewind now deletes history past its time limit even while it's off or paused.
- The Replace transcript dialog keeps showing the file name while it closes.
- Tooltips no longer pop up on their own after a menu, popover, or dialog closes.
- Video posters load again when your own storage runs on a private network address.
- Recordings uploaded by a connected agent can now use free Clips storage, like recordings made in the app.
- An agent upload too large for free hosted storage is now refused before it starts, with the size limit that applies.
- Agents connected to Clips over MCP can now import a transcript file, instead of getting an unknown-tool error.
- Clips keeps meeting transcripts recoverable while a save or notes finalization is still in progress.
- Dictation handles repeat shortcuts and microphone errors more clearly, preserves history on retry, keeps late transcript text during resume and stop, and ignores stale text after a long pause.
- Earlier screen time starts from the confirmed capture time and recovers more reliably after temporary failures.
- Earlier screen time requests now recover after temporary recording and cleanup failures.
- Earlier screen time now retries after temporary recording or upload failures.
- Imported transcripts keep a timestamped line that contains an arrow, and prose with angle brackets such as `a<b and c>d`, instead of misreading them as cue timings or markup.
- Recording cards no longer show a context warning when no context was requested
- Rewind keeps transcripts aligned and can be retried after an update fails
- The menu bar shows only the Clips icon while idle.

## 2026-10-15

### Added

- The desktop camera bubble can remove your background, and clicks on the transparent area pass through to the apps behind it.
- Step through a paused clip frame by frame with the comma and period keys, and comments keep the exact frame they were left on.

### Improved

- People using a screen reader can hear what “None” means before choosing it.
- Rewind explains what local screen history it keeps, when time and storage limits apply, who can access it, and why choosing None does not stop recording.
- The recording countdown starts when it appears and plays smoothly while Clips prepares a recording.

### Fixed

- Clips keeps showing a warning when it cannot remove earlier screen time after a failed recording, until cleanup succeeds.
- Clips keeps saving earlier screen time when local storage is unavailable, and still removes it if a recording stops unexpectedly.
- Clips retries temporary save failures, releases timed out earlier screen time exports for another attempt, and keeps cleanup from delaying new exports.
- Earlier screen time now works with window and camera recordings when Rewind is on.
- Earlier screen time requests are cleaned up safely after a recording start fails
- Earlier screen time stays attached when a recording takes longer to save.
- Earlier screen time stays available while you choose a window and start a recording.
- Earlier screen time stays tied to the device that recorded the Clip
- Failed recordings no longer leave an unfinished earlier screen-time request.
- Clips retries removing earlier screen time from recordings that fail to stop, even after the app restarts.
- You can delete saved Rewind history in Settings even when Rewind is off.
- Camera permission denials now show the right recovery guidance
- The Dictionary scrolls through long lists and stays closed during dictation, Archive and Trash show counts, and selection checkboxes stay visible over dark previews.
- The Share and copy-link buttons now match in color.
- Rewind can be enabled from Include last without leaving the recorder.
- Screen Memory checks privacy exclusions during capture recovery
- Screen Memory retries capture promptly after audio mode changes fail
- Screen Memory recovers from capture interruptions promptly and preserves privacy-gap history.
- Earlier screen time keeps recording when audio capture starts or stops, and previews follow your selection.

## 2026-10-14

### Added

- Add a transcript file to a clip from the transcript panel: WebVTT, SRT, or a timestamped transcript copied from YouTube. Clips keeps its timings, labels it as imported, and automatic transcription never replaces it.
- Agents connected over MCP can upload a local video file to Clips, choose who can open it, and get its share link back.
- Extension recordings of Agent-Native apps include what the app did, from 30 seconds before recording started, in the Debug panel and for agents.
- Record and store your first three clips before connecting your own storage
- Record three clips before connecting your own storage

### Improved

- Earlier screen time now follows its clip's normal share rules: adding it no longer makes the clip private, and sharing the clip shares its earlier screen time with it.
- The recorder's Include last menu now reads None for no earlier time and has a Turn off item that stops Rewind, and the row reads Off once Rewind is stopped.
- Clips suggestions are shorter and match the active view.

### Fixed

- Captions and the transcript highlight change on cue instead of up to a quarter second late.
- Clips recognizes existing sign-ins when checking access to free hosted recordings
- Hosted clips now save reliably to S3-compatible storage, including streamed recordings.
- Clips keeps the camera preview open while Control Center is active.
- Clips recording errors without a recovery action now dismiss automatically
- Dictation cleanup can be undone and the original transcript remains available.
- Owners can download a local copy when a clip upload fails
- Opening a private clip you don't have access to now shows the request-access screen right away instead of a loading skeleton for several seconds.
- Restoring a dictation now stays final while cleanup is still running
- Selected-window recordings now include the camera bubble over the captured window.
- Shared Clips no longer show earlier screen time after a Clip expires or moves to Trash.
- Transcript edits stay intact when cleanup is running.
- Undo no longer removes a newer dictation cleanup
- Window recordings keep the camera preview inside the captured window.
- Window recordings keep the camera bubble visible and aligned with the selected window as it moves.
- Clips explains how to connect storage when saving screenshots or redacted clips.
- Clips hides unsupported Loom edits, keeps empty-state suggestions relevant, and prevents recording controls from covering Feedback.
- Clips no longer leave an upload progress toast running while waiting for storage setup.
- Protected recordings keep playing while their access link refreshes.

## 2026-10-13

### Improved

- The Rewind setup popover now expands smoothly, and its full-width help link is easier to find.

### Fixed

- Earlier screen time appears in Transcript as soon as Clips saves it
- Earlier screen time can still be saved when audio is unavailable, and failed saves can be retried.
- Earlier screen time saves with available audio even when some tracks are missing.
- Recordings export even when some segments have no audio.
- Silence-removal errors now explain when a transcript can't be used.
- Silence removal offers transcript regeneration when timestamps are missing.

## 2026-10-12

### Fixed

- Earlier screen time can be attached when native recording setup takes longer than expected.
- The Rewind popover fits in the tray and explains that screen history stays on-device until included in a recording or approved for sharing.

## 2026-10-11

### Improved

- The agent uses its dedicated icon while importing and when the results are ready.
- Local recordings can start before connecting a storage provider.

### Fixed

- Combo buttons keep both controls at the same height
- Recordings waiting for storage setup remain retryable through temporary storage status issues.

## 2026-10-10

### Improved

- Recordings load as you scroll in batches, and / focuses search.
- The Chrome extension now captures console and network logs from the tab you are on and recently used tabs, plus up to 30 seconds before a recording starts.

### Fixed

- Camera framing keeps a consistent size and position across desktop displays
- Clips no longer treats a temporary storage status failure as missing storage.
- Split buttons keep a clear divider and rounded outer corners in the library and recording share controls.

## 2026-10-09

### Improved

- Clips share links now guide agents to read full transcripts and inspect video frames, with distinct recovery steps for private clips, expired links, and unavailable video.

### Fixed

- Transcript cleanup with your own Gemini key works again: Google retired the model it used.
- The Clips download page explains when it cannot locate its workspace path.
- The Clips download page stays open and offers a retry when release information is unavailable.
- Agents can read clip transcripts and inspect video frames from shared links, with clear guidance when a private clip needs a Share with agents link.
- Agents now get clear recovery steps when clip frames are still processing or stored media cannot be fetched.

## 2026-10-08

### Added

- Chapters now appear as a clickable list under the description on the recording page and on share links, and owners can edit them as text.

### Improved

- Opening Clips now goes directly to the recordings library.
- Signup and login sessions are available in Analytics with all form inputs masked.
- Skip setup to start recording; storage setup remains available after a recording finishes.
- The Clips agent can add split markers at timestamps so segments can be edited independently
- You can skip setup and start recording clips without connecting storage.
- The storage setup screen no longer lists example S3 providers.
- The video editor confirms when edits save to a clip and provides a clear way back to its viewer.

### Fixed

- Custom-key setup opens model settings after onboarding.
- Queued AI work (titles, summaries, chapters, filler words, workflows) now runs in the background even when the Agent tab is closed.
- Clip uploads recover more reliably from temporary server interruptions
- Clips blocks chat prompts until an AI provider is connected.
- Clips marks recordings as failed when storage setup is missing, even if upload progress cannot be repaired.
- Clips respects Skip after storage connects and gives accurate guidance when Builder does not respond
- Recording edits, audio cleanup, and desktop dictation recover reliably after interruptions.
- First-run storage setup remains available when the status check fails.

## 2026-10-07

### Improved

- Allow local recordings to be previewed and downloaded without storage.
- Clips explains when Builder needs separate file-upload access and how to restore storage.
- Show a skippable storage choice before the first recording, then keep local capture available.
- Builder.io setup choices now say “Use Builder.io”.

### Fixed

- Clips can finish saving when a browser tab stops responding.
- Clips keeps active recordings running while storage connects and shows current Builder recovery steps
- Clips preserves queued uploads, keeps complete local previews, and offers a retry when Builder status is unavailable.
- Builder connection errors now show actionable retry and browser recovery guidance.
- Return to Home after storage connects during first-run setup
- Skipping storage setup keeps the recorder ready, including when opened from a setup link
- Storage setup errors now point members to an owner or admin when they can't manage storage settings
- Clips sizes Settings and recording views correctly while a recording is active.
- Clarify Builder storage setup choices and retry guidance

## 2026-10-06

### Fixed

- Fixed arrow-key selection in comment mentions
- Fixed attached images missing from visual analysis.
- Fixed clips freezing when you hit play while the recording was still being optimized
- Fixed returning to shared clips after email verification
- Sign-in pages show the ocean wave without a fallback flash and keep it clear of the marketing copy.

## 2026-10-05

### Improved

- Clips desktop offers one-click Builder account activation or sign-in.
- Shared recording pages give the agent composer its own background.

### Fixed

- Dictation now transcribes from AirPods and other Bluetooth microphones instead of reporting that no speech was detected.
- Agent links copied from a clip are shorter, so Claude can fetch them without hitting its URL length limit.
- Sign-in and signup pages now share the animated Agent-Native wave.
- Confirming Discard recording now returns you to your library.
- Discarding a recording now removes its failed upload card from your library.
- Discarding a recovered recording no longer warns that it's open in another tab.
- Search results identify recordings in Trash and open them with Trash navigation.

## 2026-10-03

### Fixed

- Invalid Lab choices can be repaired from Labs settings.

## 2026-10-02

### Improved

- Builder.io setup now offers one-click activation and clear existing-account sign-in.

### Fixed

- Cancelled Rewind Clip setup can be retried immediately
- Long uploads (an hour or more) now transcribe reliably instead of failing.
- Recording countdowns begin during setup, with explicit cue outcomes and startup timing
- Recording visibility defaults no longer switch to Public when saved settings cannot be read.
- Screen recording startup now cleans up canceled Rewind setup and keeps countdown timing reliable on older macOS.
- Recording reminders and other actionable notifications show their message above the buttons
- Temporary upload authorization failures remain retryable, while permanently rejected Builder credentials trigger storage setup errors.

## 2026-10-01

### Improved

- Clip pages show layout-matched skeletons while loading
- Signed-out viewers now see that they need to sign in before commenting on shared clips.
- The Connect storage card is simpler: one Create Builder.io account button opens the same account popover as the rest of the app, with S3-compatible storage as the alternative
- You can start recording before connecting storage: the web recorder keeps a copy in your browser and the desktop app saves to Movies/Clips, and the recording uploads once you connect storage. If an upload is interrupted, Clips offers to finish it the next time you open it

### Fixed

- Camera repositioning keeps the recording controls visible
- Desktop clips no longer play as a short fragment when a video chunk loads incompletely while the clip is still being processed
- Existing Builder connections sign in from storage setup
- Loom imports no longer stay stuck if their upload worker stops.
- Storage setup recovers when Builder connects after cancellation
- The dictation shortcut now responds to every quick tap, the voice bar no longer disappears mid-dictation, and AI cleanup works again.
- Deleted dictations disappear from your history right away instead of after a few seconds
- Dictation shortcuts stay hidden when voice dictation is disabled.
- Opening a recording link no longer flashes a "Recording not found" message before the recording loads
- The Screenshots view labels its list Screenshots instead of Recordings

## 2026-09-30

### Improved

- Storage setup checks finish faster when starting a recording.
- Dark mode gives the sidebars a darker surface than the center
- Sidebars use clearer surface contrast
- Recording saved notifications keep the Copy link action available.
- Clips desktop confirms copied links with a check mark.

## 2026-09-29

### Improved

- Settings pages now share the account layout, with dated updates that load in batches.

### Fixed

- Chat prompts clear immediately while the assistant thinks.
- Chat stays ready for your next draft while a message is being sent.
- Clips Desktop shows a brief confirmation after copying a share link
- Chat composers no longer show temporary status rows.
- Fixed library and signup loading flashes and made desktop recording startup cues and countdowns reliable.
- Sent chat prompts clear immediately, while reply progress appears in the conversation.
- Stopping during setup cancels cleanly, while active clips still finish and save.
- The comment sign-in prompt stays visible while a clip is fullscreen.

## 2026-09-28

### Added

- Clips can capture screenshots, annotate them, redact sensitive details, and share them.

### Improved

- Choose faster recording uploads and improved recovery together in Settings → Labs, while recordings already in progress keep their original behavior.
- The app canvas now meets the right chat sidebar without a dark seam or rounded corner.
- Settings now opens in the new layout, with Account, Connections, Agent, Organization, and app sections.
- The chat sidebar matches the app navigation color, with tighter composer spacing.
- The recording viewer keeps Agent, comments, and transcripts together, and the app sidebar now moves the full page.
- Viewers can share recordings with agents from shared recording menus

### Fixed

- Clip share previews show a branded image while the recording thumbnail is unavailable.
- Meeting and feature-flag polling resumes after your session is accepted again
- Older recording links preserve the selected viewer tab when panel and Agent sidebar state are both present
- Opening Agent from a recording keeps the latest selected text attached to your prompt.
- Stop repeated Clips requests after session expiry
- Agent links stay valid when clip details change

### Security

- Password changes immediately invalidate old recording links
- Password-protected recording links stop working when the password changes

## 2026-09-26

### Improved

- Ask about a live meeting from the recording pill, with transcript context and AI-generated next-step suggestions.
- Clips asks you to connect storage only when an upload needs it.
- See the desktop app for your platform at a glance.
- The comments signup headline now wraps more evenly.
- The empty comments state now explains how screen recordings help AI agents.
- The empty comments view has a clearer headline and a focused signup action.

### Fixed

- Removing a member from your organization now completes instead of failing with a pending cleanup error
- Clips asks you to connect storage only when you choose an upload
- Clips can play recordings from public S3-compatible storage in more hosted environments.
- Dismissing storage setup now cancels queued uploads.
- Meeting chat waits for interactive AI access before sending, and its answer panel has a localized resize and dismiss label.
- Stopping a recording with its keyboard shortcut now shows the completion card.
- Video uploads only ask for storage when you choose Upload video, then offer a fresh upload action after storage connects.

### Changed

- The app entry now opens the shared sign-in and sign-up screen instead of a separate marketing page.

## 2026-09-25

### Improved

- Clips settings are reorganized in the new Settings: General with Recordings and Meetings tabs, Notifications, and Slack link previews under Channels.
- The account menu at the bottom of the sidebar shows your photo, name, and organization, and holds Settings, Usage, Get apps and extensions, and Log out
- Video storage now uses the shared storage form, and Clear credentials asks before it removes your storage keys
- Use Builder storage by creating an account in one click.
- Public clip embeds and meeting notes show richer link previews.
- The no-comments sidebar gives viewers a concise reason to try Clips and a clear path to sign up.
- Shared clips remember your sidebar choice and help new viewers understand why to sign up.

### Fixed

- Fix Google sign-in and connect popups that stayed blank and asked you to allow pop-ups
- Clips checks storage before upload and offers Builder.io or your own S3-compatible keys when storage is missing.
- Clips desktop sign-in now accepts authenticator codes when two-step verification is enabled.
- Keep Builder login state after blocked popups and show feedback while retrying storage connection checks
- Clips clears a stale recording overlay after an interrupted save
- Concurrent workflow requests no longer replace an active generation.
- Generated workflows stay tied to the request that created them.
- Organization logos can be stored privately and load in settings, shared clips, and email.
- Private MinIO and S3-compatible endpoints now work with Clips.
- Workflow drafts are saved before the agent reports them complete
- Signed-in viewers who hit an unavailable, expired, or private share link now land in their library instead of the public marketing page when they choose "Go home."

## 2026-09-24

### Improved

- Sharing recordings now uses a joined Share and quick-copy control with People and Agents tabs
- Recording actions are easier to find and align clearly.
- Share links appear after uploads finish, when clips are ready to view.

### Fixed

- Signed-in viewers see shared recordings in the Clips app shell with library breadcrumbs.
- The camera bubble stays visible while you reposition it before recording, then the popover resumes its inactive auto-hide after the drag ends.

## 2026-09-23

### Improved

- Clip share sidebars stay expanded in stacked layouts and use a floating, borderless control when collapsed.
- Clip viewers can collapse the comments, transcript, and Agent sidebar
- Search results clarify where a match appears in the video.
- Search results show where a transcript or comment match appears
- Insights charts load only when opened, keeping the recording library faster.

### Fixed

- Comment fields grow as you type so longer messages stay visible
- New recordings stay loading until their share is available
- Playback errors no longer cover the video player controls
- Trash recordings are excluded from search results.
- Opening a trashed recording now links its breadcrumb back to Trash.
- Long recording menus scroll within the visible space so every action stays reachable.

## 2026-09-22

### Added

- Clips can import Loom links in a dialog and upload videos by dropping them into the library.

### Improved

- Apps start with an app-shaped skeleton while session data loads immediately.
- Refine empty-state copy across Shared with me, Spaces, and Meetings.
- Member lists and mentions load faster in large workspaces.
- Dictation lists focus on the transcript, with time and duration available from a compact info popover in the expanded toolbar.

### Fixed

- Stopped Clips AI actions now clear the in-progress status.
- Clips keeps uploaded videos visible while the library refreshes and localizes Loom import failures.
- Clips recovers dropped uploads after a lost finalization response and clears saving feedback after successful saves.
- The desktop app stops re-checking flags and meetings every few seconds after your session expires, and resumes when you sign in again.
- Dictation capture stays controllable in every supported environment.
- Dictation cleanup keeps its recognizable button after processing, with a green success state and an accessible “AI cleaned” tooltip.
- Dictionary stays available before your first dictation so you can add preferred spellings before recording.
- Dictation cards expand from a single-line preview to the full transcript with aligned action controls, keeping the expand control in place without flashing duplicate text when collapsing.
- Rewind keeps its rolling screen history within a smaller default storage limit.
- Shared recordings play reliably when the player seeks through the video.

## 2026-09-21

### Improved

- Dictate makes it clearer how to start and what happens to your notes afterward.
- The Dictate empty state now centers within the page content area and keeps its primary action text-only.
- Dictate starts with a clear empty state and a single New Dictation action.
- Dictate history now uses meeting-style day sections with individual list cards, in-place progressive disclosure, compact source badges, AI-cleaned status badges, and explicit cleanup success or error feedback.
- Dictation cards now toggle from the card itself and collapse when you click outside.
- The empty Dictate view now keeps duplicate toolbar actions out of the way until there is dictation history.
- Empty states now share a responsive layout with outcome-led titles, non-repetitive descriptions, comfortable text wrapping, and direct calls to action.
- Empty Library, Spaces, and Dictate views now keep the toolbar focused on navigation while the empty state owns the primary action.
- Clips empty states now explain what belongs in each view and surface the most relevant next action without adding unnecessary controls.

### Fixed

- Clips keeps the menu-bar popover open, restarts cleanly after updates, and waits for Google sign-in without a loading indicator.

## 2026-09-19

### Fixed

- Clips library loads on older browsers that lack modern object helpers
- After cutting a selected range from the editor toolbar, the selection follows the playhead again.

## 2026-09-18

### Improved

- Clips loads recording and organization lists faster
- Desktop recording alerts use matching warning and error highlights in the recorder and recovery list
- Desktop recording failures notify you and stay available in Clips with upload retry and local recovery options.
- Desktop recording recovery opens in a compact page, and completion cards close after Open or Copy succeeds
- Dictation now shows listening, finalizing, pasting, and success states so release-to-paste never feels stalled.
- Dictation keeps a quiet waveform pill, reveals controls on hover, and falls back to the clipboard when no text field is focused.
- Recording shortcuts now start, stop, cancel, and pause recordings with editable platform defaults.
- Use Fn as the default desktop dictation shortcut and keep its live waveform responsive during capture.

### Fixed

- Desktop recorder popover dismissal now works from outside clicks, the menu-bar icon, and Escape after native capture setup.
- Desktop recording setup recovers cleanly from cancellation and no longer stalls on a hidden microphone request.
- Fix Google sign-in popups when replying while signed out
- Clips extension sign-in now works for self-hosted apps mounted under a path.
- Hide recording recovery alerts from the sign-in screen
- Large recordings now support on-demand frame extraction.
- Refresh the desktop Dictate status surface and prevent shortcut-triggered native speech crashes.
- Reply controls stay clickable near the bottom of a recording's comments.
- Recordings with different frame sizes can now be stitched together.

## 2026-09-17

### Improved

- Hardened macOS Window recording handoff and simplified the web recorder desktop menu.
- Recordings keep capturing through brief connection losses and resume uploading when the open tab reconnects.
- Refresh the Chrome extension recorder UI to match the current Desktop shell.
- Screen and region recording controls are clearer and more reliable.

### Fixed

- The desktop popover now closes when you click away from it.
- Escape now cancels native window selection regardless of pointer position.
- Full screen, Region, and Window now appear together in the capture menu
- macOS Window recording now uses the native single-window picker without the WebKit sharing-controls stall
- Self-hosted Clips extensions now finish sign-in reliably.
- Window picker cancellation responds to Escape immediately
- Window picker launch no longer waits on Screen Memory or exposes a parked popover artifact
- Window recording starts without interrupting Screen Memory or leaving the recorder stuck in finalization
- Clips waits for authentication before showing the recording action
- The Clips sort control keeps its keyboard focus ring visible

### Changed

- Chrome extension recorder labels now match the Web and Desktop capture controls.
- Web recording labels full-screen capture as Full screen.

## 2026-09-16

### Improved

- Folder breadcrumbs now collapse to fit and show a back button to the parent folder
- Agents can continue through long recording transcripts without losing later sections.

### Fixed

- Clips no longer marks incomplete Loom downloads as ready
- The desktop retry control stays still while it offers cancellation.
- Google sign-in now opens reliably from embedded Clips viewers

## 2026-09-15

### Added

- Recordings include a structured timeline of browser interactions and diagnostics

### Improved

- Clips places editing controls between the video preview and timeline.
- Account menus are now shorter, with workspace apps and agent management available in Settings.
- Trash now supports paging through more than 100 deleted recordings

### Fixed

- Google sign-up now opens reliably in embedded browsers
- Clips Desktop keeps Dictate visible when voice dictation is enabled
- Clips no longer reports 0% completion on a clip that only agents have read - completion and CTA conversion now show as unknown until a human view is counted
- Clips popovers now close when you switch to another application.
- Clips serves private thumbnails through the same-origin thumbnail route.
- Playback speed changes no longer restart paused clips, Picture-in-Picture stops cleanly when leaving the player, and the Windows tray stays within the usable desktop without hiding recorder controls.
- The comments empty state now uses the shared shadcn empty-state style with an icon
- Fixed the volume slider knob alignment in shared recordings
- Shared Clips now focus the agent when asked, show clear viewer-safe transcript states, and keep workspace branding visible.

## 2026-09-14

### Fixed

- Comment edits and reactions stay consistent during rapid updates.
- Comment threads keep overlapping replies, reactions, and deletions consistent.
- Selected recording checkboxes remain visible while selecting multiple clips

## 2026-09-13

### Improved

- Members now know to ask an organization admin to create the first Space.

### Fixed

- Dictate stays available by default in Clips Desktop.

## 2026-09-12

### Fixed

- Archive and Move to trash actions now use clear, action-specific labels in Clips.
- Clips sign-in prompts now focus on the requested action with larger buttons.
- Meetings stays in navigation and links to its Labs setting when unavailable.

## 2026-09-10

### Fixed

- Deleting your only organization no longer leaves a "Couldn't load organization branding" error above the create-an-organization card in Settings.
- Builder and other MCP connections now open setup in a new tab.

## 2026-09-09

### Improved

- Attendee and viewer avatars use a slimmer border.

### Fixed

- The Agent sidebar now fits below the app toolbar without clipping its composer.
- Desktop recorder switches now keep their checked state clear and legible in dark mode.
- Recording pages now open the same contextual Agent panel used throughout the app.

## 2026-09-08

### Improved

- The Cmd+K command menu now searches and navigates across recordings, meetings, dictations, folders, and spaces.

### Fixed

- Fixed desktop comment threads by keeping them in a full-height viewer tab, polished the side-panel tabs and spacing, added move, minimize, and close controls to desktop Clips windows, corrected the shared New recording action’s split-button corners, made library sub-item selection clear in the sidebar, and added visible folder tiles plus scoped recording actions to library and space views.

## 2026-09-04

### Fixed

- Clips desktop shows its real version again in About and Get Info, and nightly builds resume.
- Meeting notes now stop within about 15 seconds of a Zoom, Teams, or Meet call ending, even while music or a video keeps playing afterward.

## 2026-09-01

### Improved

- The recorder playhead now docks automatically when dragged near a screen edge, returns to floating mode when pulled away, remembers its screen position, and transitions more smoothly into Restart and Delete confirmations.

### Fixed

- Calendar reconnects wait for Google to finish before refreshing meetings.

## 2026-09-01

### Improved

- Clip editing uses a text-only Edit button for a cleaner toolbar.

### Fixed

- Clips camera bubbles now close reliably when the popover is dismissed.

## 2026-08-29

### Improved

- Clips loading states now use an even more subtle whole-surface shine.

## 2026-08-28

### Improved

- The Chrome extension download option keeps a concise browser-log explanation and links to setup docs.
- Clips loading placeholders now use a softer whole-surface shine.
- The shared comment composer now has a cleaner borderless presentation.

## 2026-08-26

### Fixed

- Detected Zoom and Teams calls no longer create duplicate meetings or leave a prompt on screen after recording starts

## 2026-08-25

### Fixed

- Skipping to the middle or end of a long recording no longer sticks on buffering

## 2026-08-24

### Improved

- Shared Clips now expose agent-readable transcript and frame metadata from public links.

### Fixed

- Recording from the Chrome extension no longer dead-ends on "Permission dismissed" when Chrome has quietly dropped the extension's microphone or camera access: Clips now reopens the permission page and starts the recording once you allow it again.
- Muted microphone alerts now return you to recording setup before recording starts.

## 2026-08-23

### Fixed

- Asking the agent what is in your library or shared clips no longer fails on the first request right after the app starts.

## 2026-08-22

### Fixed

- The Chrome extension no longer records tab/system audio when "Include microphone" is turned off.
- The recordings library no longer returns an error on the first request right after the app starts.

## 2026-08-21

### Fixed

- The camera bubble now recovers on its own when macOS refuses to start its video, instead of sitting as a black circle until you clicked it.

## 2026-08-20

### Improved

- Recording preparation now uses a centered full-screen overlay that transitions smoothly into the 3-2-1 countdown.
- Clip viewers now make Share the primary action and keep the overflow control compact and vertical.
- Recording controls now follow you across browser tabs and page navigations.

### Fixed

- Clips overlays now follow tab switches during the recording countdown and recover cleanly on tabs opened before Clips.
- Clips now opens provider setup instead of retrying a rejected key in a loop.

## 2026-08-19

### Added

- Clips Nightly builds are available for trying the latest updates.

### Improved

- Desktop Settings is tighter and quicker to scan: General, Recording, Meetings, and Dictation each hold one short card where every setting says what it actually does, permissions and update status moved into General, and rarely-needed controls like the server URL, transcription engine, and region guides now live under a new Advanced tab, and Rewind gets a settings tab of its own.

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
- The Agent-Native logo stays visible when the sidebar is collapsed and toggles the sidebar when clicked.

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

- Capture dictation, background meeting audio, and camera videos from the Agent-Native iOS and Android app with automatic recovery and resumable Clips sync.
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

For the full list of updates, see the [changelog folder](./changelog/).
