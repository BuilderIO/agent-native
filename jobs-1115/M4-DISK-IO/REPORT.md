# M4-DISK-IO — Spotlight and watcher load

Date: 2026-11-15 (M4, PST)

## Outcome

Moved `~/.replicate/measure/profiles` under `~/.replicate/.noindex/profiles` and left `~/.replicate/measure/profiles -> ../.noindex/profiles`. The directory contained 376,363 files; no contents were edited or deleted. Move completed at 15:08 PST. The original path resolves through a relative symlink; a sampled file resolves through both names to the same inode. A Spotlight count on the new target is 0. No watcher was stopped: the inventory found no watcher that was both idle and confirmed job-launcher-owned.

## Before and after measurements

| Measurement | Coordinator baseline, 14:52–14:58 | Pre-change sample, 15:02–15:05 | 10-minute post-change sample |
|---|---:|---:|---:|
| Load average (1 / 5 / 15 min) | 230 / 180 / 154 | 248.38 / 236.60 / 202.34 | 232.61 / 233.48 / 225.05 at 15:18 |
| `mds` CPU | ~70% | 7.0% at 15:03 | 1.6% at 15:18 |
| `mds_stores` CPU | not supplied | 0.6% at 15:03 | 1.6% at 15:18 |
| `fseventsd` CPU | ~41% | 20.2% at 15:05 | 5.0% at 15:18 |
| Spotlight count, `~/.replicate` | 396,230 | 396,230 | 1,152 at 15:13 (+5m) and 15:18 (+10m) |
| Spotlight count, moved `measure/profiles` target | not separated | not separated | 0 immediately, at +5m, and at +10m |
| Comparable Calendar gate run | 3m47s (14:35:12–14:38:59) | median 3m47s of latest three | 5m04s (15:09:07–15:14:11), green; +77s vs median |

The 15:02–15:05 CPU figures are sampled process CPU from `ps`, not the coordinator's earlier peak. Load climbed during the pre-change sample. The +10-minute sample was taken at 15:18, ten minutes after the move.

### Gate duration baseline

The latest three completed Calendar runs in `hosting/autogate/*.result.json` were:

- 14:52:31–14:56:41 — 4m10.5s
- 14:35:12–14:38:59 — 3m47.0s
- 14:26:43–14:28:49 — 2m06.6s

Median: **3m47.0s**. The run at 14:52 preceded this change. The next comparable Calendar run completed green in 5m04s, 77 seconds slower than the 3m47s baseline median. The active GMAIL process (PID 21399) remains live on attempt 3 after earlier `unreadable` candidate-tree results; it was left untouched as requested. The Calendar run has a structured `.result.json` with timestamps and result; it has no plain `.log` sidecar.

## Indexed folders and churn

| Folder | Indexed items / query result | File count or 5-minute file-change sample | Disposition |
|---|---:|---:|---|
| `~/.replicate` | 396,230 | `measure/profiles`: 376,363 files; `chrome-bundles`: 698; `scrub-cache`: 11; `work`: 15; `qa-fleet-chrome`: 0 files | Moved only `measure/profiles` beneath `.noindex`; old path is a symlink |
| `~/.replicate/measure` | child `mdfind` query returned 0 | 1 file changed in 5 min (`audit/forms-2.jsonl`); no open descriptors found under `measure` | Retained parent and audit path |
| `~/m4-jobs` / `pool` | 0 / 0 | `pool`: 57 files changed in 5 min | No Spotlight exclusion needed based on index query; active job pool retained |
| `~/m4-jobs/wt.noindex` / `app-slots.noindex` | wt query timed out at 15s; app-slots 0 | both had 0 recent changes in sampled period | Already `.noindex`; left in place |
| `~/Projects/builder`, `~/Projects/re/labs-wt`, `~/Projects/re/wt`, `~/Projects/builder/replicate-wt` | 0 each (coordinator counts) | not sampled | Left in place |
| `agent-native/.tmp/replica-home/jobs-1115` | 0 when queried directly | 19,016 files changed in 5 min | Active job/worktree area; no path move |
| `agent-native/.tmp` | coordinator query timed out at 15s | — | Left in place; active sessions and worktrees use these paths |

`mdutil -s` returned “unknown indexing state” for the queried folder paths. Unprivileged `fs_usage` is rejected (`must be run as root`); `lsof -c mds` returned no rows. The provided Spotlight counts and filesystem churn samples were used instead. A first child-count command hit zsh's unmatched hidden-file glob; it made no changes and was rerun with `find`, which identified `measure/profiles` as the 376,363-file child.

## Watcher inventory

| PID | Command | CWD | Age / activity evidence | Decision |
|---:|---|---|---|---|
| 39543 | Vite dev | `desktop-wt-one-agent/apps/web` | about 5h51; Steve's desktop demo | Left running as directed |
| 41418, 41503, 41515 | `vp pack --watch` | `desktop-wt-one-agent/apps/desktop` | about 5h51; Steve's desktop demo | Left running as directed |
| 56051, 56064 | `agent-native dev` / Vite | `wt-fleet-prs/apps/fleet` | about 24 min; child of active Codex session, Vite process active | Left running; app session is active |
| 12146 | `node .../MEETING-NOTES-QA-B/watch-served.ts` | `.tmp/replica-home/jobs-1114/MEETING-NOTES-QA-B` | about 3h24; `served-watch.json` says `waiting-for-deployment` and updates while observed | Left running; not idle |
| 74003 | `node .../MAIL-BY-4AM/watch.ts` | `.tmp/replica-home/jobs-1114` | about 2h10; child of active Codex PID 93588; watch status continued updating | Left running; app-session-owned |
| 58539, 58608 | Bun `server.ts` | Claude `local-agent-mode-sessions/.../rpm/plugin_01VdXP3hUf4WXSKxP9zJ7b26` | about 2m30; active Claude session | Left running as directed |
| — | Vitest run (not `--watch`) | `Projects/re/labs-wt/labs-host-r1/packages/core` | had ended by 15:13 readback | No stop action |
| 29094 | Node test runner | Claude scratchpad | active Claude-owned test process | Left running |

Stopped: **0**. Restart commands/PIDs: none.

## Change details

### Exclude the largest indexed profile subtree

- **What it replaces:** Spotlight indexing for `~/.replicate/measure/profiles`, the largest identified indexed subtree.
- **Baseline:** 376,363 files under that folder; `~/.replicate` counted 396,230 items. Move check: the new target returns 0; old path remains resolvable as a symlink.
- **Rollback:** `rm "$HOME/.replicate/measure/profiles" && mv "$HOME/.replicate/.noindex/profiles" "$HOME/.replicate/measure/profiles"`
- **24-hour readback:** confirm `readlink ~/.replicate/measure/profiles` is `../.noindex/profiles`, `test -d ~/.replicate/measure/profiles` succeeds, then rerun `mdfind -count -onlyin ~/.replicate "kMDItemFSName == '*'"` and the same M4 load / process CPU sample.

No script was edited, so no `.prev-diskio-1115` backup was needed. No password-only operation remains (`needs_steve=none`).
