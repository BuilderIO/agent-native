# Clips Meetings — Phase 0/1 Reconciliation + Agent-to-Agent Post-Call Spec

> **READ THIS BOX BEFORE ANY TOOL CALL.**
>
> **Phase 0 and Phase 1 are already implemented in the working tree, uncommitted.** Your job is
> **not** to write them. It is to review what is there, close the two genuinely outstanding gaps,
> stage the correct paths, and commit.
>
> **Do NOT run `git show <rev>:<path> > <path>` against any file in this branch.** An earlier
> draft of this spec recommended exactly that as a "mechanical restore." It would overwrite
> ~118 lines of working code with a July revision while `lib.rs` and `silence_detector.rs` stay
> edited — leaving a crate that compiles only by luck.
>
> **Do NOT run `git add -A`.** Two unrelated untracked templates (`templates/3p-factory/`,
> `templates/nomad/`) are sitting in this tree and would be swept into the commit. Stage the
> exact paths in §1.9.
>
> **This document covers two independent workstreams.** §0–§3 are the branch you are committing.
> §4–§5 are a specification for a *separate* future workstream and must not be implemented here.
> If you are only doing the branch work, stop after §3 and §6.1.

---

## 0. Context and current state

**Repo root:** `/Users/ahmedfelfel/builder/workspace/agent-native`
**Branch:** `clips-adhoc-meeting-detection`, forked from `31fdef96c` ("Update key concepts docs (#2711)").

### 0.1 `git status --short` — verified, this is the tree you are inheriting

```
 M templates/clips/.agents/skills/meetings/SKILL.md
 M templates/clips/desktop/src-tauri/src/adhoc_meetings_watcher.rs
 M templates/clips/desktop/src-tauri/src/lib.rs
 M templates/clips/desktop/src-tauri/src/silence_detector.rs
?? templates/3p-factory/                                    <-- UNRELATED, do not stage
?? templates/clips/changelog/2026-08-11-clips-asks-to-take-notes-again-when-you-join-an-adhoc-zoom-o.md
?? templates/clips/desktop/src-tauri/src/call_activity.rs
?? templates/nomad/                                         <-- UNRELATED, do not stage
```

`git log --oneline -1` → `31fdef96c`. HEAD is clean and matches `main`; **all Phase 0 and
Phase 1 work is uncommitted working-tree state.**

### 0.2 What is already done

| Item | Status | Where |
|---|---|---|
| Ad-hoc toast restored (Ask mode prompts again) | **DONE** | `adhoc_meetings_watcher.rs:300-337` |
| Mode gate widened from `== Auto` to the calendar path's gate | **DONE** | `adhoc_meetings_watcher.rs:211-216` |
| `AdhocNotificationPlan` extracted as a pure function | **DONE** | `adhoc_meetings_watcher.rs:146-165` |
| CoreAudio probe extracted to a shared module | **DONE** | `call_activity.rs` (untracked, 134 lines) |
| `default_call_app_bundle_ids` moved too | **DONE** | `call_activity.rs:8-18` |
| Module registered | **DONE** | `lib.rs:9` (`mod call_activity;`) |
| Mic AND-gate wired into the ad-hoc watcher | **DONE** | `adhoc_meetings_watcher.rs:224-228` |
| Platform-scoped lowercased bundle ids | **DONE** | `adhoc_meetings_watcher.rs:137-143` |
| 4 new Rust tests | **DONE** | `adhoc_meetings_watcher.rs:358, 372, 382, 389` |
| `meetings/SKILL.md` updated for both phases | **DONE** | uncommitted edit to `:72` |
| Changelog entry for both phases | **DONE** | untracked `2026-08-11-…` file |

### 0.3 What is actually outstanding — the entire remaining scope

> **Update — items 1 and 2 below were completed after this spec was drafted.** Both are done in
> the working tree; §2.5 and §1.7 are retained for context but need no action. Verify, do not redo.

1. ~~A test for the `None` discipline on the mic probe (§2.5).~~ **DONE.** The gate now routes
   through `mic_vetoes_detection(Option<bool>) -> bool` (`adhoc_meetings_watcher.rs`), and
   `an_unreadable_microphone_does_not_veto_detection` asserts all three outcomes:
   `Some(false)` vetoes, `Some(true)` and `None` do not.
2. ~~Trim the stale 2026-07-23 changelog entry (§1.7).~~ **DONE.** Verified unreleased first —
   `templates/clips/CHANGELOG.md`'s newest released section is `## 2026-06-23` and the text did
   not appear there — then amended in place. Front matter untouched.
3. **Decide the two open questions** in §6.1. ← the only remaining judgement call
4. **Stage the exact paths and commit** (§1.9).
5. **Install a Rust toolchain and actually compile.** Nothing on this branch has been built.
   See §1.8 — `cargo` is absent, so every Rust claim here is review-verified, not compiler-verified.

### 0.4 What clips is

`templates/clips` is a first-party Agent-Native template: a Loom-style screen recorder +
Granola-style meeting notetaker + Wisprflow-style dictation, with a Tauri macOS desktop app under
`templates/clips/desktop`. Registered at `packages/shared-app-config/templates.ts:110-119`
(`devPort: 8094`, `prodUrl: https://clips.agent-native.com`). Agent-Native's premise (`PRODUCT.md`)
is that an operation is defined **once** with `defineAction` and is then reachable from UI, agent,
HTTP, MCP, A2A, and CLI. That premise is why §4 works at all: `templates/clips/actions/get-meeting.ts`
is simultaneously an agent tool and `GET /_agent-native/actions/get-meeting`.

### 0.5 The regression this branch fixes

Two meeting detectors exist. The calendar one (`meetings_watcher.rs:423`) calls
`notify_meeting_starting`, which emits `meetings:show-notification`, rendered by
`desktop/src/overlays/meeting-notification.tsx` — this always worked. The ad-hoc one polls the
frontmost macOS bundle every 4s (`POLL_SECS`, `adhoc_meetings_watcher.rs:23`), requires 9s dwell
(`DWELL_SECS`, `:26`), matches only Zoom/Teams bundles (`STRONG_VC_BUNDLES`, `:36-42`).

Commit **`b00c38db4` ("Fix analytics dashboard usage continuity (#2378)")** deleted its toast: it
collapsed the mode gate to `mode == Auto` while the shipped default is `Ask`
(`config.rs:163-165` → `MeetingTranscriptionMode::Ask`), and removed the `notify_meeting_starting`
call plus the `show_widget` gate. **Net effect on a default install: ad-hoc detection produced
nothing at all.** That is what the working tree now repairs.

---

## 1. Phase 0 — verification checklist (already implemented)

Read each item against the file. **Do not edit unless an item fails.**

### 1.1 The mode gate — `adhoc_meetings_watcher.rs:211-216`

```rust
    if config.meeting_transcription_mode == MeetingTranscriptionMode::Manual
        && !config.show_meeting_widget_enabled
    {
        reset_dwell(app);
        return Ok(());
    }
```

Verify byte-for-byte against the calendar path's gate at `meetings_watcher.rs:401-404`. It is the
same condition. **PASS.**

### 1.2 The notification plan — `adhoc_meetings_watcher.rs:146-165`

The actual symbol is **`AdhocNotificationPlan`** with constructor
**`adhoc_notification_plan(config: &crate::config::FeatureConfig)`**. It takes the whole config by
reference, not two positional args.

```rust
fn adhoc_notification_plan(config: &crate::config::FeatureConfig) -> AdhocNotificationPlan {
    let auto_start = config.meeting_transcription_mode == MeetingTranscriptionMode::Auto;
    AdhocNotificationPlan {
        show_widget: config.show_meeting_widget_enabled
            || config.meeting_transcription_mode == MeetingTranscriptionMode::Ask
            || auto_start,
        auto_start,
    }
}
```

The `|| mode == Ask` term is deliberate and asymmetric with the calendar path
(`meetings_watcher.rs:408-410`, which has no `Ask` term). That asymmetry is what shipped before
`b00c38db4`. **Do not "harmonize" it.** It is what makes ad-hoc detection prompt in `Ask` mode even
with the widget preference off — i.e. the whole point of the fix. **PASS.**

### 1.3 The notify call — `adhoc_meetings_watcher.rs:300-337`

Destructures the plan, spawns `notify_meeting_starting` with ten positional args when
`show_widget`, and emits `meetings:start-transcription` with `reason: "adhoc-auto"` when
`auto_start`. Signature verified at `notifications.rs:332-344`:

```rust
#[tauri::command]
pub async fn notify_meeting_starting(
    app: AppHandle,                    // BY VALUE, not &AppHandle
    meeting_id: String,
    title: String,
    starts_in_secs: i64,
    join_url: Option<String>,
    scheduled_start: Option<String>,
    scheduled_end: Option<String>,
    platform: Option<String>,
    auto_start: Option<bool>,
    notification_type: Option<String>, // "adhoc" | "calendar"; None => "calendar"
) -> Result<(), String>
```

Being a `#[tauri::command]` does not block a direct Rust call — `meetings_watcher.rs:423-435`
already calls it this way with `None` as the last arg. `Some("adhoc".to_string())` sets `is_adhoc`
(`notifications.rs:350`), which produces the `"Take notes?"` subtitle (`:351`) and the
`type: "adhoc"` payload. **PASS.**

### 1.4 Nothing else from `b00c38db4` was reverted

`notifications.rs`, `recording-pill.tsx`, `live-audio-bars.tsx`, `styles.css` are untouched in this
tree. Correct: that commit's changes to `notifications.rs` were **additions** the current code
depends on — `dismiss_meeting_notification` (`notifications.rs:249-298`) and the dismissal-tombstone
suppression. Reverting them would reintroduce "dismissed prompts don't stay dismissed." **PASS.**

### 1.5 Zero TypeScript changes — correct

The frontend half of the ad-hoc toast was never removed and is already under test:
- `desktop/src/overlays/meeting-notification.tsx:24` — `type: "calendar" | "adhoc"`
- `desktop/src/overlays/meeting-notification.tsx:408` — `meeting-notification-bar-adhoc` styling
- `desktop/src/lib/meeting-notification-dismissal.ts:4` — accepts `"adhoc"`
- `desktop/src/lib/meeting-notification-dismissal.test.ts:11,23` — vitest asserts the adhoc round-trip

`git status` shows no `.tsx`/`.ts` desktop changes. **PASS.** Anyone proposing to touch the overlay
is off-spec.

### 1.6 The tests — `adhoc_meetings_watcher.rs:342-427`

**Constraint that governs all test design here:** this crate has 36 `#[cfg(test)]` modules and
**not one constructs a Tauri `AppHandle`**. `tick_macos` takes `&AppHandle`. You cannot assert that
`notify_meeting_starting` was invoked. The crate's convention is pure-function decision extraction —
see `meetings_watcher.rs:475-514` and `silence_detector.rs:680-736`. Do not build a Tauri harness.

Four new tests exist, plus two pre-existing dismissal tests:

| Line | Test | Covers |
|---|---|---|
| `:358` | `platform_bundles_do_not_vouch_for_each_other` | lowercasing + platform scoping |
| `:372` | `ask_mode_prompts_without_auto_starting` | **the b00c38db4 regression** |
| `:382` | `auto_mode_prompts_and_starts` | Auto still both toasts and starts |
| `:389` | `manual_mode_stays_silent_only_when_the_widget_is_disabled` | the only silent config |
| `:400` | `dismissal_refreshes_the_existing_cooldown_and_clears_dwell` | pre-existing |
| `:418` | `dismissal_suppression_remains_platform_scoped` | pre-existing |

They use a local `config_with(mode, show_meeting_widget_enabled)` helper (`:346-355`) that spreads
`..Default::default()`, so they inherit the shipped defaults for every other field.

**One review note, non-blocking.** `:372` asserts `Ask` behavior against a literal
`MeetingTranscriptionMode::Ask` rather than against `FeatureConfig::default()`. If someone changes
the shipped default again (`config.rs:228` → `default_meeting_transcription_mode()` at `:163-165`),
this test keeps passing while the regression returns. Binding the regression test to
`FeatureConfig::default()` would make it re-evaluate instead of quietly agreeing. Optional
hardening; the existing test is not wrong, just narrower than the bug it names.

Exact config.rs coordinates, since precision has been unreliable here:
- struct field declarations: `config.rs:119` (`meeting_transcription_mode`), `:123` (`show_meeting_widget_enabled`)
- `impl Default for FeatureConfig`: `config.rs:220-239`
- initializers inside it: `:228` and `:230`
- default fns: `:163-165` → `Ask`, `:167-169` → `true`

### 1.7 Docs — one task outstanding

**Already applied, verify only:**
- `templates/clips/.agents/skills/meetings/SKILL.md:72` already reads "…and **only while that same
  platform holds a live audio input**…The microphone check reads CoreAudio per-process input state,
  which is macOS 14+; where the OS cannot answer, detection falls back to dwell alone rather than
  going silent." Covers both phases. No edit needed.
- `templates/clips/changelog/2026-08-11-clips-asks-to-take-notes-again-when-you-join-an-adhoc-zoom-o.md`
  already exists (`type: fixed`, dated 2026-08-11) and covers both phases.
  **Do NOT run `agent-native changelog add`** — it would create a duplicate entry.

**Editing caveat if you do touch SKILL.md:** `templates/clips/.claude/skills/meetings/SKILL.md` is a
hardlink to the `.agents` copy (verified — both are inode `194884980`); only the `.agents` path is
git-tracked. Edit in place; a write-then-rename editor breaks the link. Re-run `ls -i` on both paths
after any edit. Never edit `packages/core/corpus/templates/clips/...` — gitignored and regenerated.

**OUTSTANDING — do this one.** `templates/clips/changelog/2026-07-23-meeting-recording-meters-and-dismissed-prompts.md`
currently reads:

> Meeting recording meters now use thin, responsive audio bars, while dismissed reminders stay dismissed and frontmost Zoom detection stays quiet unless Auto mode is enabled.

That final clause documents the regression as a feature. The entry is **pending, not released**
(`templates/clips/CHANGELOG.md` has one dated section; the changesets-style model is in
`packages/core/src/cli/changelog.ts:4-10`), so it is safe to amend. Trim to:

> Meeting recording meters now use thin, responsive audio bars, and dismissed reminders stay dismissed.

Keep the front matter (`type: fixed`, `date: 2026-07-23`) unchanged.

### 1.8 Phase 0 acceptance criteria — with honest runnability

**BLOCKER, read before planning: `cargo` is not installed on this machine.** Verified:
`command -v cargo` → not found; `~/.cargo/bin/cargo` → no such file; `rustc` → not found.

| # | Check | Runnable here? |
|---|---|---|
| 1 | `cargo build` from `templates/clips/desktop/src-tauri` | **NO** — no toolchain |
| 2 | `cargo test` from the same dir | **NO** — no toolchain |
| 3 | `pnpm run test` + `pnpm run typecheck` from `templates/clips/desktop` | **YES** |
| 4 | `pnpm guards` from repo root | **YES** |
| 5 | Manual: Zoom join → toast in `Ask` mode | **NO** — needs a human in a live call |

**What to do about 1 and 2.** Do not fabricate a pass and do not stall. Either:
- **(a) Install the toolchain** — `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`,
  then `source ~/.cargo/env`. Only do this with the human's go-ahead; it is a several-hundred-MB
  install.
- **(b) Delegate to CI, which is the pragmatic default.** `clips-desktop-build-check.yml:107-124`
  runs `pnpm exec tauri build`, which **does compile the Rust crate** — so a compile error (a wrong
  `notify_meeting_starting` arity, an unresolved `crate::call_activity::` path) **is** caught on the
  PR. What is *not* caught: **no `cargo test` runs anywhere in the repo** (all workflows grepped,
  zero matches). The Rust tests are only ever run by a human typing `cargo test`. **Say both facts
  in the PR body.**

**What to do about 5.** State plainly in the PR body that manual verification is pending and name
the exact steps for the human:

> With the shipped default (`Ask`), open Zoom and join a call → the "Zoom meeting detected /
> Take notes?" overlay appears within ~4s of the mic going live plus the 9s dwell, and transcription
> does **not** auto-start. Dismiss it, refocus Zoom → no re-prompt for 30 min
> (`COOLDOWN_SECS`, `adhoc_meetings_watcher.rs:30`).

Do not mark the branch verified until a human confirms.

### 1.9 Staging and commit — exact paths only

```bash
cd /Users/ahmedfelfel/builder/workspace/agent-native
git add \
  templates/clips/.agents/skills/meetings/SKILL.md \
  templates/clips/desktop/src-tauri/src/adhoc_meetings_watcher.rs \
  templates/clips/desktop/src-tauri/src/call_activity.rs \
  templates/clips/desktop/src-tauri/src/lib.rs \
  templates/clips/desktop/src-tauri/src/silence_detector.rs \
  templates/clips/changelog/2026-08-11-clips-asks-to-take-notes-again-when-you-join-an-adhoc-zoom-o.md \
  templates/clips/changelog/2026-07-23-meeting-recording-meters-and-dismissed-prompts.md
git status --short   # confirm 3p-factory and nomad are still untracked and unstaged
```

**`call_activity.rs` is untracked and MUST be staged.** `lib.rs:9` declares `mod call_activity;` —
committing without the file is an instant build break for everyone else.

**Suggested PR body:**

```md
Restores the ad-hoc Zoom/Teams "take notes?" prompt deleted in b00c38db4, and gates it on real
microphone activity so it fires when a call starts rather than when a window is merely frontmost.

**Phase 0 — restore the prompt.** b00c38db4 collapsed the ad-hoc mode gate to `mode == Auto` while
the shipped default is `Ask`, so ad-hoc detection produced nothing on a default install. The gate
now matches the calendar path (`meetings_watcher.rs:401-404`), and the notify + `show_widget`
branch is back.

**Phase 1 — require a live mic.** The CoreAudio probe already used by the call-ended watcher moved
to `call_activity.rs` and is now also consulted before prompting. Frontmost alone matched Zoom
parked on a second monitor; a live input stream is what separates "app is open" from "call is
underway". The probe is scoped to the frontmost platform's bundles, so Teams in a call cannot vouch
for an idle Zoom window.

`None` from the probe (macOS 13, or transient CoreAudio failure) means "cannot tell", not "silent",
and falls back to dwell-only rather than deleting the feature on those machines.

**Verification.** Rust tests added at `adhoc_meetings_watcher.rs:358-398`. Note that **no
`cargo test` runs anywhere in CI** — `clips-desktop-build-check.yml` compiles the crate via
`tauri build` (so compile breakage is caught) but never runs the test binary. These tests were run
locally / need a local run.

**Manual verification pending:** with the default `Ask` mode, join a Zoom call and confirm the
overlay appears and transcription does not auto-start; then hold Zoom frontmost without joining and
confirm no prompt.
```

---

## 2. Phase 1 — verification checklist (already implemented)

**Problem being solved:** frontmost alone is weak evidence. Zoom's window is frontmost in the lobby
before anyone joins and stays frontmost on its post-call screen. Phase 1 adds a second required
signal.

### 2.1 `call_activity.rs` — untracked, 134 lines

Contains **two** items, both `pub(crate)` (not `pub`):
- `default_call_app_bundle_ids()` — `call_activity.rs:8-18`, `#[cfg(target_os = "macos")]`
- `call_app_uses_microphone(bundle_ids: &[String]) -> Option<bool>` — `call_activity.rs:32-134`,
  `#[cfg(target_os = "macos")]`

All of the probe's `use` statements are function-local (`call_activity.rs:34-45`:
`core_foundation::base::TCFType`, `core_foundation::string::CFString`, the `objc2_core_audio` symbol
list, `std::ffi::c_void`, `std::mem::size_of`, `std::ptr::NonNull`), so they travelled with the body
and `silence_detector.rs` needed no top-of-file import edits. Both crates are declared under
`[target."cfg(target_os = \"macos\")".dependencies]` in `desktop/src-tauri/Cargo.toml`:
`core-foundation = "0.10"` (line 84), `objc2-core-audio` with the `AudioHardware` feature (line 136).

**Module doc records the constraint the code cannot show** (`call_activity.rs:1-31`), including that
`kAudioProcessPropertyIsRunningInput` is macOS 14+ so an older system is a `None` and never a
`Some(false)`, and that the probe is observation-only — it enumerates process objects and never
opens an input unit, because a detector that grabbed one while idle would fight `whisper_speech`.

**Caller contract, do not lose this.** The probe lowercases the bundle id it reads from CoreAudio
(`call_activity.rs:102-106`) and then does an exact `candidate == &bundle_id` comparison (`:107`).
**Callers must pass already-lowercased candidates.** `us.zoom.ZoomClips` silently never matches
otherwise. Both call sites comply.

**GAP, non-blocking:** there is no `#[cfg(not(target_os = "macos"))]` stub for either function in
`call_activity.rs`. This is fine only because both call sites are themselves inside
`#[cfg(target_os = "macos")]` blocks. Verify that still holds before adding any third caller.

### 2.2 Module registration — `lib.rs:9`

```rust
mod call_activity;
```

Inserted between `mod adhoc_meetings_watcher;` (`:8`) and `mod capture_audio_bus;` (`:10`),
preserving the alphabetical list. **PASS.**

### 2.3 `silence_detector.rs` — **two** call sites changed, not one

An earlier draft claimed "exactly one line changes." That is wrong. The diff shows two:

- `silence_detector.rs:423` — `default_call_app_bundle_ids()` → `crate::call_activity::default_call_app_bundle_ids()`
- `silence_detector.rs:462` — `call_app_uses_microphone(&call_app_bundle_ids)` → `crate::call_activity::call_app_uses_microphone(&call_app_bundle_ids)`

Both use the fully-qualified path, matching the surrounding idiom
(`crate::util::frontmost_bundle_id()` at `silence_detector.rs:427`). Both function bodies were
deleted from `silence_detector.rs`. Everything else stays: `GENERIC_BROWSER_BUNDLE_IDS`,
`is_configured_generic_browser`, `install_call_ended_watcher`, its non-macOS stub,
`microphone_release_stop_ready`, `scheduled_end_reached`, `calendar_end_stop_ready`,
`audio_recently_silent`, and the whole `mod tests` — none of whose four tests reference
`call_app_uses_microphone`, and whose `use super::{...}` list does not name it. **Zero test edits.
PASS.**

### 2.4 The AND-gate — `adhoc_meetings_watcher.rs:224-228`

```rust
    let call_bundles = bundles_for_platform(platform);
    if crate::call_activity::call_app_uses_microphone(&call_bundles) == Some(false) {
        reset_dwell(app);
        return Ok(());
    }
```

Helper at `adhoc_meetings_watcher.rs:137-143` — the real name is **`bundles_for_platform`**:

```rust
fn bundles_for_platform(platform: &str) -> Vec<String> {
    STRONG_VC_BUNDLES
        .iter()
        .filter(|(_, candidate, _)| *candidate == platform)
        .map(|(bundle_id, _, _)| bundle_id.to_lowercase())
        .collect()
}
```

**Placement — verified correct, and the important hazard is avoided.** The gate sits at `:224-228`,
**before** the calendar soft-guard (`:230-241`), and both sit **before** the dwell state machine
(`:243-275`). That ordering is what matters. The dwell state machine has side effects: when dwell
elapses it writes `session_notified` **and** `cooldown_until = now + COOLDOWN_SECS` (30 min) before
returning `true` (`:259-263`). A mic check placed *after* that block would burn the 30-minute
cooldown on a mic-less tick and permanently suppress the prompt for the real call. It is not placed
there. **PASS — do not move it.**

One consequence of sitting before the soft-guard rather than after: on a tick where a calendar
reminder recently fired, a CoreAudio probe now runs before the soft-guard short-circuits. Extra
cost, no correctness impact. Not worth changing.

**`reset_dwell(app)` at `:226` — review decision, not a defect.** An earlier draft asserted the gate
must *not* reset dwell. The shipped code does reset. Both are defensible and the tradeoff is real:

- **Resetting (current):** dwell is measured *during* the call. Someone flicking to Zoom for 2s
  mid-call cannot fire. Cost: after the mic goes live, a fresh 9s dwell must elapse, so the prompt
  lands ~9–13s after joining.
- **Not resetting:** dwell accrues in the lobby, so the prompt fires on the first ~4s tick after the
  mic comes up. Cost: the 9s dwell no longer means "9s in a call."

**Leave it as-is unless the human asks otherwise.** Do not "correct" this — it is a latency-vs-
precision preference, and the current choice is the stricter one.

### 2.5 The `None` discipline — **THE ONE OUTSTANDING ENGINEERING TASK**

`None` is a *reachable, ordinary* answer, not an error: the deployment target is
`MACOSX_DEPLOYMENT_TARGET: 13.0` (`.github/workflows/clips-desktop-build-check.yml:45`), and the
probe returns `None` on any CoreAudio failure (`call_activity.rs:62-64`, `:77-79`).

Current code expresses the policy as `== Some(false)`, which is correct: only an affirmative "not
using the mic" suppresses; `None` falls through to dwell-only. But **nothing tests it**, and the
policy lives inline where a future refactor to `.unwrap_or(false)` would silently delete the feature
for every macOS 13 user. The repo `CLAUDE.md` rule is explicit: *"Absent and unreadable must be
different values."* (`scripts/guard-no-silent-coercion.mjs:46-47` only scans `.ts`/`.tsx`, so Rust
here is on reviewer judgement — which is exactly why it needs a test.)

**Add this helper** next to `adhoc_notification_plan`, after `adhoc_meetings_watcher.rs:165`:

```rust
/// `None` is the OS declining to answer — `kAudioProcessPropertyIsRunningInput`
/// is macOS 14+ — not evidence the mic is idle. Collapsing it into `false`
/// deletes ad-hoc detection on every pre-Sonoma machine; only an affirmative
/// `Some(false)` is grounds to suppress.
fn mic_evidence_blocks_prompt(mic_running: Option<bool>) -> bool {
    mic_running == Some(false)
}
```

**Then change the call site at `:225`** to route through it — behavior identical, policy now named
and testable:

```rust
    let call_bundles = bundles_for_platform(platform);
    if mic_evidence_blocks_prompt(crate::call_activity::call_app_uses_microphone(&call_bundles)) {
        reset_dwell(app);
        return Ok(());
    }
```

**Add this test** to the existing `mod tests`:

```rust
    #[test]
    fn absent_microphone_evidence_is_not_evidence_of_silence() {
        assert!(mic_evidence_blocks_prompt(Some(false)));
        assert!(!mic_evidence_blocks_prompt(Some(true)));
        // macOS 13 / transient CoreAudio failure: dwell alone still decides.
        // If this flips to `true`, ad-hoc detection is dead on those machines
        // with no other signal that anything changed.
        assert!(!mic_evidence_blocks_prompt(None));
    }
```

Define `mic_evidence_blocks_prompt` **unconditionally** (no `#[cfg]`), matching `match_vc_bundle`
(`:126`) and `bundles_for_platform` (`:137`), which already produce harmless dead-code warnings on
the Windows leg of `clips-desktop-build-check.yml`. Warnings are not errors there. Adding `#[cfg]`
gates breaks the test on non-macOS runners for no benefit.

### 2.6 Existing Phase 1 test coverage

`platform_bundles_do_not_vouch_for_each_other` (`:358-369`) is the one that catches the real trap:
it asserts `bundles_for_platform("zoom")` contains `"us.zoom.zoomclips"` **lowercased**, so it fails
loudly if someone adds a mixed-case bundle id to `STRONG_VC_BUNDLES` (`:36-42`) without lowercasing.
It also asserts zoom and teams lists are disjoint — the platform-scoping property that stops Teams
in a call from vouching for an idle Zoom window. **PASS.**

**Cost note:** one CoreAudio process enumeration per 4s tick, only while a Zoom/Teams window is
frontmost, meetings are enabled, and no meeting is already active. The same probe already runs on a
10s cadence during a live meeting (`silence_detector.rs:399`, `:462`). Do not add a "probe only once
dwell is half elapsed" optimization on this branch.

### 2.7 Docs — already applied

See §1.7. `SKILL.md:72` already covers the mic requirement and the `None` fallback. No edit needed.

### 2.8 Phase 1 acceptance criteria

Same toolchain blocker as §1.8 — items 1 and 2 are not runnable here.

1. `cargo build` — `crate::call_activity::` resolves from both `silence_detector.rs:423` and `:462`. **Delegated to CI's `tauri build`.**
2. `cargo test` — new tests plus the four pre-existing `silence_detector.rs` tests still pass unmodified. **Not runnable here; not in CI either.**
3. Manual (human): open Zoom, hold it frontmost ~15s **without joining** → **no prompt**. Then join and unmute → prompt within ~4s of the dwell completing. Leave Zoom frontmost after the call ends → no second prompt (cooldown, and mic released).
4. Manual regression on the untouched path (human): start a meeting recording, hang up, leave the Zoom window frontmost → the call-ended watcher still stops the recording after its 30s stability window (`microphone_release_stop_ready`, `silence_detector.rs:506-514`).

---

## 3. OUT OF SCOPE for this branch

1. **Google Meet / browser-hosted calls.** Do not extend `STRONG_VC_BUNDLES`
   (`adhoc_meetings_watcher.rs:36-42`). The comment at `silence_detector.rs:384-391` explains why
   frontmost-browser is not evidence of a call, and a browser's mic stream belongs to the browser
   process — the CoreAudio probe cannot tell a Meet tab from any other tab. Needs its own design.
2. **`list-meetings` live-calendar view work.** `templates/clips/actions/list-meetings.ts` is
   untouched by both phases.
3. **The Automation-TCC / NSWorkspace swap.** `crate::util::frontmost_bundle_id()` (called at
   `adhoc_meetings_watcher.rs:192`) stays as-is. Phase 1 adds a second signal; it does not change how
   the first is obtained.
4. **The talking-points coach.**
5. **Changing the shipped default mode** from `Ask` to `Auto` (`config.rs:163-165`). Phase 0 exists
   *because* the default is `Ask`.
6. **Changing `POLL_SECS` (4), `DWELL_SECS` (9), `COOLDOWN_SECS` (30 min), or
   `CALENDAR_SOFT_GUARD_SECS` (3 min)** — `adhoc_meetings_watcher.rs:23-34`. Phase 1 changes *which*
   signals fire, not the timing envelope.
7. **Building a Tauri test harness / mock `AppHandle`.** 36 existing test modules established the
   pure-function convention.
8. **Changing the `"meetings:start-transcription"` payload** (`reason: "adhoc-auto"`). Three TS
   consumers listen: `desktop/src/app.tsx:1859`,
   `desktop/src/overlays/meeting-notification.tsx:349`,
   `desktop/src/hooks/useMeetingTranscription.ts:750`.
9. **Adding a settings toggle for the mic gate.** The gate should just be correct.
10. **Implementing §4 or §5 on this branch.** They are a specification for a separate workstream.
11. **Changing the `reset_dwell` behavior in the mic gate** (§2.4) — leave the shipped choice.
12. **Wiring `cargo test` into CI.** A genuine improvement (see §6.2), but a separate PR.

> **Note:** an earlier draft listed "moving `default_call_app_bundle_ids` into `call_activity.rs`"
> as out of scope. It has already been done (`call_activity.rs:8-18`,
> `silence_detector.rs:423`). Do not undo it.

---

## 4. Post-call → context agent: the retrieval spec

> **SEPARATE WORKSTREAM.** Do not implement any of §4 or §5 on `clips-adhoc-meeting-detection`.
> This section exists to be handed to whoever builds the context agent.

### 4.0 Direct answer to "what calls do I need to make?"

The minimum viable loop **today, with zero code changes to clips**, is three HTTP calls plus a poll:

```
1. GET  /_agent-native/actions/list-meetings?view=past&recordedOnly=true&limit=20
2. GET  /_agent-native/actions/get-meeting?id=<meetingId>          [poll until transcriptStatus=="ready"]
3. POST /_agent-native/actions/create-recording-agent-link          [only if you want a credential-free handoff]
```

All three carry `Authorization: Bearer <org service token>`. Step 2's response contains the
**complete, untruncated** transcript plus the AI summary, bullets, action items, and participants.
That is the whole payload.

### 4.1 The trigger — what means "the call is done"

**There is NO meeting-lifecycle event. DOES NOT EXIST — you must build `meeting.finalized` if you
want push semantics.**

Verified: `templates/clips/server/plugins/db.ts` calls `registerEvent` exactly four times —
`clip.created` (`:1709`), `clip.shared` (`:1722`), `clip.viewed` (`:1733`), `calendar-synced`
(`:1743`). A fifth, `meeting-reminder`, is registered in
`templates/clips/server/jobs/meeting-reminders.ts:44-51` and is **pre**-meeting. Framework-level
events add only `test.event.fired` and `agent.turn.completed`
(`packages/core/src/event-bus/registry.ts:59-77`). `grep -n "emit(" templates/clips/actions/finalize-meeting.ts`
returns **nothing**.

Why `clip.created` is not a substitute:
- Its payload is `{ clipId, title?, createdBy?, duration?, url? }` (`db.ts:1712-1719`) — **no
  `meetingId`**, so a subscriber cannot tell a meeting recording from a screen recording or join
  back to the meeting row.
- It is emitted at `templates/clips/actions/finalize-recording.ts:707-717`, **after**
  `dispatchPostFinalizeJob({kind:"transcript"})` at `:696` fires into a *separate* invocation. It
  fires before any transcript exists, long before `finalize-meeting` writes the summary.

**What exists as a "transcript is ready" hook — and it is not subscribable.** `queueBrainExport`
(`templates/clips/actions/request-transcript.ts:297-318`) writes a durable pending row then calls
`dispatchPostFinalizeJob({ recordingId, kind: "brain-export", requireAccepted: true })`. Invoked at
exactly three sites, each right after a transcript row flips to `ready`: `request-transcript.ts:578`
(Loom import), `:1005` (main path), `:1404` (Builder provider). The dispatch is a signed HTTP
self-POST to `/api/_agent-native-background/post-finalize-worker`
(`templates/clips/server/lib/post-finalize-dispatch.ts:66`), where a **hardcoded if/else**
(`templates/clips/server/routes/api/_agent-native-background/post-finalize-worker.post.ts:185-191`)
branches on `kind`. `PostFinalizeJobKind` is a closed union (`post-finalize-dispatch.ts:10-15`:
`media-ready | seekable | transcript | brain-export | loom-import`). **Nothing can subscribe.**

| Option | Cost | Latency | Notes |
|---|---|---|---|
| **A. Poll** `list-meetings` from the context agent | zero clips changes | your poll interval | Recommended for v1 |
| **B. Register + emit `meeting.finalized`** | ~20 lines in clips | immediate | Unlocks §5 with no further code |
| **C. Add a `PostFinalizeJobKind`** + branch | ~40 lines, edits core template code | immediate | Copies brain-export exactly; only if you need the durable retry ledger |

#### Option B, fully specified

**This is a spec for code that does not exist yet.** All four pieces are verified against the tree.

**B1 — register the event.** Add a fifth `registerEvent` in `templates/clips/server/plugins/db.ts`
next to the existing four (after `:1754`). Note the existing calls cast `payloadSchema` `as any`;
match that. `z` and `registerEvent` are already imported (`db.ts:11`).

```ts
  registerEvent({
    name: "meeting.finalized",
    description:
      "A meeting's transcript was summarized and its notes, bullets, and action items are ready.",
    payloadSchema: z.object({
      meetingId: z.string(),
      recordingId: z.string().nullable().optional(),
      ownerEmail: z.string().nullable().optional(),
      finalizedAt: z.string(),
    }) as any,
  });
```

**B2 — import the emitter** in `templates/clips/actions/finalize-meeting.ts`, matching
`finalize-recording.ts:18`:

```ts
import { emit } from "@agent-native/core/event-bus";
```

**B3 — emit before the return at `finalize-meeting.ts:287`.** Both locals exist and are already
read in that file: `meeting.recordingId` (used at `:67`, `:139`, `:204`) and `meeting.ownerEmail`
(used at `:152`). Copy the exact shape of `finalize-recording.ts:706-720`:

```ts
    try {
      emit(
        "meeting.finalized",
        {
          meetingId: args.meetingId,
          recordingId: meeting.recordingId,
          ownerEmail: meeting.ownerEmail,
          finalizedAt: new Date().toISOString(),
        },
        { owner: meeting.ownerEmail },
      );
    } catch (err) {
      console.warn("[finalize-meeting] meeting.finalized emit failed:", err);
    }
```

**B4 — the third argument is not optional in practice.** `{ owner: ownerEmail }` is what
`automationMatchesEventOwner` (`packages/core/src/triggers/dispatcher.ts:260-263`) matches against
the automation's creator. Omit it and events are silently dropped — organization scope grants
*visibility*, not broadcast. The `try/catch` matters too: a bus failure must not fail the finalize.

### 4.2 The ordered retrieval sequence

**Step 1 — find the meeting that just ended.**

Action: `list-meetings` — `templates/clips/actions/list-meetings.ts:54`, `http: { method: "GET" }`
(`:101`).

Schema (verified verbatim, `list-meetings.ts:57-100`):
```
view: z.enum(["upcoming","past","all","trash"]).default("upcoming")
limit: z.coerce.number().int().min(1).max(500).default(100)
offset: z.coerce.number().int().min(0).default(0)
recordedOnly: booleanParam.default(false)
includeLiveCalendar: booleanParam.default(true)
upcomingWithinMin: z.coerce.number().int().min(1).max(43200).optional()
includeStartedWithinMin: z.coerce.number().int().min(0).max(60).optional()
excludePersonalSoloEvents: booleanParam.default(false)
excludeDeclinedEvents: booleanParam.default(false)
```
`booleanParam` is imported from `./lib/cli-params.js` (`list-meetings.ts:50`) — `z.coerce.boolean()`
is wrong here because it treats the string `"false"` as truthy.

Returns `{ meetings, calendarErrors }`. Each meeting is the full `clips_meetings` row plus a derived
`summaryPreview` (first 100 chars of `summaryMd`, whitespace-collapsed, or `null`).

**Use `view=past&recordedOnly=true`.** `recordedOnly` adds `isNotNull(meetings.recordingId)`
(`list-meetings.ts:160-162`) *and* suppresses the live-calendar merge entirely (`:210-214`), so you
get only persisted, recorded meetings — no virtual calendar projections to filter. Sort by
`actualEnd`.

**Step 2 — pull the content.**

Action: `get-meeting` — `templates/clips/actions/get-meeting.ts:47`, `http: { method: "GET" }`
(`:53`). Schema (`:50-52`): `z.object({ id: z.string().describe("Meeting id") })`. That is the
entire input.

**⚠️ `get-meeting` IS NOT A PURE READ.** `get-meeting.ts:55-62` runs `parseCalendarMeetingId(args.id)`
and, on a virtual calendar id, calls `materializeCalendarMeetingFromVirtualId` — **which writes a
meeting row**:

```ts
    let meetingId = args.id;
    if (parseCalendarMeetingId(args.id)) {
      const materialized = await materializeCalendarMeetingFromVirtualId(args.id);
      if (!materialized?.meeting?.id) return { meeting: null };
      meetingId = materialized.meeting.id;
    }
```

Your polling loop must therefore poll a **persisted** id. Ids sourced from
`view=past&recordedOnly=true` always are, because that combination suppresses the live-calendar
merge. If you ever poll an id taken from a live-calendar projection, every poll iteration is a
potential write.

Returns (`get-meeting.ts:125-132`):
```
{
  meeting: { ...clips_meetings row,
             bullets: {text}[],                                    // parsed from bulletsJson
             actionItemsParsed: {assigneeEmail?,text,dueDate?}[] },
  participants: meeting_participants[],          // full rows
  actionItems:  meeting_action_items[],          // full rows
  recording:    recordings row | null,
  transcript:   recording_transcripts row | null,
  role: access.role
}
```

**Critical property: `transcript` is the complete, unbounded DB row** — `fullText` and
`segmentsJson` are returned raw, with no agent-side truncation regardless of caller. Contrast
`get-recording-player-data` (`templates/clips/actions/get-recording-player-data.ts:96`), which routes
the transcript through `boundTranscriptForAgent` when `ctx.caller` is `"tool" | "mcp" | "a2a"`
(`:273-279`), capping at `AGENT_TRANSCRIPT_MAX_CHARS = 12_000`
(`templates/clips/actions/lib/transcript-preview.ts:2-3`). **An MCP/A2A context agent calling
`get-recording-player-data` gets at most 12k chars. Use `get-meeting`.**

Gate on `meeting.transcriptStatus` (enum `idle|pending|ready|failed`,
`templates/clips/server/db/schema.ts:499-501`):
- `pending` → `finalize-meeting` is in flight (stale after 2 min, `finalize-meeting.ts:28`). Re-poll.
- `failed` → no transcript text ever existed, or a finalize crashed. Retry with
  `finalize-meeting { meetingId, force: true }`.
- `ready` → summary, bullets, action items, participants, and full transcript are all in this one
  response.

**Failure mode you must handle:** `get-meeting` returns `{ meeting: null }` for *missing*,
*inaccessible*, and *trashed* alike — three separate returns at `get-meeting.ts:60`, `:65`, `:78`.
It does not throw. Your pipeline **cannot** distinguish "no such meeting" from "you can't see it."
Treat `meeting === null` as unknown-cause failure, never as "no meeting." Likewise `safeParseArray`
(`get-meeting.ts:29-45`) swallows malformed bullets/action-items JSON and returns `[]` after a
`console.warn` — an unreadable summary is indistinguishable from an empty one.

**Step 2b (alternative) — the meeting-scoped JSON route.**

`GET /api/public-meeting?id=<meetingId>` — `templates/clips/server/routes/api/public-meeting.get.ts`.
In the auth plugin's public-path list (`templates/clips/server/plugins/auth.ts:41`), so it bypasses
the session shell and does its own `resolveAccess("meeting", meetingId, accessContext)` (`:66`).

Returns (`public-meeting.get.ts:118-148`):
```
{
  meeting: {
    id, title, scheduledStart, actualStart, actualEnd, transcriptStatus,
    summaryMd, bullets: {text}[],
    participants: [{ email, name, isOrganizer }],
    actionItems: [{ id, text, assigneeEmail, completedAt }],
    transcript: { status, language, fullText, segments } | null   // ONLY when shareTranscript is true
  },
  viewer: { role, canEdit, isOwner } | null   // null when anonymous
}
```
404 `{ error: "Not found" }` when missing or trashed (`:68-71`); 400 when `id` is absent (`:53-56`).

`shareTranscript` defaults to `false` and is flipped by `update-meeting`
(`templates/clips/actions/update-meeting.ts:45-49`), which requires **admin** access when
`shareTranscript` or `visibility` is in the patch (`:54-56`). `update-meeting` declares no `http:`
config, so it is `POST /_agent-native/actions/update-meeting`.

**Auth caveat — read carefully.** `public-meeting.get.ts:59` calls `getSession(event)`. Bearer
resolution in `getBearerSession` (`packages/core/src/server/auth.ts:866`) tries the legacy
`sessions`-table token first, then **only on `/_agent-native/actions/*`** (`isFrameworkActionRoute`,
`auth.ts:851`) falls back to the connect-minted OAuth token via `getMcpOAuthBearerSession`
(`auth.ts:818`). An **org service token is a signed JWT, not a sessions row** (`mintOrgServiceToken`
→ `signConnectToken`, `packages/core/src/mcp/connect-route.ts:341-350`). **An org service token will
NOT authenticate `/api/public-meeting`** — it resolves anonymous. Use
`/_agent-native/actions/get-meeting` with a service token; use `/api/public-meeting` only for
genuinely public/org-shared meetings or from a browser session.

**Step 3 — credential-free handoff (optional).**

Action: `create-recording-agent-link` — `templates/clips/actions/create-recording-agent-link.ts:34`,
`readOnly: true` at `:58`, no `http:` config → **POST**.

Schema (`:37-57`): `{ recordingId: string, agentLabel?: string trim 1..60, ttlSeconds?: int >0 max BUG_REPORT_AGENT_ACCESS_TTL_SECONDS }`.
Cap is 7 days (`templates/clips/shared/bug-report.ts:4`); default 2 hours
(`CLIPS_AGENT_ACCESS_TTL_SECONDS`, `templates/clips/server/lib/public-agent-context.ts:61`, applied
at `create-recording-agent-link.ts:81`).

Returns (`:97-103`): `{ recordingId, url, contextUrl, expiresAt, ttlSeconds }`, where
- `url` = `<origin><basePath>/share/<recordingId>?agent_access=<token>`
- `contextUrl` = `<origin><basePath>/api/agent-context.json?id=<recordingId>&agent_access=<token>`

Endpoint constants: `AGENT_CONTEXT_ENDPOINT = "/api/agent-context.json"`,
`AGENT_TRANSCRIPT_ENDPOINT = "/api/agent-transcript.json"`, `AGENT_FRAME_ENDPOINT = "/api/agent-frame.jpg"`,
`CLIPS_AGENT_ACCESS_PARAM = "agent_access"` (`templates/clips/shared/agent-context.ts:10-14`). The
frame URL template is literally `` `${frameBase}&atMs={timestampMs}` `` (`shared/agent-context.ts:162`).

The `/api/agent-context.json` envelope (`buildPublicAgentContext`,
`server/lib/public-agent-context.ts:522-652`) is `{ type: "agent-native.clip.context", version: 1,
instructions: string[], clip: {...}, apis: {context, transcript, frame?}, transcript: {status,
language, failureReason, retryAfterSeconds, fullText, segments, segmentCount}, chapters,
recommendedFrames: [{atMs, timestamp, reason, url}], bugReport, browserDiagnostics, ctas }`.
`fullText` here is **unbounded**.

**The hard limit, and it is the most important caveat in this section: `create-recording-agent-link`
is recording-scoped. There is no `create-meeting-agent-link`. DOES NOT EXIST — you must build it, or
pass the AI notes inline.** The agent-context envelope carries transcript + frames + chapters + CTAs
+ bug report + browser diagnostics and **never** carries `summaryMd`, `bullets`, `actionItems`, or
`participants`. Also: `create-recording-agent-link` throws `ForbiddenError` if the recording is
archived or trashed (`:70-74`), and a meeting must first be resolved to `meeting.recordingId` via
`get-meeting` — `recordingId` is nullable for ad-hoc meetings until recorded.

**No speaker attribution anywhere.** `TranscriptSegment` is
`{ startMs, endMs, text, source?: "mic" | "system" }` (`templates/clips/shared/transcript-segments.ts:1-6`).
No `speaker` or `participantEmail` field; `meeting_participants` is never joined onto segments. Do
not design around per-speaker lines.

### 4.3 The literal HTTP shape

Mount rule, `packages/core/src/server/action-routes.ts:340-353` (verbatim):
```ts
if (entry.http === false) continue;              // agent-only, never mounted
const method = entry.http?.method ?? "POST";     // default POST
const path   = entry.http?.path   ?? name;       // default = action filename
const routePath = `${ROUTE_PREFIX}/${path}`;     // ROUTE_PREFIX = "/_agent-native/actions" (:70)
```
`<name>` is the action filename minus `.ts`, kebab-case. If `APP_BASE_PATH` / `VITE_APP_BASE_PATH`
is set (workspace/gateway mode), every path is served under that prefix
(`packages/core/src/server/app-base-path.ts:9-12`).

```http
GET https://clips.agent-native.com/_agent-native/actions/get-meeting?id=mtg_abc123 HTTP/1.1
authorization: Bearer <token>
```

```http
POST https://clips.agent-native.com/_agent-native/actions/create-recording-agent-link HTTP/1.1
content-type: application/json
authorization: Bearer <token>

{"recordingId":"rec_abc123","agentLabel":"context-agent","ttlSeconds":604800}
```

Arrays over GET serialize as `key[]=a&key[]=b` (`action-routes.ts:97-137`). Optional headers:
`x-user-timezone` (IANA, `:144-153`), `X-Agent-Native-Session-Id`, `X-Request-Source`. Do **not**
send `X-Agent-Native-Frontend: 1` — it only changes `ctx.caller` to `"frontend"`, carries no auth
weight (`:162-168`), and exposes you to the stale-build 409 at `:385-408`.

Responses: the action's return value as JSON on success; **400**
`{"error":"Invalid action parameters..."}` on zod failure; **405**
`{"error":"Method not allowed. Use GET."}` on wrong method (`:380-383`); **413** over a declared
`maxBodyBytes` (`:537-547`); **500** `{"error":"Internal server error"}` for uncategorized throws,
detail kept server-side (`:656-706`).

CSRF does not block you: the middleware only fires on state-changing methods when the request
**carries a cookie** (`packages/core/src/server/csrf.ts:234-253`), and `content-type: application/json`
satisfies `looksFirstParty` anyway (`csrf.ts:149-156`).

**MCP and A2A — read before planning around them.**

- **MCP** is mounted at `POST /mcp` and `POST /_agent-native/mcp`
  (`packages/core/src/mcp/server.ts:381-398`; prefixes at `packages/core/src/mcp/route-paths.ts:7-8`),
  stateless Streamable HTTP. The POST must advertise both `application/json` and `text/event-stream`
  in `Accept`. **The default catalog for every caller is compact** —
  `COMPACT_MCP_APP_CATALOG_BUILTINS` at `packages/core/src/mcp/build-server.ts:429-440` is exactly
  `list_apps`, `open_app`, `ask_app`, `ask_app_status`, `create_embed_session`, and
  `TOOL_SEARCH_TOOL_NAME` (`= "tool-search"`, `build-server.ts:389`). Outside the full-catalog opt-in
  **the advertised set IS the callable set** — `tools/call` on an unlisted name returns
  `Unknown tool: <name>` (`:2107-2116`), and a source comment at `:435-438` says so explicitly:
  discovery is not permission. `templates/clips/server/plugins/agent-chat.ts` passes **no `mcp`
  option** (verified: only `appId`, `actions`, `initialToolNames`, `durableBackgroundRuns`,
  `extraContext`, `resolveOrgId`). **So `get-meeting` is not callable over MCP today.** The only
  reliably-callable clips tool over MCP is `ask_app` —
  `{ message: string (required), app?: string, async?: boolean, maxWaitMs?: number, approvedActions?: [{tool, input}] }`
  (`packages/core/src/mcp/builtin-tools.ts:1160-1211`).
- **A2A** is mounted at `POST /_agent-native/a2a` with a card at `GET /.well-known/agent-card.json`
  (`packages/core/src/a2a/server.ts:209-259`). Complete JSON-RPC method list: `message/send`,
  `message/stream`, `tasks/get`, `tasks/cancel`, `actions/invoke`
  (`packages/core/src/a2a/handlers.ts:1379-1414`); anything else is `-32601`. **`actions/invoke` is
  dead against clips for every action name.** `filterDirectA2AActions`
  (`packages/core/src/server/agent-chat/action-filters-a2a.ts:128-159`) requires
  `entry.publicAgent.expose === true && .readOnly === true && .requiresAuth === true`, and
  `grep -rn "publicAgent" templates/clips/actions/` returns **zero matches** (verified). Consequence:
  clips' agent card publishes `"skills": []` to anonymous *and* authenticated fetchers, and
  `actions/invoke` returns `status: "failed"` for everything.

  Natural-language `message/send` **does** work and runs the clips agent loop:
  ```http
  POST https://clips.agent-native.com/_agent-native/a2a
  authorization: Bearer <HS256 A2A JWT>
  content-type: application/json

  {"jsonrpc":"2.0","id":1,"method":"message/send",
   "params":{"message":{"role":"user","parts":[{"type":"text","text":"Summarize meeting mtg_abc123"}]},
             "async":true}}
  ```
  `async: true` returns a `Task` in `working`; poll `tasks/get` with `{"id":"<taskId>"}` until
  terminal (`submitted | working | processing | completed | failed | canceled | input-required`,
  `packages/core/src/a2a/types.ts:42-70`). Async in production **requires `A2A_SECRET`**
  (`handlers.ts:805-814`).

  To make `actions/invoke` work you must (a) add
  `publicAgent: { expose: true, readOnly: true, requiresAuth: true }` to each target clips action,
  and (b) add `mcp: { connectorCatalog: ["get-meeting","list-meetings"] }` or
  `mcp: { externalAgents: { authenticatedReads: "auto" } }` to
  `templates/clips/server/plugins/agent-chat.ts`. `search-recordings` would additionally need
  `publicAgent.allowRawQueryInput: true` because it has a string field named `query`
  (`hasRawQueryInput`, `action-filters-a2a.ts:94-108`).

**There is no action-discovery endpoint.** No OpenAPI document exists anywhere in
`packages/core/src`. `agent-native.json` is a local build/doctor manifest, not a served route
(`packages/core/src/cli/doctor.ts:106`). The only machine-readable manifests are
`/.well-known/agent-card.json` (empty for clips) and MCP `tools/list` (compact builtins only).
**Hardcode the action names from this document.**

### 4.4 Auth — which credential, where it comes from

**Recommended: an org service token.** Long-lived, org-owned, not tied to a person.

```http
POST https://clips.agent-native.com/_agent-native/actions/create-org-service-token
content-type: application/json
authorization: Bearer <a connect token from the device flow>

{"name":"context-agent","ttlDays":365}
```

Action at `packages/core/src/mcp/actions/create-org-service-token.ts:29`. Schema (`:32-45`):
`{ name: z.string().min(1).max(64), ttlDays?: z.number().int().min(1).max(365) }`. `toolCallable: false`
(`:47`) — HTTP/CLI only, not agent-invocable. Returns
`{ token, id, serviceName, serviceEmail, orgId, ttlDays, note }` (`:76-85`); **the token value is
returned exactly once and never stored**. Org owner/admin only. It is in `ALWAYS_ON_CORE_ACTIONS`
(`packages/core/src/server/action-discovery.ts:598-610`), so clips mounts it without any template
change.

**⚠️ First thing that breaks on a self-hosted or localhost clips.**
`create-org-service-token.ts:59-65` throws `ServiceTokenError(..., 500)` when it can resolve
*neither* an app URL *nor* `A2A_SECRET`:

```ts
    const appUrl = (getRequestContext()?.requestOrigin || getAppProductionUrl()).replace(/\/+$/, "");
    if (!appUrl && !process.env.A2A_SECRET?.trim()) {
      throw new ServiceTokenError(
        "Could not determine the app URL needed to mint a token. Set APP_URL on the deployment.",
        500,
      );
    }
```

For the likely context-agent dev setup — clips on localhost — set `APP_URL` or `A2A_SECRET` before
minting.

CLI equivalent:
`npx @agent-native/core@latest connect <appUrl> --service-token context-agent --ttl-days 365`
(`packages/core/src/cli/connect.ts:2469-2566`).

**Getting the bootstrap credential (headless device flow):**
1. `POST https://<clips>/mcp/connect/device/start` — no auth, no body →
   `{ device_code, user_code, verification_uri, verification_uri_complete, interval, expires_in }`
   (`packages/core/src/mcp/connect-route.ts:1273-1292`).
2. A human opens `verification_uri_complete` and approves
   (`POST /mcp/connect/device/authorize`, session-required, `:1295-1322`).
3. `POST /mcp/connect/device/poll` body `{"device_code":"<code>"}` →
   `{ status: "pending"|"approved"|"expired"|"consumed"|"not_found", token?, mcpUrl?, serverName?, mcpServerEntry? }`
   (`:1325-1409`).

**How the token is accepted.** The framework auth guard 401s any `/_agent-native/*` request without
a session (`packages/core/src/server/auth.ts:2552-2558`). `getBearerSession` (`auth.ts:866`) tries
the legacy `sessions` table first, then — **only on `/_agent-native/actions/*`**
(`isFrameworkActionRoute`, `auth.ts:851`) — `getMcpOAuthBearerSession` (`auth.ts:818`), which re-uses
the MCP `verifyAuth`: same signature check, same audience binding to this app's `/mcp` resource, same
revocation gate, resolving to `{ userEmail, orgId }`. Proven by the framework's own external caller
at `packages/core/src/cli/connect.ts:2509-2519` and by
`packages/core/src/server/action-route-connect-auth.spec.ts`.

**Two identity caveats.**
1. The service principal is a **synthetic email** `svc-<name>@service.<orgId>`
   (`connect-route.ts:338`, `serviceIdentityEmail`) that is deliberately **never inserted into
   `org_members`** (`packages/core/src/mcp/actions/service-token-access.ts:10-12`). Whether
   `resolveAccess("meeting", ...)` grants it a given meeting depends on org-visibility rules, not
   personal ownership. **Verify against a real meeting before building on it** — see §6.1.
2. `actionRouteAuth` (the adapter hook that would let an A2A JWT authenticate an HTTP action call,
   `action-routes.ts:252-274`) is **not set by any template or app in this repo** (verified by grep).
   Do not plan around it.

**A2A auth, if you go that route.** `Authorization: Bearer <HS256 JWT>` verified by `verifyA2AToken`
(`packages/core/src/a2a/server.ts:109-197`): peeks unverified `org_domain` to pick candidate secrets
— `process.env.A2A_SECRET` first, then the org's synced secret — then verifies signature, `exp`,
`aud` (when present), `iss` (when present). Claims minted by `signA2AToken`
(`packages/core/src/a2a/client.ts:145-192`): `sub` = caller email, `org_domain`, `iss` = caller's
`APP_URL`, `exp` default 15m. With **no** `A2A_SECRET` and no `apiKeyEnv`: open in dev with a console
warning, **503 in production** (`a2a/server.ts:528-541`); "production" detected broadly by
`isA2AProductionRuntime` (`packages/core/src/a2a/auth-policy.ts:7-25`).

**SSRF trap for a localhost target.** If your context agent is itself an Agent-Native app using
`@agent-native/core/a2a`, all outbound fetches go through `ssrfSafeFetch`; private/loopback targets
are allowed only when they match `workspacePrivateOrigins()` — `WORKSPACE_GATEWAY_URL`, `APP_URL`,
`BETTER_AUTH_URL`, or `AGENT_NATIVE_A2A_ALLOWED_ORIGINS` (comma-separated)
(`packages/core/src/a2a/client.ts:13-49`). Set `AGENT_NATIVE_A2A_ALLOWED_ORIGINS` **on the caller**.
A plain non-Agent-Native `fetch` has no such guard.

**Peer discovery.** A remote agent is a row in the resources table at path `remote-agents/<id>.json`
containing `{ id, name, description, url, color }` (`packages/core/src/resources/metadata.ts:35`,
`packages/core/src/resources/store.ts:1032-1095`) — **not a repo file**. Read surfaces:
`GET /_agent-native/agents[?selfAppId=<id>]` → `{ agents: [...] }`
(`packages/core/src/server/core-routes-plugin.ts:1838-1852`);
`GET /_agent-native/agents/probe?url=<base>` (session-required) returns `reachable` and `authorized`
independently (`core-routes-plugin.ts:1778-1830`) — your diagnostic for a mismatched A2A secret.

### 4.5 The brain export — the reference cross-app pattern

**Say this precisely: the Clips→Brain link is a signed HTTP webhook push, NOT A2A/JSON-RPC.** There
is no `call-agent` invocation anywhere in the export path. Brain's A2A surface is a *separate*,
read-only retrieval surface. Anyone looking for an A2A call in `export-to-brain.ts` will not find one.

**Sender side** — `templates/clips/actions/export-to-brain.ts:577`. Schema (`:580-587`):
`{ recordingId?: string, lookbackDays?: int 1..90 = 28, limit?: int 1..100 = 100, concurrency?: int 1..8 = 4, retryAttempt?: int 1..8, cursor?: string }`.
With `recordingId` → single export (requires `editor`, `:616-620`). Without → cursor-paginated
bounded backfill of the active org.

Wire payload, built at `export-to-brain.ts:241-259` (verbatim):
```jsonc
{
  "sourceKey": "clips",                              // HARDCODED literal, :242
  "externalId": "clips:recording:<recordingId>",     // :243
  "title": "<meeting.title || recording.title || 'Untitled recording'>",
  "participants": [{ "email": "...", "name": "...", "role": "organizer"|"participant" }],
  "occurredAt": "<meeting.actualStart || meeting.scheduledStart || recording.createdAt || now>",
  "transcript": "Summary\n<summaryMd>\n\nTranscript\n<fullText>",   // :236-239 — summary PREPENDED, not a field
  "segments": [{ "startMs": 0, "endMs": 1200, "text": "..." }],     // segment `source` is DROPPED here
  "sourceUrl": "<APP_URL>/r/<recordingId>",
  "tags": ["..."],
  "raw": { "recording": {...}, "meeting": {...}|null, "transcript": {...} }
}
```

Transport (`export-to-brain.ts:369-381`): `ssrfSafeFetch(destination.ingestUrl, { method: "POST",
headers: { "content-type": "application/json", authorization: Bearer <destination.ingestToken> },
body, signal: AbortSignal.timeout(10_000) }, { maxRedirects: 0 })`.

Credentials via `resolveBrainDestination()` (`:173-191`) → `resolveCredential` for
`BRAIN_INGEST_URL` and `BRAIN_INGEST_TOKEN`, org-scoped. **Never `process.env`.** Missing either is a
non-throwing typed skip: `{ status: "skipped", reason: "missing-ingest-url" | "missing-ingest-token" | "missing-request-context" }`.

Result union (`:308-349`): `{ status: "exported", captureId }` |
`{ status: "quarantined", sensitivityReceiptId, sensitivityDisposition }` |
`{ status: "skipped"|"failed", reason }`. Failure reasons are typed strings:
`brain-ingest-http-<status>`, `brain-ingest-invalid-response`, `brain-ingest-empty-response`,
`brain-ingest-timeout`, `brain-ingest-request-failed`, `empty-transcript`.

**Receiver side** — `templates/brain/server/routes/api/_agent-native/brain/ingest.post.ts`, prod URL
`https://brain.agent-native.com/api/_agent-native/brain/ingest` (hardcoded in
`templates/clips/scripts/configure-prod-brain-export.ts:64`). Registered as a public path at
`templates/brain/server/plugins/auth.ts:14`. Auth resolution (`ingest.post.ts:128-168`): bearer →
`sha256Hex(token)` → look up `brain_sources` where `status='active'` and `source_key` +
`ingest_token_hash` match → in-memory confirm → `runWithRequestContext({ userEmail: source.ownerEmail, orgId: source.orgId })`.
**Identity comes from the credential, never from a body field.** 401 "Missing token", 404 "Unknown source".

Token minting: `create-source` (`templates/brain/actions/create-source.ts:62-67`) mints
`brain_${nanoid(32)}`, stores only the SHA-256, returns plaintext once. Rotation via
`rotate-source-ingest-token` (`templates/brain/actions/rotate-source-ingest-token.ts:29-56`), which
is `agentTool: false, toolCallable: false` (`:32-33`).

**Quarantine returns HTTP 200 with `capture: null`** (`ingest.post.ts:218-222`). Clips correctly
reports `status: "quarantined"` rather than success. **A new sender that only checks `response.ok`
records silent data loss.** Check `capture !== null`.

**Durability ledger.** `templates/clips/server/lib/brain-export-state.ts:5-15` —
`{ recordingId, status: "pending"|"exported"|"quarantined"|"failed"|"skipped", attempts, updatedAt, nextAttemptAt?, captureId?, ... }`,
key prefix `clips-brain-export-` (`:3`), stored via `writeAppState`. Backoff
`min(15min, 30s * 2^(attempts-1))` (`export-to-brain.ts:426-429`), `MAX_ATTEMPTS = 8`
(`templates/clips/server/jobs/brain-export.ts:16`). The order matters: `queueBrainExport` writes the
pending row **first**, then dispatches (`request-transcript.ts:298-307`). If the dispatch is lost, the
60s sweep recovers it. **A bare `dispatchPostFinalizeJob` is fire-and-forget after a 250ms settle
(`post-finalize-dispatch.ts:19`, `:128-131`) and will silently drop work.**

**The five-part shape to copy for your context agent:**
1. Receiver exposes **one** public signed-webhook route for writes, listed in the auth plugin's
   `publicPaths`. Resolve tenant from `sourceKey` + SHA-256 of a bearer token, *then*
   `runWithRequestContext`.
2. Receiver mints the token once in a `create-source`-style action, stores only the hash, ships a
   separate admin-only non-agent-callable rotate action.
3. Sender defines **one** `defineAction` with a single-item mode and a cursor-paginated bounded
   backfill mode, resolving URL + token through `resolveCredential` (org-scoped).
4. Sender keeps a typed durable ledger in `application_state` with distinct
   `pending`/`exported`/`quarantined`/`failed`/`skipped` states, exponential backoff, `MAX_ATTEMPTS`,
   plus a sweep that also self-seeds recent untracked items (`brain-export.ts:23-73`,
   `DISCOVERY_LIMIT = 20`, `BACKFILL_DAYS = 7`).
5. Retrieval is a **completely different surface**: `http: { method: "GET" }` + `readOnly: true` +
   `publicAgent: { expose: true, readOnly: true, requiresAuth: true, isConsequential: false }` on
   question/search/get actions only. Brain's exposed set is exactly `ask-brain`
   (`templates/brain/actions/ask-brain.ts:182-184`), `search-everything` (`:68-75`),
   `search-knowledge` (`:23-30`), `get-knowledge` (`:15-22`); `get-capture` and `list-captures` are
   GET+readOnly but deliberately **not** `publicAgent` — raw captures are not enumerable over A2A.
   Preserve that boundary. Also add an `a2aMessageFallback`
   (`templates/brain/server/plugins/agent-chat.ts:67` → `templates/brain/server/lib/a2a-fallback.ts`)
   that answers deterministically when citations exist and returns `null` otherwise, so the agent
   loop is the fallback rather than the hot path.

**If you reuse clips as the sender unchanged, `sourceKey` is the hardcoded literal `"clips"`**
(`export-to-brain.ts:40`, `:242`) — your receiver must create its source with `sourceKey: "clips"`,
or you fork the action. There is no configuration knob.

**Audience-scoping hole to design around.** `resolveMeetingMemberEmails`
(`templates/brain/server/lib/meeting-audience.ts:22-38`) falls back to `[sourceOwnerEmail]` when no
participant emails resolve (`:33-36`), and clips sends `participants: []` for any recording with no
linked `meetings` row (`export-to-brain.ts:221-228`). **Ad-hoc captures — exactly what this branch's
detector produces — are the ones most likely to arrive with no participants**, so they land scoped to
the source owner alone rather than the real attendees.

**No delete propagation.** The ingest route supports `deleted: true` tombstones
(`ingest.post.ts:176-189`) but `export-to-brain.ts` never emits the field (verified by grep). Trashing
a clips recording leaves the downstream capture live. **DOES NOT EXIST — you must build that leg.**

### 4.6 Worked end-to-end example

Assume `CLIPS=https://clips.agent-native.com` and `$TOK` is an org service token from §4.4.

```bash
# T+0  — user hangs up. Desktop calls stop-meeting-recording (actions/stop-meeting-recording.ts:19),
#        which stamps actualEnd and sets transcriptStatus 'ready' iff transcript fullText is non-empty,
#        else 'failed' (:41-58). Then desktop/src/hooks/useMeetingTranscription.ts:212 calls
#        finalize-meeting. Recovery: server/jobs/stale-meeting-sweeper.ts closes out stranded
#        meetings every 5 min (SWEEP_INTERVAL_MS :44) and calls finalizeMeeting.run at :237.

# T+5s — context agent polls for the freshly-ended meeting
curl -s -H "authorization: Bearer $TOK" \
  "$CLIPS/_agent-native/actions/list-meetings?view=past&recordedOnly=true&limit=20"
# -> { "meetings": [ { "id": "mtg_abc", "title": "...", "actualEnd": "2026-08-11T15:04:11Z",
#                      "recordingId": "rec_abc", "transcriptStatus": "pending",
#                      "summaryPreview": null, ... } ],
#      "calendarErrors": [] }
# recordedOnly=true guarantees these ids are PERSISTED, so step 2 will not materialize a row.

# T+5s..T+120s — poll until ready
curl -s -H "authorization: Bearer $TOK" \
  "$CLIPS/_agent-native/actions/get-meeting?id=mtg_abc"
# transcriptStatus "pending" -> re-poll (finalize-meeting in flight; stale after 2 min,
#   finalize-meeting.ts:28 PENDING_STALE_MS)
# transcriptStatus "failed"  -> POST /_agent-native/actions/finalize-meeting {"meetingId":"mtg_abc","force":true}
# meeting === null           -> UNKNOWN CAUSE (missing | no access | trashed). Do not treat as "no meeting".

# T+~90s — ready. ONE response holds everything:
# {
#   "meeting": { "id":"mtg_abc", "title":"...", "actualStart":..., "actualEnd":...,
#                "recordingId":"rec_abc", "transcriptStatus":"ready",
#                "summaryMd":"## Decisions\n...", "bullets":[{"text":"..."}],
#                "actionItemsParsed":[{"assigneeEmail":"a@b.com","text":"...","dueDate":"..."}], ... },
#   "participants":[{"id":..,"meetingId":"mtg_abc","email":"a@b.com","name":"Ada","isOrganizer":true,...}],
#   "actionItems":[{"id":..,"meetingId":"mtg_abc","text":"...","assigneeEmail":"a@b.com","completedAt":null,...}],
#   "recording":{...},
#   "transcript":{"recordingId":"rec_abc","status":"ready","language":"en",
#                 "fullText":"<COMPLETE, UNTRUNCATED>",
#                 "segmentsJson":"[{\"startMs\":0,\"endMs\":1200,\"text\":\"...\",\"source\":\"mic\"}]"},
#   "role":"owner"
# }

# T+95s — OPTIONAL: credential-free frame/transcript handoff for a downstream reader
curl -s -X POST -H "authorization: Bearer $TOK" -H "content-type: application/json" \
  -d '{"recordingId":"rec_abc","agentLabel":"context-agent","ttlSeconds":604800}' \
  "$CLIPS/_agent-native/actions/create-recording-agent-link"
# -> { "recordingId":"rec_abc",
#      "url":"https://clips.agent-native.com/share/rec_abc?agent_access=<tok>",
#      "contextUrl":"https://clips.agent-native.com/api/agent-context.json?id=rec_abc&agent_access=<tok>",
#      "expiresAt":"...", "ttlSeconds":604800 }
# REMEMBER: contextUrl carries transcript + frames ONLY. summaryMd / bullets / actionItems
# must be forwarded INLINE from the get-meeting response above.
```

At the end, the context agent holds: full transcript text, timestamped segments, the AI summary
markdown, bullets, action items with assignees and due dates, the participant roster, and
(optionally) a 7-day scoped URL for frames.

---

## 5. Recurring workflows

> **SEPARATE WORKSTREAM.** Not implemented on this branch.

### 5.1 What an automation actually is

**Not a repo file.** Despite the `jobs/` naming, automations are **rows in the SQL resources store**,
loaded via `resourceListAllOwners("jobs/")` (`packages/core/src/triggers/dispatcher.ts:171`, `:214`).
The path convention is `jobs/<name>.md`, stripped at `dispatcher.ts:318`:

```ts
const triggerName = resource.path.replace(/^jobs\//, "").replace(/\.md$/, "");
```

Format is YAML frontmatter + a natural-language body. Two trigger types: `schedule` (5-field cron) and
`event`. **`mode` is effectively fixed to `"agentic"`** — `"deterministic"` is rejected at define time
and the dispatcher only warns and skips (`dispatcher.ts:299-303`). The body is a prompt run through a
full agent loop; **there is no way to bind a job directly to a specific action with fixed arguments.**

### 5.2 Declaring one — the agent tool

`manage-automations` (`packages/core/src/triggers/actions.ts:345`), `action` ∈
`list-events | list | define | update | delete | fire-test | run-now` (documented at `:349-356`).

**Call `action=list-events` first.** The tool description says so explicitly: "Call this BEFORE
defining an automation to discover available events."

`define` params (from the tool description at `actions.ts:351`): required `name`, `trigger_type`,
`body`; optional `scope`, `event`, `schedule`, `timezone`, `condition`, `mode`, `domain`,
`delegated_policy_id`, `model`, `mcpTools`.

**It is a native framework tool, not an HTTP action.** It is merged into `allScripts` and so is
reachable via `ask_app`, A2A `message/send`, and MCP (subject to the catalog gate), but there is **no
`/_agent-native/actions/manage-automations`**. The HTTP-reachable automation surface is
`manage-automation` (singular, `packages/core/src/triggers/actions/manage-automation.ts:10-21`),
schema `{ operation: "update"|"delete", name: string, scope: "personal"|"organization" = "personal", enabled?: boolean, schedule?: string, timezone?: string }`
with `agentTool: false` (`:12`). **It cannot create an automation.** Same for `manage-recurring-job`,
`list-automations`, `list-recurring-jobs`, `run-automation-now`, `list-automation-runs`.

**So: an external agent creates a recurring workflow by telling the clips agent to** — `ask_app` over
MCP or A2A `message/send`.

**⚠️ THE GAP THAT BLOCKS THE USER'S GOAL (a) AND ALL OF §5.**
`templates/clips/server/plugins/agent-chat.ts:15-37` defines `INITIAL_TOOL_NAMES` with 21 entries:
`view-screen`, `list-recordings`, `search-recordings`, `get-recording-player-data`,
`prepare-crm-call-evidence`, `request-transcript`, `create-recording`, `import-loom-recording`,
`update-recording`, `finalize-recording`, `cleanup-transcript`, `regenerate-summary`,
`regenerate-title`, `regenerate-chapters`, `trim-recording`, `remove-silences`,
`update-ai-request-status`, `remove-filler-words`, `export-to-brain`, `navigate`, `refresh-list`.

**Neither `get-meeting` nor `list-meetings` is among them.** The §4 HTTP path is unaffected — action
routes mount independently of the agent's initial tool set. But "chat with the clips agent about
meetings" depends on the agent reaching those tools via `tool-search`
(`TOOL_SEARCH_TOOL_NAME = "tool-search"`, `packages/core/src/mcp/build-server.ts:389`), which is a
discovery round-trip on every meetings question rather than a tool the agent already holds.

**Two options, both cheap; this is a decision for §6.1:**
- **(a) Verify `tool-search` reliably surfaces them** and accept the extra hop. No code change.
- **(b) Add `"list-meetings"` and `"get-meeting"` to `INITIAL_TOOL_NAMES`.** Two lines in
  `agent-chat.ts`. Makes meetings a first-class agent topic.

Neither has been done, and neither belongs on `clips-adhoc-meeting-detection`.

**Registration gotcha:** `refreshEventSubscriptions()` (`dispatcher.ts:170-203`) re-scans job
resources and reconciles bus subscriptions, tearing down orphans (`:185-190`). Every mutating action
calls it (e.g. `manage-automation.ts:33`, `:53`). **If you write a job resource without calling it,
the automation will not fire until the next server restart.**

### 5.3 What actually runs it

Chosen at `packages/core/src/server/agent-chat-plugin.ts:6120-6146`:

- **Long-lived runtime** (`pnpm dev`, container, VM): `setInterval(..., 60_000)` after a 10s startup
  delay (`:6134-6145`), calling `processRecurringJobs` (`packages/core/src/jobs/scheduler.ts:155`).
  `disableRecurringJobsRuntime` short-circuits this for local dev (`:6120-6125`).
- **Serverless**: a platform scheduler POSTs `/_agent-native/jobs/_process-sweep`
  (`RECURRING_JOBS_SWEEP_PATH`, `packages/core/src/jobs/scheduler-dispatch.ts:6`) with
  `Authorization: Bearer <internal token>`, subject `agent-native-recurring-jobs-sweep` (`:8-9`),
  verified at `agent-chat-plugin.ts:6087-6094`. It accepts **no job or owner input** by design
  (`scheduler-dispatch.ts:1-5`) and 503s if it lands on the synchronous server instead of the durable
  background worker (`:6095-6104`). Netlify emits the scheduled function at build time with
  `schedule: "* * * * *"` (`packages/core/src/deploy/build.ts:3140`), and a build-time assertion fails
  the build if that one-minute schedule is missing (`:3905-3910`). `A2A_SECRET` is required (`:3112`).

Cron is 5-field with IANA timezone support: `nextOccurrence`, `isValidCron`, `describeCron`,
`effectiveTimezone` (`packages/core/src/jobs/cron.ts:53,69,82,45`).

**No queue system.** No SQS/BullMQ/Redis. Concurrency control is an in-process `Set`
(`dispatcher.ts:84`) whose own comment says multi-instance deployments would need a conditional DB
update. Durability is optimistic compare-and-set on the resource row (`resourcePutIfCurrent`,
`dispatcher.ts:344-351`).

### 5.4 Reference: the Netlify cron generator

> Background reading. §5.5's payoff depends on none of it. Skip unless you are deploying a sweep to
> Netlify.

`templates/clips/jobs/emit-netlify-brain-export-cron.ts` is **not a job — it is a build-time code
generator** that writes two Netlify function files. Constants (`:11-14`):
`SCHEDULED_NAME = "clips-brain-export-cron"`, `WORKER_NAME = "clips-brain-export-sweep-background"`,
`ROUTE_PATH = "/api/clips/brain-export/run"`, `SCHEDULE = "* * * * *"`.

**The two-function split is the lesson.** Netlify scheduled functions have a short synchronous wall
clock, so a tiny cron-driven trigger (`:20-39`) does nothing but `fetch` a `background: true` worker
(`:41-77`) which re-enters the Nitro handler with the URL rewritten to `ROUTE_PATH`. The trigger treats
both `ok` and `202` as success (`:30`), because background functions return 202.

**Non-Netlify runtimes use a completely different path**: a plain `setInterval` in
`templates/clips/server/jobs/brain-export.ts:176-189`, hard-disabled on Netlify by
`if (process.env.NETLIFY === "true") return;` (`:161`) and gated on `RUN_BACKGROUND_JOBS=1` in dev
(`:162-173`). Any other serverless host must call `runBrainExportSweepOnce` from its own scheduler.

### 5.5 The payoff

Once §4.1 Option B lands (`meeting.finalized` registered and emitted with `{ owner }`), the user can
create both event-triggered and scheduled workflows against clips **purely through chat** —
`manage-automations action=list-events` then `action=define` — with no further engineering. **The
recurring-workflow layer is already built; only the event is missing** (and, for the chat experience,
the §5.2 tool-visibility decision).

Two traps to encode in any workflow you define:
- **Owner scoping.** Emit with `{ owner: ownerEmail }` or `automationMatchesEventOwner`
  (`dispatcher.ts:260-263`) silently drops it. Organization scope grants *visibility*, not broadcast.
- **Conditions fail closed.** A natural-language `condition` is classified by a fast model; on API
  failure it evaluates to **`false`** and the automation is silently skipped. A flaky classifier looks
  identical to "condition did not match." Cache is SHA-256 keyed, 5-min TTL, 500-entry LRU, payload
  truncated to 4000 chars.

### 5.6 Not the scheduler — do not wire here

`packages/scheduling` is a Cal.com-style **booking** product (event types, availability, round-robin
hosts, routing forms, Zoom/Teams/Meet providers). Its `create-workflow` / `toggle-workflow` actions
are **booking reminder workflows** (email/SMS around a booking), not agent automations. The directory
name is a trap.

---

## 6. Decisions, gaps, and backlog

### 6.1 Blocking decisions for the human

1. **`reset_dwell` in the mic gate** (§2.4). Shipped code resets, costing ~9s of extra latency after
   the mic goes live but ensuring the 9s dwell is measured during the call. Not resetting fires within
   ~4s of joining but weakens what the dwell means. **Currently resolved in code as "reset." Confirm
   or change; do not let an executor flip it silently.**
2. **Rust verification** (§1.8). `cargo` is not installed on this machine. Install the toolchain, or
   accept CI's `tauri build` compile check and a human-run `cargo test`? **Note that no `cargo test`
   runs anywhere in CI** (all workflows grepped).
3. **Manual acceptance** (§1.8 #5, §2.8 #3-4). Requires a human on macOS 14+ in a live Zoom/Teams
   call. Who runs it, and does the PR merge before or after?
4. **Meetings in the clips agent's initial tool set** (§5.2). Add `list-meetings` + `get-meeting` to
   `INITIAL_TOOL_NAMES` (`templates/clips/server/plugins/agent-chat.ts:15-37`), or rely on
   `tool-search`? Blocks the user's goal (a). **Separate branch.**
5. **Which clips actions should get `publicAgent`** (§4.3). Nothing in clips declares it (verified,
   zero matches). Exposing `get-meeting` and `list-meetings` is a product decision about what external
   agents may read without going through the agent loop, and also requires an `mcp:` option on
   `agent-chat.ts`. **Separate branch.**
6. **Push vs. poll for the post-call trigger** (§4.1 options A/B/C). Option B is ~20 lines and unlocks
   §5 entirely. **Separate branch.**

### 6.2 Does not exist — must be built if needed

7. **No meeting-lifecycle event.** Four registered events, all clip- or calendar-scoped
   (`db.ts:1709, 1722, 1733, 1743`). `finalize-meeting.ts` emits nothing (grep verified).
   **DOES NOT EXIST — you must build `meeting.finalized`;** §4.1 Option B is the executable spec.
8. **No inbound webhook for "call finished."** No route accepts an external call-ended callback. Only
   the outbound `export-to-brain` push exists. **DOES NOT EXIST.**
9. **No meeting-scoped agent-readable link.** `create-recording-agent-link` is recording-scoped; the
   `/api/agent-context.json` envelope never carries `summaryMd`, `bulletsJson`, `actionItemsJson`, or
   `participants`. **DOES NOT EXIST — pass the AI notes inline from `get-meeting`.**
10. **No delete/retire propagation** from clips to any downstream store (`export-to-brain.ts` never
    emits `deleted`). **DOES NOT EXIST.**
11. **No speaker diarization.** Segments carry `source: "mic" | "system"` only
    (`templates/clips/shared/transcript-segments.ts:1-6`). **DOES NOT EXIST.**
12. **No meeting-text search.** `search-recordings` (`templates/clips/actions/search-recordings.ts:96`)
    indexes `recordings`, `recording_transcripts.fullText`, and `recording_comments.content` —
    **never `clips_meetings`**. Summaries, user notes, and action items are not full-text searchable
    through any action. **DOES NOT EXIST.**
13. **No action-discovery endpoint.** No OpenAPI document exists in `packages/core/src`. Clips' agent
    card is `skills: []`; clips' MCP `tools/list` is the compact builtins. **DOES NOT EXIST — hardcode
    action names from §4.**
14. **`dispatchPostFinalizeJob` is not extensible.** Closed union
    (`post-finalize-dispatch.ts:10-15`) dispatched by a hardcoded if/else
    (`post-finalize-worker.post.ts:185-191`).
15. **Brain's `clips` connector is push-only and inert.**
    `templates/brain/server/lib/connectors.ts:3446-3452` returns the literal message "Clips connector
    configured. Export from Clips or add transcript payloads to source config." Brain never pulls;
    `sync-source` on a clips source does nothing.

### 6.3 Unverified — check before relying on it

16. **Org service token access to a specific meeting.** The service principal is a synthetic
    `svc-<name>@service.<orgId>` never inserted into `org_members`
    (`packages/core/src/mcp/actions/service-token-access.ts:10-12`). The bearer *does* resolve through
    `getMcpOAuthBearerSession` on `/_agent-native/actions/*` (`auth.ts:818`, `:851`, `:866`), and
    `create-org-service-token` is always mounted (`action-discovery.ts:598-610`) — but **no live
    request was run against a deployed clips instance to confirm `get-meeting` returns a non-null
    meeting for a service-token caller.** Do that first; it is a 30-second curl and it gates all of §4.
17. **Cannot assert `notify_meeting_starting` is invoked.** No Tauri test harness exists; the
    pure-function tests are the strongest this crate's conventions support.
18. **`kAudioProcessPropertyIsRunningInput` requiring macOS 14** was supplied as a given, not
    independently verified. What *is* verified from the repo: `MACOSX_DEPLOYMENT_TARGET: 13.0`
    (`.github/workflows/clips-desktop-build-check.yml:45`), and that the probe returns `None` on any
    CoreAudio failure (`call_activity.rs:62-64`, `:77-79`) — so the `None` path is reachable
    regardless of the exact cutoff.

### 6.4 Follow-up tickets — not decisions, do not file under "blocking"

19. **Wire `cargo test` into CI.** Zero `cargo test` invocations across all workflows; the 36 Rust
    `#[cfg(test)]` modules are only ever run by a human. `clips-desktop-build-check.yml:107-124` does
    compile the crate via `tauri build`, so compile breakage *is* caught — but no test ever runs.
    Genuine improvement, separate PR.
20. **Benchmark CoreAudio enumeration at a 4s cadence** on a machine with many audio clients. The
    "acceptable" judgement reasons from the existing 10s-cadence use, not from measurement.
21. **Trace A2A `message/stream`** if the context agent needs streaming rather than
    poll-until-terminal (`packages/core/src/a2a/handlers.ts:965`).
22. **Document end-to-end latency** from "transcript ready" to "answerable downstream." Known bounds
    only: post-finalize dispatch is immediate; the retry sweep is 60s; Brain distillation has
    `MAX_ATTEMPTS = 3` and a 5-min headless timeout
    (`templates/brain/jobs/process-ingest-queue.ts:36-39`); and `write-knowledge` may return
    `mode: "proposal"` requiring human approval before the content is answerable as knowledge.
23. **Deduplicate the bundle-id lists.** `STRONG_VC_BUNDLES` (`adhoc_meetings_watcher.rs:36-42`) and
    `default_call_app_bundle_ids` (`call_activity.rs:8-18`) hold the same four bundle ids in different
    shapes. Consolidating forces an edit to the call-ended watcher's candidate-selection path
    (`silence_detector.rs:420-426`) for zero behavior change. Follow-up.