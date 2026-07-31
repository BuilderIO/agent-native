---
"@agent-native/core": patch
---

Stop paying for background sweeps and no-change polls that find nothing.

A workspace runs one server per app, so every recurring sweep multiplies by app
count. Several of them queried unconditionally: the 20-second unclaimed-run
sweep issued two `agent_runs` scans back to back, the A2A continuation retry ran
two blind `UPDATE`s before ever checking whether anything was due, the MCP config
refresh scanned the whole settings table every minute to diff a signature that
had not moved since boot, and the Google Docs poller re-read its config every 30
seconds even on deployments where the integration was never enabled. On local
SQLite that was free; on a remote or metered database each one is a network round
trip, forever, per app.

Each of those now leads with a cheap existence probe or an in-process change
signal, so the idle case costs one round trip instead of several and the work
still runs the moment there is any. The poll route gets the same treatment: its
legacy watermark scan read `application_state` four separate times per check,
and now reads `MAX(updated_at)` once and only fans out when that advances — a
cost that repeated per app per connected client.

Detection latency is unchanged: every probe is a strict superset of the predicate
it guards, and the negative caches are all narrower than the staleness window
they sit in front of.
