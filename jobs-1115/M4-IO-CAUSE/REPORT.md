# M4-IO-CAUSE — process-level disk I/O measurement

Date: 2026-11-15 (M4, PST)
Host: `Mac16,5` (`Steves-MacBook-Pro-2.local`; M4)
Free space at start: 102 GiB (15 GiB floor clear)

## Outcome

The largest measured I/O came from broad, overlapping `rg` scans launched inside Codex CLI sessions, followed by `find` and Node processes. Two long-running `rg` processes shared all seven scan roots and ran concurrently under the same Codex parent; a third large `rg` run came from a second Codex parent. `rg` accounts for 166.1 GiB read/written over the ten-minute sample. Load eased as those searches finished, but disk throughput stayed high.

The top readers were children of Codex CLI sessions, which this job explicitly says not to touch. The other leading `find` readers also traced to Codex CLI sessions. I did not stop, throttle, or alter those sessions, any lane/pool/landing/gate process, a LaunchAgent, or the desktop demo. No safe fleet-owned duplicate scanner or telemetry job was identified as the top cause, so no live remediation was made. A fix and the required ten-minute post-fix window remain pending with the owners of those scans.

## Measurements

The ten-minute baseline ran 16:04:19–16:14:19. Process byte counters came from `proc_pid_rusage` flavor 4, using the SDK-declared `ri_diskio_bytesread` and `ri_diskio_byteswritten` offsets; `top -stats ... diskio` is unsupported on this macOS. `iostat -d -w 5 -c 120` returned 120 five-second samples. `fs_usage` was not used; no sudo access was available.

| Metric | Scan-heavy start / first minute | Final scan-light minute / end | Ten-minute or other observation |
|---|---:|---:|---:|
| Load average 1 min | 355.9 at 16:04:49 | 214.7 at 16:14:19 | mean 298.3; peak 355.9 |
| `disk0` throughput | first 6 `iostat` samples: 448.9 MB/s, 57,553 tps | last 6 samples: 679.5 MB/s, 67,697 tps | mean 615.5 MB/s, 65,156 tps; range 240.9–1,814.1 MB/s |
| Labs integrate `git status --short` | not measured before this observation | 2.62 s, exit 0 | single current-path timing; no pre/post-fix comparison |
| Fixed `rg -l defineAction packages/core/src` | not measured before this observation | 0.59 s, exit 0 | single current-path timing; no pre/post-fix comparison |
| Next gate run | — | not observed | prior M4-DISK-IO report records a 5m04s Calendar run; no new comparable run was captured here |

The scan-heavy and scan-light columns compare points within the untouched baseline, not an intervention. Disk throughput rose in the final six samples even as load dropped, so the load change does not prove that the device I/O was fixed. There is no post-change ten-minute measurement because no safe change was made.

At 15:54 the initial spot sample was load 205.27 / 197.10 / 202.98 (1 / 5 / 15 min). Its six `iostat` samples ranged from 238 to 554 MB/s on `disk0`. The main ten-minute sample began later while the overlapping scans were active.

## Ranked process families

Rates below are total sampled process read+write bytes divided by the 600-second window. Counts are a separate census taken around 16:26, after the ten-minute sample; process counts varied during the window.

| Rank | Family | Bytes over 10 min | Mean rate | Count at census | Evidence / owner |
|---:|---|---:|---:|---:|---|
| 1 | `rg` | 166.1 GiB | ~298 MB/s | 7 | PIDs 55556 and 56983 shared seven roots and parent Codex PID 95153; PID 36803 belonged to Codex PID 21514. PID 93994 had a 13.57 GiB single 30-second delta; its parent had exited before owner tracing. |
| 2 | `find` | 30.4 GiB | ~54 MB/s | 16 | Sampled active PIDs 48861, 18504, and 26943 traced to Codex CLI sessions. |
| 3 | `node` | 18.3 GiB | ~33 MB/s | 101 | Several high readers; no single fleet-owned scanner was established. |
| 4 | `Python` | 11.7 GiB | ~21 MB/s | 182 | Several processes; none was established as a fleet-owned duplicate scanner. |
| 5 | `spotlightknowledged.updater` | 5.3 GiB | ~9 MB/s | 1 | Apple process, parent launchd; below the search processes. |
| 6 | `grep` | 3.3 GiB | ~6 MB/s | 2 | Read activity was below `rg` / `find`. |
| 7 | `git` | 3.2 GiB | ~6 MB/s | 13 | No single status process led the I/O ranking. |

Largest observed 30-second process deltas included `rg` PID 93994 at 13.57 GiB, PID 56983 at 5.95 GiB, PID 55556 at 5.24 GiB, and PID 36803 at 4.65 GiB. `rg` PIDs 55556 and 56983 had different argv but the same seven search roots: `~/.config/replica-workers`, `~/Projects/re/kit-local`, `~/Projects/re/tools/clone`, `~/m4-jobs`, `~/m5-jobs`, `.tmp/replica-home/jobs-1114`, and `.tmp/replica-home/jobs-1115`. Their shared parent was Codex PID 95153. These were overlapping full-tree reads, not a LaunchAgent job.

The process-family census also found 1 `ugrep`, 2 `grep`, 13 `git`, 0 `vitest`, 2 `du`, 0 `rm`, and 0 `pnpm` processes at about 16:26. Thread census around 16:20 found 208 runnable (`R`) and 18 uninterruptible (`U`) threads; `U` is a proxy for uninterruptible wait, not a definitive per-thread I/O attribution. The independent `while`/`until` plus `sleep` shell-command scan found 0 active loops; this did not reproduce the earlier audit's count of 21. The sampled worktree-prune log showed its candidate check in progress near the end, but no `rm` process was present in the final process census; WORKTREE-PRUNE was left untouched and no delete bytes were assigned to it.

## LaunchAgents and repeated work

The current inventory contains 93 user LaunchAgent plists (the earlier audit counted 92). Interval distribution: 44 on-demand, 13 calendar-triggered, 8 at 60 s, 8 at 300 s, 8 at 3600 s, 5 at 900 s, 3 at 600 s, 2 at 120 s, 1 at 30 s, and 1 at 7200 s. The attached [`LAUNCHAGENTS.tsv`](LAUNCHAGENTS.tsv) records each label, interval, launchd state/run count/last exit, active PID elapsed time where available, and stdout-log modification time. Launchd does not expose a historical runtime duration for an inactive job, so the log timestamp is the available last-run proxy.

Short-interval jobs reviewed and left unchanged:

- `com.steve.re.labs-merge-retry` (30 s) and `com.steve.re.pool-landing-drain` (120 s) are landing work and were not touched.
- The 60 s offchat queue/audit/intake/morning/ledger jobs were left untouched; the Mail hold was not accessed.
- `com.steve.disk-free-curve` (60 s) and `com.steve.re.fill-pulse-1115` (60 s) are telemetry, but were not among the leading process readers.
- `com.steve.re.batch-slots-metrics-1115` (300 s) was not a leading reader. `com.steve.fleet-pulse` (300 s) and the offchat queue/ledger jobs show nonzero last exit codes in the inventory; their failures were not part of this I/O remediation and were not altered.

No `mds` process ranked in the leading disk readers. `spotlightknowledged.updater` used measurable bytes, but only about 3.2% of the `rg` family's sampled volume. This supports the earlier finding that reducing `mds` CPU did not address the dominant I/O.

## Changes, rollback, and remaining work

- Live M4 changes: none.
- Backup suffix `.prev-iocause-1115`: none needed; no live script or plist was edited.
- Stopped labels: none.
- Rollback: none; no live change to reverse.
- 24-hour readback: none scheduled because no live change was made.
- Gate duration after a change and the requested ten-minute post-change load/I/O sample: not available.

The required remediation is to have the owners of the Codex scans scope those broad searches to changed paths, then repeat the 10-minute load / `iostat` / rusage sample and capture a subsequent gate run. This job did not attempt that change because the measured processes fall inside the explicit do-not-touch boundary.
