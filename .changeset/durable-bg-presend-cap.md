---
"@agent-native/core": patch
---

fix(agent): time-cap durable background pre-send context reads so a single hung read can't freeze the worker. Previously a pre-send DB read that hung (rather than erroring) in a background-function worker stalled the run until the foreground inline-recovery grace (~16s), wasting the durable budget and leaving the run un-claimed. Each pre-send step now degrades to a safe default on timeout (background worker only; foreground unchanged), and a rejected step (e.g. message enrichment) falls back instead of failing the whole batch.
