---
"@agent-native/core": minor
---

Add optional name-based tracking to `runMigrations` (`@agent-native/core/db`): a migration entry can now set a stable, unique `name` slug that is tracked independently of its `version` number in a companion `<table>_named` bookkeeping table. This fixes a collision class where two branches that each independently extend the same migration list under the same version numbers cause whichever deploys first to "claim" those version numbers, silently skipping the other branch's DDL forever — the exact failure that left the analytics template's `analytics_alert_rules`, `analytics_alert_incidents`, and `session_recordings.network_error_count` missing in production despite `analytics_migrations` reporting every version as applied. Unnamed migrations keep the exact legacy `version > MAX(version)` behavior; a duplicate `name` in a migration list throws at startup.
