# Wispr Flow UX Reference

Source-of-truth doc for our "Dictate" tab + the existing flow-bar overlay on the desktop side. Compiled from Wispr Flow's own help center, marketing pages, and third-party reviews. Quotes preserved where they pin down a detail. Last researched 2026-05-03.

> Scope: Wispr Flow primarily. Superwhisper / MacWhisper / Apple Dictation listed at the bottom for comparison only.

---

## 1. Hold-to-dictate pill / overlay

The on-screen recorder is a small **floating bar/bubble** that appears at the **bottom-center of the screen** when the hotkey is held. It is also called the "recorder animation" in the help center and a "little floating bubble toolbar" by reviewers.

- **Idle state (always-on):** a compact floating bubble persists on screen even when not dictating; it serves as both an entry point and a status indicator. Users can toggle it off in settings — this is a documented complaint, so visibility must be optional.
  > "a little floating bubble toolbar that hovers on screen when Flow isn't actively in use. … users can toggle it off in settings." — Samantha Kasbrick review
- **Listening state:** the bar expands to show **moving white bars** (an audio-level / VU-meter style waveform). The help center is explicit:
  > "When you hear a ping or see the white bars moving, start speaking." — docs.wisprflow.ai (Starting your first dictation)
  > "The bars should stay low when you're silent and rise when you speak." — Setup Guide (mic test screen)
- **Processing state:** when the hotkey is released the bar visually transitions out of "listening" (bars stop animating) and the cleaned-up text is **pasted at the cursor**. There is no separate "thinking" sticker — pasted text is the success state.
- **End/cancel state:** `Esc` cancels mid-session; if the user spoke for **less than ~0.5s**, no audio is saved. (Quoted in the docs as "audio saves only if you spoke for at least half a second.")

Implementation note for our flow-bar: keep it **bottom-center, narrow pill, always-toggleable**. White animated bars on a dark capsule is the canonical look.

---

## 2. Hold-Fn vs toggle (hotkeys)

Defaults pulled from `docs.wisprflow.ai/articles/2612050838-supported-unsupported-keyboard-hotkey-shortcuts`:

| Action              | Mac default  | Windows default      |
| ------------------- | ------------ | -------------------- |
| **Push-to-talk**    | `Fn`         | `Ctrl + Win`         |
| **Hands-free**      | `Fn + Space` | `Ctrl + Win + Space` |
| **Command Mode**    | `Fn + Ctrl`  | `Ctrl + Win + Alt`   |
| **Paste last**      | `Cmd+Ctrl+V` | `Shift+Alt+Z`        |
| **Transform**       | `Fn + P`     | `Ctrl+Win+P`         |
| **View Diff**       | `Fn + D`     | `Ctrl+Win+D`         |
| **Open Scratchpad** | `Opt + S`    | `Win+Alt+S`          |
| **Cancel**          | `Esc`        | `Esc`                |

Behavior modes:

- **Push-to-talk:** "Hold a key or mouse button to dictate." Release to insert.
- **Hands-free:** **Double-tap** the hotkey (works across all triggers) to start, double-tap again to stop. Documented as: _"Double-tap to start and stop dictation without holding."_
- Fallback when no Fn key: `Ctrl + Opt` is auto-assigned at install.
- Mouse buttons (Middle Click, Mouse4, Mouse5) and hybrids (`Ctrl+Mouse4`) are supported; up to 4 custom shortcuts.
- **Unsupported:** more than 3 keys total; no-modifier shortcuts; left/right modifier mixes; left/right click; reserved system shortcuts; Caps Lock.

Rationale: Fn is the single key on every modern Mac that has **no built-in OS chord**, no muscle-memory conflict with Cmd-anything, and is easy to hold with the pinky. Wispr explicitly advertises "press a key, speak, release" — the model is **modal and momentary**, with hands-free as opt-in.

---

## 3. Live transcript preview

Wispr Flow does **not** stream partial words into the focused text field as you speak. The pill shows the **animated bars only** (audio-level feedback). Cleaned, formatted text is inserted **on release** in a single paste.

- Listening indicator = moving white bars + start ping.
- Processing indicator = brief pause between release and paste; no separate spinner UI on the pill.
- A separate **Scratchpad** (`Opt+S` Mac) lets users dictate into a floating window where they _can_ see/edit transcript before pasting.
- **View Diff** (`Fn + D`) shows raw vs cleaned text after the fact.

Our pill should mirror this: **don't** stream partials into target apps (it's the fragile, ugly path); show audio-level animation on the pill, paste on release.

---

## 4. Insert into focused field

- Mechanism: synthetic paste at the current cursor location. Requires macOS **Accessibility** permission and overlay access.
  > "The app requires overlay access to appear over other apps, which you enable through accessibility settings."
- **Smart capitalization:** "context-aware formatting … adjusts capitalization based on cursor position and adding necessary spaces around dictation."
- **Trailing space / punctuation:** auto-added; **trailing periods are stripped** in messaging apps:
  > "In messaging apps (like iMessage, WhatsApp, and Slack), Flow removes trailing periods for a more casual style."
- No animation — text just appears (the design ethos is "invisible"). Per their blog: _"Designing a natural and useful voice interface … emphasizes invisible, thoughtful integration rather than flashy features."_

---

## 5. Cleanup pass

Cleanup happens **server-side via cloud LLMs** before insertion. Speech goes up, cleaned text comes back, then paste.

- Removes filler words ("um", "uh", "like").
- Detects **mid-sentence self-corrections** (Backtrack):
  > Input: _"Let's do coffee at 2 actually 3"_ → Output: _"Let's do coffee at 3."_
- Auto-punctuation from pauses + tone; explicit punctuation by name supported ("quotation mark", "em dash", "asterisk", "ampersand", "ellipsis").
- **Auto Cleanup** lives under the **Style** tab with **4 levels of control** (light → aggressive).
- **View Diff** (`Fn+D`) reveals raw-vs-cleaned diff after the fact for trust.
- Cleanup is **language-aware** and **app-aware** ("Styles" — formal for docs, casual for chat, enthusiastic for emails).

For us: do cleanup **on release, before insert**. Offer a "View raw" affordance (their View Diff equivalent) for trust.

---

## 6. Audio level feedback

Visualization is a row of **white vertical bars** that rise/fall with input volume — classic minimal VU meter, not a circular waveform. Same widget is used both during dictation and during the mic-test step in onboarding (consistency = good, copy this).

Reviewers describe it as "the recorder animation"; the help center uses "white bars moving."

---

## 7. Sound effects / haptic

- **Start ping:** an audible chime when recording begins.
  > "When you hear a ping or see the white bars moving, start speaking."
- No documented stop sound; the visual transition + paste is the confirmation.
- No documented Mac haptic (Force Touch trackpad) feedback.

For us: a short start ping is canonical. Consider a softer end tick on release; skip haptics.

---

## 8. History / dictation log

- The desktop app's **Flow Hub** shows "activity history, and usage statistics."
- **Searchable history** is a competitor-table feature in their comparison content.
- **Paste last transcript** (`Cmd+Ctrl+V` Mac / `Shift+Alt+Z` Win) re-pastes the most recent dictation.

---

## 9. Settings

Concrete categories from the docs:

- **Languages** (`Settings → Languages`): explicit list (best accuracy with 2–3 selected) or **Auto-detect across 99 languages**. They explicitly recommend manual selection over auto-detect for accuracy.
- **Personalization → Dictionary:** auto-learns corrected spellings; manual add for jargon/names. "Auto-add to Dictionary" toggle.
- **Personalization → Snippets:** voice-triggered text shortcuts (scheduling links, FAQs).
- **Style:** tone presets (formal/casual/enthusiastic) and Auto Cleanup intensity (4 levels). Desktop-only, English-only at launch.
- **Hotkeys:** custom shortcut editor.
- **Whisper mode:** quiet-environment toggle (low-volume speech detection).
- **Floating bubble visibility:** toggle the always-on indicator on/off.
- **Team Plan:** shared dictionary + shared snippets.

---

## 10. Onboarding

From the official Setup Guide. Sequence:

1. **Sign-in in browser** (Google / Apple / Microsoft / SSO / email). Session hands back to desktop app.
2. **Permission cards** — one for **Microphone**, one for **Accessibility**. Each click triggers the native macOS dialog. Microphone copy: _"Flow uses this to insert spoken words into other apps."_
3. **Mic test screen:** shows the same white-bars meter; copy _"The bars should stay low when you're silent and rise when you speak."_ Allows input device selection.
4. **Hotkey configuration:** press desired chord; defaults to `Fn` on Mac.
5. **Profile + privacy + language picker** (auto-detect option here).
6. **"Try It Yourself" sandbox** — simulated **Gmail** and **Notion** environments where the user practices the hotkey.
7. **Transform demo** — before/after panel showing the cleanup magic.
8. **Flow Hub** lands as the home screen with welcome message, configured shortcut, history, stats.

Big lesson: the onboarding teaches the Fn key by **letting the user dictate into a fake Gmail/Notion right there**, not via a video. We should copy this verbatim.

---

## 11. Smart features

- **Backtrack:** mid-sentence self-correction (`actually`, `scratch that`, `wait`, "no, 3pm").
- **Auto-numbered lists:** speak "one… two… three…" → renders as a numbered list.
- **`new line` / `new paragraph`:** mid-dictation line breaks.
- **Punctuation by name:** "quotation mark," "em dash," "asterisk," "ampersand," "ellipsis."
- **Command Mode** (`Fn + Ctrl` Mac): selects highlighted text and runs an LLM on it. Examples from docs:
  - _"Make this more concise"_
  - _"Make this more assertive and concise"_
  - _"Translate to Polish"_
  - _"Turn this outline into an essay"_
  - _"Who won the San Francisco Giants game this weekend?"_ (web-search command)
  - _"Press enter"_ — special command that hits Return after pasting (great for "send" in chat apps)
  - **Note:** Command Mode is paid-tier only.
- **Code mode (Cursor / Windsurf):** filename auto-tagging in IDE, camelCase / snake_case awareness, CLI-command formatting, recognizes Supabase/Cloudflare/Vercel/etc.
- **Email mode:** part of Styles — formal tone, structured paragraphs.
- **Whisper mode:** low-volume speech detection for quiet rooms.
- **Snippets:** voice macros — say a trigger phrase, expand to canned text.
- **Personal Dictionary:** auto-learns from user edits to pasted text; if you fix a spelling after paste, Flow watches and saves it.

---

## 12. Performance feel

Wispr Flow does **not** publish concrete latency numbers, but reviewers consistently flag it as best-in-class:

- "unusually fast, accurate, and easy to fold into daily writing"
- "smooth and quick transcriptions, but its speed sometimes comes at the cost of clarity"
- Marketing claim: **"4x faster than typing"** (writes ~150 wpm dictated vs ~40 wpm typed).
- Start latency: under the perceptual threshold — start ping fires effectively at keypress; ~0.5s minimum capture before a recording is saved.
- End latency: cloud round-trip + cleanup, but reviewers describe it as "instant paste"; assume **<500 ms** target end-to-end after release for short utterances. Longer dictations (multi-sentence) take noticeably longer because cleanup is whole-utterance.
- Trade-off vs Superwhisper: Superwhisper runs Whisper.cpp **on-device**, so end latency is higher but no network. Wispr's cloud-first design is what makes it feel snappy on short utterances.

---

## Comparison context (short)

- **Superwhisper:** menu-bar status (idle/listening/processing) + a dedicated **mini recording window** + system-wide hotkeys. Hold-to-record / release-to-paste model identical to Wispr. Single-modifier hotkeys allowed (Left Cmd / Right Cmd / Fn alone). Offline / on-device Whisper.cpp. Differentiators: searchable history, BYO API key, custom presets/modes.
- **MacWhisper:** primarily a **file transcription** tool; the "Global" feature is its dictation overlay — a floating window that stays visible across apps and runs ChatGPT-style transforms on dictated text. Less polished as a system-wide pill.
- **Apple Dictation:** Fn-Fn double-tap default, on-device, no LLM cleanup, no inline corrections, no auto-formatting — the baseline Wispr is differentiating against.

---

## Sources

- https://wisprflow.ai/
- https://wisprflow.ai/features
- https://wisprflow.ai/blog
- https://wisprflow.ai/demo
- https://docs.wisprflow.ai/articles/6409258247-starting-your-first-dictation
- https://docs.wisprflow.ai/articles/2612050838-supported-unsupported-keyboard-hotkey-shortcuts
- https://docs.wisprflow.ai/articles/4816967992-how-to-use-command-mode
- https://docs.wisprflow.ai/articles/5373093536-how-do-i-use-smart-formatting-and-backtrack
- https://docs.wisprflow.ai/articles/3152211871-setup-guide
- https://docs.wisprflow.ai/articles/3191899797-use-flow-with-multiple-languages
- https://www.samanthakasbrick.com/blog/wispr-flow-review-tutorial
- https://zapier.com/blog/wispr-flow/
- https://tldv.io/blog/wisprflow/
- https://jamesm.blog/ai/mac-dictation-tools-comparison/
- https://superwhisper.com/
- https://superwhisper.com/docs/get-started/settings-shortcuts
- https://macwhisper.helpscoutdocs.com/article/16-global
