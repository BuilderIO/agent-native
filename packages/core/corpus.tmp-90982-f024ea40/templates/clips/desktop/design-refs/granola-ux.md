# Granola UX Reference

> **Purpose**: Pixel-level reference for matching Granola's UX in our Clips desktop app (in our brand colors).
> Source-of-truth for implementation agents. Last researched: 2026-05-03.

## Sources

Primary (cited inline below):

- Granola homepage — https://www.granola.ai/
- Granola changelog — https://www.granola.ai/docs/changelog
- Granola transcription docs — https://docs.granola.ai/help-center/taking-notes/transcription
- Granola "Heads Up" docs — https://docs.granola.ai/help-center/consent-security-privacy/getting-consent-for-your-workspace-heads-up-pages
- Granola "Get the best from Granola" blog — https://www.granola.ai/blog/get-the-best-from-granola
- Granola blog index — https://www.granola.ai/blog
- Wonder Tools review (with screenshots) — https://wondertools.substack.com/p/granolaguide
- BlueDot review — https://www.bluedothq.com/blog/granola-review
- tl;dv review — https://tldv.io/blog/granola-review/
- Over the Anthill review — https://overtheanthill.substack.com/p/granola
- Feisworld review — https://www.feisworld.com/blog/granola-ai-review
- Business Dive review — https://thebusinessdive.com/granola-review
- Meetingnotes teardown — https://meetingnotes.com/blog/granola-ai-teardown
- Recall.ai "How to build a desktop recording app like Granola" — https://www.recall.ai/blog/how-to-build-a-desktop-recording-app
- Medium / Design Bootcamp piece — https://medium.com/design-bootcamp/how-granola-ai-helped-me-stop-taking-notes-and-start-listening-during-meetings-and-interviews-ff72215b6553

---

## 1. Recording / Live Meeting Indicator (the "pill")

**This is the single most distinctive UX element. Get this right.**

### Placement

- Lives **inside the note view** in two states, plus a **floating** detached state.
- **Inside the note**: a "little moving circle tab at the bottom of the notes page" (Business Dive) — anchored bottom-center, just above the chat composer ("Ask anything" bar). Reveals the live transcript when clicked.
- **Detached / floating**: "While Granola is transcribing, if you have another app open, you'll see the live meeting indicator floating on the right-hand side of your screen, and you can drag it around by the handle at the bottom to reposition it." (Granola docs).
- **Click behaviour**: clicking the floating indicator returns you to the meeting note ("you can drag it out of the way or click it to return to your note").
- **Drag handle**: the indicator has a small handle at the bottom for repositioning. The drag-to-reposition behaviour was rolled out as a discrete changelog item.
- Granola also runs as a **menu bar icon** ("a tiny app, presenting just a quiet menu bar icon" — Over the Anthill). The menu bar icon is _not_ the recording pill — it's a separate persistent app entry point.

### Visual: the waveform

- "Green dancing bars at the bottom of the screen" indicate active audio capture (Granola docs). These are **vertical bars**, not a continuous line — discrete bars dancing in real time.
- A **waveform icon** sits "to the left of the 'Ask anything' chat bar"; clicking it toggles the bars' visibility.
- The bars are **green** in Granola's brand. We will use our brand accent (substitute).

### States

| State                                       | Visual                                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Idle (not in a meeting)                     | Hidden / collapsed — no bars showing.                                                                        |
| Recording                                   | Green dancing bars; pill anchored bottom-center of the note view.                                            |
| Recording + other app focused               | Detached pill floats on right edge of screen with drag handle at bottom.                                     |
| Paused (manual stop without ending meeting) | Stop/Resume controls in the transcript panel — bars freeze.                                                  |
| Auto-stopped                                | Halts when call ends (detected via transcript length + calendar times), 15 min of no audio, or system sleep. |

### Expand-to-transcript behaviour

- The pill is the entry point to the transcript panel.
- Transcript panel uses **chat-bubble layout**:
  - Grey bubbles aligned **left** = system audio (other participants, "Them").
  - Green bubbles aligned **right** = microphone audio ("Me").
- Desktop only labels **"Me"** and **"Them"** — no per-speaker names. iOS recognises distinct speakers; desktop does not.
- Transcript supports: copy entire transcript, manage "individual chunks", and search within transcript.
- One reviewer notes the transcript reads "like a one-sided WhatsApp or Messenger chat" (tl;dv) — this two-column bubble metaphor is intentional.
- Transcript bubbles are **clickable** — every AI bullet in the summary "carries a hyperlink; clicking it jumps to the exact point in the transcript (or recording)" (Feisworld). This bullet→transcript jump is a signature feature.

### Implementation notes for Clips

- Pill anchored bottom-center of note view, expands upward into a transcript drawer.
- Detachable: when the user focuses another app, the pill detaches and floats on right edge. Drag handle bottom-center of the floating pill.
- Use our brand accent for the "active" bars; use a neutral grey for paused.
- Keep the pill compact: roughly chip-sized when collapsed (think ~120–160px wide, ~32–40px tall), expanding to a panel ~360–420px wide when transcript is shown.

---

## 2. Meetings home page

### Layout

- Left **sidebar**: "notes, folders, account information, and more" (Business Dive). One reviewer: "the left sidebar provides quick access to companies, people, and team views — automatically organising notes by relationship".
- Main pane: **"Recent Meetings" view** — chronological list. Reviewers consistently call this "Recent Meetings", not "Meetings" or "Home".
- Calendar-synced events appear automatically: "all your upcoming meetings are already there" (meetingnotes); "new meetings appear automatically".
- Day grouping: chronological, by day. (Reviewers refer to processing "the day's meetings at the end of the day" — implies Today/Yesterday-style grouping rather than a giant flat list.)

### Cards

- Granola's aesthetic is intentionally **bare**. One reviewer calls the colour scheme "gray on gray", comparing it to "Windows 95" (Business Dive) — i.e. very low chroma, minimal visual hierarchy. The brand rebrand (Feb 2 2026) introduced "new logo, new typefaces, new visual system" but kept the minimal note-style aesthetic.
- Cards are list-row style rather than tile cards. Think Apple Notes / Things rows, not Trello tiles.
- Each row shows: meeting title, time, attendee names ("Jim, Michaela +5" — homepage example).
- **+N attendee overflow** is used in the homepage marketing example: `Jim, Michaela +5`. So attendees collapse past ~2 named to a `+N` count.
- Empty state copy and detail are not exposed publicly; design ours to match Apple-Notes minimalism (single illustrated/iconic prompt, no marketing fluff).

### Sidebar organisation

- Folders: "private" or "shared" (Business Dive, Wonder Tools).
- "Team Folders" (July 2025) — shared workspace organisation.
- "Shared with me" view (Sept 2025) — separate section in sidebar.
- Workspace switcher (Dec 2025) — top of sidebar, "cleaner interface redesign".

---

## 3. Meeting detail page

### Two-pane layout

- **Split-screen editor** is the canonical layout.
- **Left**: user's own notes — "a blank notepad resembling familiar applications like Apple Notes" (Feisworld). Plain text, no chrome, feels like a page in Notes.
- **Right**: AI-enhanced summary appears below or alongside, in **gray**, while user's notes stay **black**. From multiple reviewers: "Granola renders the AI-written text in **gray**, below the user's own text in **black**." Edits the user makes turn black to indicate manual override.
- Live transcript is **not** the right pane by default — it's accessed via the bottom pill / drawer. The right pane during a meeting is empty until the user generates / enhances notes.
- After a meeting: the left pane keeps your raw notes; the right (or below) shows the AI summary with **markdown sections** — bullets, headers, action items.

### Header

- Meeting title: editable inline (Apple-Notes-style click-to-edit, no "edit" button).
- Subtitle: time + attendee row.
- Actions: Share button top-right of the note (reviewers complain "you're clicking the Share button at the top of each note a lot" — meetingnotes).

### Live indicator on the page

- During recording: green dancing bars + pill at bottom-center.
- "Time remaining in meetings" added Dec 12 2025 — implies a live countdown inside the meeting view.

### Action items / summary

- **Markdown sections**: "headers, highlights, and action items"; "bite-sized summaries separated by topic".
- Sections from Granola's marketing example ("Upstart Health intro call"): **About them / Key takeaways / Decision-making insights / Budget & Timeline / Next Steps.**
- Bullets: each AI bullet has a hyperlink that jumps to the exact transcript moment. Reveal via **magnifying glass icon** on hover/click — "click the magnifying glass to see exactly where something was mentioned in the transcript."
- "Click on any summary line to see a more detailed view of that section of the transcript" (Wonder Tools).
- Action items are **flat** in the visible UI; per-attendee assignment exists implicitly through templates.

### Templates (applied to summary)

- Recipes (slash command `/`): "typing `/` in the Granola chat" surfaces template recipes.
- Built-in templates: 1:1, Stand-up, Interview, Customer Call.
- Sections within templates are user-editable ("add and remove sections").

### Generate / Enhance button

- After the meeting ends, **"Enhance notes"** button merges raw notes + AI summary.
- Re-enhancement is allowed — the user can re-run with a different template.

### Status states

- Live in-progress: green bars + pill visible.
- Generating: standard loading state (specifics not exposed publicly — reviewers describe it as "a structured summary with all your notes and key points" generated automatically when the meeting ends).
- Summary ready: user notes (black) + AI summary (gray) appear together.
- Error: "Something went wrong, please try again" (Business Dive — observed on Ask Granola).

---

## 4. Calendar integration

### Connection

- Google Calendar is primary; Microsoft sign-in added later.
- Setup: "Install it on your Mac, connect your Google calendar, grant a couple of permissions, and you're in" (Feisworld).
- "Calendar permissions modal" was refreshed Jan 16 2026 — implies a dedicated modal, not just an OS dialog.
- Calendar events are listed in Settings (visible roster).
- "Smarter calendar suggestions" (Dec 12 2025) and "Calendar connection simplified" (Dec 19 2025) — recent polish on the connect flow.

### Upcoming meetings

- Auto-listed in the home view.
- Events become a clickable note pre-meeting; opening the scheduled meeting at/after start time triggers transcription automatically.
- Auto-start: "automatically at scheduled meeting times if already viewing an upcoming event."

### Tray / system notification

- A pop-up notification offers "the option to set Granola to transcribe straight away when meeting reminders appear" (Business Dive).
- Lock-screen notification: "initiate note-taking directly from a lock screen notification with a single 'Start Granola' tap" (search summary).

---

## 5. Notification before a meeting

### The OS notification banner

- Appears as a **macOS notification** (top-right of screen, system-styled).
- Action button copy: **"Start Granola"** (canonical). Tapping it begins transcription immediately and opens the note.
- Triggered at meeting start time / when the calendar reminder fires.
- Auto-dismiss follows macOS notification defaults; no custom snooze documented.

### "Heads Up" (separate feature; consent-focused, not pre-meeting alert)

- Different concept: "Heads Up" is a **disclosure page** that _attendees_ see when joining a meeting where the host uses Granola. Includes meeting title, time, organizer, company name, an explanation, and a **"Join meeting"** button.
- Don't confuse this with the user-facing pre-meeting banner.

### Implementation notes for Clips

- Use OS-native notification (top-right). Single primary action button: e.g. **"Start Recording"** or **"Take Notes"**. Match Granola's terse copy.

---

## 6. AI generation states

- **During recording, empty state on right pane**: literally blank — "If you ignore Granola completely and take no notes, it will still have your back" (Feisworld). The point is to _not_ fill the canvas with AI noise mid-meeting. Live transcript is hidden behind the pill drawer; the main canvas stays calm.
- **Mid-meeting AI**: accessed only via Cmd+J chat sidebar. Quick prompts include **"What did I miss?"**, **"Suggest questions for me to ask"**, **"Summarize the last 5 minutes"**, and **"Make me sound smart"**.
- **Ask Granola history is ephemeral**: chat conversations disappear when you close the meeting (Business Dive). Wrong from a UX-best-practices view but worth knowing as a baseline.
- **Generating summary**: triggered automatically when call detected as ended, or on manual "Enhance notes" click. Reviewers do not describe a heavy spinner — it's quiet. Match this: subtle progress, not a modal.
- **Summary ready**: user notes (black) + AI summary (gray) co-located. The gray-vs-black contrast is the primary visual signal.

---

## 7. System audio + mic capture UX

- **Single combined waveform** of green dancing bars — Granola does **not** show separate mic vs system waveforms. One indicator covers both.
- Capture text from docs: "Granola uses your system audio to capture transcription, capturing whatever audio inputs and outputs happen on your computer."
- Permission asks: microphone + screen recording (the latter for system audio routing on macOS).
- Indication that both are captured comes through the **transcript chat-bubble split**: grey-left = system audio, green-right = mic. So the "we're capturing both" message lives in the transcript view, not the indicator pill.

---

## 8. Onboarding

- Setup is intentionally minimal: "Install it on your Mac, connect your Google calendar, grant a couple of permissions, and you're in. Granola doesn't serve you endless tutorials or pop-ups" (Feisworld).
- Welcome screen "already feels familiar, especially if you're used to Apple's minimal interfaces like Notes" (BlueDot).
- Steps in observed order:
  1. Install / open the app.
  2. Sign in (Google or Microsoft).
  3. Calendar permission modal (refreshed Jan 2026).
  4. Microphone + screen-recording permissions (macOS dialogs).
  5. Land in "Recent Meetings" with calendar already populated.
- No multi-step tour, no value-prop carousel — the empty list IS the onboarding.

---

## 9. Keyboard shortcuts

| Shortcut      | Action                                             |
| ------------- | -------------------------------------------------- |
| **Cmd + J**   | Open / toggle the AI chat sidebar ("Ask Granola"). |
| `/` (in chat) | Surfaces template "Recipes".                       |

No publicly documented shortcuts for start/stop recording or pill expand. Recording start/stop relies on calendar auto-start, notification click, or the bottom pill button. **We can do better here** — add Cmd+Shift+R (start), Cmd+. (stop) etc.

---

## 10. Color, typography, density

What Granola does (we substitute our brand):

- **Two-tone text on the canvas**: black for user, gray for AI. This is the core typographic move — copy it.
- **Brand accent green** for the live waveform bars and "Me" mic bubbles in the transcript. We substitute our brand accent.
- **Apple-Notes-minimal aesthetic**: a flat blank canvas, no toolbar chrome on top, sparse sidebar.
- **Typography**: refreshed Feb 2 2026 — "new typefaces, new visual system." Sans-serif throughout; reviewers don't call out monospace timestamps. Timestamps in the transcript are inline with bubbles, not in a separate column.
- **Density**: medium-low. Generous padding around bubbles and bullets. Sidebar rows are roomy. The app feels closer to Notes than to Slack/Linear.
- **Dark mode** shipped Nov 29 2024 — full-theme, not a hack. Pair with our brand light/dark.
- **Color rebrand Feb 2026**: "new logo, new typefaces, new visual system." Specifics aren't documented externally; capture the _tone_ (calm, paper-like, low-chroma) rather than literal hex.

---

## 11. Other surprising touches

- **Bullet → transcript jump**: every AI bullet hyperlinks to the exact transcript moment (and recording). High-value detail.
- **Quiet menu-bar app**: not a giant tray UI; just a small icon. Right-click for actions. Reviewers consistently note the "nothing in your face" feel.
- **Auto-stop heuristics**: stops when (a) calendar end + transcript length suggest the call ended, (b) 15 min silent, or (c) sleep. Don't make users hunt for stop.
- **Templates as Recipes via `/`**: slash-command pattern in the chat.
- **Re-enhance**: you can re-run summary generation with a different template after-the-fact.
- **Transcript deletion**: selective transcript chunk deletion is a feature (changelog).
- **Offline read+edit** (Dec 2024): notes work without network — syncs later.
- **Transcript search**: in-transcript word search is built in.
- **Friendly empty space** during recording: AI doesn't fill the canvas while you're typing — gray AI text appears only after enhance.
- **No bot in calls**: this is a marketing pillar but also a UX feel — meetings look identical to attendees, which Granola later "fixed" with the optional Heads Up consent page.
- **iPhone speaker recognition**: iPhone app has multi-speaker labels; desktop has only "Me" / "Them". Worth diverging here on Clips desktop.

---

## What to copy verbatim (vs improve)

**Copy verbatim:**

1. Bottom-center pill with green dancing bars (substitute our accent).
2. Detachable floating indicator on app blur, drag handle bottom-center.
3. Two-tone canvas: user black, AI gray.
4. Two-bubble transcript: grey-left "Them" / accent-right "Me".
5. Magnifying-glass icon → bullet jumps to transcript moment.
6. Cmd+J chat sidebar with quick prompts.
7. Auto-start at scheduled time when calendar event is open.
8. Auto-stop heuristics (call end / 15 min silent / sleep).
9. Minimal onboarding: install → sign in → calendar perm → mic+screen perm → land on Recent Meetings.
10. Quiet menu-bar icon as persistent entry point.

**Improve on Granola:**

- Real per-speaker names on desktop (not just Me/Them).
- Persistent Ask history (not ephemeral).
- Documented keyboard shortcuts for record start/stop and pill expand.
- Less friction on share (one-click to copy public link, not a 3-step modal).
- Visible scrollbar on long transcripts.
